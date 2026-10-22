import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockListeners = new Set<(state: string) => void>();
const mockRemove = jest.fn();
const mockApp = {
  currentState: 'active',
  addEventListener: jest.fn((_event: string, callback: (state: string) => void) => {
    mockListeners.add(callback);
    return { remove: () => { mockRemove(); mockListeners.delete(callback); } };
  }),
};
jest.mock('react-native', () => ({ AppState: mockApp }));
import { useForegroundReconcile } from '../state/useForegroundReconcile';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function RepairProbe({ reload, enabled = true, intervalMs = 30_000 }: {
  reload: () => unknown; enabled?: boolean; intervalMs?: number;
}) { return useForegroundReconcile(enabled, reload, intervalMs); }

let root: ReactTestRenderer;
let diagnostics: jest.SpyInstance;
beforeEach(() => { diagnostics = jest.spyOn(console, 'error'); jest.useFakeTimers(); jest.clearAllMocks(); mockListeners.clear(); mockApp.currentState = 'active'; });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  const errors = diagnostics.mock.calls.map(call => call.join(' ')).join('\n');
  diagnostics.mockRestore();
  jest.useRealTimers();
  expect(errors).not.toContain('same key');
});

test('commits the latest callback without restarting the existing repair deadline', async () => {
  const first = jest.fn(); const second = jest.fn();
  await act(async () => { root = create(React.createElement(RepairProbe, { reload: first })); });
  expect(mockListeners.size).toBe(1);
  await act(async () => { jest.advanceTimersByTime(20_000); });
  await act(async () => { root.update(React.createElement(RepairProbe, { reload: second })); });
  expect(mockApp.addEventListener).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(10_000); });
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledTimes(1);
  await act(async () => { root.update(React.createElement(RepairProbe, { reload: second })); });
  expect(mockApp.addEventListener).toHaveBeenCalledTimes(1);
  await act(async () => { root.update(React.createElement(RepairProbe, { reload: first })); });
  await act(async () => { for (const listener of mockListeners) listener('active'); });
  expect(first).toHaveBeenCalledTimes(1);
});

test('replaces only enabled or interval repair jobs and releases both native listener and timer', async () => {
  const reload = jest.fn();
  await act(async () => { root = create(React.createElement(RepairProbe, { reload })); });
  await act(async () => { root.update(React.createElement(RepairProbe, { reload, intervalMs: 1000 })); });
  expect(mockRemove).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(reload).toHaveBeenCalledTimes(1);
  mockApp.currentState = 'background';
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(reload).toHaveBeenCalledTimes(1);
  await act(async () => { root.update(React.createElement(RepairProbe, { reload, enabled: false })); });
  expect(mockListeners.size).toBe(0);
  mockApp.currentState = 'active';
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(reload).toHaveBeenCalledTimes(1);
  await act(async () => { root.update(React.createElement(RepairProbe, { reload })); });
  expect(mockListeners.size).toBe(1);
  await act(async () => root.unmount());
  expect(mockListeners.size).toBe(0);
});

test('Strict replay retains one repair subscription and suppresses rejected callbacks', async () => {
  const reload = jest.fn(async () => { throw new Error('offline'); });
  await act(async () => { root = create(React.createElement(React.StrictMode, null,
    React.createElement(RepairProbe, { reload })));
  });
  expect(mockListeners.size).toBe(1);
  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(reload).toHaveBeenCalledTimes(1);
});
