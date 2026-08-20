/**
 * #223 / #233 SecureStore projection cache, refresh-before-deny, restore, launch.
 */
import {
  cacheBlobToProjection,
  clearPremiumProjectionCache,
  isPremiumCacheStale,
  needsBackgroundPremiumRefresh,
  PREMIUM_BACKGROUND_REFRESH_MS,
  premiumCacheKey,
  projectionToCacheBlob,
  readPremiumProjectionCache,
  writePremiumProjectionCache,
} from '../services/premiumProjectionCache';
import {
  ensurePersonalPremiumAccess,
  restorePremiumSubscription,
  refreshPremiumProjection,
} from '../services/premiumPurchaseFlow';
import { EMPTY_PREMIUM_PROJECTION } from '../entitlements';

const store = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    store.delete(key);
  }),
}));

const mockGetPremiumProjection = jest.fn();
const mockApplyVerifiedSubscription = jest.fn();
const mockSyncAppStoreSubscription = jest.fn();
const mockRestorePremiumPurchases = jest.fn();
const mockGetUnfinished = jest.fn();
const mockFinish = jest.fn();

jest.mock('../api/client', () => ({
  getPremiumProjection: (...args: unknown[]) => mockGetPremiumProjection(...args),
  applyVerifiedSubscription: (...args: unknown[]) => mockApplyVerifiedSubscription(...args),
  getPremiumAppAccountToken: jest.fn(),
  syncAppStoreSubscription: (...args: unknown[]) => mockSyncAppStoreSubscription(...args),
}));

jest.mock('../native/purchases', () => ({
  fetchPremiumProducts: jest.fn(),
  requestPremiumSubscription: jest.fn(),
  restorePremiumPurchases: (...args: unknown[]) => mockRestorePremiumPurchases(...args),
  finishPremiumPurchase: (...args: unknown[]) => mockFinish(...args),
  getUnfinishedPremiumPurchases: (...args: unknown[]) => mockGetUnfinished(...args),
  isVerifiedPurchase: (result: { status?: string; purchaseToken?: string; transactionId?: string }) =>
    (result?.status === 'purchased' || result?.status === 'restored')
    && !!result.purchaseToken
    && !!result.transactionId,
}));

const LIVE = {
  ...EMPTY_PREMIUM_PROJECTION,
  personalPremiumActive: true,
  status: 'active' as const,
  productId: 'premium.monthly',
  entitlementVersion: 3,
  lastSyncedAt: new Date().toISOString(),
  ok: true,
  error: null,
};

const REQUIRED = {
  ...EMPTY_PREMIUM_PROJECTION,
  personalPremiumActive: false,
  error: 'subscription_required',
  ok: false,
  teamPremiumActive: true,
};

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  mockGetPremiumProjection.mockResolvedValue(REQUIRED);
  mockApplyVerifiedSubscription.mockResolvedValue({
    ok: true,
    durable: true,
    personalPremiumActive: true,
    entitlementVersion: 1,
    status: 'active',
  });
  mockSyncAppStoreSubscription.mockResolvedValue({
    ok: true,
    durable: true,
    personalPremiumActive: true,
  });
  mockRestorePremiumPurchases.mockResolvedValue([]);
  mockGetUnfinished.mockResolvedValue([]);
  mockFinish.mockResolvedValue(undefined);
});

describe('premium projection SecureStore cache', () => {
  it('A7 logout or account switch deletes the previous userId premium cache', async () => {
    await writePremiumProjectionCache('user-a', LIVE);
    expect(store.has(premiumCacheKey('user-a'))).toBe(true);
    await clearPremiumProjectionCache('user-a');
    expect(store.has(premiumCacheKey('user-a'))).toBe(false);
    expect(premiumCacheKey('user-a')).toContain('user-a');
    expect(premiumCacheKey('user-a')).not.toBe(premiumCacheKey('user-b'));
  });

  it('A6 launch hydrates UI from cache then background-refreshes when lastSyncedAt > 6h', () => {
    const fresh = projectionToCacheBlob('user-1', LIVE, new Date().toISOString());
    expect(needsBackgroundPremiumRefresh(fresh)).toBe(false);
    const stale = projectionToCacheBlob(
      'user-1',
      {
        ...LIVE,
        lastSyncedAt: new Date(Date.now() - PREMIUM_BACKGROUND_REFRESH_MS - 1000).toISOString(),
      },
    );
    expect(needsBackgroundPremiumRefresh(stale)).toBe(true);
    expect(isPremiumCacheStale(stale)).toBe(true);
    expect(cacheBlobToProjection(fresh).personalPremiumActive).toBe(true);
  });

  it('ignores blobs that do not match the current userId', async () => {
    await writePremiumProjectionCache('user-a', LIVE);
    await expect(readPremiumProjectionCache('user-b')).resolves.toBeNull();
  });
});

describe('#223 cache / restore use cases', () => {
  it('UC1 free tap with no cache refreshes to subscription_required and does not grant', async () => {
    const result = await ensurePersonalPremiumAccess({
      userId: 'user-1',
      groupId: 'group-1',
      cacheStale: true,
      cachedLive: false,
    });
    expect(mockGetPremiumProjection).toHaveBeenCalledTimes(1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('subscription_required');
    expect(result.projection.personalPremiumActive).toBe(false);
    expect(result.projection.teamPremiumActive).toBe(true);
  });

  it('UC3 stale cache with DB still live refreshes a new projection without StoreKit', async () => {
    mockGetPremiumProjection.mockResolvedValue(LIVE);
    const result = await ensurePersonalPremiumAccess({
      userId: 'user-1',
      cacheStale: true,
      cachedLive: true,
    });
    expect(result.allowed).toBe(true);
    expect(result.projection.entitlementVersion).toBe(3);
    expect(mockRestorePremiumPurchases).not.toHaveBeenCalled();
  });

  it('UC4 other device currentEntitlements JWS plus refresh grants when token matches', async () => {
    mockGetPremiumProjection
      .mockResolvedValueOnce(REQUIRED)
      .mockResolvedValueOnce(LIVE);
    mockGetUnfinished.mockResolvedValue([
      {
        status: 'restored',
        transactionId: 'txn-other-device',
        productId: 'premium.annual',
        purchaseToken: 'jws-other',
        purchase: { id: 'txn-other-device' },
        appAccountToken: 'account-token',
      },
    ]);
    const projection = await refreshPremiumProjection({
      userId: 'user-1',
      groupId: null,
      syncStoreKitIfMissing: true,
    });
    expect(mockSyncAppStoreSubscription).toHaveBeenCalledWith({
      signedTransaction: 'jws-other',
    });
    expect(projection.personalPremiumActive).toBe(true);
  });

  it('UC5 reinstall empty Keychain login refresh returns DB grant without a new payment', async () => {
    mockGetPremiumProjection.mockResolvedValue(LIVE);
    expect(store.size).toBe(0);
    const projection = await refreshPremiumProjection({ userId: 'user-1' });
    expect(projection.personalPremiumActive).toBe(true);
    expect(mockRestorePremiumPurchases).not.toHaveBeenCalled();
    const cached = await readPremiumProjectionCache('user-1');
    expect(cached?.isPremium).toBe(true);
  });

  it('UC6 Restore Purchases uploads verified currentEntitlements or shows none found', async () => {
    mockRestorePremiumPurchases.mockResolvedValue([]);
    mockGetPremiumProjection.mockResolvedValue(REQUIRED);
    const empty = await restorePremiumSubscription('group-1', { userId: 'user-1' });
    expect(empty.projection.personalPremiumActive).toBe(false);
    expect(empty.restored).toBe(0);

    mockRestorePremiumPurchases.mockResolvedValue([
      {
        status: 'restored',
        transactionId: 'txn-restore',
        productId: 'premium.annual',
        purchaseToken: 'jws-restore',
        purchase: { id: 'txn-restore' },
        appAccountToken: 'account-token',
      },
    ]);
    mockGetPremiumProjection.mockResolvedValue(LIVE);
    const restored = await restorePremiumSubscription('group-1', { userId: 'user-1' });
    expect(mockApplyVerifiedSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'restore', signedTransaction: 'jws-restore' }),
    );
    expect(restored.projection.personalPremiumActive).toBe(true);
  });
});
