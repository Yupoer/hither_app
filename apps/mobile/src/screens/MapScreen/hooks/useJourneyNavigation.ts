import { useMountEffect } from '../../../hooks/useMountEffect';
import { legacyNavigationSessionKey, readEndedNavigationSessions, rememberEndedNavigationSession } from '../../../state/endedNavigationSessions';
import { showOperationFailure } from '../../../state/appNotice';
import * as Crypto from 'expo-crypto';
import { createElement, Fragment, useState, useMemo, useCallback, useRef, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { Alert, type ScrollView } from 'react-native';
import { getOperationErrorMessage } from '../../../utils/operationError';
import { distanceMeters } from '../../../utils/geo';
import { canEvaluateSynchronizedArrival } from '../../../utils/synchronizedArrival';
import { followCarouselIndexAfterPromote } from '../../../utils/journeyStartCarouselIdentity';
import type { Coordinates, Destination, GroupState, JourneyStatus } from '../../../types';
import type { NavigationSession } from '../../../types/navigation';
import type { LocationSample } from '../../../native/location';
import type { GroupMapHandle } from '../../../components/GroupMap';
import { presentExternalMapsChooser } from '../../../native/externalNavigation';
import type { TravelMode } from '../../../native/maps';
import type { ActiveGatheringState } from '../../../types/coreData';
import { deriveActiveGatheringFromGroupState } from '../../../utils/activeGatheringState';
import {
  enqueueLeaderGatheringEnd,
  enqueueLeaderGatheringStart,
  enqueueLeaderGatheringSwitch,
  flushCoreOperationOutbox,
  getCoreOperationOutbox,
  readLocalJourneyProjection,
} from '../../../state/coreDataSync';
import { logEvent } from '../../../utils/activityLog';

interface TeamCommandIntent {
  sequence: number;
  action: 'start' | 'end';
  operationId: string;
  targetSessionId?: string | null;
  previousServerSession?: NavigationSession | null;
  switchFromDestinationId?: string;
  expectedSessionStartedAt?: string | null;
  destination: Destination;
  index: number;
  startOrigin?: Coordinates;
}

interface TeamCommandJob {
  execute: () => Promise<boolean>;
  resolve: (value: boolean) => void;
  reject: (error: unknown) => void;
}

interface UseJourneyNavigationParams {
  state: GroupState | null;
  actorId?: string | null;
  groupId: string | null | undefined;
  isLeader: boolean;
  destinations: Destination[];
  navigationDestinations?: Destination[];
  reorderDestinations?: Destination[];
  selectedDestination: Destination | undefined;
  fromCoords: Coordinates | undefined;
  /** Read the latest device fix when location ownership is declared later. */
  getFromCoords?: () => Coordinates | undefined;
  acquireStartFix: () => Promise<LocationSample | null>;
  arrivalRadiusM: number;
  refresh: () => void;
  t: (key: string, params?: Record<string, any>) => string;
  mapRef: RefObject<GroupMapHandle | null>;
  carouselRef: RefObject<ScrollView | null>;
  setSelectedIndex: (index: number) => void;
  /** Undefined means legacy data is still hydrating; null means no active session. */
  navigationSession?: NavigationSession | null;
  /** A received terminal row is distinct from a temporarily empty active query. */
  terminalSession?: NavigationSession | null;
  startSession?: (
    destinationId: string,
    requestId: string,
    replaceExisting?: boolean,
  ) => Promise<NavigationSession>;
  /** Kept for callers that still pass the old terminal handler. */
  cancelSession?: () => Promise<NavigationSession | null>;
  /** Re-read the server session when a start response was ambiguous. */
  refreshNavigationSession?: () => Promise<NavigationSession | null>;
  createRequestId?: () => string;
  travelMode?: TravelMode;
  onOptimisticGathering?: (gathering: ActiveGatheringState) => void;
  /**
   * Operator local confirm after start/switch session succeeds (ticket 02).
   * Client-triggered — does not rely on DB update payload for sender.
   */
  onOperatorStartConfirm?: (destination: Destination, eventId: string) => void;
  onOperatorPauseConfirm?: (destination: Destination, eventId: string) => void;
  /** The local operation id acts as the session key while Start is offline. */
  onLocalSessionIdChange?: (sessionId: string | null) => void;
  hasPendingTeamOperation?: boolean;
}

export function useJourneyNavigation({
  state,
  actorId,
  groupId,
  isLeader,
  destinations,
  navigationDestinations = destinations,
  reorderDestinations = destinations,
  selectedDestination,
  fromCoords,
  getFromCoords,
  acquireStartFix,
  arrivalRadiusM,
  refresh: _refresh,
  t,
  mapRef,
  setSelectedIndex,
  navigationSession,
  terminalSession,
  startSession,
  cancelSession,
  refreshNavigationSession,
  createRequestId = Crypto.randomUUID,
  travelMode = 'walk',
  onOptimisticGathering,
  onOperatorStartConfirm,
  onOperatorPauseConfirm,
  onLocalSessionIdChange,
  hasPendingTeamOperation,
}: UseJourneyNavigationParams) {
  const legacySharedTargetId = state?.group.journeyStatus === 'going'
    && navigationDestinations.some(destination => destination.id === state.group.activeDestinationId && !destination.closedAt)
    ? state.group.activeDestinationId ?? null
    : null;
  const removedTarget = state != null && navigationSession?.status === 'active'
    && !state.destinations.some(destination => destination.id === navigationSession.destinationId && !destination.closedAt);
  const authoritativeSharedTargetId = navigationSession?.status === 'active' && !removedTarget
    ? navigationSession.destinationId
    : navigationSession == null ? legacySharedTargetId : null;

  // `undefined` means no local override; null is an optimistic End. This is
  // intentionally separate from the server session so Realtime latency cannot
  // turn the newest button tap back into the previous visual state.
  const [optimisticTeamTargetId, setOptimisticTeamTargetId] = useState<string | null | undefined>(undefined);
  const [localTargetId, setLocalTargetId] = useState<string | null>(null);
  const [pendingLeaderTargetId, setPendingLeaderTargetId] = useState<string | null>(null);
  const [pendingLeaderStop, setPendingLeaderStop] = useState(false);
  const [journeyBusy, setJourneyBusy] = useState(false);
  const [locallyStopped, setLocallyStopped] = useState(false);
  const stoppedServerSessionRef = useRef<string | null>(null);
  const stoppedAtRef = useRef(0);
  const [endedSessions, setEndedSessions] = useState<Set<string>>(new Set());
  const [endedLoadedFor, setEndedLoadedFor] = useState('');
  const endedContext = `${actorId ?? ''}:${groupId ?? ''}`;

  const localSessionIdRef = useRef<string | null>(null);
  const [visibleLocalSessionId, setVisibleLocalSessionId] = useState<string | null>(null);
  const localSessionContextRef = useRef<{
    destinationId: string;
    subgroupId: string | null;
    commandSequence: number;
  } | null>(null);
  const publishLocalSessionId = useCallback((sessionId: string | null, notify = true) => {
    localSessionIdRef.current = sessionId;
    if (!sessionId) localSessionContextRef.current = null;
    if (notify) { setVisibleLocalSessionId(sessionId); onLocalSessionIdChange?.(sessionId); }
  }, [onLocalSessionIdChange]);
  const lastFollowerCenterKeyRef = useRef<string | null>(null);
  const startFrameRef = useRef<{ context: string; destination: Destination; fitted: boolean } | null>(null);
  const frameStartedDestination = useCallback((destination: Destination, startOrigin?: Coordinates) => {
    const previous = startFrameRef.current;
    const sameFrame = previous?.context === endedContext && previous.destination.id === destination.id;
    if (sameFrame && previous.fitted) return;
    const origin = startOrigin ?? getFromCoords?.() ?? fromCoords;
    if (origin && mapRef.current) {
      mapRef.current.fitRoute([origin, destination.coordinates]);
    } else if (!sameFrame) {
      mapRef.current?.centerOn(destination.coordinates, { animated: false });
    }
    startFrameRef.current = { context: endedContext, destination, fitted: Boolean(origin && mapRef.current) };
  }, [endedContext, fromCoords, getFromCoords, mapRef]);
  const refreshStartFrame = useCallback(() => {
    const frame = startFrameRef.current;
    if (frame?.context === endedContext && !frame.fitted) frameStartedDestination(frame.destination);
  }, [endedContext, frameStartedDestination]);
  const requestRef = useRef<{ destinationId: string; requestId: string } | null>(null);
  const desiredTeamIntentRef = useRef<TeamCommandJob[]>([]);
  const pendingTeamStartIntentRef = useRef<TeamCommandIntent | null>(null);
  const switchPromptRef = useRef<string | null>(null);
  const teamCommandRunnerRef = useRef<Promise<void> | null>(null);
  const teamCommandSequenceRef = useRef(0);
  const latestTeamTapRef = useRef<{ action: 'start' | 'end'; destinationId: string;
    groupId: string | null | undefined; actorId: string | null | undefined; sequence: number } | null>(null);
  const pendingCarouselTargetIdRef = useRef<string | null>(null);
  const gatheringStatesRef = useRef(new Map<string, ActiveGatheringState>());
  const gatheringCacheKey = JSON.stringify([actorId ?? null, groupId ?? null]);
  const currentActorRef = useRef(actorId);
  currentActorRef.current = actorId;
  const currentGroupRef = useRef(groupId);
  currentGroupRef.current = groupId;
  const currentLeaderRef = useRef(isLeader);
  currentLeaderRef.current = isLeader;
  const arrivalRadiusRef = useRef(arrivalRadiusM);
  arrivalRadiusRef.current = arrivalRadiusM;
  const startAttemptRef = useRef<{ id: number; destinationId: string;
    groupId: string | null | undefined; actorId: string | null | undefined } | null>(null);
  const startAttemptSequenceRef = useRef(0);
  const mountedRef = useRef(true);

  const serverOrStartedSessionRef = useRef(Boolean(authoritativeSharedTargetId));
  const pendingStartRef = useRef<{
    operationId: string;
    base: ActiveGatheringState;
    startedAt: number;
    entityVersion: number;
    previousServerSession?: NavigationSession | null;
  } | null>(null);

  /**
   * A local Start id is only a session alias while the server row is being
   * created.  Once that row (or a later authoritative replacement in the
   * same lane) is visible, keeping the alias would make every arrival/end
   * operation target an old session.  Keep this cleanup in one place so the
   * command path and the realtime reconciliation path cannot drift apart.
   */
  const clearLocalSessionAlias = useCallback(() => {
    if (!localSessionIdRef.current) return;
    publishLocalSessionId(null);
    pendingStartRef.current = null;
    requestRef.current = null;
  }, [publishLocalSessionId]);

  // Realtime/retry may confirm a start after the original request lost its response.

  /**
   * Reconcile a local Start that was acknowledged without the matching
   * request id (for example after a reconnect, or when another device starts
   * the same destination).  Do not discard an in-flight offline alias until
   * its durable operation is settled; before then it is still the only stable
   * key for local arrivals.  Once settled, the server session is authoritative
   * for this destination/scope and the alias must not shadow it.
   */

  const lastVisibleServerSessionRef = useRef<{ context: string; session: NavigationSession } | null>(null);
  if (navigationSession?.status === 'active' && navigationSession.groupId === groupId) {
    lastVisibleServerSessionRef.current = { context: endedContext, session: navigationSession };
  }

  const legacySessionKey = legacyNavigationSessionKey(state?.group.journeyStartedAt, authoritativeSharedTargetId);
  const visibleSessionKey = navigationSession?.id ?? legacySessionKey;
  const serverLegacyKey = navigationSession ? legacyNavigationSessionKey(navigationSession.startedAt, navigationSession.destinationId) : legacySessionKey;
  const hiddenSession = (navigationSession
    ? endedSessions.has(visibleSessionKey) || endedSessions.has(serverLegacyKey)
      || Boolean(navigationSession.requestId && endedSessions.has(navigationSession.requestId))
    : endedSessions.has(legacySessionKey)) && !optimisticTeamTargetId;
  const suppressNavigation = locallyStopped || (isLeader && (hiddenSession
    || (Boolean(actorId) && endedLoadedFor !== endedContext && !optimisticTeamTargetId)));
  const sharedTargetId = suppressNavigation ? null : optimisticTeamTargetId !== undefined
    ? optimisticTeamTargetId
    : authoritativeSharedTargetId;

  // Shared flock session owns the target for leaders and members. During a
  // local optimistic End, `sharedTargetId` is null and the route disappears
  // immediately instead of waiting for the terminal RPC.
  const navTargetId = suppressNavigation ? null : sharedTargetId ?? (isLeader ? pendingLeaderTargetId : localTargetId);
  const navTarget = useMemo<Destination | undefined>(() => {
    if (!navTargetId) return undefined;
    const fromList = navigationDestinations.find((destination) => destination.id === navTargetId);
    if (fromList) return fromList;
    if (
      navigationSession?.status === 'active'
      && navigationSession.destinationId === navTargetId
    ) {
      return {
        id: navigationSession.destinationId,
        title: navigationSession.destination.name,
        order: 0,
        day: 1,
        coordinates: navigationSession.destination.coordinates,
      };
    }
    return undefined;
  }, [navTargetId, navigationDestinations, navigationSession]);
  const journeyGoing = !pendingLeaderStop && Boolean(navTargetId);
  const journeyStatus: JourneyStatus = journeyGoing ? 'going' : 'paused';
  const journeyActive = journeyGoing && Boolean(navTarget);
  const activePoint = navTarget ?? selectedDestination;
  const numericDistance = fromCoords && navTarget
    ? distanceMeters(fromCoords, navTarget.coordinates)
    : undefined;

  /** External map control: chooser (Google / Apple / cancel) then open provider. */
  const openExternalNavigation = useCallback(
    (dest: Destination) => {
      presentExternalMapsChooser(dest, travelMode, {
        title: t('map.openExternalNavigation'),
        googleLabel: t('map.googleMaps'),
        appleLabel: t('map.appleMaps'),
        cancelLabel: t('common.cancel'),
        openFailedTitle: t('map.setFailedTitle'),
        openFailedMessage: t('map.externalMapsOpenFailed'),
      });
    },
    [t, travelMode],
  );

  /** @deprecated Use openExternalNavigation — kept as alias for gradual call-site migration. */
  const openInAppleMaps = openExternalNavigation;

  const startLocalRoutePlan = useCallback(
    (dest: Destination, index: number) => {
      setLocalTargetId(dest.id);
      setSelectedIndex(index);
      mapRef.current?.centerOn(dest.coordinates, { animated: false });
    },
    [mapRef, setSelectedIndex],
  );

  const runTeamEnd = useCallback(async (intent: TeamCommandIntent): Promise<boolean> => {
    if (!groupId) return false;
    const isCurrent = () => mountedRef.current && currentGroupRef.current === groupId && currentActorRef.current === actorId;
    const baseState = gatheringStatesRef.current.get(gatheringCacheKey)
      ?? (state ? deriveActiveGatheringFromGroupState(state, 0) : undefined);
    if (isCurrent()) setJourneyBusy(true);
    try {
      const operationId = intent.operationId;
      // End is scoped to the session that was active when the user tapped.
      // A later Start must never be mistaken for this terminal operation.
      const localSessionId = localSessionIdRef.current;
      const localContext = localSessionContextRef.current;
      const scopeMatches = (localContext?.subgroupId ?? null)
        === (intent.destination.subgroupId ?? null);
      const localMatches = Boolean(localSessionId && localContext
        && localContext.destinationId === intent.destination.id && scopeMatches);
      const serverMatches = Boolean(navigationSession?.status === 'active'
        && navigationSession.destinationId === intent.destination.id
        && (navigationSession.scopeSubgroupId ?? null)
          === (intent.destination.subgroupId ?? null));
      const navigationSessionId = intent.targetSessionId !== undefined ? intent.targetSessionId
        : localMatches ? localSessionId : serverMatches ? navigationSession?.id ?? null : null;
      intent.targetSessionId = navigationSessionId;
      if (intent.expectedSessionStartedAt === undefined) intent.expectedSessionStartedAt = state?.group.journeyStartedAt ?? null;
      const endedSessionKey = navigationSessionId ?? legacyNavigationSessionKey(intent.expectedSessionStartedAt, intent.destination.id);
      const result = await enqueueLeaderGatheringEnd(groupId, { baseState, groupState: state,
        actorId: actorId ?? undefined, operationId,
        navigationSessionId,
        expectedSessionStartedAt: navigationSessionId ? null : intent.expectedSessionStartedAt,
        subgroupId: intent.destination.subgroupId ?? null,
        flushImmediately: false });
      if (actorId) {
        setEndedSessions(values => new Set([...values, endedSessionKey]));
        // The durable End owns restart recovery; this dismissal cache is secondary.
        void rememberEndedNavigationSession(actorId, groupId, endedSessionKey).catch(() => undefined);
      }
      gatheringStatesRef.current.set(gatheringCacheKey, result.local);
      if (!isCurrent()) { void flushCoreOperationOutbox().catch(() => undefined); return true; }
      pendingStartRef.current = null;
      requestRef.current = null;
      publishLocalSessionId(null);
      if (!pendingTeamStartIntentRef.current
        || pendingTeamStartIntentRef.current.sequence <= intent.sequence) {
        pendingTeamStartIntentRef.current = null;
      }
      if (teamCommandSequenceRef.current === intent.sequence) {
        onOptimisticGathering?.(result.local);
        setOptimisticTeamTargetId(null);
      }
      // The durable operation owns both the gathering and navigation-session
      // transition. No second online-only cancel can race it.
      void flushCoreOperationOutbox().then(async () => {
        if (!isCurrent()) return;
        // Confirm only an accepted current command. Do not replay an old End
        // sound when a later Start is already queued, or while still offline.
        if (onOperatorPauseConfirm) {
          const pending = await getCoreOperationOutbox().getOperation(operationId);
          if (!pending && isCurrent() && teamCommandSequenceRef.current === intent.sequence) {
            onOperatorPauseConfirm(intent.destination, `pause:${groupId}:${operationId}`);
          }
        }
        if (!isCurrent()) return;
        _refresh();
        return refreshNavigationSession?.();
      }).catch(() => undefined);
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      if (pendingTeamStartIntentRef.current?.sequence === intent.sequence) {
        pendingTeamStartIntentRef.current = null;
      }
      if (teamCommandSequenceRef.current === intent.sequence) {
        latestTeamTapRef.current = null;
        setOptimisticTeamTargetId(undefined);
      }
      Alert.alert(t('map.setFailedTitle'), getOperationErrorMessage(error));
      logEvent('nav_end_failed', { destId: intent.destination.id });
      return false;
    } finally {
      if (isCurrent() && teamCommandSequenceRef.current === intent.sequence) {
        setPendingLeaderStop(false);
        setPendingLeaderTargetId(null);
        setJourneyBusy(false);
      }
    }
  }, [groupId, actorId, state, navigationSession, publishLocalSessionId, onOptimisticGathering, onOperatorPauseConfirm, createRequestId, _refresh, refreshNavigationSession, t]);

  const runTeamStart = useCallback(async (intent: TeamCommandIntent): Promise<boolean> => {
    if (!groupId) return false;
    const isCurrent = () => mountedRef.current && currentGroupRef.current === groupId && currentActorRef.current === actorId;
    const { destination: dest, index } = intent;
    if (isCurrent()) { setJourneyBusy(true); setPendingLeaderStop(false); }
    try {
      const durable = await readLocalJourneyProjection(groupId, dest.id);
      if (!isCurrent()) return false;
      const cached = gatheringStatesRef.current.get(gatheringCacheKey);
      const baseState = durable && (!cached || durable.gathering.entityVersion >= cached.entityVersion)
        ? durable.gathering : cached ?? (state ? deriveActiveGatheringFromGroupState(state, 0) : undefined);
      if (baseState) gatheringStatesRef.current.set(gatheringCacheKey, baseState);
      const switching = Boolean((intent.switchFromDestinationId && intent.switchFromDestinationId !== dest.id)
        || (baseState?.activeDestinationId && baseState.activeDestinationId !== dest.id));
      const operationId = intent.operationId;
      const options = { baseState, groupState: state, actorId: actorId ?? undefined, activeDestinationId: dest.id, operationId,
        promoteWithinDay: true,
        // The transition is durable before a server session exists. Reusing
        // this id as navigationRequestId lets delayed arrivals stay bound to
        // this exact local session after reconnect.
        navigationRequestId: operationId,
        navigationSessionId: navigationSession?.id ?? null,
        subgroupId: dest.subgroupId ?? null,
        flushImmediately: false };
      const enqueued = switching
        ? await enqueueLeaderGatheringSwitch(groupId, options)
        : await enqueueLeaderGatheringStart(groupId, options);
      gatheringStatesRef.current.set(gatheringCacheKey, enqueued.local);
      if (!isCurrent()) { void flushCoreOperationOutbox().catch(() => undefined); return true; }
      pendingStartRef.current = { operationId: enqueued.operationId, base: enqueued.base,
        startedAt: enqueued.local.phaseChangedAt, entityVersion: enqueued.local.entityVersion,
        previousServerSession: intent.previousServerSession };
      requestRef.current = { destinationId: dest.id, requestId: enqueued.operationId };
      localSessionContextRef.current = {
        destinationId: dest.id,
        subgroupId: dest.subgroupId ?? null,
        commandSequence: intent.sequence,
      };
      // An older queued Start still owns its internal End dependency, but its
      // alias must never be exposed as the newer visible destination's session.
      publishLocalSessionId(enqueued.operationId, teamCommandSequenceRef.current === intent.sequence);
      if (teamCommandSequenceRef.current === intent.sequence) {
        onOptimisticGathering?.(enqueued.local);
        setOptimisticTeamTargetId(dest.id);
        frameStartedDestination(dest, intent.startOrigin);
        const currentIndex = navigationDestinations.findIndex(item => item.id === dest.id);
        setSelectedIndex(currentIndex >= 0 ? currentIndex : index);
        pendingCarouselTargetIdRef.current = dest.id;
      }
      void flushCoreOperationOutbox().then(() => {
        if (!isCurrent()) return;
        _refresh();
        return refreshNavigationSession?.();
      }).catch(() => undefined);
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      if (pendingTeamStartIntentRef.current?.sequence === intent.sequence) {
        pendingTeamStartIntentRef.current = null;
      }
      if (teamCommandSequenceRef.current === intent.sequence) {
        startFrameRef.current = null;
        latestTeamTapRef.current = null;
        const savedGathering = gatheringStatesRef.current.get(gatheringCacheKey);
        setOptimisticTeamTargetId(savedGathering
          ? savedGathering.journeyPhase === 'en_route' ? savedGathering.activeDestinationId : null
          : undefined);
        publishLocalSessionId(savedGathering?.journeyPhase === 'en_route' ? localSessionIdRef.current : null);
      }
      showOperationFailure(t('map.setFailedTitle'), getOperationErrorMessage(error));
      logEvent('nav_start_failed', { destId: dest.id, sequence: intent.sequence });
      return false;
    } finally {
      if (isCurrent() && teamCommandSequenceRef.current === intent.sequence) {
        setPendingLeaderTargetId(null); setJourneyBusy(false);
      }
    }
  }, [groupId, actorId, state, navigationSession?.id, navigationDestinations, mapRef, onOptimisticGathering,
    setSelectedIndex, createRequestId, _refresh, refreshNavigationSession, publishLocalSessionId, gatheringCacheKey, t, frameStartedDestination]);

  const enqueueTeamCommand = useCallback((action: 'start' | 'end', dest: Destination, index: number, switchFromDestinationId?: string, startOrigin?: Coordinates): Promise<boolean> => {
    const latestTap = latestTeamTapRef.current;
    const ownLatestTap = latestTap?.groupId === groupId && latestTap?.actorId === actorId ? latestTap : null;
    if (action === 'start' && isLeader
      && (ownLatestTap ? !locallyStopped && ownLatestTap.action === 'start' && ownLatestTap.destinationId === dest.id
        : !locallyStopped && navTargetId === dest.id)) return Promise.resolve(true);
    if (action === 'end') {
      startFrameRef.current = null;
      stoppedServerSessionRef.current = navigationSession?.id ?? null;
      stoppedAtRef.current = Date.now();
      setLocallyStopped(true);
      setOptimisticTeamTargetId(null);
      setPendingLeaderTargetId(null);
      setLocalTargetId(null);
    } else {
      setLocallyStopped(false);
    }

    if (!isLeader) {
      if (action === 'start') startLocalRoutePlan(dest, index);
      else setLocalTargetId(null);
      return Promise.resolve(true);
    }
    const intent: TeamCommandIntent = {
      sequence: ++teamCommandSequenceRef.current,
      action,
      operationId: createRequestId(),
      destination: dest,
      switchFromDestinationId,
      startOrigin,
      index,
      previousServerSession: (() => {
        const previous = navigationSession ?? (lastVisibleServerSessionRef.current?.context === endedContext
          ? lastVisibleServerSessionRef.current.session : null);
        return previous && previous.groupId === groupId && previous.destinationId === dest.id
          && (previous.scopeSubgroupId ?? null) === (dest.subgroupId ?? null) ? previous : null;
      })(),
    };
    latestTeamTapRef.current = { action, destinationId: dest.id, groupId, actorId, sequence: intent.sequence };
    // Any delayed promotion snapshot of the previous tap has lost selection
    // ownership, even if that older command committed before this new tap.
    pendingCarouselTargetIdRef.current = null;
    // Clear the externally visible old alias while retaining the FIFO's
    // internal session identity until the new command durably commits.
    setVisibleLocalSessionId(null);
    onLocalSessionIdChange?.(null);
    if (action === 'start') {
      pendingTeamStartIntentRef.current = intent;
      // Publish the tap immediately. The session alias/receipt is published
      // only after SQLite commits, and a failed local save rolls this back.
      setPendingLeaderStop(false);
      setPendingLeaderTargetId(dest.id);
      setOptimisticTeamTargetId(dest.id);
      setSelectedIndex(index);
      frameStartedDestination(dest, startOrigin);
    } else {
      pendingTeamStartIntentRef.current = null;
    }
    // Capture the originating group's callback; a later render/group switch
    // must not execute a new tap using an older drain closure's group/state.
    const result = new Promise<boolean>((resolve, reject) => {
      const job: TeamCommandJob = {
        execute: async () => {
          const runner = action === 'start' ? runTeamStart : runTeamEnd;
          return runner(intent);
        },
        resolve,
        reject,
      };
      desiredTeamIntentRef.current.push(job);
    });
    // Distinct commands persist in tap order; the newest tap owns display.
    const drain = () => {
      if (teamCommandRunnerRef.current) return;
      const run = (async () => {
      while (desiredTeamIntentRef.current.length) {
        const job = desiredTeamIntentRef.current.shift()!;
        try {
          job.resolve(await job.execute());
        } catch (error) {
          job.reject(error);
        }
      }
    })().finally(() => {
      teamCommandRunnerRef.current = null;
      // A tap can land between the final loop check and finally. Restart
      // without removing/re-appending its head (which would reorder taps).
      if (desiredTeamIntentRef.current.length) drain();
    });
    teamCommandRunnerRef.current = run;
    };
    drain();
    return result;
  }, [isLeader, locallyStopped, navTargetId, groupId, actorId, startLocalRoutePlan, runTeamStart, runTeamEnd, createRequestId, navigationSession, endedContext, setSelectedIndex, mapRef, onLocalSessionIdChange, frameStartedDestination]);

  const acquireAndStart = useCallback(async (dest: Destination, index: number, switchFromDestinationId?: string) => {
    if (startAttemptRef.current?.destinationId === dest.id
      && startAttemptRef.current.groupId === groupId && startAttemptRef.current.actorId === actorId) return;
    const attemptId = ++startAttemptSequenceRef.current;
    const requestedAt = Date.now();
    startAttemptRef.current = { id: attemptId, destinationId: dest.id, groupId, actorId };
    try {
      const fix = await acquireStartFix();
      if (startAttemptRef.current?.id !== attemptId || !mountedRef.current
        || currentGroupRef.current !== groupId || currentActorRef.current !== actorId
        || !currentLeaderRef.current) return;
      const radius = arrivalRadiusRef.current;
      const coords = fix?.coordinates;
      if (!fix || !coords || fix.timestamp < requestedAt
        || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)
        || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180
        || !canEvaluateSynchronizedArrival({ sampledAt: fix.timestamp, now: Date.now(),
          accuracyM: fix.accuracy, radiusM: radius })) {
        Alert.alert(t('nav.startUnavailableTitle'), t('nav.startLocationUnavailable'));
        return;
      }
      if (distanceMeters(coords, dest.coordinates) < radius) {
        Alert.alert(t('nav.startUnavailableTitle'), t('nav.alreadyWithinArrivalRange'));
        return;
      }
      void enqueueTeamCommand('start', dest, index, switchFromDestinationId, coords);
    } catch {
      if (startAttemptRef.current?.id === attemptId && mountedRef.current
        && currentGroupRef.current === groupId && currentActorRef.current === actorId) {
        Alert.alert(t('nav.startUnavailableTitle'), t('nav.startLocationUnavailable'));
      }
    } finally {
      if (startAttemptRef.current?.id === attemptId) startAttemptRef.current = null;
    }
  }, [acquireStartFix, actorId, enqueueTeamCommand, groupId, t]);

  const startNavigation = useCallback(
    async (dest: Destination, index: number) => {
      if (isLeader) {
        // Resolve the current target independently of its local dismissal.
        // A suppressed active server row still must be explicitly switched.
        const latest = latestTeamTapRef.current;
        const ownLatest = latest?.groupId === groupId && latest?.actorId === actorId ? latest : null;
        const cached = gatheringStatesRef.current.get(gatheringCacheKey);
        const currentId = ownLatest?.action === 'start' ? ownLatest.destinationId
          : ownLatest?.action === 'end' ? null
          : optimisticTeamTargetId ? optimisticTeamTargetId
          : navigationSession?.status === 'active' ? navigationSession.destinationId
          : cached?.journeyPhase === 'en_route' ? cached.activeDestinationId
          : legacySharedTargetId;
        if (currentId === dest.id && !locallyStopped) return;
        if (currentId && currentId !== dest.id) {
          const promptKey = JSON.stringify([actorId, groupId, currentId, dest.id]);
          if (switchPromptRef.current === promptKey) return;
          switchPromptRef.current = promptKey;
          const dismiss = () => { if (switchPromptRef.current === promptKey) switchPromptRef.current = null; };
          const currentName = navigationDestinations.find(d => d.id === currentId)?.title
            ?? (navigationSession?.destinationId === currentId ? navigationSession.destination.name : currentId);
          Alert.alert(t('map.switchJourneyTitle'), t('map.switchJourneyMessage', { currentName, newName: dest.title }), [
            { text: t('common.cancel'), style: 'cancel', onPress: dismiss },
            { text: t('map.switchJourneyConfirm'), onPress: () => {
              dismiss();
              if (mountedRef.current && currentGroupRef.current === groupId && currentActorRef.current === actorId) {
                void acquireAndStart(dest, index, currentId);
              }
            } },
          ], { cancelable: true, onDismiss: dismiss });
          return;
        }
      }
      // Location acquisition precedes the durable command. The queue still
      // accepts End and later Start taps while the first write is pending.
      if (isLeader) await acquireAndStart(dest, index);
      else void enqueueTeamCommand('start', dest, index);
    },
    [acquireAndStart, enqueueTeamCommand, isLeader, locallyStopped, groupId, actorId, gatheringCacheKey, optimisticTeamTargetId,
      navigationSession, legacySharedTargetId, navigationDestinations, t],
  );

  const requestTeamEnd = useCallback(
    async (dest: Destination, index: number) => {
      startAttemptRef.current = null;
      const wasBusy = teamCommandRunnerRef.current !== null;
      const pending = enqueueTeamCommand('end', dest, index);
      // Preserve the tap API's non-blocking behavior when an earlier Start is
      // still writing. Consumers that need causal ordering (for example
      // deleting the active card) use stopNavigation, which opts into waiting.
      return wasBusy ? true : pending;
    },
    [enqueueTeamCommand],
  );

  const hasRequestedEnd = useCallback((destinationId: string) => {
    const latest = latestTeamTapRef.current;
    return latest?.action === 'end' && latest.destinationId === destinationId
      && latest.groupId === currentGroupRef.current && latest.actorId === currentActorRef.current;
  }, []);

  const stopNavigation = useCallback(async () => {
    startAttemptRef.current = null;
    if (isLeader) {
      const dest = pendingTeamStartIntentRef.current?.destination
        ?? navTarget
        ?? selectedDestination;
      if (dest) {
        const pending = enqueueTeamCommand('end', dest, destinations.findIndex((item) => item.id === dest.id));
        return pending;
      }
      setLocallyStopped(true);
      setOptimisticTeamTargetId(null);
      setPendingLeaderTargetId(null);
      return true;
    }
    setLocalTargetId(null);
    return true;
  }, [isLeader, navTarget, selectedDestination, destinations, enqueueTeamCommand]);

  /** Called after durable delete/complete; that operation owns the server cancellation. */
  const stopRemovedDestination = useCallback((destinationId: string, sessionId: string | null) => {
    if (navTargetId !== destinationId) return;
    // The durable snapshot hides this target. Unlike a user's End, a rejected
    // removal can restore the same original session and resume following it.
    setOptimisticTeamTargetId(null);
    setLocalTargetId(null);
    setPendingLeaderTargetId(null);
    startFrameRef.current = null;
    publishLocalSessionId(null);
  }, [navTargetId, publishLocalSessionId]);

  // Reorder is asynchronous. Project the selected page only after the latest
  // visible carousel order exactly matches the ID-based promote result; a
  // stale array still contains the target but must not clear the pending ID.

  return {
    lifecycle: createElement(JourneyNavigationRuntime, {
      setLocallyStopped, setEndedSessions, actorId, groupId, setEndedLoadedFor, endedContext, t, refreshStartFrame,
      fromCoords, mountedRef, setOptimisticTeamTargetId, setLocalTargetId, setPendingLeaderTargetId,
      setPendingLeaderStop, setJourneyBusy, publishLocalSessionId, localSessionContextRef, pendingTeamStartIntentRef,
      pendingStartRef, requestRef, latestTeamTapRef, startFrameRef, switchPromptRef, pendingCarouselTargetIdRef,
      navigationSession, navigationDestinations, clearLocalSessionAlias, serverOrStartedSessionRef,
      onOperatorStartConfirm, localSessionIdRef, hasPendingTeamOperation, teamCommandSequenceRef, gatheringStatesRef,
      gatheringCacheKey, setSelectedIndex, state, terminalSession, lastVisibleServerSessionRef, teamCommandRunnerRef,
      stoppedServerSessionRef, stoppedAtRef, locallyStopped, hiddenSession, navigationSessionId: navigationSession?.id,
      authoritativeSharedTargetId, optimisticTeamTargetId, sharedTargetId, pendingLeaderTargetId,
      lastFollowerCenterKeyRef, destinations, mapRef,
    }),
    navigationStoppedLocally: suppressNavigation,
    journeyStatus,
    journeyGoing,
    journeyActive,
    navTarget,
    navTargetId,
    sharedTargetId: sharedTargetId ?? null,
    localTargetId,
    /** Local UUID used to bind offline arrivals until the server session is visible. */
    localSessionId: localSessionContextRef.current?.destinationId === navTargetId
      && (!latestTeamTapRef.current || latestTeamTapRef.current.sequence === localSessionContextRef.current.commandSequence)
      ? visibleLocalSessionId : null,
    pendingLeaderTargetId,
    activePoint,
    numericDistance,
    journeyBusy,
    openExternalNavigation,
    openInAppleMaps,
    startNavigation,
    refreshStartFrame,
    requestTeamEnd,
    hasRequestedEnd,
    stopNavigation,
    stopRemovedDestination,
    startLocalRoutePlan,
  };
}

interface JourneyResourceInput {
  setLocallyStopped: Dispatch<SetStateAction<boolean>>;
  setEndedSessions: Dispatch<SetStateAction<Set<string>>>;
  actorId: UseJourneyNavigationParams['actorId'];
  groupId: UseJourneyNavigationParams['groupId'];
  setEndedLoadedFor: Dispatch<SetStateAction<string>>;
  endedContext: string;
  t: UseJourneyNavigationParams['t'];
  refreshStartFrame: () => void;
  fromCoords: Coordinates | undefined;
  mountedRef: RefObject<boolean>;
  setOptimisticTeamTargetId: Dispatch<SetStateAction<string | null | undefined>>;
  setLocalTargetId: Dispatch<SetStateAction<string | null>>;
  setPendingLeaderTargetId: Dispatch<SetStateAction<string | null>>;
  setPendingLeaderStop: Dispatch<SetStateAction<boolean>>;
  setJourneyBusy: Dispatch<SetStateAction<boolean>>;
  publishLocalSessionId: (sessionId: string | null, notify?: boolean) => void;
  localSessionContextRef: RefObject<{ destinationId: string; subgroupId: string | null; commandSequence: number; } | null>;
  pendingTeamStartIntentRef: RefObject<TeamCommandIntent | null>;
  pendingStartRef: RefObject<{ operationId: string; base: ActiveGatheringState; startedAt: number; entityVersion: number; previousServerSession?: NavigationSession | null; } | null>;
  requestRef: RefObject<{ destinationId: string; requestId: string; } | null>;
  latestTeamTapRef: RefObject<{ action: "start" | "end"; destinationId: string; groupId: string | null | undefined; actorId: string | null | undefined; sequence: number; } | null>;
  startFrameRef: RefObject<{ context: string; destination: Destination; fitted: boolean; } | null>;
  switchPromptRef: RefObject<string | null>;
  pendingCarouselTargetIdRef: RefObject<string | null>;
  navigationSession: NavigationSession | null | undefined;
  navigationDestinations: Destination[];
  clearLocalSessionAlias: () => void;
  serverOrStartedSessionRef: RefObject<boolean>;
  onOperatorStartConfirm: ((destination: Destination, eventId: string) => void) | undefined;
  localSessionIdRef: RefObject<string | null>;
  hasPendingTeamOperation: boolean | undefined;
  teamCommandSequenceRef: RefObject<number>;
  gatheringStatesRef: RefObject<Map<string, ActiveGatheringState>>;
  gatheringCacheKey: string;
  setSelectedIndex: (index: number) => void;
  state: GroupState | null;
  terminalSession: NavigationSession | null | undefined;
  lastVisibleServerSessionRef: RefObject<{ context: string; session: NavigationSession; } | null>;
  teamCommandRunnerRef: RefObject<Promise<void> | null>;
  stoppedServerSessionRef: RefObject<string | null>;
  stoppedAtRef: RefObject<number>;
  locallyStopped: boolean;
  hiddenSession: boolean;
  navigationSessionId: string | undefined;
  authoritativeSharedTargetId: string | null;
  optimisticTeamTargetId: string | null | undefined;
  sharedTargetId: string | null;
  pendingLeaderTargetId: string | null;
  lastFollowerCenterKeyRef: RefObject<string | null>;
  destinations: Destination[];
  mapRef: RefObject<GroupMapHandle | null>;
}

function JourneyEndedHistory({
  setLocallyStopped, setEndedSessions, actorId, groupId, setEndedLoadedFor, endedContext, t,
}: JourneyResourceInput) {
  useMountEffect(() => {
    let active = true;
    setLocallyStopped(false);
    setEndedSessions(new Set());
    if (!actorId || !groupId) { setEndedLoadedFor(endedContext); return; }
    void readEndedNavigationSessions(actorId, groupId).then(values => {
      if (active) { setEndedSessions(current => new Set([...current, ...values])); setEndedLoadedFor(endedContext); }
    }).catch(error => {
      if (active) {
        // Fail closed: unreadable dismissal history cannot resurrect navigation.
        setEndedLoadedFor('');
        showOperationFailure(t('map.setFailedTitle'), getOperationErrorMessage(error));
      }
    });
    return () => { active = false; };
  });
  return null;
}

function JourneyStartFrame({
  refreshStartFrame,
}: JourneyResourceInput) {
  useMountEffect(refreshStartFrame);
  return null;
}

function JourneyCommandLifetime({
  mountedRef,
}: JourneyResourceInput) {
  useMountEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; });
  return null;
}

function JourneyIdentityReset({
  setOptimisticTeamTargetId, setLocalTargetId, setPendingLeaderTargetId, setPendingLeaderStop, setJourneyBusy,
  publishLocalSessionId, localSessionContextRef, pendingTeamStartIntentRef, pendingStartRef, requestRef,
  latestTeamTapRef, startFrameRef, switchPromptRef, pendingCarouselTargetIdRef,
}: JourneyResourceInput) {
  useMountEffect(() => {
    setOptimisticTeamTargetId(undefined);
    setLocalTargetId(null);
    setPendingLeaderTargetId(null);
    setPendingLeaderStop(false);
    setJourneyBusy(false);
    publishLocalSessionId(null);
    localSessionContextRef.current = null;
    pendingTeamStartIntentRef.current = null;
    pendingStartRef.current = null;
    requestRef.current = null;
    latestTeamTapRef.current = null;
    startFrameRef.current = null;
    switchPromptRef.current = null;
    pendingCarouselTargetIdRef.current = null;
  });
  return null;
}

function JourneyStartAcknowledgement({
  requestRef, pendingStartRef, navigationSession, navigationDestinations, setOptimisticTeamTargetId,
  clearLocalSessionAlias, serverOrStartedSessionRef, onOperatorStartConfirm, groupId,
}: JourneyResourceInput) {
  useMountEffect(() => {
    const pending = requestRef.current;
    if (!pendingStartRef.current || !pending || navigationSession?.status !== 'active'
      || navigationSession.requestId !== pending.requestId) return;
    const destination = navigationDestinations.find((item) => item.id === navigationSession.destinationId);
    if (!destination) return;
    setOptimisticTeamTargetId(navigationSession.destinationId);
    clearLocalSessionAlias();
    serverOrStartedSessionRef.current = true;
    onOperatorStartConfirm?.(destination, `start:${groupId}:${pending.requestId}`);
    void flushCoreOperationOutbox().catch(() => undefined);
  });
  return null;
}

function JourneyAliasSettlement({
  localSessionIdRef, localSessionContextRef, navigationSession, clearLocalSessionAlias, pendingStartRef,
}: JourneyResourceInput) {
  useMountEffect(() => {
    const localSessionId = localSessionIdRef.current;
    const localContext = localSessionContextRef.current;
    const session = navigationSession;
    if (!localSessionId || !localContext || !session) return;

    const sameLane = session.destinationId === localContext.destinationId
      && (session.scopeSubgroupId ?? null) === (localContext.subgroupId ?? null);
    if (!sameLane) return;

    // A matching active/terminal row is the authoritative acknowledgement of
    // this local Start.  The request-matching effect above handles the active
    // row's notification; this branch also clears aliases for terminal rows.
    if (session.id === localSessionId || session.requestId === localSessionId) {
      clearLocalSessionAlias();
      return;
    }

    // A different active session in the same lane wins only after the local
    // Start has settled.  This is the T -> U handoff: U must receive the next
    // arrival and End instead of the stale local T alias.
    if (session.status !== 'active') return;
    // Prove replacement against the known prior server row. Comparing server
    // time with the device's local phase time breaks on clock skew; without a
    // known baseline only this Start's request identity can prove its ACK.
    const previousServer = pendingStartRef.current?.previousServerSession;
    if (pendingStartRef.current && (!previousServer || session.id === previousServer.id
      || Date.parse(session.startedAt) <= Date.parse(previousServer.startedAt))) return;
    let cancelled = false;
    void getCoreOperationOutbox().getOperation(localSessionId).then((operation) => {
      if (cancelled || localSessionIdRef.current !== localSessionId) return;
      // Non-arrival Start operations are removed from the outbox on ACK, so a
      // missing row is also a settled operation.  The local id was only
      // published after a successful enqueue; it is never a speculative key.
      const settled = !operation
        || operation.status === 'acked'
        || operation.status === 'conflict';
      if (settled) clearLocalSessionAlias();
    }).catch(() => undefined);
    return () => { cancelled = true; };
  // Re-run when the owning group projection reports that the Start operation
  // settled, even if the realtime session row itself did not change.
  });
  return null;
}

function JourneyCanonicalTarget({
  localSessionContextRef, pendingStartRef, groupId, navigationDestinations, teamCommandSequenceRef,
  setOptimisticTeamTargetId, setPendingLeaderTargetId, clearLocalSessionAlias, requestRef, latestTeamTapRef,
  pendingTeamStartIntentRef, gatheringStatesRef, gatheringCacheKey, setSelectedIndex,
}: JourneyResourceInput) {
  useMountEffect(() => {
    const context = localSessionContextRef.current;
    const pending = pendingStartRef.current;
    if (!groupId || !context || !pending || navigationDestinations.some(d => d.id === context.destinationId && !d.closedAt)) return;
    if (typeof readLocalJourneyProjection !== 'function') return;
    let cancelled = false;
    const originalId = context.destinationId;
    const sequence = teamCommandSequenceRef.current;
    void readLocalJourneyProjection(groupId, originalId).then(projection => {
      if (!projection || cancelled || sequence !== teamCommandSequenceRef.current
        || localSessionContextRef.current !== context || pendingStartRef.current !== pending) return;
      const destination = navigationDestinations.find(d => d.id === projection.canonicalDestinationId && !d.closedAt);
      if (projection.canonicalDestinationId === originalId || !destination) {
        // There is no merge ledger for this removed target. It is deletion or
        // completion, not permission to follow another destination.
        setOptimisticTeamTargetId(null);
        setPendingLeaderTargetId(null);
        clearLocalSessionAlias();
        return;
      }
      context.destinationId = destination.id;
      if (requestRef.current) requestRef.current.destinationId = destination.id;
      if (latestTeamTapRef.current?.action === 'start') latestTeamTapRef.current.destinationId = destination.id;
      if (pendingTeamStartIntentRef.current) pendingTeamStartIntentRef.current.destination = destination;
      gatheringStatesRef.current.set(gatheringCacheKey, projection.gathering);
      setOptimisticTeamTargetId(destination.id);
      setSelectedIndex(navigationDestinations.findIndex(d => d.id === destination.id));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  });
  return null;
}

function JourneyTerminalHistory({
  terminalSession, groupId, localSessionIdRef, lastVisibleServerSessionRef, endedContext, pendingTeamStartIntentRef,
  teamCommandRunnerRef, pendingStartRef, localSessionContextRef, setEndedSessions, actorId, stoppedServerSessionRef,
  startFrameRef, stoppedAtRef, setLocallyStopped, setOptimisticTeamTargetId, setPendingLeaderTargetId,
  latestTeamTapRef, clearLocalSessionAlias,
}: JourneyResourceInput) {
  useMountEffect(() => {
    if (!terminalSession || terminalSession.status === 'active' || terminalSession.groupId !== groupId) return;
    const localId = localSessionIdRef.current;
    const matchesLocalStart = Boolean(localId && (terminalSession.id === localId || terminalSession.requestId === localId));
    const matchesServer = lastVisibleServerSessionRef.current?.context === endedContext
      && lastVisibleServerSessionRef.current.session.id === terminalSession.id
      && (lastVisibleServerSessionRef.current.session.scopeSubgroupId ?? null) === (terminalSession.scopeSubgroupId ?? null);
    // An old session's End may arrive after a new local Start of the same stop.
    // Its stable request identity, not destination equality, owns termination.
    const pendingIntent = pendingTeamStartIntentRef.current;
    const matchesPendingIntent = Boolean(pendingIntent && (terminalSession.id === pendingIntent.operationId
      || terminalSession.requestId === pendingIntent.operationId));
    if (pendingIntent && teamCommandRunnerRef.current && !matchesPendingIntent) return;
    if (pendingStartRef.current && !matchesLocalStart && !matchesPendingIntent) return;
    if (!matchesLocalStart && !matchesServer) return;
    const localStart = pendingStartRef.current;
    const localDestinationId = localSessionContextRef.current?.destinationId;
    const endedKeys = [...new Set([terminalSession.id, terminalSession.requestId,
      legacyNavigationSessionKey(terminalSession.startedAt, terminalSession.destinationId),
      ...(localStart && localDestinationId ? [legacyNavigationSessionKey(
        new Date(localStart.startedAt).toISOString(), localDestinationId)] : []),
    ].filter((key): key is string => Boolean(key)))];
    setEndedSessions(values => new Set([...values, ...endedKeys]));
    if (actorId && groupId) {
      void Promise.all(endedKeys.map(key => rememberEndedNavigationSession(actorId, groupId, key))).catch(() => undefined);
    }
    stoppedServerSessionRef.current = terminalSession.id;
    startFrameRef.current = null;
    stoppedAtRef.current = Date.now();
    setLocallyStopped(true);
    setOptimisticTeamTargetId(null);
    setPendingLeaderTargetId(null);
    latestTeamTapRef.current = null;
    pendingTeamStartIntentRef.current = null;
    clearLocalSessionAlias();
  });
  return null;
}

function JourneyNewServerSession({
  locallyStopped, navigationSession, hiddenSession, stoppedServerSessionRef, stoppedAtRef, setLocallyStopped,
}: JourneyResourceInput) {
  useMountEffect(() => {
    if (locallyStopped && navigationSession?.status === 'active' && !hiddenSession
      && navigationSession.id !== stoppedServerSessionRef.current
      && Date.parse(navigationSession.startedAt) > stoppedAtRef.current) {
      setLocallyStopped(false);
    }
  });
  return null;
}

function JourneyGatheringSeed({
  groupId, gatheringStatesRef, gatheringCacheKey, state,
}: JourneyResourceInput) {
  useMountEffect(() => {
    if (groupId && !gatheringStatesRef.current.has(gatheringCacheKey) && state) {
      gatheringStatesRef.current.set(gatheringCacheKey, deriveActiveGatheringFromGroupState(state, 0));
    }
  });
  return null;
}

function JourneyDurableProjection({
  hasPendingTeamOperation, state, groupId, teamCommandRunnerRef, pendingStartRef, localSessionIdRef,
  teamCommandSequenceRef, localSessionContextRef, gatheringStatesRef, gatheringCacheKey, clearLocalSessionAlias,
  stoppedServerSessionRef, navigationSession, stoppedAtRef, setLocallyStopped, latestTeamTapRef,
  pendingTeamStartIntentRef, setOptimisticTeamTargetId,
}: JourneyResourceInput) {
  useMountEffect(() => {
    if (hasPendingTeamOperation !== false || !state || !groupId || teamCommandRunnerRef.current) return;
    const localStart = pendingStartRef.current;
    if (localStart && localSessionIdRef.current) {
      let cancelled = false;
      const sequence = teamCommandSequenceRef.current;
      void getCoreOperationOutbox().getOperation(localStart.operationId).then(async operation => {
        if (cancelled || sequence !== teamCommandSequenceRef.current
          || pendingStartRef.current !== localStart) return;
        let committedGathering: ActiveGatheringState | undefined;
        if (operation?.status !== 'conflict') {
          // Queue ACK and navigation-session hydration are separate. Missing
          // receipt means accepted, not paused. Only a newer durable End can
          // retire this Start before its matching server session is visible.
          const projection = typeof readLocalJourneyProjection === 'function'
            ? await readLocalJourneyProjection(groupId, localSessionContextRef.current?.destinationId ?? '') : null;
          if (cancelled || sequence !== teamCommandSequenceRef.current
            || pendingStartRef.current !== localStart) return;
          committedGathering = projection?.gathering;
          if (committedGathering) gatheringStatesRef.current.set(gatheringCacheKey, committedGathering);
          if (!projection || projection.gathering.journeyPhase === 'en_route'
            || projection.gathering.entityVersion <= localStart.entityVersion) {
            if (projection?.gathering.journeyPhase === 'en_route') {
              localStart.entityVersion = Math.max(localStart.entityVersion, projection.gathering.entityVersion);
            }
            return;
          }
        }
        const rejected = operation?.status === 'conflict';
        clearLocalSessionAlias();
        if (committedGathering) gatheringStatesRef.current.set(gatheringCacheKey, committedGathering);
        else if (rejected) gatheringStatesRef.current.set(gatheringCacheKey, localStart.base);
        if (!rejected) {
          stoppedServerSessionRef.current = navigationSession?.id ?? null;
          stoppedAtRef.current = Date.now();
          setLocallyStopped(true);
        }
        latestTeamTapRef.current = null;
        pendingTeamStartIntentRef.current = null;
        setOptimisticTeamTargetId(rejected ? undefined : null);
      }).catch(() => undefined);
      return () => { cancelled = true; };
    }
    const sequence = teamCommandSequenceRef.current;
    let cancelled = false;
    void readLocalJourneyProjection(groupId, state.group.activeDestinationId ?? '').then(projection => {
      if (cancelled || sequence !== teamCommandSequenceRef.current) return;
      const previous = gatheringStatesRef.current.get(gatheringCacheKey);
      if (projection && (!previous || projection.gathering.entityVersion >= previous.entityVersion)) {
        gatheringStatesRef.current.set(gatheringCacheKey, projection.gathering);
      }
    }).catch(() => undefined);
    latestTeamTapRef.current = null;
    pendingTeamStartIntentRef.current = null;
    setOptimisticTeamTargetId(undefined);
    return () => { cancelled = true; };
  });
  return null;
}

function JourneySharedTarget({
  serverOrStartedSessionRef, authoritativeSharedTargetId, optimisticTeamTargetId, pendingStartRef,
  pendingTeamStartIntentRef, setOptimisticTeamTargetId,
}: JourneyResourceInput) {
  useMountEffect(() => {
    serverOrStartedSessionRef.current = Boolean(authoritativeSharedTargetId);
    const override = optimisticTeamTargetId;
    if (override === undefined) return;
    if (override === authoritativeSharedTargetId && !pendingStartRef.current && !pendingTeamStartIntentRef.current) {
      setOptimisticTeamTargetId(undefined);
    }
  });
  return null;
}

function JourneyLeaderPending({
  teamCommandRunnerRef, sharedTargetId, pendingLeaderTargetId, setPendingLeaderTargetId, setPendingLeaderStop,
}: JourneyResourceInput) {
  useMountEffect(() => {
    if (!teamCommandRunnerRef.current && sharedTargetId && pendingLeaderTargetId === sharedTargetId) {
      setPendingLeaderTargetId(null);
    }
    if (sharedTargetId) setPendingLeaderStop(false);
  });
  return null;
}

function JourneyCarouselPromotion({
  pendingCarouselTargetIdRef, navigationDestinations, setSelectedIndex,
}: JourneyResourceInput) {
  useMountEffect(() => {
    const targetId = pendingCarouselTargetIdRef.current;
    if (!targetId) return;
    const index = followCarouselIndexAfterPromote({
      destinations: navigationDestinations,
      sharedTargetId: targetId,
    });
    if (index == null) return;
    pendingCarouselTargetIdRef.current = null;
    setSelectedIndex(index);
  });
  return null;
}

function JourneyFollowerCamera({
  sharedTargetId, lastFollowerCenterKeyRef, destinations, navigationSession, setSelectedIndex, startFrameRef,
  endedContext, mapRef,
}: JourneyResourceInput) {
  useMountEffect(() => {
    if (!sharedTargetId) {
      lastFollowerCenterKeyRef.current = null;
      return;
    }
    const index = followCarouselIndexAfterPromote({
      destinations,
      sharedTargetId,
    });
    if (index == null) return;
    const destination = destinations[index];
    if (!destination) return;
    const orderKey = destinations.map((d) => d.id).join(',');
    const centerKey = `${navigationSession?.id ?? 'legacy'}:${sharedTargetId}:${orderKey}`;
    if (lastFollowerCenterKeyRef.current === centerKey) return;
    lastFollowerCenterKeyRef.current = centerKey;
    setSelectedIndex(index);
    // Target changes from Start/follow are direct selections; only a manual
    // carousel swipe should animate the camera between points.
    if (startFrameRef.current?.context !== endedContext || startFrameRef.current.destination.id !== destination.id) {
      mapRef.current?.centerOn(destination.coordinates, { animated: false });
    }
  });
  return null;
}

function JourneyNavigationRuntime(input: JourneyResourceInput) {
  const {
    actorId, groupId, endedContext, fromCoords, refreshStartFrame, publishLocalSessionId, clearLocalSessionAlias,
    navigationSession, navigationDestinations, onOperatorStartConfirm, hasPendingTeamOperation, state,
    gatheringCacheKey, setSelectedIndex, terminalSession, locallyStopped, hiddenSession, navigationSessionId,
    authoritativeSharedTargetId, optimisticTeamTargetId, pendingLeaderTargetId, sharedTargetId, destinations, mapRef,
  } = input;
  const [previous, setPrevious] = useState({
    actorId, groupId, endedContext, fromCoords, refreshStartFrame, publishLocalSessionId, clearLocalSessionAlias,
    navigationSession, navigationDestinations, onOperatorStartConfirm, hasPendingTeamOperation, state,
    gatheringCacheKey, setSelectedIndex, terminalSession, locallyStopped, hiddenSession, navigationSessionId,
    authoritativeSharedTargetId, optimisticTeamTargetId, pendingLeaderTargetId, sharedTargetId, destinations, mapRef,
    JourneyEndedHistoryGeneration: 0, JourneyStartFrameGeneration: 0, JourneyCommandLifetimeGeneration: 0,
    JourneyIdentityResetGeneration: 0, JourneyStartAcknowledgementGeneration: 0, JourneyAliasSettlementGeneration: 0,
    JourneyCanonicalTargetGeneration: 0, JourneyTerminalHistoryGeneration: 0, JourneyNewServerSessionGeneration: 0,
    JourneyGatheringSeedGeneration: 0, JourneyDurableProjectionGeneration: 0, JourneySharedTargetGeneration: 0,
    JourneyLeaderPendingGeneration: 0, JourneyCarouselPromotionGeneration: 0, JourneyFollowerCameraGeneration: 0,
  });
  const JourneyEndedHistoryChanged =
    !Object.is(previous.actorId, actorId)
    || !Object.is(previous.groupId, groupId)
    || !Object.is(previous.endedContext, endedContext);
  const JourneyStartFrameChanged =
    !Object.is(previous.fromCoords, fromCoords)
    || !Object.is(previous.refreshStartFrame, refreshStartFrame);
  const JourneyIdentityResetChanged =
    !Object.is(previous.groupId, groupId)
    || !Object.is(previous.actorId, actorId)
    || !Object.is(previous.publishLocalSessionId, publishLocalSessionId);
  const JourneyStartAcknowledgementChanged =
    !Object.is(previous.clearLocalSessionAlias, clearLocalSessionAlias)
    || !Object.is(previous.groupId, groupId)
    || !Object.is(previous.navigationSession, navigationSession)
    || !Object.is(previous.navigationDestinations, navigationDestinations)
    || !Object.is(previous.onOperatorStartConfirm, onOperatorStartConfirm);
  const JourneyAliasSettlementChanged =
    !Object.is(previous.clearLocalSessionAlias, clearLocalSessionAlias)
    || !Object.is(previous.hasPendingTeamOperation, hasPendingTeamOperation)
    || !Object.is(previous.navigationSession, navigationSession);
  const JourneyCanonicalTargetChanged =
    !Object.is(previous.state, state)
    || !Object.is(previous.groupId, groupId)
    || !Object.is(previous.navigationDestinations, navigationDestinations)
    || !Object.is(previous.hasPendingTeamOperation, hasPendingTeamOperation)
    || !Object.is(previous.gatheringCacheKey, gatheringCacheKey)
    || !Object.is(previous.clearLocalSessionAlias, clearLocalSessionAlias)
    || !Object.is(previous.setSelectedIndex, setSelectedIndex);
  const JourneyTerminalHistoryChanged =
    !Object.is(previous.terminalSession, terminalSession)
    || !Object.is(previous.groupId, groupId)
    || !Object.is(previous.actorId, actorId)
    || !Object.is(previous.endedContext, endedContext)
    || !Object.is(previous.clearLocalSessionAlias, clearLocalSessionAlias);
  const JourneyNewServerSessionChanged =
    !Object.is(previous.locallyStopped, locallyStopped)
    || !Object.is(previous.navigationSession, navigationSession)
    || !Object.is(previous.hiddenSession, hiddenSession);
  const JourneyGatheringSeedChanged =
    !Object.is(previous.state, state)
    || !Object.is(previous.groupId, groupId)
    || !Object.is(previous.gatheringCacheKey, gatheringCacheKey);
  const JourneyDurableProjectionChanged =
    !Object.is(previous.state, state)
    || !Object.is(previous.groupId, groupId)
    || !Object.is(previous.gatheringCacheKey, gatheringCacheKey)
    || !Object.is(previous.hasPendingTeamOperation, hasPendingTeamOperation)
    || !Object.is(previous.clearLocalSessionAlias, clearLocalSessionAlias)
    || !Object.is(previous.navigationSessionId, navigationSessionId);
  const JourneySharedTargetChanged =
    !Object.is(previous.authoritativeSharedTargetId, authoritativeSharedTargetId)
    || !Object.is(previous.optimisticTeamTargetId, optimisticTeamTargetId);
  const JourneyLeaderPendingChanged =
    !Object.is(previous.pendingLeaderTargetId, pendingLeaderTargetId)
    || !Object.is(previous.sharedTargetId, sharedTargetId);
  const JourneyCarouselPromotionChanged =
    !Object.is(previous.navigationDestinations, navigationDestinations)
    || !Object.is(previous.setSelectedIndex, setSelectedIndex);
  const JourneyFollowerCameraChanged =
    !Object.is(previous.destinations, destinations)
    || !Object.is(previous.mapRef, mapRef)
    || !Object.is(previous.navigationSessionId, navigationSessionId)
    || !Object.is(previous.setSelectedIndex, setSelectedIndex)
    || !Object.is(previous.sharedTargetId, sharedTargetId);
  if (JourneyEndedHistoryChanged
    || JourneyStartFrameChanged
    || JourneyIdentityResetChanged
    || JourneyStartAcknowledgementChanged
    || JourneyAliasSettlementChanged
    || JourneyCanonicalTargetChanged
    || JourneyTerminalHistoryChanged
    || JourneyNewServerSessionChanged
    || JourneyGatheringSeedChanged
    || JourneyDurableProjectionChanged
    || JourneySharedTargetChanged
    || JourneyLeaderPendingChanged
    || JourneyCarouselPromotionChanged
    || JourneyFollowerCameraChanged) {
    setPrevious({
      actorId, groupId, endedContext, fromCoords, refreshStartFrame, publishLocalSessionId, clearLocalSessionAlias,
      navigationSession, navigationDestinations, onOperatorStartConfirm, hasPendingTeamOperation, state,
      gatheringCacheKey, setSelectedIndex, terminalSession, locallyStopped, hiddenSession, navigationSessionId,
      authoritativeSharedTargetId, optimisticTeamTargetId, pendingLeaderTargetId, sharedTargetId, destinations, mapRef,
      JourneyEndedHistoryGeneration: previous.JourneyEndedHistoryGeneration + (JourneyEndedHistoryChanged ? 1 : 0),
      JourneyStartFrameGeneration: previous.JourneyStartFrameGeneration + (JourneyStartFrameChanged ? 1 : 0),
      JourneyCommandLifetimeGeneration: previous.JourneyCommandLifetimeGeneration,
      JourneyIdentityResetGeneration: previous.JourneyIdentityResetGeneration + (JourneyIdentityResetChanged ? 1 : 0),
      JourneyStartAcknowledgementGeneration: previous.JourneyStartAcknowledgementGeneration + (JourneyStartAcknowledgementChanged ? 1 : 0),
      JourneyAliasSettlementGeneration: previous.JourneyAliasSettlementGeneration + (JourneyAliasSettlementChanged ? 1 : 0),
      JourneyCanonicalTargetGeneration: previous.JourneyCanonicalTargetGeneration + (JourneyCanonicalTargetChanged ? 1 : 0),
      JourneyTerminalHistoryGeneration: previous.JourneyTerminalHistoryGeneration + (JourneyTerminalHistoryChanged ? 1 : 0),
      JourneyNewServerSessionGeneration: previous.JourneyNewServerSessionGeneration + (JourneyNewServerSessionChanged ? 1 : 0),
      JourneyGatheringSeedGeneration: previous.JourneyGatheringSeedGeneration + (JourneyGatheringSeedChanged ? 1 : 0),
      JourneyDurableProjectionGeneration: previous.JourneyDurableProjectionGeneration + (JourneyDurableProjectionChanged ? 1 : 0),
      JourneySharedTargetGeneration: previous.JourneySharedTargetGeneration + (JourneySharedTargetChanged ? 1 : 0),
      JourneyLeaderPendingGeneration: previous.JourneyLeaderPendingGeneration + (JourneyLeaderPendingChanged ? 1 : 0),
      JourneyCarouselPromotionGeneration: previous.JourneyCarouselPromotionGeneration + (JourneyCarouselPromotionChanged ? 1 : 0),
      JourneyFollowerCameraGeneration: previous.JourneyFollowerCameraGeneration + (JourneyFollowerCameraChanged ? 1 : 0) });
  }
  return createElement(Fragment, null,
    createElement(JourneyEndedHistory, { ...input, key: 'JourneyEndedHistory:' + previous.JourneyEndedHistoryGeneration }),
    createElement(JourneyStartFrame, { ...input, key: 'JourneyStartFrame:' + previous.JourneyStartFrameGeneration }),
    createElement(JourneyCommandLifetime, { ...input, key: 'JourneyCommandLifetime:' + previous.JourneyCommandLifetimeGeneration }),
    createElement(JourneyIdentityReset, { ...input, key: 'JourneyIdentityReset:' + previous.JourneyIdentityResetGeneration }),
    createElement(JourneyStartAcknowledgement, { ...input, key: 'JourneyStartAcknowledgement:' + previous.JourneyStartAcknowledgementGeneration }),
    createElement(JourneyAliasSettlement, { ...input, key: 'JourneyAliasSettlement:' + previous.JourneyAliasSettlementGeneration }),
    createElement(JourneyCanonicalTarget, { ...input, key: 'JourneyCanonicalTarget:' + previous.JourneyCanonicalTargetGeneration }),
    createElement(JourneyTerminalHistory, { ...input, key: 'JourneyTerminalHistory:' + previous.JourneyTerminalHistoryGeneration }),
    createElement(JourneyNewServerSession, { ...input, key: 'JourneyNewServerSession:' + previous.JourneyNewServerSessionGeneration }),
    createElement(JourneyGatheringSeed, { ...input, key: 'JourneyGatheringSeed:' + previous.JourneyGatheringSeedGeneration }),
    createElement(JourneyDurableProjection, { ...input, key: 'JourneyDurableProjection:' + previous.JourneyDurableProjectionGeneration }),
    createElement(JourneySharedTarget, { ...input, key: 'JourneySharedTarget:' + previous.JourneySharedTargetGeneration }),
    createElement(JourneyLeaderPending, { ...input, key: 'JourneyLeaderPending:' + previous.JourneyLeaderPendingGeneration }),
    createElement(JourneyCarouselPromotion, { ...input, key: 'JourneyCarouselPromotion:' + previous.JourneyCarouselPromotionGeneration }),
    createElement(JourneyFollowerCamera, { ...input, key: 'JourneyFollowerCamera:' + previous.JourneyFollowerCameraGeneration })
  );
}
