/**
 * Unified notification delivery policy matrix.
 *
 * Transport layers (local operator feedback, Realtime fallback, APNs/FCM) only
 * deliver — they do not invent recipient rules. Server prefs remain authoritative
 * for remote delivery; operator local success is not mixed into sender-exclusion.
 */

export type NotificationEventKind =
  | 'start_journey'
  | 'own_arrival'
  | 'member_arrival'
  | 'quick_command'
  | 'exception'
  | 'coordination'
  | 'route_request'
  | 'leave_group'
  | 'straggler'
  | 'add_gathering'
  | 'meet_time';

/** Push / preference category for a commands INSERT (#170). */
export type CommandPushCategory = 'leader_commands' | 'follower_requests';

/**
 * Classify a command row into push preference category + policy event.
 *
 * - Fixed leader types → leader_commands / quick_command
 * - Fixed follower types (need_*) → follower_requests / quick_command (whole-group)
 * - request_start → follower_requests / route_request (leaders only)
 * - custom → role of sender; missing/unknown role must NOT drift to leader
 *   (would mis-route follower custom under leaderCommands prefs).
 */
export function classifyCommandNotification(input: {
  commandType: string;
  /** Explicit membership role of sender; null/undefined when lookup failed. */
  senderRole?: 'leader' | 'follower' | null;
  /** Whether `commandType` is in the leader fixed set (caller supplies isLeaderCommand). */
  isLeaderFixedType?: boolean;
}): {
  pushCategory: CommandPushCategory;
  prefCategory: 'leaderCommands' | 'followerRequests';
  policyEvent: NotificationEventKind;
} {
  const type = input.commandType;
  if (type === 'request_start') {
    return {
      pushCategory: 'follower_requests',
      prefCategory: 'followerRequests',
      policyEvent: 'route_request',
    };
  }
  if (type === 'custom') {
    const isLeader = input.senderRole === 'leader';
    return {
      pushCategory: isLeader ? 'leader_commands' : 'follower_requests',
      prefCategory: isLeader ? 'leaderCommands' : 'followerRequests',
      policyEvent: 'quick_command',
    };
  }
  const leaderFixed =
    input.isLeaderFixedType
    ?? [
      'gather', 'find_gathering', 'depart', 'rest', 'be_careful',
      'go_left', 'go_right', 'stop', 'hurry_up',
    ].includes(type);
  if (leaderFixed) {
    return {
      pushCategory: 'leader_commands',
      prefCategory: 'leaderCommands',
      policyEvent: 'quick_command',
    };
  }
  // Follower fixed (need_restroom, need_break, need_help, found_something, …)
  return {
    pushCategory: 'follower_requests',
    prefCategory: 'followerRequests',
    policyEvent: 'quick_command',
  };
}

export type DeliveryKind =
  /** Sender's own device after a successful local op (once). */
  | 'operator_local_confirm'
  /** Other members in scope (exclude sender; solo silent). */
  | 'sync_broadcast'
  /** Effective leaders of the group only. */
  | 'leader_only'
  /** Meet-time style: include sender in scope. */
  | 'scope_including_sender';

export type MembershipRole = 'leader' | 'follower';

export interface PolicyMember {
  userId: string;
  role: MembershipRole;
  /** null = main team */
  subgroupId: string | null;
  solo: boolean;
}

export interface NotificationPolicyInput {
  event: NotificationEventKind;
  senderId: string;
  members: PolicyMember[];
  /**
   * Optional command subtype for route_request vs generic follower request.
   * When event is route_request, only leaders receive.
   */
  commandType?: string | null;
  /** Stable identity for dual-path (Realtime + push) dedup. */
  eventId?: string | null;
  /** Server-authoritative pref: false → empty recipients for remote; local confirm still allowed. */
  prefsAllow?: boolean;
}

export interface NotificationPolicyResult {
  deliveryKind: DeliveryKind;
  recipientIds: string[];
  /** True when sender is intentionally included (operator confirm / meet). */
  includesSender: boolean;
  /** Event identity for dual-path dedup (null when not provided). */
  eventIdentity: string | null;
  /** Whether Realtime local fallback should still fire when a push token exists. */
  keepRealtimeFallback: boolean;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function leaders(members: PolicyMember[]): PolicyMember[] {
  return members.filter((m) => m.role === 'leader');
}

function senderOf(members: PolicyMember[], senderId: string): PolicyMember | undefined {
  return members.find((m) => m.userId === senderId);
}

function inSenderScope(member: PolicyMember, sender: PolicyMember | undefined): boolean {
  if (!sender) return true;
  return member.subgroupId === sender.subgroupId;
}

/**
 * Resolve unique recipients + delivery kind for one notification event.
 * Pure — no I/O.
 */
export function resolveNotificationRecipients(
  input: NotificationPolicyInput,
): NotificationPolicyResult {
  const eventIdentity = input.eventId ?? null;
  const keepRealtimeFallback = true;
  const prefsAllow = input.prefsAllow !== false;
  const sender = senderOf(input.members, input.senderId);

  // Operator local confirms always allow sender once; not gated by broadcast prefs
  // the same way as peer alerts (server prefs still filter remote fan-out).
  if (input.event === 'start_journey' || input.event === 'own_arrival') {
    return {
      deliveryKind: 'operator_local_confirm',
      recipientIds: unique([input.senderId]),
      includesSender: true,
      eventIdentity,
      keepRealtimeFallback,
    };
  }

  if (input.event === 'member_arrival') {
    // Leaders of the group once; exclude the arriving member.
    const ids = leaders(input.members)
      .filter((m) => m.userId !== input.senderId)
      .filter((m) => !m.solo)
      .map((m) => m.userId);
    return {
      deliveryKind: 'leader_only',
      recipientIds: prefsAllow ? unique(ids) : [],
      includesSender: false,
      eventIdentity,
      keepRealtimeFallback,
    };
  }

  if (input.event === 'route_request' || input.commandType === 'request_start') {
    const ids = leaders(input.members)
      .filter((m) => m.userId !== input.senderId)
      .map((m) => m.userId);
    return {
      deliveryKind: 'leader_only',
      recipientIds: prefsAllow ? unique(ids) : [],
      includesSender: false,
      eventIdentity,
      keepRealtimeFallback,
    };
  }

  if (input.event === 'leave_group') {
    const ids = leaders(input.members)
      .filter((m) => m.userId !== input.senderId)
      .map((m) => m.userId);
    return {
      deliveryKind: 'leader_only',
      recipientIds: prefsAllow ? unique(ids) : [],
      includesSender: false,
      eventIdentity,
      keepRealtimeFallback,
    };
  }

  if (input.event === 'meet_time') {
    const ids = input.members.map((m) => m.userId);
    return {
      deliveryKind: 'scope_including_sender',
      recipientIds: prefsAllow ? unique(ids) : [],
      includesSender: true,
      eventIdentity,
      keepRealtimeFallback,
    };
  }

  if (input.event === 'straggler') {
    // Include detector; mute solo recipients.
    const ids = input.members
      .filter((m) => inSenderScope(m, sender))
      .filter((m) => !m.solo || m.userId === input.senderId)
      .map((m) => m.userId);
    return {
      deliveryKind: 'scope_including_sender',
      recipientIds: prefsAllow ? unique(ids) : [],
      includesSender: true,
      eventIdentity,
      keepRealtimeFallback,
    };
  }

  // Sync broadcasts: quick commands, exceptions, coordination, add gathering.
  // Quick commands are whole-group on server (not subgroup-muted); others use scope.
  const wholeGroup =
    input.event === 'quick_command';
  const ids = input.members
    .filter((m) => m.userId !== input.senderId)
    .filter((m) => !m.solo)
    .filter((m) => (wholeGroup ? true : inSenderScope(m, sender)))
    .map((m) => m.userId);

  return {
    deliveryKind: 'sync_broadcast',
    recipientIds: prefsAllow ? unique(ids) : [],
    includesSender: false,
    eventIdentity,
    keepRealtimeFallback,
  };
}

/**
 * Dual-path dedup: same event identity notifies a recipient **once** per process,
 * regardless of channel (local / Realtime / push). First channel wins.
 *
 * Does **not** drop the Realtime subscription merely because a push token exists —
 * callers keep listening; this set only suppresses duplicate presentation.
 * Channel is accepted for diagnostics/call-site clarity but does not split keys.
 */
export function shouldDeliverOnce(
  seen: Set<string>,
  eventIdentity: string | null | undefined,
  recipientId: string,
  _channel: 'local' | 'realtime' | 'push' = 'local',
): boolean {
  if (!eventIdentity) return true;
  const key = `${eventIdentity}|${recipientId}`;
  if (seen.has(key)) return false;
  seen.add(key);
  // Bound memory for long sessions (FIFO-ish: drop oldest inserted key).
  if (seen.size > 400) {
    const first = seen.values().next().value;
    if (first != null) seen.delete(first);
  }
  return true;
}

/**
 * Process-wide dual-path seen set shared by Realtime local presentation and
 * any FG push presentation path so they suppress true duplicates.
 */
const processSeenEventDeliveries = new Set<string>();

export function getProcessNotificationSeen(): Set<string> {
  return processSeenEventDeliveries;
}

/** Test-only reset. */
export function __resetProcessNotificationSeenForTests(): void {
  processSeenEventDeliveries.clear();
}

/** Build a stable event identity from known fields. */
export function buildNotificationEventId(parts: {
  event: NotificationEventKind | string;
  groupId: string;
  entityId?: string | null;
  senderId?: string | null;
  version?: string | number | null;
}): string {
  return [
    parts.event,
    parts.groupId,
    parts.entityId ?? '',
    parts.senderId ?? '',
    parts.version != null ? String(parts.version) : '',
  ].join(':');
}

/**
 * Map server push category (+ optional type) to the event key used in dual-path
 * identities. Keep in lockstep with send-push `eventIdFromPayload`.
 */
export function mapPushCategoryToEventKey(
  category: string,
  type?: string | null,
): string {
  if (type === 'request_start') return 'route_request';
  switch (category) {
    case 'leader_commands':
    case 'follower_requests':
    case 'leaderCommands':
    case 'followerRequests':
    case 'quick_command':
      return 'quick_command';
    case 'add_gathering':
    case 'addGathering':
      return 'add_gathering';
    case 'journey':
    case 'exception':
      return 'journey';
    case 'arrival':
    case 'member_arrival':
      return 'member_arrival';
    case 'straggler':
      return 'straggler';
    case 'route_request':
      return 'route_request';
    case 'start_journey':
      return 'start_journey';
    case 'own_arrival':
      return 'own_arrival';
    default:
      return category;
  }
}

/**
 * Dual-path identity shared by Realtime local + APNs/FCM data payloads.
 * Algorithm must match send-push `eventIdFromPayload` (Deno copy).
 *
 * Journey omits sender so client Realtime (no leader uid) matches server.
 */
export function buildAlignedNotificationEventId(fields: {
  category: string;
  groupId: string;
  type?: string | null;
  senderId?: string | null;
  /** Command / itinerary / alert row id when available. */
  entityId?: string | null;
  destinationId?: string | null;
  memberId?: string | null;
  requestId?: string | null;
  status?: string | null;
  title?: string | null;
  version?: string | number | null;
}): string {
  const event = mapPushCategoryToEventKey(fields.category, fields.type);
  const entity =
    fields.entityId
    ?? fields.requestId
    ?? fields.destinationId
    ?? fields.memberId
    ?? (fields.type && fields.senderId
      ? `${fields.type}:${fields.senderId}`
      : null)
    ?? fields.status
    ?? fields.title
    ?? '';
  const isJourney = event === 'journey';
  return buildNotificationEventId({
    event,
    groupId: fields.groupId,
    entityId: isJourney ? (fields.status ?? entity) : entity,
    senderId: isJourney ? '' : (fields.senderId ?? ''),
    version: isJourney
      ? String(fields.status ?? fields.version ?? '')
      : (fields.version != null ? String(fields.version) : ''),
  });
}

/**
 * Resolve event identity from push notification `data` (server alertData keys).
 * Prefers server-provided `eventId` when present.
 */
export function eventIdFromPushData(
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (!data) return null;
  if (typeof data.eventId === 'string' && data.eventId.length > 0) {
    return data.eventId;
  }
  const groupId =
    (typeof data.groupId === 'string' && data.groupId)
    || (typeof data.group_id === 'string' && data.group_id)
    || null;
  const category =
    (typeof data.category === 'string' && data.category) || null;
  if (!groupId || !category) return null;
  return buildAlignedNotificationEventId({
    category,
    groupId,
    type: typeof data.type === 'string' ? data.type : null,
    senderId:
      (typeof data.senderId === 'string' && data.senderId)
      || (typeof data.sender_id === 'string' && data.sender_id)
      || null,
    entityId:
      (typeof data.entityId === 'string' && data.entityId)
      || (typeof data.entity_id === 'string' && data.entity_id)
      || null,
    destinationId:
      (typeof data.destinationId === 'string' && data.destinationId)
      || (typeof data.destination_id === 'string' && data.destination_id)
      || null,
    memberId:
      (typeof data.memberId === 'string' && data.memberId)
      || (typeof data.member_id === 'string' && data.member_id)
      || null,
    requestId:
      (typeof data.requestId === 'string' && data.requestId)
      || (typeof data.request_id === 'string' && data.request_id)
      || null,
    status: typeof data.status === 'string' ? data.status : null,
    title: typeof data.title === 'string' ? data.title : null,
    version:
      data.version != null && (typeof data.version === 'string' || typeof data.version === 'number')
        ? data.version
        : null,
  });
}

/**
 * Mark a push (or local) delivery in the process-wide seen set so the other
 * path can suppress. Safe to call when identity is unknown (no-op).
 */
export function markNotificationDelivered(
  recipientId: string | null | undefined,
  eventIdentity: string | null | undefined,
  channel: 'local' | 'realtime' | 'push' = 'push',
): boolean {
  if (!recipientId || !eventIdentity) return false;
  return shouldDeliverOnce(
    getProcessNotificationSeen(),
    eventIdentity,
    recipientId,
    channel,
  );
}
