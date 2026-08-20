/**
 * User-scoped SecureStore Premium UI cache. Never authorization.
 * Never stores JWS, session JWT, or Apple keys.
 */
import * as SecureStore from 'expo-secure-store';
import {
  EMPTY_PREMIUM_PROJECTION,
  mapPremiumProjectionRow,
  type PremiumProjection,
} from '../entitlements';

export const PREMIUM_CACHE_TTL_MS = 30 * 60 * 1000;
export const PREMIUM_BACKGROUND_REFRESH_MS = 6 * 60 * 60 * 1000;

export type PremiumCacheBlob = {
  userId: string;
  isPremium: boolean;
  expiresAt: string | null;
  entitlementVersion: number | null;
  lastSyncedAt: string | null;
  productId: string | null;
  status: string;
};

export function premiumCacheKey(userId: string): string {
  return `hither.premium.projection.${userId}`;
}

export function projectionToCacheBlob(
  userId: string,
  projection: PremiumProjection,
  syncedAt = new Date().toISOString(),
): PremiumCacheBlob {
  return {
    userId,
    isPremium: projection.personalPremiumActive,
    expiresAt: projection.expiresAt,
    entitlementVersion: projection.entitlementVersion,
    lastSyncedAt: projection.lastSyncedAt ?? syncedAt,
    productId: projection.productId,
    status: projection.status,
  };
}

export function cacheBlobToProjection(blob: PremiumCacheBlob): PremiumProjection {
  return mapPremiumProjectionRow({
    personalPremiumActive: blob.isPremium,
    teamPremiumActive: false,
    status: blob.status,
    productId: blob.productId,
    expiresAt: blob.expiresAt,
    entitlementVersion: blob.entitlementVersion,
    lastSyncedAt: blob.lastSyncedAt,
    ok: blob.isPremium,
    error: blob.isPremium ? null : 'subscription_required',
  });
}

export function isPremiumCacheStale(
  blob: PremiumCacheBlob | null | undefined,
  nowMs = Date.now(),
  ttlMs = PREMIUM_CACHE_TTL_MS,
): boolean {
  if (!blob?.lastSyncedAt) return true;
  const synced = Date.parse(blob.lastSyncedAt);
  if (!Number.isFinite(synced)) return true;
  return nowMs - synced > ttlMs;
}

export function needsBackgroundPremiumRefresh(
  blob: PremiumCacheBlob | null | undefined,
  nowMs = Date.now(),
): boolean {
  return isPremiumCacheStale(blob, nowMs, PREMIUM_BACKGROUND_REFRESH_MS);
}

function parseBlob(raw: string | null, userId: string): PremiumCacheBlob | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PremiumCacheBlob;
    if (!parsed || parsed.userId !== userId) return null;
    if (typeof parsed.lastSyncedAt !== 'string' && parsed.lastSyncedAt !== null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function readPremiumProjectionCache(userId: string): Promise<PremiumCacheBlob | null> {
  try {
    const raw = await SecureStore.getItemAsync(premiumCacheKey(userId));
    return parseBlob(raw, userId);
  } catch {
    return null;
  }
}

export async function writePremiumProjectionCache(
  userId: string,
  projection: PremiumProjection,
): Promise<PremiumCacheBlob> {
  const blob = projectionToCacheBlob(userId, projection);
  await SecureStore.setItemAsync(premiumCacheKey(userId), JSON.stringify(blob));
  return blob;
}

export async function clearPremiumProjectionCache(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    await SecureStore.deleteItemAsync(premiumCacheKey(userId));
  } catch {
    // Cache delete is best-effort; authorization still re-reads the server.
  }
}

export function emptyPersonalProjection(teamPremiumActive = false): PremiumProjection {
  return {
    ...EMPTY_PREMIUM_PROJECTION,
    teamPremiumActive,
  };
}
