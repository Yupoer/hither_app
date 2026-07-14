import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getGroupState } from '../api/client';
import { supabase } from '../api/supabase';
import type { GroupState } from '../types';
import {
  applyMemberLocationPatches,
  locationPatchFromRealtimePayload,
  mergeLocationPatches,
  type MemberLocationPatch,
} from '../utils/groupStatePatches';
import { isOwnLocationChange, locationPolicy } from '../utils/locationPolicy';

/**
 * Fallback polling interval. Realtime is primary; this is a safety net only.
 * Kept long because full getGroupState is multi-query and expensive.
 */
export const GROUP_POLL_INTERVAL_MS = 5 * 60_000;

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

interface UseGroupStateResult {
  state: GroupState | null;
  /** True only during the very first load (before any data arrives). */
  loading: boolean;
  error: string | null;
  /** Force an immediate refresh (e.g. pull-to-refresh, recenter). */
  refresh: () => Promise<boolean>;
}

/**
 * Subscribe to a group's live state.
 *
 * Primary path: Realtime on member_locations / memberships / itinerary_items.
 * Peer location events are **patched in-memory** from the payload (no network).
 * Membership / itinerary / profile changes still debounced full-refetch.
 *
 * Own-device location upserts are ignored: local GPS owns self on the map.
 *
 * Fallback: slow interval poll only while AppState is active.
 */
export function useGroupState(
  groupId: string | null,
  options: UseGroupStateOptions = {},
): UseGroupStateResult {
  const { myUserId = null, highAccuracy = false } = options;
  const [state, setState] = useState<GroupState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchesRef = useRef(new Map<string, MemberLocationPatch>());
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;
  const highAccuracyRef = useRef(highAccuracy);
  highAccuracyRef.current = highAccuracy;

  const load = useCallback(async (): Promise<boolean> => {
    if (!groupId) {
      return false;
    }
    try {
      const next = await getGroupState(groupId);
      if (activeRef.current) {
        setState(next);
        setError(null);
      }
      return true;
    } catch (e) {
      if (activeRef.current) {
        setError(e instanceof Error ? e.message : '無法取得群組狀態');
      }
      return false;
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, [groupId]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    activeRef.current = true;
    setLoading(true);
    setState(null);
    pendingPatchesRef.current.clear();

    if (!groupId) {
      setLoading(false);
      return;
    }

    loadRef.current();

    const scheduleReload = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        loadRef.current();
      }, REALTIME_DEBOUNCE_MS);
    };

    /** Flush buffered peer location patches into local state (zero HTTP). */
    const flushLocationPatches = () => {
      const buffered = Array.from(pendingPatchesRef.current.values());
      pendingPatchesRef.current.clear();
      if (buffered.length === 0) return;

      setState((prev) => {
        if (!prev) {
          // No state yet — fall back to full load once.
          void loadRef.current();
          return prev;
        }
        const next = applyMemberLocationPatches(
          prev,
          buffered,
          myUserIdRef.current,
        );
        if (next === null) {
          // Unknown member id — need full membership snapshot.
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
      const ms = locationPolicy(highAccuracyRef.current).realtimeLocationDebounceMs;
      locationDebounceRef.current = setTimeout(flushLocationPatches, ms);
    };

    const filter = `group_id=eq.${groupId}`;
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
      .subscribe();

    const profilesChannel = supabase
      .channel(`profiles:${groupId}:${subId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        scheduleReload,
      )
      .subscribe();

    // Fallback poll only while foregrounded — avoid burning radio in background.
    let timer: ReturnType<typeof setInterval> | null = null;
    const armPoll = (appState: AppStateStatus) => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (appState === 'active') {
        timer = setInterval(() => loadRef.current(), GROUP_POLL_INTERVAL_MS);
      }
    };
    armPoll(AppState.currentState);
    const appSub = AppState.addEventListener('change', armPoll);

    return () => {
      activeRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
      if (timer) clearInterval(timer);
      appSub.remove();
      supabase.removeChannel(channel);
      supabase.removeChannel(profilesChannel);
    };
  }, [groupId]);

  return { state, loading, error, refresh: load };
}
