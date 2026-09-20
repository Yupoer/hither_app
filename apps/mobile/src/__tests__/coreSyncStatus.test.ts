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

it('shows a non-blocking conflict receipt without manual resolution controls', async () => {
  const operation = row({ status: 'conflict', conflictResult: { code: 'stale_version',
    operationId: 'op', entityType: 'itinerary', entityId: 'g', occurredAt: 1, serverEntityVersion: 3, message: 'changed' } });
  const resolve = jest.fn(async () => { throw new Error('should not be called'); });
  let root: any;
  await act(async () => { root = create(React.createElement(CoreSyncStatus, {
    operations: [operation], actorId: 'me', t, onResolve: resolve, describeError: () => 'storage unavailable',
  })); });
  await act(async () => root.root.findAllByType('Pressable')[0].props.onPress());
  expect(JSON.stringify(root.toJSON())).toContain('coreData.actionEdit');
  expect(JSON.stringify(root.toJSON())).toContain('Local name');
  expect(JSON.stringify(root.toJSON())).toContain('coreData.versionDifference');
  expect(root.root.findAllByType('Pressable')).toHaveLength(1);
  expect(JSON.stringify(root.toJSON())).not.toContain('coreData.pendingSync');
  expect(resolve).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it('keeps permission conflicts non-blocking and never offers blind reapply', async () => {
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
  expect(root.root.findAllByType('Pressable')).toHaveLength(1);
  expect(resolve).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
