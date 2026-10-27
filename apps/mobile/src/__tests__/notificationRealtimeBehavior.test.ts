import React from 'react';

type RealtimeCallback = (payload: { new: Record<string, unknown>; old?: Record<string, unknown> }) => void;

const mockSubscriptions: Array<{
  table: string;
  event: string;
  callback: RealtimeCallback;
}> = [];
const mockSession = {
  user: { id: 'me' },
  membership: { role: 'leader', group: { id: 'group-1' } },
};
const mockSchedule = jest.fn(async () => undefined);
const mockUnsubscribe = jest.fn();
const mockNotifications = {
  addForegroundListener: jest.fn(() => mockUnsubscribe),
  scheduleLocalNotification: mockSchedule,
};
const mockT = jest.fn((key: string, params?: Record<string, unknown>) =>
  `${key}${params ? ` ${Object.values(params).join(' ')}` : ''}`);
const mockGetPreferences = jest.fn(async () => ({
  leaderCommands: true,
  followerRequests: true,
  addGathering: true,
  journey: true,
  arrival: true,
}));
const mockSeen = new Set<string>();
const mockChannel: { on: jest.Mock; subscribe: jest.Mock } = {
  on: jest.fn(),
  subscribe: jest.fn(),
};
mockChannel.on.mockImplementation((event: string, filter: { table: string }, callback: RealtimeCallback) => {
  mockSubscriptions.push({ event, table: filter.table, callback });
  return mockChannel;
});
mockChannel.subscribe.mockImplementation(() => mockChannel);
const mockSupabase = {
  from: jest.fn((table: string) => {
    const builder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => {
        if (table === 'public_profiles') return { data: { nickname: 'Ada' }, error: null };
        if (table === 'itinerary_items') return { data: { title: 'Museum' }, error: null };
        if (table === 'memberships') {
          return {
            data: { solo: false, subgroup_id: null, role: 'leader', user_id: 'leader-1' },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    };
    return builder;
  }),
  channel: jest.fn(() => mockChannel),
  removeChannel: jest.fn(),
};

jest.mock('../api/supabase', () => ({ supabase: mockSupabase }));
jest.mock('../api/client', () => ({ getNotificationPreferences: () => mockGetPreferences() }));
jest.mock('../native', () => ({ notifications: mockNotifications }));
jest.mock('../state/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('../utils/notificationDeliveryPolicy', () => ({
  buildAlignedNotificationEventId: (input: Record<string, unknown>) =>
    [input.category, input.groupId, input.type, input.senderId, input.entityId, input.status]
      .filter(Boolean).join('|'),
  classifyCommandNotification: ({ commandType, senderRole }: {
    commandType: string;
    senderRole: string | null;
  }) => ({
    prefCategory: commandType === 'custom' && senderRole === 'leader'
      ? 'leaderCommands'
      : commandType === 'request_start'
        ? 'followerRequests'
        : 'leaderCommands',
    policyEvent: commandType === 'request_start' ? 'route_request' : 'quick_command',
    pushCategory: commandType === 'request_start' ? 'follower_requests' : 'leader_commands',
  }),
  eventIdFromPushData: () => 'push-event',
  getProcessNotificationSeen: () => mockSeen,
  isLeaderCommand: (commandType: string) => commandType === 'start_journey',
  markNotificationDelivered: jest.fn(),
  resolveNotificationRecipients: ({ members }: { members: Array<{ userId: string }> }) => ({
    recipientIds: members.map((member) => member.userId),
  }),
  shouldDeliverOnce: () => true,
}));

const { useGroupNotifications } = require('../state/useGroupNotifications') as typeof import('../state/useGroupNotifications');
const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => import('react-test-renderer').ReactTestRenderer;
};

function Probe() {
  return useGroupNotifications();
}

async function mountNotifications(): Promise<{ unmount: () => void }> {
  mockSubscriptions.length = 0;
  let root: { unmount: () => void };
  await act(async () => {
    root = create(React.createElement(Probe));
    await Promise.resolve();
  });
  return root!;
}

async function emit(table: string, payload: { new: Record<string, unknown>; old?: Record<string, unknown> }) {
  const subscription = mockSubscriptions.find((item) => item.table === table);
  if (!subscription) throw new Error(`missing realtime subscription: ${table}`);
  await act(async () => {
    subscription.callback(payload);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Realtime notification semantics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscriptions.length = 0;
    mockSeen.clear();
    mockSession.membership.role = 'leader';
    mockSession.user = { id: 'me' };
    mockSession.membership.group.id = 'group-1';
  });

  it('uses nickname/title/message semantics for commands, gathering, and arrival', async () => {
    const root = await mountNotifications();

    await emit('commands', {
      new: { id: 'command-1', sender_id: 'sender-1', type: 'custom', message: '  meet now  ' },
    });
    expect(mockSchedule).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Ada',
      body: 'meet now',
    }));

    await emit('itinerary_items', {
      new: { id: 'stop-1', created_by: 'sender-1', title: 'Museum' },
    });
    expect(mockSchedule).toHaveBeenLastCalledWith(expect.objectContaining({
      title: expect.stringContaining('Ada'),
      body: expect.stringContaining('Museum'),
    }));

    await emit('destination_arrivals', {
      new: { id: 'arrival-1', user_id: 'traveler-1', destination_id: 'stop-1', source: 'gps' },
    });
    expect(mockSchedule).toHaveBeenLastCalledWith(expect.objectContaining({
      title: expect.stringContaining('Ada'),
      body: expect.stringContaining('Museum'),
      data: expect.objectContaining({ eventId: expect.stringContaining('arrival-1') }),
    }));
    root.unmount();
  });

  it('hydrates journey destination and straggler fallback copy through Realtime', async () => {
    const root = await mountNotifications();
    await emit('group_alerts', {
      new: {
        id: 'alert-1',
        kind: 'straggler',
        member_name: 'Kai',
        distance_m: 120,
        sender_id: 'leader-1',
      },
    });
    expect(mockSchedule).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Kai',
      body: expect.stringContaining('120 m'),
    }));

    mockSession.membership.role = 'follower';
    root.unmount();
    const followerRoot = await mountNotifications();
    await emit('groups', {
      new: { journey_status: 'going', active_destination_id: 'stop-1' },
      old: { journey_status: 'paused' },
    });
    expect(mockSchedule).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'notif.journeyGoingTitle',
      body: expect.stringContaining('Ada Museum'),
      data: expect.objectContaining({ senderId: 'leader-1' }),
    }));
    followerRoot.unmount();
  });
  it('installs once per identity, refreshes role without resubscribing, and rejects stale completion', async () => {
    let root!: import('react-test-renderer').ReactTestRenderer;
    await act(async () => { root = create(React.createElement(Probe)); });
    const released = mockUnsubscribe.mock.calls.length;
    const removed = mockSupabase.removeChannel.mock.calls.length;
    expect(mockSupabase.channel).toHaveBeenCalledTimes(1);
    expect(mockNotifications.addForegroundListener).toHaveBeenCalledTimes(1);
    mockSession.user = { id: 'me' };
    mockSession.membership.role = 'follower';
    await act(async () => { root.update(React.createElement(Probe)); });
    expect(mockSupabase.channel).toHaveBeenCalledTimes(1);
    let resolve!: (prefs: Awaited<ReturnType<typeof mockGetPreferences>>) => void;
    mockGetPreferences.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await emit('commands', { new: { id: 'late', sender_id: 'other', type: 'custom', message: 'late' } });
    mockSession.user = { id: 'account-b' };
    await act(async () => { root.update(React.createElement(Probe)); });
    expect(mockUnsubscribe).toHaveBeenCalledTimes(released + 1);
    expect(mockSupabase.removeChannel).toHaveBeenCalledTimes(removed + 1);
    await act(async () => { resolve({ leaderCommands: true, followerRequests: true, addGathering: true, journey: true, arrival: true }); });
    expect(mockSchedule).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
    expect(mockUnsubscribe).toHaveBeenCalledTimes(released + 2);
  });

  it('notifies a follower of their own arrival and honors the separate arrival switch', async () => {
    mockSession.membership.role = 'follower';
    const root = await mountNotifications();
    mockGetPreferences.mockResolvedValue({ leaderCommands: true, followerRequests: true,
      addGathering: true, journey: false, arrival: true });
    await emit('destination_arrivals', { new: { id: 'own-1', user_id: 'me', destination_id: 'stop-1' } });
    expect(mockSchedule).toHaveBeenCalledWith(expect.objectContaining({ title: 'map.arriveTitle' }));
    mockSchedule.mockClear();
    await emit('destination_arrivals', { new: { id: 'peer-1', user_id: 'someone-else', destination_id: 'stop-1' } });
    expect(mockSchedule).not.toHaveBeenCalled();
    mockGetPreferences.mockResolvedValue({ leaderCommands: true, followerRequests: true,
      addGathering: true, journey: true, arrival: false });
    await emit('destination_arrivals', { new: { id: 'own-2', user_id: 'me', destination_id: 'stop-2' } });
    expect(mockSchedule).not.toHaveBeenCalled();
    root.unmount();
  });

});
