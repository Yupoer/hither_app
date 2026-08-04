/**
 * OTA-09 coordination request lifecycle hook for MapScreen.
 * Fetch / create / respond / override / cancel with realtime + pull refresh.
 * Does not gate navigation start.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelCoordinationRequest,
  createCoordinationRequest,
  fetchCoordinationRequests,
  fetchCoordinationResponses,
  overrideCoordinationRequest,
  respondToCoordinationRequest,
  type CreateCoordinationRequestInput,
} from '../../../api/client';
import { supabase } from '../../../api/supabase';
import type {
  CoordinationRequest,
  CoordinationResponse,
} from '../../../types';

const RELOAD_MIN_INTERVAL_MS = 1_500;
export const OPEN_REQUEST_RECOVERY_INTERVAL_MS = 60_000;

export interface CoordinationRequestView extends CoordinationRequest {
  responses: CoordinationResponse[];
  responseCount: number;
  myOptionId: string | null;
}

export interface UseCoordinationRequestsOptions {
  groupId: string | null;
  userId: string | undefined;
  /** When false, skips network (e.g. demo groups). Default true when groupId set. */
  enabled?: boolean;
}

export interface UseCoordinationRequestsResult {
  requests: CoordinationRequestView[];
  openCount: number;
  loading: boolean;
  refreshing: boolean;
  busyRequestId: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  createRequest: (
    input: Omit<CreateCoordinationRequestInput, 'groupId'>,
  ) => Promise<CoordinationRequest | null>;
  respond: (requestId: string, optionId: string) => Promise<boolean>;
  override: (requestId: string, optionId: string) => Promise<boolean>;
  cancel: (requestId: string) => Promise<boolean>;
}

async function loadViews(groupId: string, userId: string | undefined): Promise<CoordinationRequestView[]> {
  const rows = await fetchCoordinationRequests(groupId);
  const withResponses = await Promise.all(
    rows.map(async (row) => {
      let responses: CoordinationResponse[] = [];
      try {
        responses = await fetchCoordinationResponses(row.id);
      } catch {
        responses = [];
      }
      const myOptionId =
        userId != null
          ? (responses.find((r) => r.userId === userId)?.optionId ?? null)
          : null;
      return {
        ...row,
        responses,
        responseCount: responses.length,
        myOptionId,
      };
    }),
  );
  return withResponses;
}

export function useCoordinationRequests(
  options: UseCoordinationRequestsOptions,
): UseCoordinationRequestsResult {
  const { groupId, userId, enabled = true } = options;
  const active = enabled && !!groupId;

  const [requests, setRequests] = useState<CoordinationRequestView[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef<Promise<void> | null>(null);
  const pendingRef = useRef(false);
  const lastLoadAtRef = useRef(0);
  const channelSeqRef = useRef(0);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    const gid = groupIdRef.current;
    if (!gid || !active) return;

    if (inFlightRef.current) {
      pendingRef.current = true;
      await inFlightRef.current;
      if (!pendingRef.current) return;
    }

    do {
      pendingRef.current = false;
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);

      const run = (async () => {
        try {
          const views = await loadViews(gid, userIdRef.current);
          if (groupIdRef.current !== gid) return;
          setRequests(views);
          setError(null);
          lastLoadAtRef.current = Date.now();
        } catch (err) {
          if (groupIdRef.current !== gid) return;
          setError(err instanceof Error ? err.message : 'load_failed');
        } finally {
          if (mode === 'initial') setLoading(false);
          if (mode === 'refresh') setRefreshing(false);
        }
      })();

      inFlightRef.current = run.finally(() => {
        inFlightRef.current = null;
      });
      await inFlightRef.current;
      // Subsequent loops after a concurrent request are silent reloads.
      mode = 'silent';
    } while (pendingRef.current);
  }, [active]);

  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) return;
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      if (Date.now() - lastLoadAtRef.current < RELOAD_MIN_INTERVAL_MS) return;
      void load('silent');
    }, 300);
  }, [load]);

  const refresh = useCallback(async () => {
    await load('refresh');
  }, [load]);

  const openCount = useMemo(
    () => requests.filter((request) => request.status === 'open').length,
    [requests],
  );

  useEffect(() => {
    if (!active || !groupId) {
      setRequests([]);
      setLoading(false);
      setError(null);
      return;
    }
    lastLoadAtRef.current = 0;
    void load('initial');

    const channel = supabase
      .channel(`coordination-requests:${groupId}:${++channelSeqRef.current}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'coordination_requests',
          filter: `group_id=eq.${groupId}`,
        },
        scheduleReload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'coordination_responses',
        },
        scheduleReload,
      )
      .subscribe();

    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [active, groupId, load, scheduleReload]);

  // Missed Realtime events are recovered read-only, and only while an open
  // deadline exists. With zero open requests there is no periodic read/write.
  useEffect(() => {
    if (!active || openCount === 0) return;
    const recovery = setInterval(() => {
      void load('silent');
    }, OPEN_REQUEST_RECOVERY_INTERVAL_MS);
    return () => clearInterval(recovery);
  }, [active, load, openCount]);

  const createRequest = useCallback(
    async (
      input: Omit<CreateCoordinationRequestInput, 'groupId'>,
    ): Promise<CoordinationRequest | null> => {
      const gid = groupIdRef.current;
      if (!gid) return null;
      setBusyRequestId('create');
      try {
        const created = await createCoordinationRequest({ ...input, groupId: gid });
        await load('silent');
        return created;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'create_failed');
        return null;
      } finally {
        setBusyRequestId(null);
      }
    },
    [load],
  );

  const respond = useCallback(
    async (requestId: string, optionId: string): Promise<boolean> => {
      setBusyRequestId(requestId);
      try {
        await respondToCoordinationRequest(requestId, optionId);
        await load('silent');
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'respond_failed');
        return false;
      } finally {
        setBusyRequestId(null);
      }
    },
    [load],
  );

  const override = useCallback(
    async (requestId: string, optionId: string): Promise<boolean> => {
      setBusyRequestId(requestId);
      try {
        await overrideCoordinationRequest(requestId, optionId);
        await load('silent');
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'override_failed');
        return false;
      } finally {
        setBusyRequestId(null);
      }
    },
    [load],
  );

  const cancel = useCallback(
    async (requestId: string): Promise<boolean> => {
      setBusyRequestId(requestId);
      try {
        await cancelCoordinationRequest(requestId);
        await load('silent');
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'cancel_failed');
        return false;
      } finally {
        setBusyRequestId(null);
      }
    },
    [load],
  );

  return {
    requests,
    openCount,
    loading,
    refreshing,
    busyRequestId,
    error,
    refresh,
    createRequest,
    respond,
    override,
    cancel,
  };
}
