jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (value: unknown) => value },
}));
import React from 'react';
import CoreSyncStatus from '../components/CoreSyncStatus';
import type { CoreOperation } from '../types/coreData';
const { create, act } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const row = (overrides: Partial<CoreOperation> = {}): CoreOperation => ({
  id: 'op', actorId: 'me', groupId: 'g', entityType: 'itinerary', entityId: 'g',
  entityVersion: 1, operationType: 'edit_destination', payload: { patch: { title: 'Local name' } },
  status: 'pending', attempts: 0, nextAttemptAt: 0, conflictResult: null, createdAt: 0, updatedAt: 0, ...overrides,
});
const t = (key: string) => key;
import { clearAppNotices, subscribeAppNotices } from '../state/appNotice';
beforeEach(clearAppNotices);
it('keeps pending operations silent and never presents another actor failures', async () => {
  const notices = jest.fn(); const unsubscribe = subscribeAppNotices(notices);
  let root: any;
  await act(async () => { root = create(React.createElement(CoreSyncStatus, {
    operations: [row(), row({ actorId: 'other', status: 'failed' })],
    actorId: 'me', t, onResolve: jest.fn(), describeError: String,
  })); });
  expect(root.toJSON()).toBeNull();
  expect(notices.mock.calls.filter(([notice]) => notice !== null)).toHaveLength(0);
  await act(async () => root.unmount()); unsubscribe();
});
it('deduplicates retry failures and shows a distinct terminal rejection notice', async () => {
  const notices = jest.fn(); const unsubscribe = subscribeAppNotices(notices);
  let root: any;
  const props = { actorId: 'me', t, onResolve: jest.fn(), describeError: () => 'rejected' };
  await act(async () => { root = create(React.createElement(CoreSyncStatus, {
    ...props, operations: [row({ status: 'failed', lastError: 'offline' })],
  })); });
  await act(async () => root.update(React.createElement(CoreSyncStatus, {
    ...props, operations: [row({ status: 'failed', attempts: 4 })],
  })));
  expect(notices.mock.calls.filter(([notice]) => notice !== null)).toHaveLength(1);
  expect(notices.mock.calls.at(-1)[0].title).toBe('notice.syncDelayed');
  expect(root.toJSON()).toBeNull();
  await act(async () => root.unmount()); unsubscribe();
});
