import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { getCachedMyJoinedGroups, getMyJoinedGroups, type JoinedGroupInfo } from '../api/services/GroupService';
import { classifyOperationError, type OperationErrorClassification } from '../utils/operationError';

/** Account-scoped list; a failed refresh never means that memberships vanished. */
export function useJoinedGroups(actorId: string | null, includeProfiles = true) {
  const [result, setResult] = useState<{
    actorId: string | null;
    groups: JoinedGroupInfo[];
    loading: boolean;
    error: OperationErrorClassification | null;
  }>(() => ({ actorId, groups: getCachedMyJoinedGroups(actorId) ?? [], loading: !!actorId, error: null }));
  const [attempt, setAttempt] = useState(0);
  const actorRef = useRef(actorId);
  actorRef.current = actorId;
  const flight = useRef(false);
  useEffect(() => {
    let cancelled = false;
    flight.current = !!actorId;
    setResult(previous => ({
      actorId,
      groups: previous.actorId === actorId ? previous.groups : getCachedMyJoinedGroups(actorId) ?? [],
      loading: !!actorId,
      error: previous.actorId === actorId ? previous.error : null,
    }));
    if (!actorId) return;
    const current = () => !cancelled && actorRef.current === actorId;
    void getMyJoinedGroups({ includeProfiles, expectedActorId: actorId }).then(groups => {
      if (current()) setResult({ actorId, groups, loading: false, error: null });
    }).catch(cause => {
      if (current()) setResult(previous => ({ ...previous, loading: false, error: classifyOperationError(cause) }));
    }).finally(() => { if (current()) flight.current = false; });
    return () => { cancelled = true; };
  }, [actorId, includeProfiles, attempt]);
  const retry = useCallback(() => {
    if (flight.current || !actorRef.current) return;
    flight.current = true;
    setAttempt(value => value + 1);
  }, []);
  const setGroups = useCallback((update: SetStateAction<JoinedGroupInfo[]>) => {
    setResult(previous => previous.actorId !== actorId ? previous : {
      ...previous, groups: typeof update === 'function' ? update(previous.groups) : update,
    });
  }, [actorId]);
  return {
    groups: result.actorId === actorId ? result.groups : getCachedMyJoinedGroups(actorId) ?? [],
    loading: result.actorId === actorId ? result.loading : !!actorId,
    error: result.actorId === actorId ? result.error : null,
    retry, setGroups,
  };
}
