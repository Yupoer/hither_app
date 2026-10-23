import { AppState } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { createElement, useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
import {
  ackNavigationSession,
  cancelNavigationSession,
  completeNavigationSession,
  getActiveNavigationSession,
  getMyNavigationMemberState,
  startNavigationSession,
  subscribeNavigationSession,
} from '../api/services/NavigationService';
import { requireUserId } from '../api/services/_helpers';
import type {
  MemberNavigationState,
  NavigationMemberStatus,
  NavigationSession,
} from '../types/navigation';
import type { NavigationAnnouncementResponseKind } from '../types/coreData';
import { diagnostics } from './diagnostics';
import { enqueuePersonalNavigationResponse } from './coreDataSync';
import { runNavigationTerminalMutation } from './navigationTerminalMutation';
import { getOperationErrorMessage } from '../utils/operationError';
import { getActiveLanguage } from '../i18n';

interface NavigationLaneOwner {
  revision: RefObject<number>;
  activeSessionIdRef: RefObject<string | null>;
  sessionRef: RefObject<NavigationSession | null>;
  lastEventRef: RefObject<NavigationSession | null>;
  laneRef: RefObject<{ groupId: string | null; scopeSubgroupId: string | null; actorId: string | null } | null>;
  setTerminalSession: Dispatch<SetStateAction<NavigationSession | null>>;
  setSession: Dispatch<SetStateAction<NavigationSession | null>>;
  setMemberState: Dispatch<SetStateAction<MemberNavigationState | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

interface NavigationLaneInput {
  groupId: string | null;
  scopeSubgroupId: string | null;
  actorId: string | null;
  refresh: () => Promise<NavigationSession | null>;
  acceptSession: (next: NavigationSession) => void;
}

function NavigationLaneSubscription({ owner, groupId, scopeSubgroupId, actorId, refresh, acceptSession, foreground }:
  NavigationLaneInput & { owner: NavigationLaneOwner; foreground: boolean }) {
  useMountEffect(() => {
    const previous = owner.laneRef.current;
    if (!previous || previous.groupId !== groupId || previous.scopeSubgroupId !== scopeSubgroupId || previous.actorId !== actorId) {
      owner.laneRef.current = { groupId, scopeSubgroupId, actorId };
      owner.revision.current += 1;
      owner.activeSessionIdRef.current = null;
      owner.sessionRef.current = null;
      owner.lastEventRef.current = null;
      owner.setTerminalSession(null);
      owner.setSession(null);
      owner.setMemberState(null);
      if (previous && (previous.groupId !== groupId || previous.scopeSubgroupId !== scopeSubgroupId)) owner.setError(null);
    }
    if (!foreground) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void refresh();
    if (!groupId) return;
    const timer = setInterval(() => { void refresh(); }, 30_000);
    void subscribeNavigationSession(groupId, next => {
      if (!cancelled) acceptSession(next);
    }, next => {
      if (!cancelled && next.navigationSessionId === owner.activeSessionIdRef.current) owner.setMemberState(next);
    }, scopeSubgroupId, () => { if (!cancelled) void refresh(); }).then(cleanup => {
      if (cancelled) cleanup();
      else unsubscribe = cleanup;
    }).catch(cause => {
      if (!cancelled) owner.setError(getOperationErrorMessage(cause, getActiveLanguage()));
    });
    return () => {
      cancelled = true;
      owner.revision.current += 1;
      clearInterval(timer);
      unsubscribe?.();
    };
  });
  return null;
}

function NavigationSessionRuntime(input: NavigationLaneInput & { owner: NavigationLaneOwner }) {
  const { owner } = input;
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useMountEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      owner.revision.current += 1;
      setForeground(state === 'active');
    });
    return () => { owner.revision.current += 1; sub.remove(); };
  });
  const [laneInput, setLaneInput] = useState({ ...input, foreground, generation: 0 });
  if (!Object.is(laneInput.groupId, input.groupId) || !Object.is(laneInput.scopeSubgroupId, input.scopeSubgroupId)
    || !Object.is(laneInput.actorId, input.actorId) || !Object.is(laneInput.refresh, input.refresh)
    || !Object.is(laneInput.acceptSession, input.acceptSession) || !Object.is(laneInput.foreground, foreground)) {
    setLaneInput({ ...input, foreground, generation: laneInput.generation + 1 });
  }
  return createElement(NavigationLaneSubscription, { ...input, foreground, key: laneInput.generation });
}

export function useNavigationSession(
  groupId: string | null,
  scopeSubgroupId: string | null = null,
  actorId: string | null = null,
) {
  const [terminalSession, setTerminalSession] = useState<NavigationSession | null>(null);
  const [session, setSession] = useState<NavigationSession | null>(null);
  const [memberState, setMemberState] = useState<MemberNavigationState | null>(null);
  const [loading, setLoading] = useState(Boolean(groupId));
  const [error, setError] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionRef = useRef<NavigationSession | null>(null);
  const lastEventRef = useRef<NavigationSession | null>(null);
  const eventIdentityRef = useRef<string | null>(null);

  const revision = useRef(0);
  const actorRef = useRef(actorId);
  actorRef.current = actorId;
  const groupRef = useRef(groupId);
  groupRef.current = groupId;
  const scopeRef = useRef<string | null>(scopeSubgroupId);
  scopeRef.current = scopeSubgroupId;
  const laneRef = useRef<NavigationLaneOwner['laneRef']['current']>(null);

  const acceptSession = useCallback((next: NavigationSession) => {
    if (next.groupId !== groupRef.current) return;
    if ((next.scopeSubgroupId ?? null) !== scopeRef.current) return;
    const previous = lastEventRef.current;
    if (previous?.groupId === next.groupId && (previous.id === next.id
      ? previous.status !== 'active' || previous.version > next.version
        || (previous.version === next.version && (next.memberIds === undefined
          || JSON.stringify(previous.memberIds) === JSON.stringify(next.memberIds)))
      : next.status !== 'active' || Date.parse(previous.startedAt) > Date.parse(next.startedAt))) return;
    if (previous?.id === next.id && next.memberIds === undefined && previous.memberIds !== undefined) {
      next = { ...next, memberIds: previous.memberIds };
    }
    lastEventRef.current = next;
    eventIdentityRef.current = JSON.stringify([groupRef.current, scopeRef.current, actorRef.current]);
    revision.current += 1;
    if (next.status !== 'active') {
      setTerminalSession(next);
      activeSessionIdRef.current = null;
      sessionRef.current = null;
      setSession(null);
      setMemberState(null);
      return;
    }
    setTerminalSession(null);
    activeSessionIdRef.current = next.id;
    sessionRef.current = next;
    if (previous?.id !== next.id) setMemberState(null);
    setSession(next);
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
    if (AppState.currentState !== 'active') return null;
    const requestRevision = ++revision.current;
    setLoading(true);
    try {
      const next = await getActiveNavigationSession(groupId, scopeSubgroupId);
      if (requestRevision !== revision.current || groupId !== groupRef.current || actorId !== actorRef.current) return null;
      if (!next) {
        activeSessionIdRef.current = null;
        sessionRef.current = null;
        setSession(null);
        setMemberState(null);
        setError(null);
        return null;
      }
      acceptSession(next);
      const memberRevision = revision.current;
      const member = await getMyNavigationMemberState(next.id);
      if (activeSessionIdRef.current === next.id && groupId === groupRef.current
        && scopeSubgroupId === scopeRef.current && actorId === actorRef.current
        && memberRevision === revision.current) setMemberState(member);
      setError(null);
      return next;
    } catch (cause) {
      setError(getOperationErrorMessage(cause, getActiveLanguage()));
      return null;
    } finally {
      setLoading(false);
    }
  }, [acceptSession, groupId, scopeSubgroupId, actorId]);


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
    replaceExisting = false,
  ) => {
    if (!groupId) throw new Error('缺少群組');
    const next = await startNavigationSession(
      groupId,
      destinationId,
      requestId,
      replaceExisting,
    );
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

  /**
   * OTA-04 / OTA-02: personal navigation announcement response.
   * User-scoped outbox op — never mutates team gathering phase.
   */
  const respondToAnnouncement = useCallback(async (
    response: NavigationAnnouncementResponseKind | null,
  ) => {
    if (!session || !groupId) return null;
    const userId = await requireUserId();
    await enqueuePersonalNavigationResponse({
      groupId,
      sessionId: session.id,
      userId,
      response,
    });
    return response;
  }, [groupId, session]);

  return {
    lifecycle: createElement(NavigationSessionRuntime, {
      groupId, scopeSubgroupId, actorId, refresh, acceptSession,
      owner: { revision, activeSessionIdRef, sessionRef, lastEventRef, laneRef,
        setTerminalSession, setSession, setMemberState, setError },
    }),
    terminalSession: eventIdentityRef.current === JSON.stringify([groupId, scopeSubgroupId, actorId]) ? terminalSession : null,
    session: eventIdentityRef.current === JSON.stringify([groupId, scopeSubgroupId, actorId]) ? session : null,
    memberState: eventIdentityRef.current === JSON.stringify([groupId, scopeSubgroupId, actorId]) ? memberState : null,
    loading,
    error,
    refresh,
    start,
    cancel,
    complete,
    ack,
    respondToAnnouncement,
  };
}
