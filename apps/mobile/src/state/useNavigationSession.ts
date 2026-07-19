import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ackNavigationSession,
  cancelNavigationSession,
  completeNavigationSession,
  getActiveNavigationSession,
  getMyNavigationMemberState,
  startNavigationSession,
  subscribeNavigationSession,
} from '../api/services/NavigationService';
import type {
  MemberNavigationState,
  NavigationMemberStatus,
  NavigationSession,
} from '../types/navigation';
import { diagnostics } from './diagnostics';
import { runNavigationTerminalMutation } from './navigationTerminalMutation';

export function useNavigationSession(groupId: string | null) {
  const [session, setSession] = useState<NavigationSession | null>(null);
  const [memberState, setMemberState] = useState<MemberNavigationState | null>(null);
  const [loading, setLoading] = useState(Boolean(groupId));
  const [error, setError] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionRef = useRef<NavigationSession | null>(null);

  const acceptSession = useCallback((next: NavigationSession) => {
    if (next.status !== 'active') {
      activeSessionIdRef.current = null;
      sessionRef.current = null;
      setSession(null);
      setMemberState(null);
      return;
    }
    setSession((previous) => {
      if (
        previous?.id === next.id &&
        previous.version >= next.version
      ) {
        return previous;
      }
      activeSessionIdRef.current = next.id;
      sessionRef.current = next;
      if (previous?.id !== next.id) setMemberState(null);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!groupId) {
      activeSessionIdRef.current = null;
      sessionRef.current = null;
      setSession(null);
      setMemberState(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    try {
      const next = await getActiveNavigationSession(groupId);
      if (!next) {
        activeSessionIdRef.current = null;
        sessionRef.current = null;
        setSession(null);
        setMemberState(null);
        setError(null);
        return null;
      }
      acceptSession(next);
      setMemberState(await getMyNavigationMemberState(next.id));
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '無法取得導航狀態');
      return null;
    } finally {
      setLoading(false);
    }
  }, [acceptSession, groupId]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void refresh();
    if (!groupId) return;

    void subscribeNavigationSession(
      groupId,
      (next) => {
        if (!cancelled) acceptSession(next);
      },
      (next) => {
        if (!cancelled && next.navigationSessionId === activeSessionIdRef.current) {
          setMemberState(next);
        }
      },
    ).then((cleanup) => {
      if (cancelled) cleanup();
      else unsubscribe = cleanup;
    }).catch((cause) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : '無法訂閱導航狀態');
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [acceptSession, groupId, refresh]);

  const reconcileTerminalConflict = useCallback(async (
    action: 'cancel' | 'complete',
    current: NavigationSession,
  ) => {
    await diagnostics.write({
      event: 'navigation_terminal_conflict',
      source: action,
      navigationSessionId: current.id,
      expectedVersion: current.version,
      updateId: Updates.updateId ?? 'embedded',
      runtimeVersion: String(Updates.runtimeVersion ?? 'unknown'),
      appVersion: Constants.expoConfig?.version ?? 'development',
    }).catch(() => undefined);
    await refresh();
  }, [refresh]);

  const start = useCallback(async (
    destinationId: string,
    requestId: string,
  ) => {
    if (!groupId) throw new Error('缺少群組');
    const next = await startNavigationSession(groupId, destinationId, requestId);
    acceptSession(next);
    return next;
  }, [acceptSession, groupId]);

  const cancel = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return null;
    const next = await runNavigationTerminalMutation(
      'cancel',
      current.id,
      current.version,
      () => cancelNavigationSession(current.id, current.version),
      () => reconcileTerminalConflict('cancel', current),
    );
    if (!next) return null;
    acceptSession(next);
    return next;
  }, [acceptSession, reconcileTerminalConflict]);

  const complete = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return null;
    const next = await runNavigationTerminalMutation(
      'complete',
      current.id,
      current.version,
      () => completeNavigationSession(current.id, current.version),
      () => reconcileTerminalConflict('complete', current),
    );
    if (!next) return null;
    acceptSession(next);
    return next;
  }, [acceptSession, reconcileTerminalConflict]);

  const ack = useCallback(async (
    status: NavigationMemberStatus,
    detail: Record<string, unknown> = {},
  ) => {
    if (!session) return null;
    const next = await ackNavigationSession(session.id, status, detail);
    setMemberState(next);
    return next;
  }, [session]);

  return {
    session,
    memberState,
    loading,
    error,
    refresh,
    start,
    cancel,
    complete,
    ack,
  };
}
