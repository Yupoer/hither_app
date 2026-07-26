/**
 * Hook integration tests for OTA-09 MapScreen wiring of coordination requests.
 * Uses default jest (node + ts-jest) with react-test-renderer harness.
 */
import React from 'react';
import type { CoordinationRequest, CoordinationResponse } from '../types';
import { useCoordinationRequests } from '../screens/MapScreen/hooks/useCoordinationRequests';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  create: (element: React.ReactElement) => {
    update: (next: React.ReactElement) => void;
    unmount: () => void;
  };
};

const openRequest: CoordinationRequest = {
  id: 'req-1',
  groupId: 'group-1',
  createdBy: 'leader-1',
  subject: 'Move meetup?',
  subjectKind: 'itinerary',
  options: [
    { id: 'opt_a', label: 'Keep', kind: 'keep_current' },
    { id: 'opt_b', label: 'Change', kind: 'itinerary' },
  ],
  deadline: new Date(Date.now() + 3_600_000).toISOString(),
  policy: 'majority',
  defaultOutcome: 'opt_a',
  status: 'open',
  resolvedOutcome: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const responseRow: CoordinationResponse = {
  id: 'resp-1',
  requestId: 'req-1',
  userId: 'member-1',
  optionId: 'opt_b',
  respondedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const fetchCoordinationRequests = jest.fn();
const fetchCoordinationResponses = jest.fn();
const createCoordinationRequest = jest.fn();
const respondToCoordinationRequest = jest.fn();
const overrideCoordinationRequest = jest.fn();
const cancelCoordinationRequest = jest.fn();

jest.mock('../api/client', () => ({
  fetchCoordinationRequests: (groupId: string) => fetchCoordinationRequests(groupId),
  fetchCoordinationResponses: (requestId: string) => fetchCoordinationResponses(requestId),
  createCoordinationRequest: (input: unknown) => createCoordinationRequest(input),
  respondToCoordinationRequest: (requestId: string, optionId: string) =>
    respondToCoordinationRequest(requestId, optionId),
  overrideCoordinationRequest: (requestId: string, optionId: string) =>
    overrideCoordinationRequest(requestId, optionId),
  cancelCoordinationRequest: (requestId: string) => cancelCoordinationRequest(requestId),
}));

const channelOn = jest.fn(function channelOnFn(this: unknown) {
  return this;
});
const channelSubscribe = jest.fn(function channelSubscribeFn(this: unknown) {
  return this;
});
const removeChannel = jest.fn();
const channel = jest.fn((_name?: string) => ({
  on: channelOn,
  subscribe: channelSubscribe,
}));

jest.mock('../api/supabase', () => ({
  supabase: {
    channel: (name: string) => channel(name),
    removeChannel: (ch: unknown) => removeChannel(ch),
  },
}));

describe('useCoordinationRequests', () => {
  let roots: Array<{ unmount: () => void }> = [];

  beforeEach(() => {
    jest.useFakeTimers();
    roots = [];
    jest.clearAllMocks();
    fetchCoordinationRequests.mockResolvedValue([openRequest]);
    fetchCoordinationResponses.mockResolvedValue([responseRow]);
    createCoordinationRequest.mockResolvedValue({
      ...openRequest,
      id: 'req-new',
      subject: 'New subject',
    });
    respondToCoordinationRequest.mockResolvedValue(responseRow);
    overrideCoordinationRequest.mockResolvedValue({
      ...openRequest,
      status: 'resolved',
      resolvedOutcome: 'opt_a',
      resolutionSource: 'organizer_override',
    });
    cancelCoordinationRequest.mockResolvedValue({
      ...openRequest,
      status: 'cancelled',
    });
    channelOn.mockImplementation(function channelOnFn(this: unknown) {
      return this;
    });
    channelSubscribe.mockImplementation(function channelSubscribeFn(this: unknown) {
      return this;
    });
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots) root.unmount();
      roots = [];
    });
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function mountHarness(
    render: () => React.ReactElement,
  ): { unmount: () => void } {
    let root!: { unmount: () => void };
    act(() => {
      root = create(render());
    });
    roots.push(root);
    return root;
  }

  it('loads requests with response counts and myOptionId', async () => {
    let api: ReturnType<typeof useCoordinationRequests> | undefined;
    function Harness() {
      api = useCoordinationRequests({
        groupId: 'group-1',
        userId: 'member-1',
        enabled: true,
      });
      return null;
    }

    mountHarness(() => React.createElement(Harness));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchCoordinationRequests).toHaveBeenCalledWith('group-1');
    expect(fetchCoordinationResponses).toHaveBeenCalledWith('req-1');
    expect(api?.requests).toHaveLength(1);
    expect(api?.requests[0]?.responseCount).toBe(1);
    expect(api?.requests[0]?.myOptionId).toBe('opt_b');
    expect(api?.openCount).toBe(1);
  });

  it('subscribes to realtime tables and cleans up on unmount', async () => {
    function Harness() {
      useCoordinationRequests({
        groupId: 'group-1',
        userId: 'leader-1',
      });
      return null;
    }

    const root = mountHarness(() => React.createElement(Harness));
    await act(async () => {
      await Promise.resolve();
    });

    expect(channel).toHaveBeenCalled();
    expect(channelOn).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ table: 'coordination_requests' }),
      expect.any(Function),
    );
    expect(channelOn).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ table: 'coordination_responses' }),
      expect.any(Function),
    );

    await act(async () => {
      root.unmount();
    });
    roots = roots.filter((r) => r !== root);
    expect(removeChannel).toHaveBeenCalled();
  });

  it('responds and reloads', async () => {
    let api: ReturnType<typeof useCoordinationRequests> | undefined;
    function Harness() {
      api = useCoordinationRequests({
        groupId: 'group-1',
        userId: 'member-1',
      });
      return null;
    }

    mountHarness(() => React.createElement(Harness));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      const ok = await api!.respond('req-1', 'opt_a');
      expect(ok).toBe(true);
    });

    expect(respondToCoordinationRequest).toHaveBeenCalledWith('req-1', 'opt_a');
    expect(fetchCoordinationRequests.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('creates a request via service (leader path)', async () => {
    let api: ReturnType<typeof useCoordinationRequests> | undefined;
    function Harness() {
      api = useCoordinationRequests({
        groupId: 'group-1',
        userId: 'leader-1',
      });
      return null;
    }

    mountHarness(() => React.createElement(Harness));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      const created = await api!.createRequest({
        subject: 'New subject',
        subjectKind: 'itinerary',
        options: openRequest.options,
        deadline: openRequest.deadline,
        policy: 'majority',
        defaultOutcome: 'opt_a',
      });
      expect(created?.id).toBe('req-new');
    });

    expect(createCoordinationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group-1',
        subject: 'New subject',
      }),
    );
  });

  it('overrides and reloads (leader path)', async () => {
    let api: ReturnType<typeof useCoordinationRequests> | undefined;
    function Harness() {
      api = useCoordinationRequests({
        groupId: 'group-1',
        userId: 'leader-1',
      });
      return null;
    }

    mountHarness(() => React.createElement(Harness));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      const ok = await api!.override('req-1', 'opt_a');
      expect(ok).toBe(true);
    });

    expect(overrideCoordinationRequest).toHaveBeenCalledWith('req-1', 'opt_a');
  });

  it('does not load when disabled', async () => {
    function Harness() {
      useCoordinationRequests({
        groupId: 'group-1',
        userId: 'member-1',
        enabled: false,
      });
      return null;
    }

    mountHarness(() => React.createElement(Harness));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchCoordinationRequests).not.toHaveBeenCalled();
    expect(channel).not.toHaveBeenCalled();
  });
});
