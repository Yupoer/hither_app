import { createElement, Fragment, useCallback, useRef, useState } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
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
  lifecycle: import('react').ReactElement;
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

  const remoteMembershipPublicationLifecycle = createElement(RemoteMembershipPublication, { dataSource, me, group, membership, groupId, setMembership, setRevokedContext });

  const handledRejections = useRef(new Set<string>());
  const itineraryRoleRejectionLifecycle = createElement(ItineraryRoleRejection, { openOperations, handledRejections, setRevokedContext, roleContext, refresh });

  const arrivalRoleRejectionLifecycle = createElement(ArrivalRoleRejection, { arrivalOperations, userId, setRevokedContext, roleContext });

  const markLeaderRevoked = useCallback(() => setRevokedContext(roleContext), [roleContext]);
  return { ...role, roleContext, markLeaderRevoked, lifecycle: createElement(Fragment, { key: 'group-role-runtime' }, remoteMembershipPublicationLifecycle, itineraryRoleRejectionLifecycle, arrivalRoleRejectionLifecycle) };
}

function RemoteMembershipPublication({ dataSource, me, group, membership, groupId, setMembership, setRevokedContext }: {
  dataSource: GroupStateDataSource;
  me: Pick<MemberLocation, "role" | "subgroupId"> | undefined;
  group: Group | null;
  membership: Membership | null;
  groupId: string | null;
  setMembership: (membership: Membership) => void;
  setRevokedContext: import("react").Dispatch<import("react").SetStateAction<string | null>>;
}) {
  const [remoteMembershipPublicationInputs, setRemoteMembershipPublicationInputs] = useState(() => ({ generation: 0, dataSource, me, group, groupId, membership_role: membership?.role, membership_group_id: membership?.group.id, setMembership }));
  if (!(Object.is(remoteMembershipPublicationInputs.dataSource, dataSource) && Object.is(remoteMembershipPublicationInputs.me, me) && Object.is(remoteMembershipPublicationInputs.group, group) && Object.is(remoteMembershipPublicationInputs.groupId, groupId) && Object.is(remoteMembershipPublicationInputs.membership_role, membership?.role) && Object.is(remoteMembershipPublicationInputs.membership_group_id, membership?.group.id) && Object.is(remoteMembershipPublicationInputs.setMembership, setMembership))) {
    setRemoteMembershipPublicationInputs({ generation: remoteMembershipPublicationInputs.generation + 1, dataSource, me, group, groupId, membership_role: membership?.role, membership_group_id: membership?.group.id, setMembership });
  }
  return createElement(RemoteMembershipPublicationCommit, { key: remoteMembershipPublicationInputs.generation, dataSource, me, group, membership, groupId, setMembership, setRevokedContext });
}

function RemoteMembershipPublicationCommit({ dataSource, me, group, membership, groupId, setMembership, setRevokedContext }: {
  dataSource: GroupStateDataSource;
  me: Pick<MemberLocation, "role" | "subgroupId"> | undefined;
  group: Group | null;
  membership: Membership | null;
  groupId: string | null;
  setMembership: (membership: Membership) => void;
  setRevokedContext: import("react").Dispatch<import("react").SetStateAction<string | null>>;
}) {
  useMountEffect(() => {
    if (dataSource !== 'remote' || !me || !group || membership?.group.id !== groupId) return;
    if (membership.role !== me.role) setMembership({ group, role: me.role });
    setRevokedContext(null);
  });
  return null;
}

function ItineraryRoleRejection({ openOperations, handledRejections, setRevokedContext, roleContext, refresh }: {
  openOperations: readonly CoreOperation[];
  handledRejections: import("react").RefObject<Set<string>>;
  setRevokedContext: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  roleContext: string;
  refresh: () => Promise<unknown>;
}) {
  const [itineraryRoleRejectionInputs, setItineraryRoleRejectionInputs] = useState(() => ({ generation: 0, openOperations, roleContext, refresh }));
  if (!(Object.is(itineraryRoleRejectionInputs.openOperations, openOperations) && Object.is(itineraryRoleRejectionInputs.roleContext, roleContext) && Object.is(itineraryRoleRejectionInputs.refresh, refresh))) {
    setItineraryRoleRejectionInputs({ generation: itineraryRoleRejectionInputs.generation + 1, openOperations, roleContext, refresh });
  }
  return createElement(ItineraryRoleRejectionCommit, { key: itineraryRoleRejectionInputs.generation, openOperations, handledRejections, setRevokedContext, roleContext, refresh });
}

function ItineraryRoleRejectionCommit({ openOperations, handledRejections, setRevokedContext, roleContext, refresh }: {
  openOperations: readonly CoreOperation[];
  handledRejections: import("react").RefObject<Set<string>>;
  setRevokedContext: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  roleContext: string;
  refresh: () => Promise<unknown>;
}) {
  useMountEffect(() => {
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
  });
  return null;
}

function ArrivalRoleRejection({ arrivalOperations, userId, setRevokedContext, roleContext }: {
  arrivalOperations: readonly CoreOperation[];
  userId: string | undefined;
  setRevokedContext: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  roleContext: string;
}) {
  const [arrivalRoleRejectionInputs, setArrivalRoleRejectionInputs] = useState(() => ({ generation: 0, arrivalOperations, userId, roleContext }));
  if (!(Object.is(arrivalRoleRejectionInputs.arrivalOperations, arrivalOperations) && Object.is(arrivalRoleRejectionInputs.userId, userId) && Object.is(arrivalRoleRejectionInputs.roleContext, roleContext))) {
    setArrivalRoleRejectionInputs({ generation: arrivalRoleRejectionInputs.generation + 1, arrivalOperations, userId, roleContext });
  }
  return createElement(ArrivalRoleRejectionCommit, { key: arrivalRoleRejectionInputs.generation, arrivalOperations, userId, setRevokedContext, roleContext });
}

function ArrivalRoleRejectionCommit({ arrivalOperations, userId, setRevokedContext, roleContext }: {
  arrivalOperations: readonly CoreOperation[];
  userId: string | undefined;
  setRevokedContext: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  roleContext: string;
}) {
  useMountEffect(() => {
    if (arrivalOperations.some((operation) => operation.payload.actorId === userId
      && isLeaderRoleRejection(operation))) setRevokedContext(roleContext);
  });
  return null;
}
