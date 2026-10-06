import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import {
  deleteLiveActivitySession,
  deleteMyLiveActivitySessions,
  deleteMyLiveActivitySessionsForGroups,
  getOrCreateLiveActivityDeviceId,
  upsertDeviceActivityToken,
  updateDeviceActivityAccent,
  upsertLiveActivitySession,
  type LiveActivityTokenRegisterResult,
} from '../api/services/LiveActivityService';
import { liveActivity, notifications, type GroupActivityState } from '../native';
import type { TravelMode } from '../utils/geo';
import { LiveActivityLifecycleReconciler } from '../utils/liveActivityLifecycle';
import { decidePushTokenAdoption } from '../utils/liveActivityPushTokenAdoption';
import { getSharedLiveActivityTokenGate } from '../utils/liveActivityTokenGate';
import { diagnostics } from './diagnostics';
import { useSession } from './SessionContext';
import { useForegroundUi, isForegroundUi } from './foregroundUi';

/** Allow-listed register outcome only — never the push token itself. */
function recordTokenRegisterResult(result: LiveActivityTokenRegisterResult): void {
  // Successful quiet path: skip noisy diagnostics on every cold start.
  if (result === 'upserted' || result === 'benign_idempotent') return;
  void diagnostics
    .write({
      event: 'live_activity_token_register',
      source: 'live_activity',
      errorCode: result,
      success: result === 'reclaimed_own_token',
      reason: result,
    })
    .catch(() => undefined);
}

export interface LiveActivitySessionContext {
  groupId: string;
  navigationSessionId?: string;
  destinationId: string;
  initialDistanceM: number;
  travelMode: TravelMode;
}

/**
 * End every Hither Live Activity on device and drop matching DB sessions.
 * Call on leave / sign-out / MyTeams leave / cold start so lock-screen
 * orphans cannot stick after the in-memory activity handle is lost.
 */
export async function clearLiveActivities(opts?: {
  groupIds?: string[];
  /** Terminal authentication cleanup must not call an authenticated API. */
  localOnly?: boolean;
}): Promise<void> {
  await liveActivity.endAllGroupActivities();
  if (opts?.localOnly) return;
  if (opts?.groupIds?.length) {
    await deleteMyLiveActivitySessionsForGroups(opts.groupIds).catch(() => undefined);
  } else {
    await deleteMyLiveActivitySessions().catch(() => undefined);
  }
}

export function useLiveActivity(
  active: boolean | undefined,
  state: GroupActivityState,
  session?: LiveActivitySessionContext,
  liveActivitiesEnabled = true,
): void {
  const { user } = useSession();
  const foreground = useForegroundUi();
  const lastPersistAtRef = useRef(0);
  const lastDisplayRef = useRef({ at: 0, semantic: '', payload: '' });
  const displayQueueRef = useRef(Promise.resolve());
  const lastPersistedAccentRef = useRef<string | undefined>(undefined);
  const stateRef = useRef(state);
  const sessionRef = useRef(session);
  const pushToStartTokenRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const enabledRef = useRef(liveActivitiesEnabled);
  const activeRef = useRef(active);
  const userIdRef = useRef<string | null>(user?.id ?? null);
  const reconcilerRef = useRef<LiveActivityLifecycleReconciler | null>(null);
  stateRef.current = state;
  sessionRef.current = session;
  enabledRef.current = liveActivitiesEnabled;
  activeRef.current = active;
  userIdRef.current = user?.id ?? null;

  const currentScopedState = (): GroupActivityState => ({ ...stateRef.current,
    ...(sessionRef.current ? { destinationId: sessionRef.current.destinationId,
      navigationSessionId: sessionRef.current.navigationSessionId } : {}) });

  if (reconcilerRef.current == null) {
    reconcilerRef.current = new LiveActivityLifecycleReconciler({
      endGroupActivity: (activityId) => liveActivity.endGroupActivity(activityId),
      endAllGroupActivities: () => liveActivity.endAllGroupActivities(),
      startGroupActivity: (intent) => liveActivity.startGroupActivity({ ...stateRef.current,
        destinationId: intent.destinationId, navigationSessionId: intent.navigationSessionId }),
      listGroupActivities: () => liveActivity.listGroupActivities(),
      deleteSession: (activityId) =>
        deleteLiveActivitySession(activityId).catch(() => undefined),
      deleteAllSessions: () =>
        deleteMyLiveActivitySessions().catch(() => undefined),
      ensureStartPermission: async () => {
        // Android 13+ requires POST_NOTIFICATIONS before the foreground
        // service notification can appear on the lock screen.
        if (Platform.OS !== 'android') return true;
        return notifications.requestPermission();
      },
    });
  }

  /** Min interval between Supabase live_activity_sessions upserts (local LA still updates more often). */
  const PERSIST_MIN_MS = 15_000;

  const persistSession = async (
    activityId: string,
    opts?: { force?: boolean },
  ): Promise<void> => {
    const currentSession = sessionRef.current;
    const currentState = currentScopedState();
    if (
      !currentSession ||
      reconcilerRef.current?.currentHandle !== activityId ||
      !reconcilerRef.current.ownsScope(currentSession.destinationId, currentSession.navigationSessionId) ||
      currentState.distanceMeters == null ||
      currentSession.initialDistanceM <= 0
    ) {
      return;
    }
    const now = Date.now();
    if (!opts?.force && currentState.accentHex === lastPersistedAccentRef.current
      && now - lastPersistAtRef.current < PERSIST_MIN_MS) {
      return;
    }
    lastPersistAtRef.current = now;
    const actorId = userIdRef.current;
    if (!actorId) return;
    await upsertLiveActivitySession({
      ...currentSession,
      activityId,
      pushToken: reconcilerRef.current?.currentPushToken,
      currentDistanceM: currentState.distanceMeters,
      sampledAtMs: currentState.sampledAtMs,
      etaTargetAtMs: currentState.etaTargetAtMs,
      etaSeconds: currentState.etaSeconds,
      progress: currentState.progress,
      accentHex: currentState.accentHex,
    }, actorId);
    lastPersistedAccentRef.current = currentState.accentHex;
  };

  useEffect(() => {
    const subscription = liveActivity.addPushTokenListener((event) => {
      const reconciler = reconcilerRef.current;
      if (!reconciler || activeRef.current !== true || !sessionRef.current?.destinationId) return;
      const decision = decidePushTokenAdoption({
        eventActivityId: event.activityId,
        eventPushToken: event.pushToken,
        eventNavigationSessionId: event.navigationSessionId,
        eventDestinationId: event.destinationId,
        currentDestinationId: sessionRef.current.destinationId,
        currentHandle: reconciler.ownsScope(sessionRef.current.destinationId, sessionRef.current.navigationSessionId)
          ? reconciler.currentHandle : null,
        currentNavigationSessionId: sessionRef.current?.navigationSessionId,
      });
      if (decision.action === 'ignore') return;

      // Adopt before persist so Supabase receives this event's token bound to
      // the same activity id. Skip persist when adopt fails.
      const adopted = decision.observeExisting
        ? reconciler.adoptObservedActivity({
            activityId: decision.activityId,
            pushToken: decision.pushToken,
            destinationId: event.destinationId,
            navigationSessionId: event.navigationSessionId,
          })
        : reconciler.adoptPushToken(decision.activityId, decision.pushToken);
      if (!adopted) return;

      void persistSession(decision.activityId, { force: true }).catch(() => undefined);
    });
    return () => subscription.remove();
    // The listener reads mutable refs so token rotation never resubscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (session?.navigationSessionId) {
      void liveActivity.observeExistingActivities().catch(() => undefined);
    }
  }, [session?.navigationSessionId]);

  useEffect(() => {
    let cancelled = false;
    const persistToken = async (token: string | null) => {
      pushToStartTokenRef.current = token;
      const deviceId = deviceIdRef.current ??
        await getOrCreateLiveActivityDeviceId();
      if (cancelled) return;
      deviceIdRef.current = deviceId;
      const uid = userIdRef.current;
      if (!uid) return;
      const gate = getSharedLiveActivityTokenGate();
      await gate.ready();
      if (cancelled) return;
      const identity = {
        userId: uid,
        deviceId,
        token,
        enabled: enabledRef.current,
      };
      const decision = gate.shouldRegister(identity);
      if (decision.action === 'skip') {
        // Permanent conflict / idempotent cache / backoff — no network, no spam.
        return;
      }
      try {
        const result = await upsertDeviceActivityToken(
          deviceId,
          token,
          enabledRef.current,
          stateRef.current.accentHex,
          uid,
        );
        gate.recordResult(identity, result);
        recordTokenRegisterResult(result);
      } catch {
        // Non-unique failures throw (orThrow) — feed gate so retries are bounded.
        gate.recordResult(identity, 'unknown_error');
        recordTokenRegisterResult('unknown_error');
      }
    };
    const subscription = liveActivity.addPushToStartTokenListener(({ token }) => {
      void persistToken(token).catch(() => undefined);
    });
    void getOrCreateLiveActivityDeviceId().then((deviceId) => {
      if (!cancelled) deviceIdRef.current = deviceId;
    }).catch(() => undefined);
    void liveActivity.startPushToStartTokenObservation().catch(() => undefined);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!user?.id || !state.accentHex) return;
    void getOrCreateLiveActivityDeviceId().then((id) =>
      updateDeviceActivityAccent(id, state.accentHex!),
    ).catch(() => undefined);
  }, [user?.id, state.accentHex]);

  useEffect(() => {
    const deviceId = deviceIdRef.current;
    const uid = userIdRef.current;
    if (!deviceId || !uid) return;
    const gate = getSharedLiveActivityTokenGate();
    void gate.ready().then(() => {
      const identity = {
        userId: uid,
        deviceId,
        token: pushToStartTokenRef.current,
        enabled: liveActivitiesEnabled,
      };
      const decision = gate.shouldRegister(identity);
      if (decision.action === 'skip') return;
      void upsertDeviceActivityToken(
        deviceId,
        pushToStartTokenRef.current,
        liveActivitiesEnabled,
        stateRef.current.accentHex,
        uid,
      )
        .then((result) => {
          gate.recordResult(identity, result);
          recordTokenRegisterResult(result);
        })
        .catch(() => {
          // Thrown soft-fail paths must still enter backoff / stop auto-spam.
          gate.recordResult(identity, 'unknown_error');
          recordTokenRegisterResult('unknown_error');
        });
    });
  }, [liveActivitiesEnabled, user?.id]);

  // Generation-aware start/stop (#146) — serialized; stale end-all cannot kill new activity.
  useEffect(() => {
    const reconciler = reconcilerRef.current;
    if (!reconciler) return;

    if (active && session?.destinationId) {
      void reconciler
        .request({ kind: 'start', destinationId: session.destinationId, navigationSessionId: session.navigationSessionId })
        .then(() => {
          const handle = reconciler.currentHandle;
          if (handle && sessionRef.current && reconciler.ownsScope(sessionRef.current.destinationId, sessionRef.current.navigationSessionId)) {
            void liveActivity.updateGroupActivity(handle, currentScopedState()).catch(() => undefined);
            void persistSession(handle, { force: true }).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    } else if (active === false) {
      // Journey off — clear native + DB sessions.
      // Do NOT tear down while active but session is still hydrating (GPS baseline).
      void reconciler
        .request({ kind: 'stop', clearSessions: true })
        .catch(() => undefined);
    } else if (active && !session) {
      // Active journey but session not ready yet — leave existing activity alone.
    } // Unknown/hydrating state must not end a native activity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, session?.destinationId, session?.navigationSessionId]);


  const arrivalSignature = state.memberArrived?.map((arrived) => (arrived ? '1' : '0')).join('');
  // BUG-05: emoji changes must also push a Live Activity update.
  const emojiSignature = state.memberEmojis?.join(',') ?? '';
  const destinationEmojiSig = state.destinationEmoji ?? '';

  useEffect(() => {
    // Native may have received a newer headless update while hidden. Returning
    // to the foreground sends the current snapshot without changing its ETA.
    if (!foreground) lastDisplayRef.current = { at: 0, semantic: '', payload: '' };
  }, [foreground]);

  useEffect(() => {
    const handle = reconcilerRef.current?.currentHandle;
    if (!active || !handle || !session || !reconcilerRef.current?.ownsScope(session.destinationId, session.navigationSessionId)
      || !foreground || AppState.currentState !== 'active') return;
    const semantic = JSON.stringify([session?.navigationSessionId, session?.destinationId, state.status, state.personalArrived, state.personalArrivalAtMs, state.personalArrivalSequence, state.gatheredCount,
      state.memberCount, state.gatheringTitle, state.groupName, state.accentHex, state.travelMode,
      arrivalSignature, emojiSignature, destinationEmojiSig, state.language]);
    const payload = JSON.stringify(currentScopedState());
    const last = lastDisplayRef.current;
    if (last.payload === payload) return;
    let cancelled = false;
    const send = () => {
      displayQueueRef.current = displayQueueRef.current.then(async () => {
        if (cancelled || !isForegroundUi() || reconcilerRef.current?.currentHandle !== handle
          || !sessionRef.current || !reconcilerRef.current.ownsScope(sessionRef.current.destinationId, sessionRef.current.navigationSessionId)) return;
        const latestState = currentScopedState();
        const latestPayload = JSON.stringify(latestState);
        if (lastDisplayRef.current.payload === latestPayload) return;
        await liveActivity.updateGroupActivity(handle, latestState);
        // Only successful native delivery advances the throttle / dedupe state.
        lastDisplayRef.current = { at: Date.now(), semantic, payload: latestPayload };
        await persistSession(handle);
      }).catch(() => undefined);
    };
    const waitMs = last.semantic === semantic ? Math.max(0, 5_000 - (Date.now() - last.at)) : 0;
    const timer = waitMs > 0 ? setTimeout(send, waitMs) : undefined;
    if (waitMs === 0) send();
    return () => { cancelled = true; if (timer != null) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    foreground,
    session?.destinationId,
    session?.navigationSessionId,
    state.status,
    state.personalArrived,
    state.personalArrivalAtMs,
    state.personalArrivalSequence,
    state.language,
    state.sampledAtMs,
    state.etaTargetAtMs,
    state.distanceMeters,
    state.etaSeconds,
    state.progress,
    state.gatheredCount,
    state.memberCount,
    state.gatheringTitle,
    state.groupName,
    state.accentHex,
    state.travelMode,
    arrivalSignature,
    emojiSignature,
    destinationEmojiSig,
  ]);
}
