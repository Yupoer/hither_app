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
it('shows only the current actor local receipt, never another account or an acknowledged row', async () => {
  let root: any;
  await act(async () => { root = create(React.createElement(CoreSyncStatus, {
    operations: [row(), row({ id: 'private', actorId: 'other' }), row({ id: 'ack', status: 'acked' })],
    actorId: 'me', t, onResolve: jest.fn(), describeError: String,
  })); });
  expect(JSON.stringify(root.toJSON())).toContain('coreData.pendingSync');
  expect(root.root.findByType('Text').props.children).toEqual(['coreData.pendingSync', ' · ', 1]);
  await act(async () => { root.update(React.createElement(CoreSyncStatus, {
    operations: [row()], actorId: 'other', t, onResolve: jest.fn(), describeError: String,
  })); });
  expect(root.toJSON()).toBeNull();
  await act(async () => root.unmount());
});

it('offers explicit version reapply with the action title and reports resolution failure without dismissing the draft', async () => {
  const operation = row({ status: 'conflict', conflictResult: { code: 'stale_version',
    operationId: 'op', entityType: 'itinerary', entityId: 'g', occurredAt: 1, serverEntityVersion: 3, message: 'changed' } });
  const resolve = jest.fn(async () => { throw new Error('SQLite disk full'); });
  let root: any;
  await act(async () => { root = create(React.createElement(CoreSyncStatus, {
    operations: [operation], actorId: 'me', t, onResolve: resolve, describeError: () => 'storage unavailable',
  })); });
  await act(async () => root.root.findAllByType('Pressable')[0].props.onPress());
  expect(JSON.stringify(root.toJSON())).toContain('coreData.actionEdit');
  expect(JSON.stringify(root.toJSON())).toContain('Local name');
  expect(JSON.stringify(root.toJSON())).toContain('coreData.versionDifference');
  await act(async () => root.root.findAllByType('Pressable')[2].props.onPress());
  expect(resolve).toHaveBeenCalledWith(operation, 'reapply');
  expect(JSON.stringify(root.toJSON())).toContain('storage unavailable');
  expect(root.root.findAllByType('Pressable')[2].props.disabled).toBe(false);
  await act(async () => root.unmount());
});

it('does not offer blind reapply for permission or invalid-state conflicts', async () => {
  const operation = row({ status: 'conflict', conflictResult: { code: 'unauthorized',
    operationId: 'op', entityType: 'itinerary', entityId: 'g', occurredAt: 1, message: 'permission denied' } });
  const resolve = jest.fn(async () => undefined);
  let root: any;
  await act(async () => { root = create(React.createElement(CoreSyncStatus, {
    operations: [operation], actorId: 'me', t, onResolve: resolve, describeError: () => 'server access denied',
  })); });
  await act(async () => root.root.findAllByType('Pressable')[0].props.onPress());
  expect(JSON.stringify(root.toJSON())).not.toContain('coreData.reapplyLocal');
  expect(JSON.stringify(root.toJSON())).not.toContain('coreData.versionDifference');
  await act(async () => root.root.findAllByType('Pressable')[1].props.onPress());
  expect(resolve).toHaveBeenCalledWith(operation, 'discard');
  await act(async () => root.unmount());
});
