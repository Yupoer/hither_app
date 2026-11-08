import React from 'react';
import { act, create } from 'react-test-renderer';
import type { PendingStartRequest } from '../api/services/NotificationService';
import { useMemberInbox } from '../screens/MapScreen/hooks/useMemberInbox';

const mockFetchRequests = jest.fn<Promise<PendingStartRequest[]>, [string, string]>();
const mockRemoveChannel = jest.fn();
jest.mock('../api/client', () => ({ fetchPendingStartRequests: (groupId: string, actorId: string) => mockFetchRequests(groupId, actorId) }));
jest.mock('../api/supabase', () => ({ supabase: {
  channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
} }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: async () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('keeps the new team inbox when a response from the previous team arrives late', async () => {
  let deliverOld!: (requests: PendingStartRequest[]) => void;
  const oldRead = new Promise<PendingStartRequest[]>(resolve => { deliverOld = resolve; });
  mockFetchRequests.mockImplementation(groupId => groupId === 'previous'
    ? oldRead : Promise.resolve([{ id: 'new', title: 'Station', senderId: 'new-peer' }]));

  let requests: PendingStartRequest[] = [];
  function Team({ groupId }: { groupId: string }) {
    const inbox = useMemberInbox(groupId, 'leader');
    requests = inbox.requests;
    return inbox.lifecycle;
  }

  let root!: ReturnType<typeof create>;
  await act(async () => { root = create(React.createElement(Team, { groupId: 'previous' })); });
  try {
    expect(mockFetchRequests).toHaveBeenCalledWith('previous', 'leader');
    await act(async () => { root.update(React.createElement(Team, { groupId: 'current' })); });
    expect(requests.map(request => request.title)).toEqual(['Station']);
    await act(async () => { deliverOld([{ id: 'old', title: 'Private trip', senderId: 'old-peer' }]); });
    expect(requests.map(request => request.title)).toEqual(['Station']);
  } finally {
    await act(async () => { root.unmount(); });
  }
  expect(mockRemoveChannel).toHaveBeenCalledTimes(2);
});
