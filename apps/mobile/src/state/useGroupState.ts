import { useCallback, useEffect, useRef, useState } from 'react';
import { getGroupState } from '../api/client';
import { supabase } from '../api/supabase';
import type { GroupState } from '../types';

/**
 * Fallback polling interval. Realtime (below) is the primary update mechanism;
 * this slow poll is a safety net for missed events / dropped websocket.
 */
export const GROUP_POLL_INTERVAL_MS = 5 * 60_000;

/** Coalesce bursts of realtime events into a single refetch. */
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
 * Primary path: a Supabase Realtime channel listening to postgres_changes on
 * `member_locations`, `memberships`, and `itinerary_items` (scoped to this
 * group). Any change triggers a debounced refetch of the aggregated state.
 *
 * Fallback path: a slow interval poll, in case a websocket event is missed.
 *
 * The fetch is isolated in api/client, so the snake_case→camelCase mapping and
 * aggregation stay in one place.
 */
export function useGroupState(groupId: string | null): UseGroupStateResult {
  const [state, setState] = useState<GroupState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // Guards against setState after unmount and out-of-order responses.
  const activeRef = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable per-instance suffix so two hooks on the same group don't collide on
  // one shared (already-subscribed) realtime channel.


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

    if (!groupId) {
      setLoading(false);
      return;
    }

    loadRef.current();

    // Debounced refetch shared by every realtime event for this group.
    const scheduleReload = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        loadRef.current();
      }, REALTIME_DEBOUNCE_MS);
    };

    const filter = `group_id=eq.${groupId}`;
    const subId = ++channelSeq;
    const channel = supabase
      .channel(`group:${groupId}:${subId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_locations', filter },
        scheduleReload,
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

    // Nickname / avatar edits live in `profiles` (no group_id column — RLS
    // already scopes visibility to co-members). Kept on its OWN channel so a
    // backend without the profiles_avatar migration (table not yet in the
    // realtime publication) only degrades this binding, not the group channel
    // above; the fallback poll still picks profile edits up.
    const profilesChannel = supabase
      .channel(`profiles:${groupId}:${subId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        scheduleReload,
      )
      .subscribe();

    // Fallback poll in case a realtime event is dropped.
    const timer = setInterval(() => loadRef.current(), GROUP_POLL_INTERVAL_MS);

    return () => {
      activeRef.current = false;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      clearInterval(timer);
      supabase.removeChannel(channel);
      supabase.removeChannel(profilesChannel);
    };
  }, [groupId]);

  return { state, loading, error, refresh: load };
}
