/**
 * #156 Ordered Step 5 — behavioral component tests (mocked flow boundary).
 *
 * Renders Store (`showRestore=false`) and Paywall (`showRestore` / PaywallSheet)
 * contexts of PremiumPresentation and exercises:
 * - product load on mount
 * - purchase success / cancel / failure
 * - restore routing + entitlement refresh
 *
 * Real StoreKit / Play Billing on device remains Unverified (agent hosts).
 * Parent #155 non-goal: green Jest is not device purchase evidence.
 */
import React from 'react';

process.env.EXPO_PUBLIC_PREMIUM_MONTHLY_PRODUCT_ID = 'premium.monthly';
process.env.EXPO_PUBLIC_PREMIUM_ANNUAL_PRODUCT_ID = 'premium.annual';
process.env.EXPO_PUBLIC_PREMIUM_SUBSCRIPTION_GROUP_ID = 'hither-premium';

const mockAlert = jest.fn();
const mockLoadProducts = jest.fn();
const mockPurchase = jest.fn();
const mockRestore = jest.fn();
const mockRefreshEntitlement = jest.fn();
const mockRefreshProfile = jest.fn();

type SessionShape = {
  user: { id: string } | null;
  membership: { group: { id: string } } | null;
  isPro: boolean;
  isAnonymous?: boolean;
  premiumProjection: {
    personalPremiumActive: boolean;
    teamPremiumActive: boolean;
    status: string;
    productId: string | null;
    expiresAt: string | null;
    sourceVersion: string | null;
  };
  refreshEntitlement: typeof mockRefreshEntitlement;
  refreshProfile: typeof mockRefreshProfile;
};

let sessionState: SessionShape;

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: {
    create: (styles: unknown) => styles,
    hairlineWidth: 1,
    absoluteFill: {},
  },
  Text: 'Text',
  View: 'View',
  ScrollView: 'ScrollView',
  Modal: 'Modal',
  TextInput: 'TextInput',
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));

jest.mock('../api/client', () => ({
  redeemPromoCode: jest.fn(),
  getPremiumProjection: jest.fn(async () => ({
    personalPremiumActive: true,
    teamPremiumActive: false,
    status: 'active',
    productId: 'premium.monthly',
    expiresAt: null,
    sourceVersion: '1',
  })),
}));

jest.mock('../utils/uiAction', () => ({
  runUiAction: jest.fn(),
}));

jest.mock('../i18n', () => ({
  useTranslation: () => ({
    language: 'en',
    t: (key: string, params?: Record<string, string | number>) =>
      (params ? `${key}:${JSON.stringify(params)}` : key),
  }),
}));

jest.mock('../state/PreferencesContext', () => ({
  useTheme: () => ({ colors: { accent: '#F5B142' } }),
}));

jest.mock('../state/SessionContext', () => ({
  useSession: () => sessionState,
}));

jest.mock('../services/premiumPurchaseFlow', () => ({
  loadPremiumStoreProducts: (...args: unknown[]) => mockLoadProducts(...args),
  purchasePremiumSubscription: (...args: unknown[]) => mockPurchase(...args),
  restorePremiumSubscription: (...args: unknown[]) => mockRestore(...args),
}));

jest.mock('../native/purchases', () => ({
  hasEligibleIntroductoryOffer: (product: {
    introductoryOfferEligibleIOS?: boolean;
    introductoryPriceIOS?: string | null;
  }) =>
    product.introductoryOfferEligibleIOS === true
    && typeof product.introductoryPriceIOS === 'string'
    && product.introductoryPriceIOS.trim().length > 0,
}));

jest.mock('../components/OverlaySheet', () => {
  const ReactActual = require('react') as typeof import('react');
  return {
    __esModule: true,
    default: function MockOverlaySheet({
      children,
      visible,
      title,
    }: {
      children?: React.ReactNode;
      visible: boolean;
      title?: string;
    }) {
      if (!visible) return null;
      return ReactActual.createElement(
        'OverlaySheet',
        { testID: 'paywall-overlay', title },
        children,
      );
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => {
    unmount: () => void;
    root: {
      findAll: (
        predicate: (node: { props: Record<string, unknown>; type: unknown }) => boolean,
      ) => Array<{
        props: Record<string, unknown>;
        type: unknown;
      }>;
    };
  };
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PremiumPresentation = require('../components/PremiumPresentation').default as typeof import('../components/PremiumPresentation').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PaywallSheet = require('../components/PaywallSheet').default as typeof import('../components/PaywallSheet').default;

const SAMPLE_PRODUCTS = [
  {
    id: 'premium.monthly',
    type: 'subs' as const,
    displayName: 'Monthly',
    displayPrice: 'NT$60',
    description: 'Premium monthly',
    currency: 'TWD',
    introductoryPriceIOS: 'Free for 7 days',
    introductoryOfferEligibleIOS: true,
    subscriptionGroupIdIOS: 'hither-premium',
  },
  {
    id: 'premium.annual',
    type: 'subs' as const,
    displayName: 'Annual',
    displayPrice: 'NT$480',
    description: 'Premium annual',
    currency: 'TWD',
    introductoryPriceIOS: null,
    introductoryOfferEligibleIOS: false,
    subscriptionGroupIdIOS: 'hither-premium',
  },
];

const EMPTY_PROJECTION = {
  personalPremiumActive: false,
  teamPremiumActive: false,
  status: 'none',
  productId: null,
  expiresAt: null,
  sourceVersion: null,
};

function flush() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

type TestNode = { props: Record<string, unknown>; type?: unknown };
type TestRoot = {
  findAll: (fn: (n: TestNode) => boolean) => TestNode[];
};

function findByTestId(root: TestRoot, testID: string): TestNode[] {
  // Prefer host nodes (string types from RN mocks) so memo/composite wrappers
  // that also receive the same testID prop are not double-counted.
  const all = root.findAll((node) => node.props.testID === testID);
  const hosts = all.filter((node) => typeof node.type === 'string');
  return hosts.length > 0 ? hosts : all;
}

async function press(root: TestRoot, testID: string) {
  const nodes = findByTestId(root, testID);
  expect(nodes.length).toBeGreaterThan(0);
  const onPress = nodes[0].props.onPress as undefined | (() => void | Promise<void>);
  expect(typeof onPress).toBe('function');
  await act(async () => {
    await onPress?.();
  });
}

function defaultSession(overrides: Partial<SessionShape> = {}): SessionShape {
  return {
    user: { id: 'user-1' },
    membership: { group: { id: 'group-1' } },
    isPro: false,
    premiumProjection: { ...EMPTY_PROJECTION },
    refreshEntitlement: mockRefreshEntitlement,
    refreshProfile: mockRefreshProfile,
    ...overrides,
  };
}

describe('#156 behavioral: PremiumPresentation Store + Paywall', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    sessionState = defaultSession();
    mockLoadProducts.mockResolvedValue(SAMPLE_PRODUCTS);
    mockPurchase.mockResolvedValue({ ok: true, purchase: { transactionId: 't1' } });
    mockRestore.mockResolvedValue({
      ok: true,
      restored: 1,
      projection: {
        ...EMPTY_PROJECTION,
        personalPremiumActive: true,
        status: 'active',
      },
    });
    mockRefreshEntitlement.mockResolvedValue(undefined);
    mockRefreshProfile.mockResolvedValue(undefined);
    consoleError = jest.spyOn(console, 'error').mockImplementation((...args) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      if (String(args[0]).includes('not wrapped in act')) return;
    });
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('Store context loads products and hides restore CTA', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(PremiumPresentation, {
          showRestore: false,
          testID: 'store-premium-presentation',
        }),
      );
    });
    await flush();

    expect(mockLoadProducts).toHaveBeenCalledTimes(1);
    expect(findByTestId(tree.root, 'store-premium-presentation').length).toBe(1);
    expect(findByTestId(tree.root, 'store-premium-presentation-purchase').length).toBe(1);
    expect(findByTestId(tree.root, 'store-premium-presentation-restore').length).toBe(0);
    tree.unmount();
  });

  it('Paywall context shows restore CTA and loads products once per mount', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(PremiumPresentation, {
          showRestore: true,
          testID: 'paywall-premium-presentation',
        }),
      );
    });
    await flush();

    expect(mockLoadProducts).toHaveBeenCalledTimes(1);
    expect(findByTestId(tree.root, 'paywall-premium-presentation-restore').length).toBe(1);
    tree.unmount();
  });

  it('PaywallSheet hosts PremiumPresentation with restore enabled', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(PaywallSheet, {
          visible: true,
          onClose: jest.fn(),
        }),
      );
    });
    await flush();

    expect(findByTestId(tree.root, 'paywall-premium-presentation').length).toBe(1);
    expect(findByTestId(tree.root, 'paywall-premium-presentation-restore').length).toBe(1);
    expect(findByTestId(tree.root, 'paywall-premium-presentation-purchase').length).toBe(1);
    tree.unmount();
  });

  it('purchase success refreshes profile + entitlement and fires onPurchaseSuccess', async () => {
    const onPurchaseSuccess = jest.fn();
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(PremiumPresentation, {
          showRestore: false,
          onPurchaseSuccess,
          testID: 'store-premium-presentation',
        }),
      );
    });
    await flush();

    await press(tree.root, 'store-premium-presentation-purchase');
    await flush();

    expect(mockPurchase).toHaveBeenCalledWith('monthly', expect.objectContaining({
      onNativePurchased: expect.any(Function),
      userId: 'user-1',
    }));
    expect(mockRefreshProfile).toHaveBeenCalled();
    expect(mockRefreshEntitlement).toHaveBeenCalledWith('group-1');
    expect(onPurchaseSuccess).toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('paywall.title', 'paywall.purchaseSuccess');
    tree.unmount();
  });

  it('purchase cancel is silent (no failure alert, no entitlement refresh)', async () => {
    mockPurchase.mockResolvedValueOnce({ ok: false, error: 'cancelled' });
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(PremiumPresentation, {
          showRestore: false,
          testID: 'store-premium-presentation',
        }),
      );
    });
    await flush();

    await press(tree.root, 'store-premium-presentation-purchase');
    await flush();

    expect(mockRefreshEntitlement).not.toHaveBeenCalled();
    expect(mockRefreshProfile).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('purchase failure alerts purchaseFailed without success callback', async () => {
    mockPurchase.mockResolvedValueOnce({ ok: false, error: 'store_purchase_failed' });
    const onPurchaseSuccess = jest.fn();
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(PremiumPresentation, {
          showRestore: false,
          onPurchaseSuccess,
          testID: 'store-premium-presentation',
        }),
      );
    });
    await flush();

    await press(tree.root, 'store-premium-presentation-purchase');
    await flush();

    expect(onPurchaseSuccess).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('paywall.title', 'paywall.purchaseFailed');
    tree.unmount();
  });

  it('restore success refreshes entitlement and fires onRestoreSuccess', async () => {
    const onRestoreSuccess = jest.fn();
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(PremiumPresentation, {
          showRestore: true,
          onRestoreSuccess,
          testID: 'paywall-premium-presentation',
        }),
      );
    });
    await flush();

    await press(tree.root, 'paywall-premium-presentation-restore');
    await flush();

    expect(mockRestore).toHaveBeenCalledWith('group-1', expect.objectContaining({ userId: 'user-1' }));
    expect(mockRefreshProfile).toHaveBeenCalled();
    expect(mockRefreshEntitlement).toHaveBeenCalledWith('group-1');
    expect(onRestoreSuccess).toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('paywall.title', 'paywall.restoreSuccess');
    tree.unmount();
  });

  it('restore with no premium projection shows restoreNone', async () => {
    mockRestore.mockResolvedValueOnce({
      ok: true,
      restored: 0,
      projection: { ...EMPTY_PROJECTION },
    });
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(PremiumPresentation, {
          showRestore: true,
          testID: 'paywall-premium-presentation',
        }),
      );
    });
    await flush();

    await press(tree.root, 'paywall-premium-presentation-restore');
    await flush();

    expect(mockRefreshEntitlement).toHaveBeenCalledWith('group-1');
    expect(mockAlert).toHaveBeenCalledWith('paywall.title', 'paywall.restoreNone');
    tree.unmount();
  });

  it('anonymous purchase and restore require in-place upgrade first', async () => {
    sessionState = defaultSession({ isAnonymous: true });
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(PremiumPresentation, {
          showRestore: true,
          testID: 'paywall-premium-presentation',
        }),
      );
    });
    await flush();
    await press(tree.root, 'paywall-premium-presentation-purchase');
    await flush();
    expect(mockPurchase).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('paywall.title', 'paywall.upgradeRequired');
    await press(tree.root, 'paywall-premium-presentation-restore');
    await flush();
    expect(mockRestore).not.toHaveBeenCalled();
    tree.unmount();
  });
});
