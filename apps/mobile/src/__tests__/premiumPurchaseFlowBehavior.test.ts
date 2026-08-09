/**
 * #156 Step 5 — coordinator integration (mocked native IAP + server API).
 * Covers product-load single-flight/cache, purchase branches, restore + projection.
 * Device StoreKit / Play Billing remains Unverified separately.
 */

process.env.EXPO_PUBLIC_PREMIUM_MONTHLY_PRODUCT_ID = 'premium.monthly';
process.env.EXPO_PUBLIC_PREMIUM_ANNUAL_PRODUCT_ID = 'premium.annual';
process.env.EXPO_PUBLIC_PREMIUM_SUBSCRIPTION_GROUP_ID = 'hither-premium';

const mockFetchPremiumProducts = jest.fn();
const mockRequestPremiumSubscription = jest.fn();
const mockRestorePremiumPurchases = jest.fn();
const mockFinishPremiumPurchase = jest.fn();
const mockApplyVerifiedSubscription = jest.fn();
const mockGetPremiumAppAccountToken = jest.fn();
const mockGetPremiumProjection = jest.fn();

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('../native/purchases', () => ({
  fetchPremiumProducts: (...args: unknown[]) => mockFetchPremiumProducts(...args),
  requestPremiumSubscription: (...args: unknown[]) => mockRequestPremiumSubscription(...args),
  restorePremiumPurchases: (...args: unknown[]) => mockRestorePremiumPurchases(...args),
  finishPremiumPurchase: (...args: unknown[]) => mockFinishPremiumPurchase(...args),
  getUnfinishedPremiumPurchases: jest.fn().mockResolvedValue([]),
  isVerifiedPurchase: (result: { status?: string }) =>
    result?.status === 'purchased' || result?.status === 'restored',
}));

jest.mock('../api/client', () => ({
  applyVerifiedSubscription: (...args: unknown[]) => mockApplyVerifiedSubscription(...args),
  getPremiumAppAccountToken: (...args: unknown[]) => mockGetPremiumAppAccountToken(...args),
  getPremiumProjection: (...args: unknown[]) => mockGetPremiumProjection(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const flow = require('../services/premiumPurchaseFlow') as typeof import('../services/premiumPurchaseFlow');

const SAMPLE_PRODUCTS = [
  {
    id: 'premium.monthly',
    type: 'subs' as const,
    displayName: 'Monthly',
    displayPrice: 'NT$60',
    description: 'Premium monthly',
    currency: 'TWD',
  },
  {
    id: 'premium.annual',
    type: 'subs' as const,
    displayName: 'Annual',
    displayPrice: 'NT$480',
    description: 'Premium annual',
    currency: 'TWD',
  },
];

const EMPTY_PROJECTION = {
  personalPremiumActive: false,
  teamPremiumActive: false,
  status: 'none' as const,
  productId: null,
  expiresAt: null,
  sourceVersion: null,
};

describe('#156 behavioral: premiumPurchaseFlow coordinator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchPremiumProducts.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(SAMPLE_PRODUCTS), 5);
        }),
    );
    mockGetPremiumAppAccountToken.mockResolvedValue('account-token');
    mockApplyVerifiedSubscription.mockResolvedValue({
      ok: true,
      projection: { ...EMPTY_PROJECTION, personalPremiumActive: true, status: 'active' },
    });
    mockFinishPremiumPurchase.mockResolvedValue(undefined);
    mockGetPremiumProjection.mockResolvedValue({
      ...EMPTY_PROJECTION,
      personalPremiumActive: true,
      status: 'active',
    });
  });

  it('coalesces concurrent Store+Paywall product loads into one native fetch and caches', async () => {
    // Clear TTL cache by advancing past it via isolated re-require would drop
    // in-flight state; within one suite we only assert first-load single-flight
    // plus immediate cache hit.
    const firstWave = await Promise.all([
      flow.loadPremiumStoreProducts(),
      flow.loadPremiumStoreProducts(),
    ]);
    expect(mockFetchPremiumProducts).toHaveBeenCalledTimes(1);
    expect(firstWave[0]).toEqual(SAMPLE_PRODUCTS);
    expect(firstWave[1]).toEqual(SAMPLE_PRODUCTS);

    const cached = await flow.loadPremiumStoreProducts();
    expect(mockFetchPremiumProducts).toHaveBeenCalledTimes(1);
    expect(cached).toEqual(SAMPLE_PRODUCTS);
  });

  it('purchase success verifies on server then finishes native transaction', async () => {
    mockRequestPremiumSubscription.mockResolvedValue({
      status: 'purchased',
      transactionId: 'txn-1',
      productId: 'premium.monthly',
      purchaseToken: 'jws-token',
      purchase: { id: 'txn-1' },
      appAccountToken: 'account-token',
    });
    const result = await flow.purchasePremiumSubscription('monthly');
    expect(result.ok).toBe(true);
    expect(mockGetPremiumAppAccountToken).toHaveBeenCalled();
    expect(mockRequestPremiumSubscription).toHaveBeenCalledWith(
      'premium.monthly',
      'account-token',
    );
    expect(mockApplyVerifiedSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        signedTransaction: 'jws-token',
        transactionId: 'txn-1',
        productId: 'premium.monthly',
        source: 'purchase',
      }),
    );
    expect(mockFinishPremiumPurchase).toHaveBeenCalled();
  });

  it('purchase cancelled does not apply or finish', async () => {
    mockRequestPremiumSubscription.mockResolvedValue({ status: 'cancelled' });
    const result = await flow.purchasePremiumSubscription('monthly');
    expect(result).toEqual(expect.objectContaining({ ok: false, error: 'cancelled' }));
    expect(mockApplyVerifiedSubscription).not.toHaveBeenCalled();
    expect(mockFinishPremiumPurchase).not.toHaveBeenCalled();
  });

  it('purchase native failure does not apply or finish', async () => {
    mockRequestPremiumSubscription.mockResolvedValue({
      status: 'failed',
      reason: 'store_error',
    });
    const result = await flow.purchasePremiumSubscription('annual');
    expect(result.ok).toBe(false);
    expect(mockApplyVerifiedSubscription).not.toHaveBeenCalled();
    expect(mockFinishPremiumPurchase).not.toHaveBeenCalled();
  });

  it('restore settles native purchases and returns server projection', async () => {
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
    const restored = await flow.restorePremiumSubscription('group-1');
    expect(restored.ok).toBe(true);
    expect(restored.restored).toBe(1);
    expect(mockApplyVerifiedSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'restore', transactionId: 'txn-restore' }),
    );
    expect(mockGetPremiumProjection).toHaveBeenCalledWith('group-1');
    expect(restored.projection.personalPremiumActive).toBe(true);
  });

  it('leaves transaction unfinished when server verification fails', async () => {
    mockRequestPremiumSubscription.mockResolvedValue({
      status: 'purchased',
      transactionId: 'txn-fail',
      productId: 'premium.monthly',
      purchaseToken: 'jws-fail',
      purchase: { id: 'txn-fail' },
      appAccountToken: 'account-token',
    });
    mockApplyVerifiedSubscription.mockResolvedValueOnce({
      ok: false,
      error: 'verification_failed',
    });
    const result = await flow.purchasePremiumSubscription('monthly');
    expect(result.ok).toBe(false);
    expect(mockFinishPremiumPurchase).not.toHaveBeenCalled();
  });
});
