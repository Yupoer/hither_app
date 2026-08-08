import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
  deleteLiveActivitySession,
  deleteMyLiveActivitySessions,
  deleteMyLiveActivitySessionsForGroups,
  getOrCreateLiveActivityDeviceId,
  upsertDeviceActivityToken,
  upsertLiveActivitySession,
  type LiveActivityTokenRegisterResult,
} from '../api/services/LiveActivityService';
import { liveActivity, notifications, type GroupActivityState } from '../native';
import type { TravelMode } from '../utils/geo';
import { LiveActivityLifecycleReconciler } from '../utils/liveActivityLifecycle';
import { getSharedLiveActivityTokenGate } from '../utils/liveActivityTokenGate';
import { diagnostics } from './diagnostics';
import { useSession } from './SessionContext';

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
}): Promise<void> {
  await liveActivity.endAllGroupActivities();
  if (opts?.groupIds?.length) {
    await deleteMyLiveActivitySessionsForGroups(opts.groupIds).catch(() => undefined);
  } else {
    await deleteMyLiveActivitySessions().catch(() => undefined);
  }
}

export function useLiveActivity(
  active: boolean,
  state: GroupActivityState,
  session?: LiveActivitySessionContext,
  liveActivitiesEnabled = true,
): void {
  const { user } = useSession();
  const lastPersistAtRef = useRef(0);
  const stateRef = useRef(state);
  const sessionRef = useRef(session);
  const pushToStartTokenRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const enabledRef = useRef(liveActivitiesEnabled);
  const userIdRef = useRef<string | null>(user?.id ?? null);
  const reconcilerRef = useRef<LiveActivityLifecycleReconciler | null>(null);
  stateRef.current = state;
  sessionRef.current = session;
  enabledRef.current = liveActivitiesEnabled;
  userIdRef.current = user?.id ?? null;

  if (reconcilerRef.current == null) {
    reconcilerRef.current = new LiveActivityLifecycleReconciler({
      endGroupActivity: (activityId) => liveActivity.endGroupActivity(activityId),
      endAllGroupActivities: () => liveActivity.endAllGroupActivities(),
      startGroupActivity: () => liveActivity.startGroupActivity(stateRef.current),
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
  const PERSIST_MIN_MS = 30_000;

  const persistSession = async (
    activityId: string,
    opts?: { force?: boolean },
  ): Promise<void> => {
    const currentSession = sessionRef.current;
    const currentState = stateRef.current;
    if (
      !currentSession ||
      currentState.distanceMeters == null ||
      currentSession.initialDistanceM <= 0
    ) {
      return;
    }
    const now = Date.now();
    if (!opts?.force && now - lastPersistAtRef.current < PERSIST_MIN_MS) {
      return;
    }
    lastPersistAtRef.current = now;
    await upsertLiveActivitySession({
      ...currentSession,
      activityId,
      pushToken: reconcilerRef.current?.currentPushToken,
      currentDistanceM: currentState.distanceMeters,
      etaSeconds: currentState.etaSeconds,
    });
  };

  useEffect(() => {
    const subscription = liveActivity.addPushTokenListener((event) => {
      const reconciler = reconcilerRef.current;
      if (!reconciler) return;
      if (
        event.activityId !== reconciler.currentHandle &&
        (!event.navigationSessionId ||
          event.navigationSessionId !== sessionRef.current?.navigationSessionId)
      ) return;
      // Token rotation for the active activity — keep handle, refresh push token
      // via a no-op start for same destination is unnecessary; persist only.
      void persistSession(event.activityId, { force: true }).catch(() => undefined);
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
        .request({ kind: 'start', destinationId: session.destinationId })
        .then(() => {
          const handle = reconciler.currentHandle;
          if (handle) {
            void persistSession(handle, { force: true }).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    } else if (!active) {
      // Journey off — clear native + DB sessions.
      // Do NOT tear down while active but session is still hydrating (GPS baseline).
      void reconciler
        .request({ kind: 'stop', clearSessions: true })
        .catch(() => undefined);
    } else if (active && !session) {
      // Active journey but session not ready yet — leave existing activity alone.
    } else {
      // Active with session lost destination: stop native only.
      void reconciler
        .request({ kind: 'stop', clearSessions: false })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, session?.destinationId]);

  useEffect(() => {
    return () => {
      void reconcilerRef.current?.dispose().catch(() => undefined);
    };
  }, []);

  const roundedDistance =
    state.distanceMeters != null ? Math.round(state.distanceMeters / 10) * 10 : null;
  const roundedEta =
    state.etaSeconds != null ? Math.round(state.etaSeconds / 15) * 15 : null;
  const progressBucket =
    state.progress != null ? Math.round(state.progress * 20) : null;
  const arrivalSignature = state.memberArrived?.map((arrived) => (arrived ? '1' : '0')).join('');
  // BUG-05: emoji changes must also push a Live Activity update.
  const emojiSignature = state.memberEmojis?.join(',') ?? '';
  const destinationEmojiSig = state.destinationEmoji ?? '';

  useEffect(() => {
    const handle = reconcilerRef.current?.currentHandle;
    if (active && handle) {
      void liveActivity.updateGroupActivity(handle, stateRef.current);
      void persistSession(handle).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    roundedDistance,
    roundedEta,
    progressBucket,
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
