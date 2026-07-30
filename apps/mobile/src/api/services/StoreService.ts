/**
 * StoreService — server-authoritative token wallet / redeem / reward sessions.
 * Client never writes wallet, ledger, credits, or entitlements.
 */
import { supabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';
import type {
  CreateRewardSessionResult,
  RedeemStoreProductResult,
  StoreCatalogProduct,
  StoreRewardSessionSummary,
  StoreSnapshot,
} from '../../store/types';

function asRecord(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return null;
}

function mapCatalog(raw: unknown): StoreCatalogProduct[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = asRecord(item) ?? {};
    return {
      code: String(row.code ?? ''),
      displayName: String(row.display_name ?? row.displayName ?? row.code ?? ''),
      scope: String(row.scope ?? 'team'),
      priceTokens: Number(row.price_tokens ?? row.priceTokens ?? 0),
      effectJson:
        row.effect_json && typeof row.effect_json === 'object'
          ? (row.effect_json as Record<string, unknown>)
          : {},
      sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
      active: row.active !== false,
    };
  });
}

function mapSession(raw: unknown): StoreRewardSessionSummary | null {
  const row = asRecord(raw);
  if (!row) return null;
  return {
    sessionRef: String(row.session_ref ?? row.sessionRef ?? ''),
    platform: String(row.platform ?? ''),
    status: String(row.status ?? ''),
    expiresAt: (row.expires_at as string | null | undefined) ?? null,
    createdAt: (row.created_at as string | null | undefined) ?? null,
  };
}

export function mapStoreSnapshot(raw: Record<string, unknown> | null | undefined): StoreSnapshot {
  if (!raw || raw.ok === false) {
    return {
      ok: false,
      error: typeof raw?.error === 'string' ? raw.error : 'unknown',
      anonymous: false,
      registrationRequired: false,
      balance: 0,
      catalog: [],
      canCreateRewardSession: false,
      canRedeem: false,
      groupId: null,
      groupName: null,
      isMember: false,
      memberCount: 0,
      tripPremium: null,
      extraPointCredits: 0,
      liveActivityPersonal: false,
      liveActivityEffective: false,
      activeRewardSession: null,
    };
  }
  return {
    ok: true,
    anonymous: !!raw.anonymous,
    registrationRequired: !!raw.registration_required,
    balance: Number(raw.balance ?? 0),
    catalog: mapCatalog(raw.catalog),
    canCreateRewardSession: !!raw.can_create_reward_session,
    canRedeem: !!raw.can_redeem,
    groupId: (raw.group_id as string | null | undefined) ?? null,
    groupName: (raw.group_name as string | null | undefined) ?? null,
    isMember: !!raw.is_member,
    memberCount: Number(raw.member_count ?? 0),
    tripPremium:
      raw.trip_premium && typeof raw.trip_premium === 'object'
        ? (raw.trip_premium as Record<string, unknown>)
        : null,
    extraPointCredits: Number(raw.extra_point_credits ?? 0),
    liveActivityPersonal: !!raw.live_activity_personal,
    liveActivityEffective: !!raw.live_activity_effective,
    activeRewardSession: mapSession(raw.active_reward_session),
  };
}

export async function getStoreSnapshot(groupId?: string | null): Promise<StoreSnapshot> {
  await requireUserId();
  const { data, error } = await supabase.rpc('get_store_snapshot', {
    p_group_id: groupId ?? null,
  });
  orThrow(error);
  return mapStoreSnapshot(asRecord(data));
}

export async function createRewardSession(
  platform: 'ios' | 'android',
): Promise<CreateRewardSessionResult> {
  await requireUserId();
  const { data, error } = await supabase.rpc('create_reward_session', {
    p_platform: platform,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  const row = asRecord(data);
  if (!row || row.ok === false) {
    return {
      ok: false,
      error: typeof row?.error === 'string' ? row.error : 'unknown',
      sessionRef: typeof row?.session_ref === 'string' ? row.session_ref : undefined,
      expiresAt: (row?.expires_at as string | null | undefined) ?? null,
    };
  }
  return {
    ok: true,
    sessionRef: String(row.session_ref ?? ''),
    platform: String(row.platform ?? platform),
    adUnit: typeof row.ad_unit === 'string' ? row.ad_unit : undefined,
    status: String(row.status ?? 'active'),
    expiresAt: (row.expires_at as string | null | undefined) ?? null,
    rewardAmount: Number(row.reward_amount ?? 1),
    rewardItem: String(row.reward_item ?? 'hither_token'),
  };
}

/**
 * Mark reward session failed (no-fill / dismiss / load error) or verifying
 * (client earned reward; SSV pending). Releases active-session slot on fail.
 */
export async function updateRewardSessionStatus(
  sessionRef: string,
  status: 'failed' | 'verifying',
): Promise<{ ok: boolean; error?: string; status?: string }> {
  await requireUserId();
  const { data, error } = await supabase.rpc('update_reward_session_status', {
    p_session_ref: sessionRef,
    p_status: status,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  const row = asRecord(data);
  if (!row || row.ok === false) {
    return {
      ok: false,
      error: typeof row?.error === 'string' ? row.error : 'unknown',
    };
  }
  return {
    ok: true,
    status: typeof row.status === 'string' ? row.status : status,
  };
}

export async function redeemStoreProduct(
  productCode: string,
  groupId?: string | null,
): Promise<RedeemStoreProductResult> {
  await requireUserId();
  const { data, error } = await supabase.rpc('redeem_store_product', {
    p_product_code: productCode,
    p_group_id: groupId ?? null,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  const row = asRecord(data);
  if (!row || row.ok === false) {
    return {
      ok: false,
      error: typeof row?.error === 'string' ? row.error : 'unknown',
      shortfall: typeof row?.shortfall === 'number' ? row.shortfall : undefined,
      price: typeof row?.price === 'number' ? row.price : undefined,
      balance: typeof row?.balance === 'number' ? row.balance : undefined,
      message: typeof row?.message === 'string' ? row.message : undefined,
    };
  }
  return {
    ok: true,
    productCode: String(row.product_code ?? productCode),
    balance: typeof row.balance === 'number' ? row.balance : undefined,
    redemptionId: typeof row.redemption_id === 'string' ? row.redemption_id : undefined,
    entitlementId: typeof row.entitlement_id === 'string' ? row.entitlement_id : undefined,
    startedAt: (row.started_at as string | null | undefined) ?? null,
    expiresAt: (row.expires_at as string | null | undefined) ?? null,
    source: typeof row.source === 'string' ? row.source : undefined,
    stacked: typeof row.stacked === 'boolean' ? row.stacked : undefined,
    extraPointCredits:
      typeof row.extra_point_credits === 'number' ? row.extra_point_credits : undefined,
    liveActivityPersonal:
      typeof row.live_activity_personal === 'boolean' ? row.live_activity_personal : undefined,
  };
}
