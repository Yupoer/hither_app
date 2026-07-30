/** Client types for Rewarded Ads Token Store (server snapshot is authoritative). */

export type SheetPaneKey = 'members' | 'route' | 'tools' | 'store';

export const SHEET_PANE_ORDER: readonly SheetPaneKey[] = [
  'members',
  'route',
  'tools',
  'store',
] as const;

export type StoreProductCode =
  | 'team_premium_1d'
  | 'team_premium_3d'
  | 'team_premium_7d'
  | 'team_extra_points_3'
  | 'team_extra_points_10'
  | 'personal_live_activity_lifetime';

export type StoreProductScope = 'team' | 'personal';

export interface StoreCatalogProduct {
  code: StoreProductCode | string;
  displayName: string;
  scope: StoreProductScope | string;
  priceTokens: number;
  effectJson: Record<string, unknown>;
  sortOrder: number;
  active: boolean;
}

export interface StoreRewardSessionSummary {
  sessionRef: string;
  platform: string;
  status: string;
  expiresAt: string | null;
  createdAt: string | null;
}

export interface StoreSnapshot {
  ok: boolean;
  error?: string;
  anonymous: boolean;
  registrationRequired: boolean;
  balance: number;
  catalog: StoreCatalogProduct[];
  canCreateRewardSession: boolean;
  canRedeem: boolean;
  groupId: string | null;
  groupName: string | null;
  isMember: boolean;
  memberCount: number;
  tripPremium: Record<string, unknown> | null;
  extraPointCredits: number;
  liveActivityPersonal: boolean;
  liveActivityEffective: boolean;
  activeRewardSession: StoreRewardSessionSummary | null;
}

export type RewardedAdUiState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'showing'
  | 'dismissed'
  | 'verifying'
  | 'credited'
  | 'no_fill'
  | 'network_error'
  | 'consent_required'
  | 'unsupported'
  | 'registration_required'
  | 'session_active'
  | 'error';

export interface CreateRewardSessionResult {
  ok: boolean;
  error?: string;
  sessionRef?: string;
  platform?: string;
  adUnit?: string;
  status?: string;
  expiresAt?: string | null;
  rewardAmount?: number;
  rewardItem?: string;
}

export interface RedeemStoreProductResult {
  ok: boolean;
  error?: string;
  productCode?: string;
  balance?: number;
  redemptionId?: string;
  entitlementId?: string;
  startedAt?: string | null;
  expiresAt?: string | null;
  source?: string;
  stacked?: boolean;
  extraPointCredits?: number;
  liveActivityPersonal?: boolean;
  shortfall?: number;
  price?: number;
  message?: string;
}

/** Production AdMob IDs (not secret). Test units used in non-release builds. */
export const ADMOB_APP_IDS = {
  ios: 'ca-app-pub-8135109277557342~4266216474',
  android: 'ca-app-pub-8135109277557342~5387726456',
} as const;

export const ADMOB_REWARDED_UNITS = {
  ios: 'ca-app-pub-8135109277557342/7899053731',
  android: 'ca-app-pub-8135109277557342/7100977386',
} as const;

/** Google official sample rewarded unit for automated / dev builds. */
export const ADMOB_TEST_REWARDED_UNITS = {
  ios: 'ca-app-pub-3940256099942544/1712485313',
  android: 'ca-app-pub-3940256099942544/5224354917',
} as const;

export const STORE_SSV_CALLBACK_URL =
  'https://htqrucnjafhhvxdqslbv.supabase.co/functions/v1/admob-reward-callback';
