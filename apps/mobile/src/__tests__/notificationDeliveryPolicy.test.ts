import {
  buildAlignedNotificationEventId,
  buildNotificationEventId,
  eventIdFromPushData,
  markNotificationDelivered,
  resolveNotificationRecipients,
  shouldDeliverOnce,
  __resetProcessNotificationSeenForTests,
} from '../utils/notificationDeliveryPolicy';

const members = [
  { userId: 'leader1', role: 'leader' as const, subgroupId: null, solo: false },
  { userId: 'member1', role: 'follower' as const, subgroupId: null, solo: false },
  { userId: 'member2', role: 'follower' as const, subgroupId: null, solo: false },
  { userId: 'solo1', role: 'follower' as const, subgroupId: null, solo: true },
  { userId: 'subLeader', role: 'leader' as const, subgroupId: 'sg1', solo: false },
  { userId: 'subMember', role: 'follower' as const, subgroupId: 'sg1', solo: false },
];

describe('resolveNotificationRecipients', () => {
  it('start_journey → operator local confirm for sender once', () => {
    const r = resolveNotificationRecipients({
      event: 'start_journey',
      senderId: 'leader1',
      members,
      eventId: 'e1',
    });
    expect(r.deliveryKind).toBe('operator_local_confirm');
    expect(r.recipientIds).toEqual(['leader1']);
    expect(r.includesSender).toBe(true);
    expect(r.keepRealtimeFallback).toBe(true);
  });

  it('own_arrival → operator local confirm for arriving member', () => {
    const r = resolveNotificationRecipients({
      event: 'own_arrival',
      senderId: 'member1',
      members,
    });
    expect(r.deliveryKind).toBe('operator_local_confirm');
    expect(r.recipientIds).toEqual(['member1']);
  });

  it('member_arrival → leaders only, exclude sender, mute solo leaders none', () => {
    const r = resolveNotificationRecipients({
      event: 'member_arrival',
      senderId: 'member1',
      members,
    });
    expect(r.deliveryKind).toBe('leader_only');
    expect(r.recipientIds.sort()).toEqual(['leader1', 'subLeader'].sort());
    expect(r.recipientIds).not.toContain('member1');
  });

  it('quick_command excludes sender and solo; whole-group', () => {
    const r = resolveNotificationRecipients({
      event: 'quick_command',
      senderId: 'leader1',
      members,
    });
    expect(r.deliveryKind).toBe('sync_broadcast');
    expect(r.recipientIds.sort()).toEqual(
      ['member1', 'member2', 'subLeader', 'subMember'].sort(),
    );
    expect(r.recipientIds).not.toContain('solo1');
    expect(r.recipientIds).not.toContain('leader1');
  });

  it('exception stays in sender scope', () => {
    const r = resolveNotificationRecipients({
      event: 'exception',
      senderId: 'subMember',
      members,
    });
    expect(r.recipientIds.sort()).toEqual(['subLeader'].sort());
  });

  it('route_request / request_start → leaders only', () => {
    const r = resolveNotificationRecipients({
      event: 'route_request',
      senderId: 'member1',
      members,
    });
    expect(r.deliveryKind).toBe('leader_only');
    expect(r.recipientIds).toContain('leader1');
    expect(r.recipientIds).not.toContain('member1');
  });

  it('leave_group → leaders only', () => {
    const r = resolveNotificationRecipients({
      event: 'leave_group',
      senderId: 'member2',
      members,
    });
    expect(r.deliveryKind).toBe('leader_only');
  });

  it('prefsAllow false empties remote-style recipients but not operator confirm', () => {
    const remote = resolveNotificationRecipients({
      event: 'quick_command',
      senderId: 'leader1',
      members,
      prefsAllow: false,
    });
    expect(remote.recipientIds).toEqual([]);

    const local = resolveNotificationRecipients({
      event: 'start_journey',
      senderId: 'leader1',
      members,
      prefsAllow: false,
    });
    expect(local.recipientIds).toEqual(['leader1']);
  });

  it('keepRealtimeFallback is always true (do not drop for push token)', () => {
    for (const event of [
      'start_journey',
      'quick_command',
      'member_arrival',
      'route_request',
    ] as const) {
      const r = resolveNotificationRecipients({ event, senderId: 'leader1', members });
      expect(r.keepRealtimeFallback).toBe(true);
    }
  });
});

describe('shouldDeliverOnce / event identity', () => {
  it('dedupes dual-path: first channel wins across local/realtime/push', () => {
    const seen = new Set<string>();
    const id = buildNotificationEventId({
      event: 'quick_command',
      groupId: 'g1',
      entityId: 'cmd1',
      senderId: 'leader1',
    });
    expect(shouldDeliverOnce(seen, id, 'member1', 'local')).toBe(true);
    // Same identity — Realtime and push must not deliver again.
    expect(shouldDeliverOnce(seen, id, 'member1', 'realtime')).toBe(false);
    expect(shouldDeliverOnce(seen, id, 'member1', 'push')).toBe(false);
  });

  it('allows push first then blocks Realtime for the same identity', () => {
    const seen = new Set<string>();
    expect(shouldDeliverOnce(seen, 'e1', 'u1', 'push')).toBe(true);
    expect(shouldDeliverOnce(seen, 'e1', 'u1', 'realtime')).toBe(false);
  });

  it('allows different recipients and different events', () => {
    const seen = new Set<string>();
    expect(shouldDeliverOnce(seen, 'e1', 'a', 'local')).toBe(true);
    expect(shouldDeliverOnce(seen, 'e1', 'b', 'local')).toBe(true);
    expect(shouldDeliverOnce(seen, 'e2', 'a', 'local')).toBe(true);
  });
});

describe('buildAlignedNotificationEventId / push data', () => {
  it('matches request_start dual-path keys for Realtime + push fields', () => {
    const fromRealtime = buildAlignedNotificationEventId({
      category: 'follower_requests',
      groupId: 'g1',
      type: 'request_start',
      senderId: 'member1',
      entityId: 'cmd-uuid',
    });
    const fromPush = eventIdFromPushData({
      category: 'follower_requests',
      groupId: 'g1',
      type: 'request_start',
      senderId: 'member1',
      entityId: 'cmd-uuid',
      eventId: fromRealtime,
    });
    expect(fromPush).toBe(fromRealtime);
    expect(fromRealtime).toContain('route_request');
    expect(fromRealtime).toContain('cmd-uuid');
  });

  it('journey identity omits sender so client matches without leader uid', () => {
    const a = buildAlignedNotificationEventId({
      category: 'journey',
      groupId: 'g1',
      status: 'going',
      senderId: 'leader-uuid',
    });
    const b = buildAlignedNotificationEventId({
      category: 'journey',
      groupId: 'g1',
      status: 'going',
      senderId: 'other',
    });
    expect(a).toBe(b);
  });

  it('markNotificationDelivered process-wide blocks Realtime after push', () => {
    __resetProcessNotificationSeenForTests();
    const id = buildAlignedNotificationEventId({
      category: 'leader_commands',
      groupId: 'g1',
      type: 'gather',
      senderId: 'L',
      entityId: 'c1',
    });
    expect(markNotificationDelivered('u1', id, 'push')).toBe(true);
    expect(markNotificationDelivered('u1', id, 'realtime')).toBe(false);
  });
});

describe('leader role fallback for request_start (BUG-5)', () => {
  it('leader_only includes self when role is leader even with sparse members', () => {
    const r = resolveNotificationRecipients({
      event: 'route_request',
      senderId: 'member1',
      members: [
        { userId: 'leader1', role: 'leader', subgroupId: null, solo: false },
        { userId: 'member1', role: 'follower', subgroupId: null, solo: false },
      ],
      commandType: 'request_start',
    });
    expect(r.recipientIds).toContain('leader1');
    expect(r.recipientIds).not.toContain('member1');
  });

  it('leader_only is empty when self is wrongly classified as follower alone', () => {
    // Documents the BUG-5 failure mode: incomplete members with follower self.
    const r = resolveNotificationRecipients({
      event: 'route_request',
      senderId: 'member1',
      members: [
        { userId: 'leader1', role: 'follower', subgroupId: null, solo: false },
      ],
      commandType: 'request_start',
    });
    expect(r.recipientIds).not.toContain('leader1');
  });
});
