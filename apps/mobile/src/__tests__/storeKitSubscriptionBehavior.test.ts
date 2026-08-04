type TestAdapter = typeof import('../native/purchases');

const ENV_KEYS = [
  'EXPO_PUBLIC_PREMIUM_MONTHLY_PRODUCT_ID',
  'EXPO_PUBLIC_PREMIUM_ANNUAL_PRODUCT_ID',
  'EXPO_PUBLIC_PREMIUM_SUBSCRIPTION_GROUP_ID',
] as const;
const previousEnv = new Map<string, string | undefined>();

function product(id: string, groupId?: string) {
  return {
    id,
    type: 'subs' as const,
    displayName: id,
    displayPrice: 'NT$60',
    description: 'Premium',
    currency: 'TWD',
    introductoryPriceIOS: 'Free for 7 days',
    subscriptionGroupIdIOS: groupId ?? null,
  };
}

function loadAdapter({
  platform,
  groupId = 'hither-premium',
  productGroupId,
  eligibility,
}: {
  platform: 'ios' | 'android' | 'web';
  groupId?: string;
  productGroupId?: string | null;
  eligibility: jest.Mock;
}): { adapter: TestAdapter; fetchProducts: jest.Mock } {
  jest.resetModules();
  for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
  process.env.EXPO_PUBLIC_PREMIUM_MONTHLY_PRODUCT_ID = 'premium.monthly';
  process.env.EXPO_PUBLIC_PREMIUM_ANNUAL_PRODUCT_ID = 'premium.annual';
  process.env.EXPO_PUBLIC_PREMIUM_SUBSCRIPTION_GROUP_ID = groupId;

  const fetchProducts = jest.fn().mockResolvedValue([
    product('premium.monthly', productGroupId === undefined ? groupId : productGroupId ?? undefined),
    product('premium.annual', productGroupId === undefined ? groupId : productGroupId ?? undefined),
  ]);
  jest.doMock('react-native', () => ({ Platform: { OS: platform } }));
  jest.doMock('expo-iap', () => ({
    initConnection: jest.fn().mockResolvedValue(true),
    purchaseUpdatedListener: jest.fn(() => ({ remove: jest.fn() })),
    purchaseErrorListener: jest.fn(() => ({ remove: jest.fn() })),
    fetchProducts,
    isEligibleForIntroOfferIOS: eligibility,
  }));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const adapter = require('../native/purchases') as TestAdapter;
  return { adapter, fetchProducts };
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = previousEnv.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  jest.resetModules();
  jest.dontMock('react-native');
  jest.dontMock('expo-iap');
});

describe('StoreKit introductory-offer eligibility', () => {
  it('queries one iOS subscription group and shares the result across plans', async () => {
    const eligibility = jest.fn().mockResolvedValue(true);
    const { adapter } = loadAdapter({ platform: 'ios', eligibility });

    const products = await adapter.fetchPremiumProducts();
    expect(eligibility).toHaveBeenCalledTimes(1);
    expect(eligibility).toHaveBeenCalledWith('hither-premium');
    expect(products).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'premium.monthly', introductoryOfferEligibleIOS: true }),
      expect.objectContaining({ id: 'premium.annual', introductoryOfferEligibleIOS: true }),
    ]));

    await adapter.fetchPremiumProducts();
    expect(eligibility).toHaveBeenCalledTimes(1);
  });

  it('fails closed when StoreKit eligibility rejects', async () => {
    const eligibility = jest.fn().mockRejectedValue(new Error('store unavailable'));
    const { adapter } = loadAdapter({ platform: 'ios', eligibility });

    const products = await adapter.fetchPremiumProducts();
    expect(products).toEqual(expect.arrayContaining([
      expect.objectContaining({ introductoryOfferEligibleIOS: false }),
    ]));
  });

  it('does not query eligibility on Android or unsupported runtimes', async () => {
    const eligibility = jest.fn().mockResolvedValue(true);
    const { adapter } = loadAdapter({ platform: 'android', eligibility });

    const products = await adapter.fetchPremiumProducts();
    expect(eligibility).not.toHaveBeenCalled();
    expect(products.every((item) => item.introductoryOfferEligibleIOS === false)).toBe(true);
  });

  it('fails closed when an iOS product has no subscription group', async () => {
    const eligibility = jest.fn().mockResolvedValue(true);
    const { adapter } = loadAdapter({ platform: 'ios', productGroupId: null, eligibility });

    const products = await adapter.fetchPremiumProducts();
    expect(eligibility).not.toHaveBeenCalled();
    expect(products.every((item) => item.introductoryOfferEligibleIOS === false)).toBe(true);
  });

  it('renders an introductory offer only when StoreKit eligibility and an offer are both present', async () => {
    const eligibility = jest.fn().mockResolvedValue(true);
    const { adapter } = loadAdapter({ platform: 'ios', eligibility });
    const { hasEligibleIntroductoryOffer } = adapter;

    expect(hasEligibleIntroductoryOffer({
      ...product('premium.monthly', 'hither-premium'),
      introductoryOfferEligibleIOS: true,
    })).toBe(true);
    expect(hasEligibleIntroductoryOffer({
      ...product('premium.monthly', 'hither-premium'),
      introductoryPriceIOS: null,
      introductoryOfferEligibleIOS: true,
    })).toBe(false);
    expect(hasEligibleIntroductoryOffer({
      ...product('premium.monthly', 'hither-premium'),
      introductoryOfferEligibleIOS: false,
    })).toBe(false);
  });
});
