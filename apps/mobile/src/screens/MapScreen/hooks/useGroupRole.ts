import { useCallback, useEffect, useRef, useState } from 'react';
import { isDemoGroup } from '../../../api/demo';
import type { Membership } from '../../../state/SessionContext';
import type { GroupStateDataSource } from '../../../state/useGroupState';
import type { Group, MemberLocation, MemberRole, Subgroup } from '../../../types';
import type { CoreOperation } from '../../../types/coreData';
import { classifyOperationError } from '../../../utils/operationError';

export interface GroupRoleInput {
  groupId: string | null;
  userId: string | undefined;
  me: Pick<MemberLocation, 'role' | 'subgroupId'> | undefined;
  membership: Membership | null;
  subgroups: readonly Pick<Subgroup, 'id' | 'leaderId'>[];
  /** The server rejected a leader-only write in this user+group context. */
  leaderRevoked: boolean;
}

export interface GroupRole {
  /** Group-state membership row first; the session row only covers the gap before it loads. */
  role: MemberRole | null;
  isLeader: boolean;
  isMySubgroupLeader: boolean;
  /** Main leader or leader of my current subgroup, unless the server revoked it. */
  canEditItinerary: boolean;
}

export function deriveGroupRole(input: GroupRoleInput): GroupRole {
  const demo = isDemoGroup(input.groupId);
  const role = input.me
    ? input.me.role
    : input.membership?.group.id === input.groupId ? input.membership.role : null;
  // The demo flock has no membership row; the tester drives it as leader.
  const isLeader = demo || (!input.leaderRevoked && role === 'leader');
  const myScopeId = input.me?.subgroupId;
  const isMySubgroupLeader = Boolean(myScopeId && (demo
    || input.subgroups.some((subgroup) => subgroup.id === myScopeId && subgroup.leaderId === input.userId)));
  return {
    role,
    isLeader,
    isMySubgroupLeader,
    canEditItinerary: !input.leaderRevoked && (isLeader || isMySubgroupLeader),
  };
}

function isLeaderRoleRejection(operation: CoreOperation): boolean {
  return operation.status === 'conflict'
    && classifyOperationError(operation.conflictResult).kind === 'leader_role_rejected';
}

export interface UseGroupRoleInput {
  groupId: string | null;
  userId: string | undefined;
  me: Pick<MemberLocation, 'role' | 'subgroupId'> | undefined;
  membership: Membership | null;
  setMembership: (membership: Membership) => void;
  group: Group | null;
  subgroups: readonly Pick<Subgroup, 'id' | 'leaderId'>[];
  dataSource: GroupStateDataSource;
  openOperations: readonly CoreOperation[];
  arrivalOperations: readonly CoreOperation[];
  refresh: () => Promise<unknown>;
}

/**
 * Single owner of the viewer's role. A server rejection of a leader-only write
 * revokes editing locally until a remote load confirms the membership again,
 * and remote loads write the confirmed role back to the persisted session.
 */
export function useGroupRole(input: UseGroupRoleInput): GroupRole & {
  /** `${userId}:${groupId}` — revocation never leaks across accounts or groups. */
  roleContext: string;
  markLeaderRevoked: () => void;
} {
  const { groupId, userId, me, membership, setMembership, group, dataSource, openOperations,
    arrivalOperations, refresh } = input;
  const roleContext = `${userId ?? ''}:${groupId ?? ''}`;
  const [revokedContext, setRevokedContext] = useState<string | null>(null);
  const role = deriveGroupRole({
    groupId,
    userId,
    me,
    membership,
    subgroups: input.subgroups,
    leaderRevoked: revokedContext === roleContext,
  });

  useEffect(() => {
    if (dataSource !== 'remote' || !me || !group || membership?.group.id !== groupId) return;
    if (membership.role !== me.role) setMembership({ group, role: me.role });
    setRevokedContext(null);
  }, [dataSource, me, group, groupId, membership?.role, membership?.group.id, setMembership]);

  const handledRejections = useRef(new Set<string>());
  useEffect(() => {
    let rejected = false;
    for (const operation of openOperations) {
      if (operation.operationType === 'record_arrival' || operation.operationType === 'leader_correct_arrival'
        || handledRejections.current.has(operation.id) || operation.status !== 'conflict') continue;
      handledRejections.current.add(operation.id);
      if (isLeaderRoleRejection(operation)) rejected = true;
    }
    if (!rejected) return;
    setRevokedContext(roleContext);
    void refresh().catch(() => undefined);
  }, [openOperations, roleContext, refresh]);

  useEffect(() => {
    if (arrivalOperations.some((operation) => operation.payload.actorId === userId
      && isLeaderRoleRejection(operation))) setRevokedContext(roleContext);
  }, [arrivalOperations, userId, roleContext]);

  const markLeaderRevoked = useCallback(() => setRevokedContext(roleContext), [roleContext]);
  return { ...role, roleContext, markLeaderRevoked };
}
