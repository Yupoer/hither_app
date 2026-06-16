import { useCallback, useEffect, useRef, useState } from 'react';
import { getGroupState } from '../api/client';
import type { GroupState } from '../types';

/** How often the Map screen refreshes group state, per the MVP requirement. */
export const GROUP_POLL_INTERVAL_MS = 5000;

interface UseGroupStateResult {
  state: GroupState | null;
  /** True only during the very first load (before any data arrives). */
  loading: boolean;
  error: string | null;
  /** Force an immediate refresh (e.g. pull-to-refresh, recenter). */
  refresh: () => void;
}

/**
 * Subscribe to a group's live state, polling `getGroupState` every
 * GROUP_POLL_INTERVAL_MS. Keeps the latest snapshot in local state.
 *
 * Why a hook + setInterval instead of React Query: the MVP only needs one
 * polled resource and no caching/invalidation across screens, so a focused
 * hook avoids an extra dependency. The fetch is isolated in api/client, so
 * moving to React Query (or websockets) later is a drop-in change.
 */
export function useGroupState(groupId: string | null): UseGroupStateResult {
  const [state, setState] = useState<GroupState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // Guards against setState after unmount and out-of-order responses.
  const activeRef = useRef(true);

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
    const timer = setInterval(load, GROUP_POLL_INTERVAL_MS);

    return () => {
      activeRef.current = false;
      clearInterval(timer);
    };
  }, [groupId, load]);

  return { state, loading, error, refresh: load };
}
