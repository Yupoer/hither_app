import { useCallback, useEffect, useRef, useState } from 'react';
import { getGroupState } from '../api/client';
import { supabase } from '../api/supabase';
import type { GroupState } from '../types';

/**
 * Fallback polling interval. Realtime (below) is the primary update mechanism;
 * this slow poll is a safety net for missed events / dropped websocket.
 */
export const GROUP_POLL_INTERVAL_MS = 15000;

/** Coalesce bursts of realtime events into a single refetch. */
const REALTIME_DEBOUNCE_MS = 300;

interface UseGroupStateResult {
  state: GroupState | null;
  /** True only during the very first load (before any data arrives). */
  loading: boolean;
  error: string | null;
  /** Force an immediate refresh (e.g. pull-to-refresh, recenter). */
  refresh: () => void;
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

  const load = useCallback(async () => {
    if (!groupId) {
      return;
    }
    try {
      const next = await getGroupState(groupId);
      if (activeRef.current) {
        setState(next);
        setError(null);
      }
    } catch (e) {
      if (activeRef.current) {
        setError(e instanceof Error ? e.message : '無法取得群組狀態');
      }
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, [groupId]);

  useEffect(() => {
    activeRef.current = true;
    setLoading(true);
    setState(null);

    if (!groupId) {
      setLoading(false);
      return;
    }

    load();

    // Debounced refetch shared by every realtime event for this group.
    const scheduleReload = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(load, REALTIME_DEBOUNCE_MS);
    };

    const filter = `group_id=eq.${groupId}`;
    const channel = supabase
      .channel(`group:${groupId}`)
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

    // Fallback poll in case a realtime event is dropped.
    const timer = setInterval(load, GROUP_POLL_INTERVAL_MS);

    return () => {
      activeRef.current = false;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [groupId, load]);

  return { state, loading, error, refresh: load };
}
