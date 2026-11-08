import type { PendingStartRequest } from '../../api/services/NotificationService';
import type { GatherPointRequest } from '../../types';
import type { OrganizerExceptionItem } from '../../utils/organizerExceptions';
import type { CoordinationRequestView } from './hooks/useCoordinationRequests';

export type MemberInboxEntry =
  | { kind: 'start'; request: PendingStartRequest }
  | { kind: 'destination'; request: GatherPointRequest }
  | { kind: 'notice'; item: OrganizerExceptionItem }
  | { kind: 'coordination'; request: CoordinationRequestView };

export function inboxNoticeId(entry: MemberInboxEntry): string | null {
  if (entry.kind === 'notice') {
    return entry.item.type === 'needs_help'
      ? `help:${entry.item.memberId}:${entry.item.lastSeenAt}`
      : `exception:${entry.item.id}`;
  }
  if (entry.kind === 'coordination' && entry.request.status !== 'open') {
    return `coordination:${entry.request.id}:${entry.request.status}`;
  }
  return null;
}

export function projectMemberInbox({
  startRequests, destinationRequests, notices, coordination, memberIds, userId, isLeader, seen,
}: {
  startRequests: readonly PendingStartRequest[];
  destinationRequests: readonly GatherPointRequest[];
  notices: readonly OrganizerExceptionItem[];
  coordination: readonly CoordinationRequestView[];
  memberIds: ReadonlySet<string>;
  userId: string | undefined;
  isLeader: boolean;
  seen: Readonly<Record<string, true>>;
}) {
  const byMember = new Map<string, { entries: MemberInboxEntry[]; count: number }>();
  let total = 0;
  function add(actorId: string, entry: MemberInboxEntry, pending: boolean) {
    if (!memberIds.has(actorId)) return;
    const noticeId = inboxNoticeId(entry);
    const unread = pending || (noticeId !== null && !seen[noticeId]) ? 1 : 0;
    const actor = byMember.get(actorId) ?? { entries: [], count: 0 };
    actor.entries.push(entry);
    actor.count += unread;
    byMember.set(actorId, actor);
    total += unread;
  }
  for (const request of startRequests) add(request.senderId, { kind: 'start', request }, true);
  for (const request of destinationRequests) {
    if (request.requesterId !== userId) add(request.requesterId, { kind: 'destination', request }, true);
  }
  for (const item of notices) add(item.memberId, { kind: 'notice', item }, false);
  for (const request of coordination) {
    add(request.createdBy, { kind: 'coordination', request },
      request.status === 'open' && (isLeader || request.myOptionId === null));
  }
  return { byMember, total };
}
