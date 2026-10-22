import React from 'react';
import { act, create } from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';
import { StorePane, type StorePaneProps } from '../screens/MapScreen/components/StorePane';
import type { StoreSnapshot } from '../store/types';

const mockAppListeners = new Set<(state: string) => void>();
const mockNetListeners = new Set<(online: boolean) => void>();
const mockGetSnapshot = jest.fn();
const mockCreateSession = jest.fn(async () => ({ ok: true, sessionRef: 'reward-1' }));
const mockLoad = jest.fn(async () => 'no_fill');
const mockDispose = jest.fn();
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', Platform: { OS: 'ios' },
  StyleSheet: { create: (s: unknown) => s }, Alert: { alert: jest.fn() },
  findNodeHandle: () => 7, AccessibilityInfo: { setAccessibilityFocus: jest.fn() },
  AppState: { addEventListener: (_: string, listener: (state: string) => void) => {
    mockAppListeners.add(listener); return { remove: () => mockAppListeners.delete(listener) };
  } },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) },
}));
jest.mock('../components/WaveLoading', () => 'WaveLoading');
jest.mock('../components/PremiumBanner', () => 'PremiumBanner');
jest.mock('../a11y/useFontScaleBucket', () => ({ useFontLayout: () => ({ scale: 1, boldText: false }) }));
jest.mock('../api/services/StoreService', () => ({
  getStoreSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
  createRewardSession: () => mockCreateSession(), updateRewardSessionStatus: jest.fn(async () => {}), redeemStoreProduct: jest.fn(),
}));
jest.mock('../api/services/_helpers', () => ({ requireUserId: async () => 'u1', isNetworkRequestError: () => false }));
jest.mock('../native/rewardedAds', () => ({
  ensureRewardedAdsReady: async () => ({ available: true }),
  createRewardedAdController: () => ({ load: mockLoad, dispose: mockDispose }),
}));
jest.mock('../store/connectivity', () => ({
  getConnectivitySnapshot: async () => ({ online: true }), getNavigatorOnline: () => true,
  isDefinitelyOffline: (online: boolean) => online === false, probeReachability: async () => true,
  subscribeConnectivity: (listener: (online: boolean) => void) => { mockNetListeners.add(listener); return () => mockNetListeners.delete(listener); },
}));
jest.mock('../state/diagnostics', () => ({
  diagnostics: { write: async () => {} }, logStoreAdStep: async () => {}, tailId: (s: string) => s, truncateDiagText: (s: string) => s,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const props: StorePaneProps = { groupId: 'g1', groupName: 'Group', isAnonymous: false, personalPremiumActive: false,
  accent: '#fff', t: (key, params) => params ? `${key}:${params.count ?? ''}` : key };
const snapshot = (groupId: string, balance: number): StoreSnapshot => ({
  ok: true, anonymous: false, registrationRequired: false, balance, catalog: [], canCreateRewardSession: true,
  canRedeem: true, groupId, groupName: 'Group', isMember: true, memberCount: 1, tripPremium: null,
  extraPointCredits: 0, liveActivityPersonal: false, liveActivityEffective: false, activeRewardSession: null,
});
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockGetSnapshot.mockResolvedValue(snapshot('g1', 10)); });
afterEach(() => { jest.useRealTimers(); });

it('retains the pane while replacing group connections and dropping old snapshot responses', async () => {
  const resolve = new Map<string, (value: StoreSnapshot) => void>();
  mockGetSnapshot.mockImplementation(group => new Promise(done => resolve.set(group, done)));
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(StorePane, props)); });
  const pane = tree.root.findByProps({ testID: 'store-pane' });
  expect(mockAppListeners.size).toBe(1); expect(mockNetListeners.size).toBe(1);
  await act(async () => tree.update(React.createElement(StorePane, { ...props, groupId: 'g2' })));
  expect(tree.root.findByProps({ testID: 'store-pane' })).toBe(pane);
  expect(mockAppListeners.size).toBe(1); expect(mockNetListeners.size).toBe(1);
  await act(async () => resolve.get('g2')!(snapshot('g2', 20)));
  expect(JSON.stringify(tree.toJSON())).toContain('store.balanceA11y:20');
  await act(async () => resolve.get('g1')!(snapshot('g1', 99)));
  expect(JSON.stringify(tree.toJSON())).toContain('store.balanceA11y:20');
  expect(JSON.stringify(tree.toJSON())).not.toContain('store.balanceA11y:99');
  await act(async () => tree.unmount());
  expect(mockAppListeners.size).toBe(0); expect(mockNetListeners.size).toBe(0);
});

it('replaces the deep-link focus timer on callback identity and cancels it on unmount', async () => {
  const timers = jest.spyOn(globalThis, 'setTimeout');
  const clearTimer = jest.spyOn(globalThis, 'clearTimeout');
  const consumed = jest.fn();
  const product = { code: 'p1', displayName: 'Product', scope: 'team', priceTokens: 1, effectJson: {}, sortOrder: 0, active: true };
  mockGetSnapshot.mockResolvedValue({ ...snapshot('g1', 10), catalog: [product] });
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(StorePane, { ...props, highlightProductCode: 'p1', onHighlightConsumed: consumed }), { createNodeMock: () => ({}) }); });
  expect(consumed).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(200));
  const nextConsumed = jest.fn();
  await act(async () => tree.update(React.createElement(StorePane, { ...props, highlightProductCode: 'p1', onHighlightConsumed: nextConsumed })));
  expect(nextConsumed).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(100));
  expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(180));
  expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(React.createElement(StorePane, { ...props, highlightProductCode: 'p1', onHighlightConsumed: consumed })));
  await act(async () => tree.unmount());
  await act(async () => jest.advanceTimersByTime(300));
  expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledTimes(1);
  timers.mock.calls.forEach((args, index) => {
    if (args[1] === 280) expect(clearTimer).toHaveBeenCalledWith(timers.mock.results[index].value);
  });
  timers.mockRestore(); clearTimer.mockRestore();
});

it('preserves no-fill probe timing, cancels offline work and cleans the active ad controller', async () => {
  const intervals = jest.spyOn(globalThis, 'setInterval');
  const clearTimer = jest.spyOn(globalThis, 'clearInterval');
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(StorePane, props)); });
  await act(async () => tree.root.findByProps({ testID: 'store-ad-cta' }).props.onPress());
  expect(mockCreateSession).toHaveBeenCalledTimes(1);
  expect(mockDispose).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(11_999));
  expect(mockCreateSession).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(1));
  expect(mockCreateSession).toHaveBeenCalledTimes(2);
  await act(async () => { for (const listener of mockNetListeners) listener(false); });
  await act(async () => jest.advanceTimersByTime(70_000));
  expect(mockCreateSession).toHaveBeenCalledTimes(2);
  await act(async () => { for (const listener of mockNetListeners) listener(true); });
  mockLoad.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => tree.root.findByProps({ testID: 'store-ad-cta' }).props.onPress());
  const disposed = mockDispose.mock.calls.length;
  await act(async () => tree.unmount());
  expect(mockDispose).toHaveBeenCalledTimes(disposed + 1);
  expect(intervals.mock.calls.length).toBeGreaterThan(0);
  intervals.mock.results.forEach(result => expect(clearTimer).toHaveBeenCalledWith(result.value));
  const created = mockCreateSession.mock.calls.length;
  await act(async () => jest.advanceTimersByTime(70_000));
  expect(mockCreateSession).toHaveBeenCalledTimes(created);
  intervals.mockRestore(); clearTimer.mockRestore();
});
