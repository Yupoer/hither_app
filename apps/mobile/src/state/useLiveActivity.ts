import { useEffect, useRef } from 'react';
import {
  deleteLiveActivitySession,
  upsertLiveActivitySession,
} from '../api/services/LiveActivityService';
import { liveActivity, type GroupActivityState } from '../native';
import type { TravelMode } from '../utils/geo';

export interface LiveActivitySessionContext {
  groupId: string;
  destinationId: string;
  initialDistanceM: number;
  travelMode: TravelMode;
}

export function useLiveActivity(
  active: boolean,
  state: GroupActivityState,
  session?: LiveActivitySessionContext,
): void {
  const handleRef = useRef<string | null>(null);
  const destinationRef = useRef<string | null>(null);
  const pushTokenRef = useRef<string | undefined>(undefined);
  const stateRef = useRef(state);
  const sessionRef = useRef(session);
  stateRef.current = state;
  sessionRef.current = session;

  const persistSession = async (activityId: string): Promise<void> => {
    const currentSession = sessionRef.current;
    const currentState = stateRef.current;
    if (
      !currentSession ||
      currentState.distanceMeters == null ||
      currentSession.initialDistanceM <= 0
    ) {
      return;
    }
    await upsertLiveActivitySession({
      ...currentSession,
      activityId,
      pushToken: pushTokenRef.current,
      currentDistanceM: currentState.distanceMeters,
      etaSeconds: currentState.etaSeconds,
    });
  };

  const finishActivity = (activityId: string) => {
    void liveActivity.endGroupActivity(activityId);
    void deleteLiveActivitySession(activityId).catch(() => undefined);
  };

  useEffect(() => {
    const subscription = liveActivity.addPushTokenListener((event) => {
      if (event.activityId !== handleRef.current) return;
      pushTokenRef.current = event.pushToken;
      void persistSession(event.activityId).catch(() => undefined);
    });
    return () => subscription.remove();
    // The listener reads mutable refs so token rotation never resubscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      if (handleRef.current) {
        finishActivity(handleRef.current);
        handleRef.current = null;
      }
      destinationRef.current = desiredDestination;
      pushTokenRef.current = undefined;

      void (async () => {
        const result = await liveActivity.startGroupActivity(stateRef.current);
        if (!result) return;
        if (cancelled) {
          finishActivity(result.activityId);
          return;
        }
        handleRef.current = result.activityId;
        pushTokenRef.current = result.pushToken;
        await persistSession(result.activityId).catch(() => undefined);
      })();
    } else if (handleRef.current) {
      const activityId = handleRef.current;
      handleRef.current = null;
      destinationRef.current = null;
      pushTokenRef.current = undefined;
      finishActivity(activityId);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, session?.destinationId]);

  useEffect(() => {
    return () => {
      if (!handleRef.current) return;
      const activityId = handleRef.current;
      handleRef.current = null;
      finishActivity(activityId);
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
