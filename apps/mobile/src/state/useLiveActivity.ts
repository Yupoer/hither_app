import { createElement, Fragment, useRef, useState, type RefObject } from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
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

export interface LiveActivityRuntimeProps {
  active: boolean | undefined;
  state: GroupActivityState;
  session?: LiveActivitySessionContext;
  liveActivitiesEnabled?: boolean;
}

export function LiveActivityRuntime({ active, state, session, liveActivitiesEnabled = true }: LiveActivityRuntimeProps) {
  const { user } = useSession();
  const foreground = useForegroundUi();
  const lastPersistAtRef = useRef(0);
  const lastDisplayRef = useRef({ at: 0, semantic: '', payload: '' });
  const displayQueueRef = useRef(Promise.resolve());
  const lastPersistedAccentRef = useRef<string | undefined>(undefined);
  const lastPersistedTravelModeRef = useRef<string | undefined>(undefined);
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
    if (!opts?.force && currentSession.travelMode === lastPersistedTravelModeRef.current
      && currentState.accentHex === lastPersistedAccentRef.current
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
    lastPersistedTravelModeRef.current = currentSession.travelMode;
  };

  const arrivalSignature = state.memberArrived?.map((arrived) => (arrived ? '1' : '0')).join('');
  // BUG-05: emoji changes must also push a Live Activity update.
  const emojiSignature = state.memberEmojis?.join(',') ?? '';
  const destinationEmojiSig = state.destinationEmoji ?? '';

  return createElement(LiveActivityResources, {
    reconcilerRef,
    activeRef,
    sessionRef,
    persistSession,
    session,
    pushToStartTokenRef,
    deviceIdRef,
    userIdRef,
    enabledRef,
    stateRef,
    state,
    userId: user?.id,
    liveActivitiesEnabled,
    active,
    currentScopedState,
    foreground,
    lastDisplayRef,
    arrivalSignature,
    emojiSignature,
    destinationEmojiSig,
    displayQueueRef,
    navigationSessionId: session?.navigationSessionId,
    stateAccentHex: state.accentHex,
    destinationId: session?.destinationId,
    stateStatus: state.status,
    statePersonalArrived: state.personalArrived,
    statePersonalArrivalAtMs: state.personalArrivalAtMs,
    statePersonalArrivalSequence: state.personalArrivalSequence,
    statePersonalArrivalCorrectionAtMs: state.personalArrivalCorrectionAtMs,
    stateLanguage: state.language,
    stateSampledAtMs: state.sampledAtMs,
    stateEtaTargetAtMs: state.etaTargetAtMs,
    stateDistanceMeters: state.distanceMeters,
    stateEtaSeconds: state.etaSeconds,
    stateProgress: state.progress,
    stateGatheredCount: state.gatheredCount,
    stateMemberCount: state.memberCount,
    stateGatheringTitle: state.gatheringTitle,
    stateGroupName: state.groupName,
    stateTravelMode: state.travelMode,
  });
}

interface LiveActivityResourceInput {
  reconcilerRef: RefObject<LiveActivityLifecycleReconciler | null>;
  activeRef: RefObject<boolean | undefined>;
  sessionRef: RefObject<LiveActivitySessionContext | undefined>;
  persistSession: (activityId: string, opts?: { force?: boolean; }) => Promise<void>;
  session: LiveActivitySessionContext | undefined;
  pushToStartTokenRef: RefObject<string | null>;
  deviceIdRef: RefObject<string | null>;
  userIdRef: RefObject<string | null>;
  enabledRef: RefObject<boolean>;
  stateRef: RefObject<GroupActivityState>;
  state: GroupActivityState;
  userId: string | undefined;
  liveActivitiesEnabled: boolean;
  active: boolean | undefined;
  currentScopedState: () => GroupActivityState;
  foreground: boolean;
  lastDisplayRef: RefObject<{ at: number; semantic: string; payload: string; }>;
  arrivalSignature: string | undefined;
  emojiSignature: string;
  destinationEmojiSig: string;
  displayQueueRef: RefObject<Promise<void>>;
  navigationSessionId: string | undefined;
  stateAccentHex: GroupActivityState['accentHex'];
  destinationId: string | undefined;
  stateStatus: GroupActivityState['status'];
  statePersonalArrived: GroupActivityState['personalArrived'];
  statePersonalArrivalAtMs: GroupActivityState['personalArrivalAtMs'];
  statePersonalArrivalSequence: GroupActivityState['personalArrivalSequence'];
  statePersonalArrivalCorrectionAtMs: GroupActivityState['personalArrivalCorrectionAtMs'];
  stateLanguage: GroupActivityState['language'];
  stateSampledAtMs: GroupActivityState['sampledAtMs'];
  stateEtaTargetAtMs: GroupActivityState['etaTargetAtMs'];
  stateDistanceMeters: GroupActivityState['distanceMeters'];
  stateEtaSeconds: GroupActivityState['etaSeconds'];
  stateProgress: GroupActivityState['progress'];
  stateGatheredCount: GroupActivityState['gatheredCount'];
  stateMemberCount: GroupActivityState['memberCount'];
  stateGatheringTitle: GroupActivityState['gatheringTitle'];
  stateGroupName: GroupActivityState['groupName'];
  stateTravelMode: GroupActivityState['travelMode'];
}

function LiveActivityPushTokens({
  reconcilerRef, activeRef, sessionRef, persistSession,
}: LiveActivityResourceInput) {
  useMountEffect(() => {
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
  });
  return null;
}

function LiveActivitySessionObservation({
  session,
}: LiveActivityResourceInput) {
  useMountEffect(() => {
    if (session?.navigationSessionId) {
      void liveActivity.observeExistingActivities().catch(() => undefined);
    }
  });
  return null;
}

function LiveActivityPushToStartTokens({
  pushToStartTokenRef, deviceIdRef, userIdRef, enabledRef, stateRef,
}: LiveActivityResourceInput) {
  useMountEffect(() => {
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
  });
  return null;
}

function LiveActivityAccent({
  state, userId,
}: LiveActivityResourceInput) {
  useMountEffect(() => {
    if (!userId || !state.accentHex) return;
    void getOrCreateLiveActivityDeviceId().then((id) =>
      updateDeviceActivityAccent(id, state.accentHex!),
    ).catch(() => undefined);
  });
  return null;
}

function LiveActivityTokenPolicy({
  deviceIdRef, userIdRef, pushToStartTokenRef, liveActivitiesEnabled, stateRef,
}: LiveActivityResourceInput) {
  useMountEffect(() => {
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
  });
  return null;
}

// Keep intent generations in the stable reconciler across input-job replacements.
function LiveActivityJourneyIntent({
  reconcilerRef, active, session, sessionRef, currentScopedState, persistSession,
}: LiveActivityResourceInput) {
  useMountEffect(() => {
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
  });
  return null;
}

function LiveActivityResumeDisplay({
  foreground, lastDisplayRef,
}: LiveActivityResourceInput) {
  useMountEffect(() => {
    // Native may have received a newer headless update while hidden. Returning
    // to the foreground sends the current snapshot without changing its ETA.
    if (!foreground) lastDisplayRef.current = { at: 0, semantic: '', payload: '' };
  });
  return null;
}

function LiveActivityDisplayDelivery({
  reconcilerRef, active, session, foreground, state, arrivalSignature, emojiSignature, destinationEmojiSig,
  currentScopedState, lastDisplayRef, displayQueueRef, sessionRef, persistSession,
}: LiveActivityResourceInput) {
  useMountEffect(() => {
    const handle = reconcilerRef.current?.currentHandle;
    if (!active || !handle || !session || !reconcilerRef.current?.ownsScope(session.destinationId, session.navigationSessionId)
      || !foreground || AppState.currentState !== 'active') return;
    const semantic = JSON.stringify([session?.navigationSessionId, session?.destinationId, state.status, state.personalArrived, state.personalArrivalAtMs, state.personalArrivalSequence, state.personalArrivalCorrectionAtMs, state.gatheredCount,
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
        // A canceled send cannot restore the throttle after the background reset.
        if (cancelled || !isForegroundUi() || reconcilerRef.current?.currentHandle !== handle) return;
        // Only successful native delivery advances the throttle / dedupe state.
        lastDisplayRef.current = { at: Date.now(), semantic, payload: latestPayload };
        await persistSession(handle);
      }).catch(() => undefined);
    };
    const waitMs = last.semantic === semantic ? Math.max(0, 5_000 - (Date.now() - last.at)) : 0;
    const timer = waitMs > 0 ? setTimeout(send, waitMs) : undefined;
    if (waitMs === 0) send();
    return () => { cancelled = true; if (timer != null) clearTimeout(timer); };
  });
  return null;
}

function LiveActivityResources(input: LiveActivityResourceInput) {
  const {
    navigationSessionId, userId, stateAccentHex, liveActivitiesEnabled, active, destinationId, foreground, stateStatus,
    statePersonalArrived, statePersonalArrivalAtMs, statePersonalArrivalSequence, statePersonalArrivalCorrectionAtMs, stateLanguage, stateSampledAtMs,
    stateEtaTargetAtMs, stateDistanceMeters, stateEtaSeconds, stateProgress, stateGatheredCount, stateMemberCount,
    stateGatheringTitle, stateGroupName, stateTravelMode, arrivalSignature, emojiSignature, destinationEmojiSig,
  } = input;
  const [previous, setPrevious] = useState({
    navigationSessionId, userId, stateAccentHex, liveActivitiesEnabled, active, destinationId, foreground, stateStatus,
    statePersonalArrived, statePersonalArrivalAtMs, statePersonalArrivalSequence, statePersonalArrivalCorrectionAtMs, stateLanguage, stateSampledAtMs,
    stateEtaTargetAtMs, stateDistanceMeters, stateEtaSeconds, stateProgress, stateGatheredCount, stateMemberCount,
    stateGatheringTitle, stateGroupName, stateTravelMode, arrivalSignature, emojiSignature, destinationEmojiSig,
    LiveActivitySessionObservationGeneration: 0, LiveActivityAccentGeneration: 0, LiveActivityTokenPolicyGeneration: 0,
    LiveActivityJourneyIntentGeneration: 0, LiveActivityResumeDisplayGeneration: 0,
    LiveActivityDisplayDeliveryGeneration: 0,
  });
  const LiveActivitySessionObservationChanged =
    !Object.is(previous.navigationSessionId, navigationSessionId);
  const LiveActivityAccentChanged =
    !Object.is(previous.userId, userId)
    || !Object.is(previous.stateAccentHex, stateAccentHex);
  const LiveActivityTokenPolicyChanged =
    !Object.is(previous.liveActivitiesEnabled, liveActivitiesEnabled)
    || !Object.is(previous.userId, userId);
  const LiveActivityJourneyIntentChanged =
    !Object.is(previous.active, active)
    || !Object.is(previous.destinationId, destinationId)
    || !Object.is(previous.navigationSessionId, navigationSessionId);
  const LiveActivityResumeDisplayChanged =
    !Object.is(previous.foreground, foreground);
  const LiveActivityDisplayDeliveryChanged =
    !Object.is(previous.active, active)
    || !Object.is(previous.foreground, foreground)
    || !Object.is(previous.destinationId, destinationId)
    || !Object.is(previous.navigationSessionId, navigationSessionId)
    || !Object.is(previous.stateStatus, stateStatus)
    || !Object.is(previous.statePersonalArrived, statePersonalArrived)
    || !Object.is(previous.statePersonalArrivalAtMs, statePersonalArrivalAtMs)
    || !Object.is(previous.statePersonalArrivalSequence, statePersonalArrivalSequence)
    || !Object.is(previous.statePersonalArrivalCorrectionAtMs, statePersonalArrivalCorrectionAtMs)
    || !Object.is(previous.stateLanguage, stateLanguage)
    || !Object.is(previous.stateSampledAtMs, stateSampledAtMs)
    || !Object.is(previous.stateEtaTargetAtMs, stateEtaTargetAtMs)
    || !Object.is(previous.stateDistanceMeters, stateDistanceMeters)
    || !Object.is(previous.stateEtaSeconds, stateEtaSeconds)
    || !Object.is(previous.stateProgress, stateProgress)
    || !Object.is(previous.stateGatheredCount, stateGatheredCount)
    || !Object.is(previous.stateMemberCount, stateMemberCount)
    || !Object.is(previous.stateGatheringTitle, stateGatheringTitle)
    || !Object.is(previous.stateGroupName, stateGroupName)
    || !Object.is(previous.stateAccentHex, stateAccentHex)
    || !Object.is(previous.stateTravelMode, stateTravelMode)
    || !Object.is(previous.arrivalSignature, arrivalSignature)
    || !Object.is(previous.emojiSignature, emojiSignature)
    || !Object.is(previous.destinationEmojiSig, destinationEmojiSig);
  if (LiveActivitySessionObservationChanged
    || LiveActivityAccentChanged
    || LiveActivityTokenPolicyChanged
    || LiveActivityJourneyIntentChanged
    || LiveActivityResumeDisplayChanged
    || LiveActivityDisplayDeliveryChanged) {
    setPrevious({
      navigationSessionId, userId, stateAccentHex, liveActivitiesEnabled, active, destinationId, foreground,
      stateStatus, statePersonalArrived, statePersonalArrivalAtMs, statePersonalArrivalSequence, statePersonalArrivalCorrectionAtMs, stateLanguage,
      stateSampledAtMs, stateEtaTargetAtMs, stateDistanceMeters, stateEtaSeconds, stateProgress, stateGatheredCount,
      stateMemberCount, stateGatheringTitle, stateGroupName, stateTravelMode, arrivalSignature, emojiSignature,
      destinationEmojiSig,
      LiveActivitySessionObservationGeneration: previous.LiveActivitySessionObservationGeneration + (LiveActivitySessionObservationChanged ? 1 : 0),
      LiveActivityAccentGeneration: previous.LiveActivityAccentGeneration + (LiveActivityAccentChanged ? 1 : 0),
      LiveActivityTokenPolicyGeneration: previous.LiveActivityTokenPolicyGeneration + (LiveActivityTokenPolicyChanged ? 1 : 0),
      LiveActivityJourneyIntentGeneration: previous.LiveActivityJourneyIntentGeneration + (LiveActivityJourneyIntentChanged ? 1 : 0),
      LiveActivityResumeDisplayGeneration: previous.LiveActivityResumeDisplayGeneration + (LiveActivityResumeDisplayChanged ? 1 : 0),
      LiveActivityDisplayDeliveryGeneration: previous.LiveActivityDisplayDeliveryGeneration + (LiveActivityDisplayDeliveryChanged ? 1 : 0) });
  }
  return createElement(Fragment, null,
    createElement(LiveActivityPushTokens, { ...input, key: 'LiveActivityPushTokens' }),
    createElement(LiveActivitySessionObservation, { ...input, key: 'LiveActivitySessionObservation:' + previous.LiveActivitySessionObservationGeneration }),
    createElement(LiveActivityPushToStartTokens, { ...input, key: 'LiveActivityPushToStartTokens' }),
    createElement(LiveActivityAccent, { ...input, key: 'LiveActivityAccent:' + previous.LiveActivityAccentGeneration }),
    createElement(LiveActivityTokenPolicy, { ...input, key: 'LiveActivityTokenPolicy:' + previous.LiveActivityTokenPolicyGeneration }),
    createElement(LiveActivityJourneyIntent, { ...input, key: 'LiveActivityJourneyIntent:' + previous.LiveActivityJourneyIntentGeneration }),
    createElement(LiveActivityResumeDisplay, { ...input, key: 'LiveActivityResumeDisplay:' + previous.LiveActivityResumeDisplayGeneration }),
    createElement(LiveActivityDisplayDelivery, { ...input, key: 'LiveActivityDisplayDelivery:' + previous.LiveActivityDisplayDeliveryGeneration })
  );
}
