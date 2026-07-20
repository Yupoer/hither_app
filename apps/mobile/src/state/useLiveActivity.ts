import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
  deleteLiveActivitySession,
  deleteMyLiveActivitySessions,
  deleteMyLiveActivitySessionsForGroups,
  getOrCreateLiveActivityDeviceId,
  upsertDeviceActivityToken,
  upsertLiveActivitySession,
} from '../api/services/LiveActivityService';
import { liveActivity, notifications, type GroupActivityState } from '../native';
import type { TravelMode } from '../utils/geo';

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
  const handleRef = useRef<string | null>(null);
  const destinationRef = useRef<string | null>(null);
  const pushTokenRef = useRef<string | undefined>(undefined);
  const lastPersistAtRef = useRef(0);
  const stateRef = useRef(state);
  const sessionRef = useRef(session);
  const pushToStartTokenRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const enabledRef = useRef(liveActivitiesEnabled);
  stateRef.current = state;
  sessionRef.current = session;
  enabledRef.current = liveActivitiesEnabled;

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
      pushToken: pushTokenRef.current,
      currentDistanceM: currentState.distanceMeters,
      etaSeconds: currentState.etaSeconds,
    });
  };

  const finishActivity = async (activityId: string) => {
    await liveActivity.endGroupActivity(activityId);
    await deleteLiveActivitySession(activityId).catch(() => undefined);
  };

  useEffect(() => {
    const subscription = liveActivity.addPushTokenListener((event) => {
      if (
        event.activityId !== handleRef.current &&
        (!event.navigationSessionId ||
          event.navigationSessionId !== sessionRef.current?.navigationSessionId)
      ) return;
      const previousId = handleRef.current;
      handleRef.current = event.activityId;
      pushTokenRef.current = event.pushToken;
      if (previousId && previousId !== event.activityId) {
        void finishActivity(previousId).catch(() => undefined);
      }
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
      await upsertDeviceActivityToken(deviceId, token, enabledRef.current);
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
    if (!deviceId) return;
    void upsertDeviceActivityToken(
      deviceId,
      pushToStartTokenRef.current,
      liveActivitiesEnabled,
    ).catch(() => undefined);
  }, [liveActivitiesEnabled]);

  useEffect(() => {
    let cancelled = false;
    const desiredDestination = session?.destinationId ?? null;

    if (active && session) {
      if (
        handleRef.current &&
        destinationRef.current === desiredDestination
      ) {
        return () => {
          cancelled = true;
        };
      }

      void (async () => {
        // Android 13+ requires POST_NOTIFICATIONS before the foreground
        // service notification can appear on the lock screen.
        if (Platform.OS === 'android') {
          const granted = await notifications.requestPermission();
          if (!granted || cancelled) return;
        }
        destinationRef.current = desiredDestination;
        pushTokenRef.current = undefined;

        // Always clear every Hither activity first. Push-to-start (APNs) can
        // already have created a minimal lock-screen activity; starting another
        // without end-all left two Live Activities (team+progress vs full ETA).
        if (handleRef.current) {
          const previousId = handleRef.current;
          handleRef.current = null;
          await finishActivity(previousId).catch(() => undefined);
        }
        await liveActivity.endAllGroupActivities();
        if (cancelled) return;

        const result = await liveActivity.startGroupActivity(stateRef.current);
        if (!result) return;
        if (cancelled) {
          await finishActivity(result.activityId);
          await liveActivity.endAllGroupActivities();
          return;
        }
        handleRef.current = result.activityId;
        pushTokenRef.current = result.pushToken;
        await persistSession(result.activityId, { force: true }).catch(() => undefined);
      })();
    } else if (!active || handleRef.current) {
      // Journey off, or session dropped while an activity is running.
      // Do NOT tear down while active but session is still hydrating (GPS baseline).
      const activityId = handleRef.current;
      handleRef.current = null;
      destinationRef.current = null;
      pushTokenRef.current = undefined;
      void (async () => {
        if (activityId) {
          await finishActivity(activityId);
        }
        // End-all covers lost handles and multi-start races.
        await liveActivity.endAllGroupActivities();
        if (!active) {
          await deleteMyLiveActivitySessions().catch(() => undefined);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, session?.destinationId]);

  useEffect(() => {
    return () => {
      const activityId = handleRef.current;
      handleRef.current = null;
      void (async () => {
        if (activityId) {
          await finishActivity(activityId);
        }
        await liveActivity.endAllGroupActivities();
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    if (active && handleRef.current) {
      void liveActivity.updateGroupActivity(handleRef.current, stateRef.current);
      void persistSession(handleRef.current).catch(() => undefined);
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
  ]);
}
