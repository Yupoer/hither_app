import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockListeners = new Set<(state: string) => void>();
const mockReconcile = jest.fn(async (_input: unknown) => ({ settled: 0 }));
const mockRead = jest.fn(async (_id: string): Promise<unknown> => null);
const mockProjection = jest.fn(async (_input: unknown): Promise<void> => undefined);
const mockRefresh = jest.fn(async (_group?: string | null) => null);
const mockSession = {
  initializing: false, user: { id: 'a' }, membership: { group: { id: 'g' } }, refreshEntitlement: mockRefresh,
};
jest.mock('react-native', () => ({ AppState: { addEventListener: (_event: string, listener: (state: string) => void) => {
  mockListeners.add(listener); return { remove: () => mockListeners.delete(listener) };
} } }));
jest.mock('../state/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../services/premiumPurchaseFlow', () => ({
  reconcileUnfinishedPremiumPurchases: (input: unknown) => mockReconcile(input),
  refreshPremiumProjection: (input: unknown) => mockProjection(input),
}));
jest.mock('../services/premiumProjectionCache', () => ({
  readPremiumProjectionCache: (id: string) => mockRead(id), needsBackgroundPremiumRefresh: () => true,
}));
import PremiumPurchaseRecovery from '../components/PremiumPurchaseRecovery';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  jest.clearAllMocks(); mockListeners.clear();
  mockSession.initializing = false; mockSession.user = { id: 'a' }; mockSession.refreshEntitlement = mockRefresh;
});

it('preserves full User and callback identity while replacing only its purchase recovery listener', async () => {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(PremiumPurchaseRecovery)); });
  expect(mockReconcile).toHaveBeenCalledTimes(1); expect(mockListeners.size).toBe(1);
  await act(async () => { tree.update(React.createElement(PremiumPurchaseRecovery)); });
  expect(mockReconcile).toHaveBeenCalledTimes(1);
  mockSession.user = { id: 'a' };
  await act(async () => { tree.update(React.createElement(PremiumPurchaseRecovery)); });
  expect(mockReconcile).toHaveBeenCalledTimes(2); expect(mockListeners.size).toBe(1);
  const stale = [...mockListeners][0];
  mockSession.refreshEntitlement = jest.fn(async () => null);
  await act(async () => { tree.update(React.createElement(PremiumPurchaseRecovery)); });
  expect(mockReconcile).toHaveBeenCalledTimes(3); expect(mockListeners.size).toBe(1);
  await act(async () => { stale('active'); });
  expect(mockReconcile).toHaveBeenCalledTimes(3);
  await act(async () => { tree.unmount(); });
  expect(mockListeners.size).toBe(0);
});

it.each(['purchase', 'cache', 'projection'])('rejects a late %s result after account replacement', async stage => {
  let complete!: () => void;
  if (stage === 'purchase') mockReconcile.mockReturnValueOnce(new Promise(done => { complete = () => done({ settled: 1 }); }));
  if (stage === 'cache') mockRead.mockReturnValueOnce(new Promise(done => { complete = () => done({ isPremium: false }); }));
  if (stage === 'projection') mockProjection.mockReturnValueOnce(new Promise<void>(done => { complete = () => done(); }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(PremiumPurchaseRecovery)); });
  mockSession.user = { id: 'b' }; mockSession.initializing = true;
  await act(async () => { tree.update(React.createElement(PremiumPurchaseRecovery)); });
  const projections = mockProjection.mock.calls.length;
  const refreshes = mockRefresh.mock.calls.length;
  await act(async () => { complete(); });
  expect(mockProjection).toHaveBeenCalledTimes(projections);
  expect(mockRefresh).toHaveBeenCalledTimes(refreshes);
  expect(mockListeners.size).toBe(0);
  await act(async () => { tree.unmount(); });
});
