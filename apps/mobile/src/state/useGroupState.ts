import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getGroupState } from '../api/client';
import { isNetworkRequestError } from '../api/services/_helpers';
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
import { isOwnLocationChange, locationPolicy } from '../utils/locationPolicy';
import {
  isLeaderGatheringOperation,
  mergeRemoteGroupStatePreservingOwnLocation,
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
  refresh: () => Promise<boolean>;
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
  const { myUserId = null, highAccuracy = false } = options;
  const [state, setState] = useState<GroupState | null>(null);
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeReadyRef = useRef(false);
  const pendingPatchesRef = useRef(new Map<string, MemberLocationPatch>());
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;
  const highAccuracyRef = useRef(highAccuracy);
  highAccuracyRef.current = highAccuracy;

  const loadInFlightRef = useRef<Promise<boolean> | null>(null);

  const refreshOpenOperations = useCallback(async (id: string) => {
    try {
      const ops = await listOpenCoreOperations(id);
      if (activeRef.current) setOpenOperations(ops);
    } catch {
      if (activeRef.current) setOpenOperations([]);
    }
  }, []);

  // Live outbox banners: refresh open ops after enqueue / flush.
  useEffect(() => {
    if (!groupId) return;
    return subscribeCoreOutboxChanges(() => {
      void refreshOpenOperations(groupId);
    });
  }, [groupId, refreshOpenOperations]);

  const applyOptimisticGathering = useCallback((gathering: ActiveGatheringState) => {
    setState((prev) => {
      if (!prev) return prev;
      return projectOptimisticGathering(prev, gathering);
    });
    setDataSource('local_cache');
    if (groupId) void refreshOpenOperations(groupId);
  }, [groupId, refreshOpenOperations]);

  const applyLocalSnapshot = useCallback(async (id: string): Promise<boolean> => {
    try {
      const snapshot = await readCoreSnapshot(id);
      if (!snapshot) {
        if (activeRef.current) {
          setEmptyLocalSnapshot(true);
          setSnapshotFreshness({ unit: 'missing' });
          setDataSource('none');
        }
        return false;
      }
      const next = groupStateFromCoreSnapshot(snapshot);
      const freshness = coreSnapshotFreshness(snapshot, Date.now());
      if (activeRef.current) {
        setState(next);
        setDataSource('local_cache');
        setSnapshotFreshness(freshness);
        setEmptyLocalSnapshot(false);
        const source: CoreSnapshotSource = snapshot.source;
        void source;
      }
      await refreshOpenOperations(id);
      return true;
    } catch {
      return false;
    }
  }, [refreshOpenOperations]);

  const load = useCallback((): Promise<boolean> => {
    if (!groupId) return Promise.resolve(false);
    if (loadInFlightRef.current) return loadInFlightRef.current;
    const run = (async () => {
      try {
        const next = await getGroupState(groupId);
        if (activeRef.current) {
          setState((previous) =>
            mergeRemoteGroupStatePreservingOwnLocation(
              previous,
              next,
              myUserIdRef.current,
              {
                preserveLocalGathering: openOperationsRef.current.some(
                  (operation) => isLeaderGatheringOperation(operation),
                ),
              },
            ),
          );
          setError(null);
          setDataSource('remote');
          setEmptyLocalSnapshot(false);
        }
        try {
          // Persist snapshot and hydrate server entity versions (OTA-04 #6).
          await hydrateCoreEntityVersions(groupId, next);
          const snap = await readCoreSnapshot(groupId);
          if (activeRef.current && snap) {
            setSnapshotFreshness(coreSnapshotFreshness(snap, Date.now()));
          }
        } catch {
          // Local cache write is best-effort; remote state still paints.
        }
        // Opportunistic outbox drain after a successful network round-trip.
        await flushCoreOperationOutbox().catch(() => undefined);
        await refreshOpenOperations(groupId);
        return true;
      } catch (cause) {
        const restored = await applyLocalSnapshot(groupId);
        if (activeRef.current) {
          if (restored) {
            // Offline / network failure with a prior snapshot: show cached data.
            setError(
              isNetworkRequestError(cause)
                ? null
                : cause instanceof Error
                  ? cause.message
                  : '無法取得群組狀態',
            );
          } else {
            setError(cause instanceof Error ? cause.message : '無法取得群組狀態');
          }
        }
        // Always false when remote pull failed — callers (force-refresh, sync)
        // must surface failure even if a local cache is still painted.
        return false;
      } finally {
        if (activeRef.current) setLoading(false);
      }
    })().finally(() => {
      loadInFlightRef.current = null;
    });
    loadInFlightRef.current = run;
    return run;
  }, [applyLocalSnapshot, groupId, refreshOpenOperations]);

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
    setLoading(true);
    setState(null);
    setDataSource('none');
    setSnapshotFreshness({ unit: 'missing' });
    setEmptyLocalSnapshot(false);
    setError(null);
    pendingPatchesRef.current.clear();

    if (!groupId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      await applyLocalSnapshot(groupId);
      if (cancelled || !activeRef.current) return;
      // If we already painted from cache, drop the full-screen loader so the
      // map can render while remote reconciliation continues.
      if (activeRef.current) {
        // loading stays true until remote attempt finishes unless we have cache;
        // applyLocalSnapshot does not clear loading — load() does.
      }
      await loadRef.current();
    })();

    return () => {
      cancelled = true;
      activeRef.current = false;
    };
  }, [applyLocalSnapshot, groupId]);

  // Realtime + poll only while the app is foregrounded (battery budget).
  useEffect(() => {
    if (!groupId || appState !== 'active') {
      return;
    }

    activeRef.current = true;

    // Soft refresh when returning from background so peer pins catch up.
    void loadRef.current();
    void flushCoreOperationOutbox().catch(() => undefined);

    const scheduleReload = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        loadRef.current();
      }, REALTIME_DEBOUNCE_MS);
    };

    const flushLocationPatches = () => {
      const buffered = Array.from(pendingPatchesRef.current.values());
      pendingPatchesRef.current.clear();
      if (buffered.length === 0) return;

      setState((prev) => {
        if (!prev) {
          void loadRef.current();
          return prev;
        }
        const next = applyMemberLocationPatches(
          prev,
          buffered,
          myUserIdRef.current,
        );
        if (next === null) {
          void loadRef.current();
          return prev;
        }
        return next;
      });
    };

    const scheduleLocationPatch = () => {
      if (locationDebounceRef.current) {
        clearTimeout(locationDebounceRef.current);
      }
      const ms = locationPolicy(highAccuracyRef.current, 'foreground')
        .realtimeLocationDebounceMs;
      locationDebounceRef.current = setTimeout(flushLocationPatches, ms);
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
            scheduleReload();
            return;
          }
          mergeLocationPatches(pendingPatchesRef.current, parsed);
          scheduleLocationPatch();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'memberships', filter },
        scheduleReload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itinerary_items', filter },
        scheduleReload,
      )
      // Leader start/stop nav writes groups.journey_status + active_destination_id.
      // Without this, followers only learn via the 5-minute poll and never show
      // the planned route polyline / multi-mode alts / Live Activity in time.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'groups', filter: groupRowFilter },
        scheduleReload,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        scheduleReload,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          realtimeReadyRef.current = true;
          // A new member can subscribe after the leader has already written
          // itinerary rows. Hydrate once after the channel is ready instead
          // of relying on an event that happened before this subscription.
          void loadRef.current();
          return;
        }
        if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          realtimeReadyRef.current = false;
        }
      });

    const timer = setInterval(() => {
      void loadRef.current();
    }, GROUP_POLL_INTERVAL_MS);

    return () => {
      realtimeReadyRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [groupId, appState]);

  return {
    state,
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
