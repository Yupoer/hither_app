import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getGroupRecoverySnapshot } from '../api/client';
import { energyObservability } from './energyObservability';
import { syncLocationSharing } from './locationSharingSync';
import { isNetworkRequestError } from '../api/services/_helpers';
import { getOperationErrorMessage } from '../utils/operationError';
import { supabase } from '../api/supabase';
import type { GroupState } from '../types';
import type {
  CoreSnapshotFreshness,
  CoreSnapshotSource,
} from '../types/coreData';
import {
  applyMemberLocationPatches,
  locationPatchFromRealtimePayload,
  mergeLocationPatches,
  type MemberLocationPatch,
} from '../utils/groupStatePatches';
import { isOwnLocationChange } from '../utils/locationPolicy';
import { groupSyncDelay } from '../utils/groupSyncCadence';
import {
  describeRecoveryMerge,
  isLeaderGatheringOperation,
  mergeRemoteGroupStatePreservingOwnLocation,
  pickStrongerReloadReason,
  shouldFenceEmptyItinerary,
  type GroupReloadReason,
} from '../utils/syncAuthority';
import {
  coreSnapshotFreshness,
} from '../utils/coreSnapshotFreshness';
import {
  groupStateFromCoreSnapshot,
  readCoreSnapshot,
} from './coreDataStore';
import {
  flushCoreOperationOutbox,
  hydrateCoreEntityVersions,
  listOpenCoreOperations,
  projectOptimisticGathering,
  projectPendingDestinations,
  subscribeCoreOutboxChanges,
} from './coreDataSync';
import type { ActiveGatheringState, CoreOperation } from '../types/coreData';

/**
 * Slow reconciliation interval. Realtime is still the fast path, but the
 * poll also repairs silent/missed events after a member joins or a stop is
 * added while the channel reports SUBSCRIBED.
 */
// ponytail: 60s is the fallback ceiling; Realtime handles normal propagation.
export const GROUP_POLL_INTERVAL_MS = 60_000;

/** Coalesce bursts of non-location realtime events into a single refetch. */
const REALTIME_DEBOUNCE_MS = 300;

/**
 * Monotonic id so each hook instance gets its OWN realtime channel topic.
 * supabase-js reuses a channel when two callers pass the same topic name, and a
 * reused channel that is already `subscribe()`d rejects new `postgres_changes`
 * bindings ("cannot add postgres_changes callbacks ... after subscribe()").
 * That happens when two screens (e.g. Map + Settings) observe the same group at
 * once, so we suffix the topic with a per-instance id to keep them distinct.
 */
let channelSeq = 0;

interface UseGroupStateOptions {
  /** Current user id — own location pings are ignored to avoid full-state thrash. */
  myUserId?: string | null;
  /** Aligns location-event debounce with the accuracy profile. */
  highAccuracy?: boolean;
}

export type GroupStateDataSource = 'remote' | 'local_cache' | 'none';

interface UseGroupStateResult {
  state: GroupState | null;
  /** True only during the very first load (before any data arrives). */
  loading: boolean;
  error: string | null;
  /** Force an immediate refresh (e.g. pull-to-refresh, recenter). */
  refresh: (reason?: GroupReloadReason) => Promise<boolean>;
  /** Where the current state was loaded from (OTA-04 local-first). */
  dataSource: GroupStateDataSource;
  /** Snapshot freshness for offline / stale banners. */
  snapshotFreshness: CoreSnapshotFreshness;
  /** Empty snapshot after offline cold start (no prior sync). */
  emptyLocalSnapshot: boolean;
  /** Pending / conflicted outbox ops for this group (OTA-04 UI). */
  openOperations: CoreOperation[];
  /** Merge optimistic gathering into in-memory GroupState after local enqueue. */
  applyOptimisticGathering: (gathering: ActiveGatheringState) => void;
}

/**
 * Subscribe to a group's live state.
 *
 * Primary path (foreground only): Realtime on member_locations / memberships /
 * itinerary_items. Peer locations are patched in-memory from the payload.
 *
 * Local-first (OTA-04): successful remote loads persist a SQLite snapshot;
 * network failures restore group + itinerary from that snapshot so offline
 * cold start still paints the last known journey.
 *
 * When AppState is not `active`, channels are torn down so the radio can sleep
 * during all-day background sharing (upload is owned by the background task).
 *
 * Fallback: slow interval poll only while foregrounded.
 */
export function useGroupState(
  groupId: string | null,
  options: UseGroupStateOptions = {},
): UseGroupStateResult {
  const { myUserId = null } = options;
  const [state, setState] = useState<GroupState | null>(null);
  /** Mirrors React state so recovery can merge + persist one authoritative snapshot. */
  const stateRef = useRef<GroupState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<GroupStateDataSource>('none');
  const [snapshotFreshness, setSnapshotFreshness] = useState<CoreSnapshotFreshness>({
    unit: 'missing',
  });
  const [emptyLocalSnapshot, setEmptyLocalSnapshot] = useState(false);
  const [openOperations, setOpenOperations] = useState<CoreOperation[]>([]);
  const openOperationsRef = useRef<CoreOperation[]>([]);
  openOperationsRef.current = openOperations;
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const activeRef = useRef(true);
  const groupIdRef = useRef(groupId);
  // Keep identity refs current during render. Async callbacks can settle
  // between the render and the passive effect that would otherwise update
  // these refs, especially while switching groups/accounts.
  groupIdRef.current = groupId;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeReadyRef = useRef(false);
  const pendingPatchesRef = useRef(new Map<string, MemberLocationPatch>());
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;

  const loadInFlightRef = useRef<Promise<boolean> | null>(null);
  const loadInFlightContextRef = useRef<{
    groupId: string;
    actorId: string | null;
    generation: number;
  } | null>(null);
  // Realtime can report a newer revision while the recovery RPC is still in
  // flight. Do not collapse that event into the old promise: the completion
  // path schedules one immediate follow-up snapshot for the same group.
  const pendingReloadRef = useRef(false);
  /** Strongest reason among coalesced reload requests for the next load. */
  const pendingReloadReasonRef = useRef<GroupReloadReason | null>(null);
  /** Reason consumed by the in-flight recovery load. */
  const inFlightReasonRef = useRef<GroupReloadReason>('unknown');
  const groupGenerationRef = useRef(0);
  const inFlightRevisionRef = useRef<string | null>(null);
  const latestRevisionRef = useRef('0');
  const isOlderRevision = useCallback((candidate: string, current: string): boolean => {
    if (candidate === current) return false;
    const candidateMs = Date.parse(candidate);
    const currentMs = Date.parse(current);
    if (!Number.isNaN(candidateMs) && !Number.isNaN(currentMs)) {
      return candidateMs < currentMs;
    }
    return candidate < current;
  }, []);

  const refreshOpenOperations = useCallback(async (
    id: string,
    expectedGeneration = groupGenerationRef.current,
    expectedActorId = myUserIdRef.current,
  ) => {
    const isCurrent = () => (
      activeRef.current
      && groupGenerationRef.current === expectedGeneration
      && groupIdRef.current === id
      && myUserIdRef.current === expectedActorId
    );
    try {
      const ops = await listOpenCoreOperations(id);
      if (isCurrent()) {
        const own = ops.filter(op => Boolean(myUserIdRef.current)
          && (op.actorId ?? op.payload.actorId) === myUserIdRef.current);
        const previous = openOperationsRef.current;
        openOperationsRef.current = own;
        setOpenOperations(own);
        // Accepted/conflicted intent must converge to authoritative data, not
        // wait five minutes for the fallback poll or retain a local draft.
        if (previous.some(op => op.status !== 'conflict'
          && !own.some(next => next.id === op.id && next.status !== 'conflict'))) {
          void loadRef.current('itinerary_mutation');
        }
      }
    } catch (cause) {
      // A queue read failure is not evidence that saved operations disappeared.
      // Keep the last receipt visible and expose the real storage/session error.
      if (isCurrent()) setError(getOperationErrorMessage(cause));
    }
  }, []);

  // Live outbox banners: refresh open ops after enqueue / flush.
  useEffect(() => {
    if (!groupId) return;
    return subscribeCoreOutboxChanges(() => {
      void refreshOpenOperations(groupId);
    });
  }, [groupId, myUserId, refreshOpenOperations]);

  const applyOptimisticGathering = useCallback((gathering: ActiveGatheringState) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = projectOptimisticGathering(prev, gathering);
      stateRef.current = next;
      return next;
    });
    setDataSource('local_cache');
    if (groupId) void refreshOpenOperations(groupId);
  }, [groupId, refreshOpenOperations]);

  const applyLocalSnapshot = useCallback(async (
    id: string,
    expectedGeneration = groupGenerationRef.current,
    expectedActorId = myUserIdRef.current,
  ): Promise<boolean> => {
    const isCurrent = () => (
      activeRef.current
      && groupGenerationRef.current === expectedGeneration
      && groupIdRef.current === id
      && myUserIdRef.current === expectedActorId
    );
    try {
      const snapshot = await readCoreSnapshot(id);
      if (!isCurrent()) return false;
      if (!snapshot) {
        setEmptyLocalSnapshot(true);
        setSnapshotFreshness({ unit: 'missing' });
        setDataSource('none');
        return false;
      }
      const next = groupStateFromCoreSnapshot(snapshot);
      const freshness = coreSnapshotFreshness(snapshot, Date.now());
      stateRef.current = next;
      setState(next);
      setDataSource('local_cache');
      setSnapshotFreshness(freshness);
      setEmptyLocalSnapshot(false);
      const source: CoreSnapshotSource = snapshot.source;
      void source;
      await refreshOpenOperations(id, expectedGeneration, expectedActorId);
      return true;
    } catch {
      return false;
    }
  }, [refreshOpenOperations]);

  const load = useCallback((reason: GroupReloadReason = 'unknown'): Promise<boolean> => {
    if (!groupId) return Promise.resolve(false);
    const actorId = myUserId;
    const generation = groupGenerationRef.current;
    const isCurrentRequest = () => (
      activeRef.current
      && groupGenerationRef.current === generation
      && groupIdRef.current === groupId
      && myUserIdRef.current === actorId
    );

    // A callback retained by the previous group/account must not start a new
    // recovery request after the hook has moved on. This is separate from the
    // response guard below: it prevents an old refresh from occupying the
    // shared in-flight slot needed by the current identity.
    if (!isCurrentRequest()) return Promise.resolve(false);

    if (loadInFlightRef.current) {
      const inFlight = loadInFlightContextRef.current;
      if (inFlight
        && inFlight.groupId === groupId
        && inFlight.actorId === actorId
        && inFlight.generation === generation) {
        // Initial/group-foreground effects may call load twice for the same
        // revision. Only a revision that arrived after this request needs a
        // follow-up; Realtime callbacks explicitly mark their own events below.
        if (latestRevisionRef.current !== inFlightRevisionRef.current) {
          pendingReloadRef.current = true;
        }
        pendingReloadReasonRef.current = pickStrongerReloadReason(
          pendingReloadReasonRef.current,
          reason,
        );
        return loadInFlightRef.current;
      }
      // A stale request may still settle, but it must not be reused by the
      // current group/account. The new request below owns the slot.
    }
    inFlightRevisionRef.current = latestRevisionRef.current;
    const loadReason = pickStrongerReloadReason(pendingReloadReasonRef.current, reason);
    pendingReloadReasonRef.current = null;
    inFlightReasonRef.current = loadReason;
    const run = (async () => {
      try {
        energyObservability.increment('snapshot');
        energyObservability.event('snapshot');
        const recovery = await getGroupRecoverySnapshot(groupId);
        if (!isCurrentRequest()) return false;
        const next = recovery.state;
        const staleResponse = isOlderRevision(recovery.revision, latestRevisionRef.current);
        const isCurrentGeneration = isCurrentRequest();
        // One authoritative merge for React state + SQLite. Do not persist the
        // raw empty remote when membership fence preserves local cards (#167).
        let persistSnapshot: GroupState | null = null;
        if (isCurrentGeneration && !staleResponse) {
          latestRevisionRef.current = recovery.revision;
          const preserveLocalGathering = openOperationsRef.current.some(
            (operation) => isLeaderGatheringOperation(operation),
          );
          const previous = stateRef.current;
          const previousCount = previous?.destinations.length ?? 0;
          const remoteCount = next.destinations.length;
          const fenced = shouldFenceEmptyItinerary({
            reason: loadReason,
            previousDestinationCount: previousCount,
            remoteDestinationCount: remoteCount,
          });
          const meta = describeRecoveryMerge({
            reason: loadReason,
            revision: recovery.revision,
            previousDestinationCount: previousCount,
            remoteDestinationCount: remoteCount,
            preserveLocalGathering,
            fencedEmptyItinerary: fenced,
          });
          if (
            meta.outcome === 'fenced_empty_itinerary'
            || meta.outcome === 'preserved_local_gathering'
            || loadReason === 'membership_change'
            || loadReason === 'itinerary_mutation'
          ) {
            // Compact seam log for membership vs itinerary diagnostics.
            // eslint-disable-next-line no-console
            console.info('[group-recovery-merge]', meta);
          }
          const merged = mergeRemoteGroupStatePreservingOwnLocation(
            previous,
            next,
            myUserIdRef.current,
            {
              preserveLocalGathering,
              reloadReason: loadReason,
            },
          );
          stateRef.current = merged;
          setState(merged);
          persistSnapshot = merged;
          setError(null);
          setDataSource('remote');
          setEmptyLocalSnapshot(false);
        }
        try {
          if (!isCurrentRequest()) return false;
          // Persist the same merged snapshot used for paint (never raw empty fenced next).
          if (!staleResponse && isCurrentGeneration && persistSnapshot) {
            await hydrateCoreEntityVersions(groupId, persistSnapshot);
          }
          if (!isCurrentRequest()) return false;
          const snap = await readCoreSnapshot(groupId);
          if (
            isCurrentRequest()
            && snap
          ) {
            setSnapshotFreshness(coreSnapshotFreshness(snap, Date.now()));
          }
        } catch {
          // Local cache write is best-effort; remote state still paints.
        }
        // Opportunistic outbox drain after a successful network round-trip.
        if (!isCurrentRequest()) return false;
        if (actorId) await syncLocationSharing(actorId).catch(() => undefined);
        if (!isCurrentRequest()) return false;
        await flushCoreOperationOutbox().catch(() => undefined);
        if (!isCurrentRequest()) return false;
        await refreshOpenOperations(groupId, generation, actorId);
        return isCurrentRequest();
      } catch (cause) {
        if (!isCurrentRequest()) return false;
        const message = cause instanceof Error ? cause.message : String(cause ?? '');
        const notMember = /not_member/i.test(message);
        if (notMember) {
          // Membership revoked (e.g. kick) — do not paint stale local cards.
          if (isCurrentRequest()) {
            stateRef.current = null;
            setState(null);
            setDataSource('none');
            setError('not_member');
            setEmptyLocalSnapshot(false);
          }
          return false;
        }
        const restored = await applyLocalSnapshot(groupId, generation, actorId);
        if (!isCurrentRequest()) return false;
        if (restored) {
          // Offline / network failure with a prior snapshot: show cached data.
          setError(
            isNetworkRequestError(cause)
              ? null
                : getOperationErrorMessage(cause),
          );
        } else {
          setError(getOperationErrorMessage(cause));
        }
        // Always false when remote pull failed — callers (force-refresh, sync)
        // must surface failure even if a local cache is still painted.
        return false;
      } finally {
        if (isCurrentRequest()) setLoading(false);
      }
    })().finally(() => {
      if (loadInFlightRef.current !== run) return;
      loadInFlightRef.current = null;
      inFlightRevisionRef.current = null;
      loadInFlightContextRef.current = null;
      if (!isCurrentRequest()) return;
      const shouldFollow = pendingReloadRef.current;
      pendingReloadRef.current = false;
      if (!shouldFollow || !activeRef.current || !groupId) return;
      if (groupGenerationRef.current !== generation) return;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      // The old response is fully settled here. Start the newer request now,
      // avoiding the 60-second poll ceiling and remaining observable under
      // Jest's fake timers as well as native runtimes.
      if (
        activeRef.current
        && groupGenerationRef.current === generation
        && groupId
      ) {
        const followReason = pendingReloadReasonRef.current ?? 'unknown';
        pendingReloadReasonRef.current = null;
        void loadRef.current(followReason);
      }
    });
    loadInFlightRef.current = run;
    loadInFlightContextRef.current = { groupId, actorId, generation };
    return run;
  }, [applyLocalSnapshot, groupId, isOlderRevision, myUserId, refreshOpenOperations]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const sub = AppState.addEventListener('change', setAppState);
    return () => sub.remove();
  }, []);

  // Initial / group change load — even if briefly backgrounded, keep last state.
  // OTA-04: paint local snapshot immediately so offline cold start is usable,
  // then reconcile with remote when possible.
  useEffect(() => {
    activeRef.current = true;
    realtimeReadyRef.current = false;
    const generation = groupGenerationRef.current + 1;
    groupGenerationRef.current = generation;
    pendingReloadRef.current = false;
    pendingReloadReasonRef.current = null;
    setLoading(true);
    stateRef.current = null;
    setState(null);
    setDataSource('none');
    openOperationsRef.current = [];
    setOpenOperations([]);
    setSnapshotFreshness({ unit: 'missing' });
    setEmptyLocalSnapshot(false);
    setError(null);
    pendingPatchesRef.current.clear();
    latestRevisionRef.current = '0';

    if (!groupId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      await applyLocalSnapshot(groupId, generation, myUserId);
      if (cancelled || !activeRef.current) return;
      // If we already painted from cache, drop the full-screen loader so the
      // map can render while remote reconciliation continues.
      if (activeRef.current) {
        // loading stays true until remote attempt finishes unless we have cache;
        // applyLocalSnapshot does not clear loading — load() does.
      }
      await loadRef.current('subscription_hydrate');
    })();

    return () => {
      cancelled = true;
      activeRef.current = false;
      if (groupGenerationRef.current === generation) {
        groupGenerationRef.current += 1;
        // A request for the previous group cannot be reused by the next
        // effect. It may still settle in the background, but the new group
        // must start its own recovery request immediately.
        loadInFlightRef.current = null;
        inFlightRevisionRef.current = null;
        loadInFlightContextRef.current = null;
        pendingReloadRef.current = false;
        pendingReloadReasonRef.current = null;
      }
    };
  }, [applyLocalSnapshot, groupId, myUserId]);

  // Realtime + poll only while the app is foregrounded (battery budget).
  useEffect(() => {
    if (!groupId || appState !== 'active') {
      return;
    }

    activeRef.current = true;

    // Soft refresh when returning from background so peer pins catch up.
    void loadRef.current('poll_manual_refresh');
    // load() drains only after session and remote state recovery have succeeded.

    const scheduleReload = (
      reason: GroupReloadReason,
      payload?: { commit_timestamp?: string },
    ) => {
      const revision = payload?.commit_timestamp;
      if (revision && isOlderRevision(revision, latestRevisionRef.current)) return;
      if (revision && isOlderRevision(latestRevisionRef.current, revision)) {
        latestRevisionRef.current = revision;
      }
      energyObservability.increment('realtime_callback');
      pendingReloadReasonRef.current = pickStrongerReloadReason(
        pendingReloadReasonRef.current,
        reason,
      );
      if (loadInFlightRef.current) {
        pendingReloadRef.current = true;
        return;
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        const nextReason = pendingReloadReasonRef.current ?? reason;
        pendingReloadReasonRef.current = null;
        loadRef.current(nextReason);
      }, REALTIME_DEBOUNCE_MS);
    };

    const flushLocationPatches = () => {
      locationDebounceRef.current = null;
      const buffered = Array.from(pendingPatchesRef.current.values());
      pendingPatchesRef.current.clear();
      if (buffered.length === 0) return;

      setState((prev) => {
        if (!prev) {
          void loadRef.current('location_change');
          return prev;
        }
        const next = applyMemberLocationPatches(
          prev,
          buffered,
          myUserIdRef.current,
        );
        if (next === null) {
          void loadRef.current('location_change');
          return prev;
        }
        stateRef.current = next;
        return next;
      });
    };

    const scheduleLocationPatch = () => {
      if (locationDebounceRef.current) return;
      locationDebounceRef.current = setTimeout(flushLocationPatches, 250);
    };

    const filter = `group_id=eq.${groupId}`;
    // groups PK is `id`, not group_id — journey_status / active_destination_id live here.
    const groupRowFilter = `id=eq.${groupId}`;
    const subId = ++channelSeq;
    const channel = supabase
      .channel(`group:${groupId}:${subId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_locations', filter },
        (payload) => {
          if (isOwnLocationChange(payload, myUserIdRef.current)) return;

          const parsed = locationPatchFromRealtimePayload({
            new: payload.new as Record<string, unknown> | null,
            old: payload.old as Record<string, unknown> | null,
            eventType: payload.eventType,
          });
          if (parsed === 'full-reload' || parsed === null) {
            scheduleReload('location_change', payload as { commit_timestamp?: string });
            return;
          }
          mergeLocationPatches(pendingPatchesRef.current, parsed);
          scheduleLocationPatch();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'memberships', filter },
        (payload) => scheduleReload('membership_change', payload as { commit_timestamp?: string }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itinerary_items', filter },
        (payload) => scheduleReload('itinerary_mutation', payload as { commit_timestamp?: string }),
      )
      // Daily stay snapshots are independent of itinerary events; remote clear
      // or some→some must fence-reload peers (not wait for poll).
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_accommodations', filter },
        (payload) => scheduleReload('accommodation_change', payload as { commit_timestamp?: string }),
      )
      // Leader start/stop nav writes groups.journey_status + active_destination_id.
      // Without this, followers only learn via the 5-minute poll and never show
      // the planned route polyline / multi-mode alts / Live Activity in time.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'groups', filter: groupRowFilter },
        (payload) => scheduleReload('group_update', payload as { commit_timestamp?: string }),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        (payload) => scheduleReload('profile_update', payload as { commit_timestamp?: string }),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          realtimeReadyRef.current = true;
          // A new member can subscribe after the leader has already written
          // itinerary rows. Hydrate once after the channel is ready instead
          // of relying on an event that happened before this subscription.
          void loadRef.current('subscription_hydrate');
          return;
        }
        if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          realtimeReadyRef.current = false;
        }
      });

    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (stopped) return;
        const ok = await loadRef.current('poll_manual_refresh');
        failures = ok ? 0 : failures + 1;
        if (!stopped) schedule();
      }, groupSyncDelay(realtimeReadyRef.current, failures));
    };
    schedule();

    return () => {
      realtimeReadyRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
      stopped = true;
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [groupId, appState, isOlderRevision]);

  const projectedState = useMemo(() => state
    ? projectPendingDestinations(state, openOperations) : null, [state, openOperations]);
  return {
    state: projectedState,
    loading,
    error,
    refresh: load,
    dataSource,
    snapshotFreshness,
    emptyLocalSnapshot,
    openOperations,
    applyOptimisticGathering,
  };
}
