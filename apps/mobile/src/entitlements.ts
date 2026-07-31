/**
 * Free Plan + Small Trip Premium Pass constants and pure helpers.
 *
 * Server is authoritative for enforcement (join_group, itinerary trigger,
 * entitlement RPCs). These values mirror the server contract for client UX
 * (paywall copy, pre-flight checks). Never treat local state as proof of payment.
 */

/** Free-plan caps. Leader is included in groupMembers. */
export const FREE_LIMITS = {
  /** Total people including Leader. Server rejects the 6th join. */
  groupMembers: 5,
  anonymousMembers: 2,
  /** Max simultaneous unfinished (closed_at IS NULL) points per itinerary scope. */
  destinationsPerItinerary: 5,
  kmlImportPoints: 5,
  stragglerThresholdM: 500,
  historyEntries: 3,
} as const;

/** Small Trip Premium Pass product boundary (OTA-08). */
export const SMALL_TRIP_PASS = {
  planCode: 'small_trip_pass',
  /** Inclusive min/max trip size (people, Leader included). */
  minMembers: 2,
  maxMembers: 5,
  /** Duration after activation. */
  durationDays: 7,
  /** Display price (store price is authoritative when IAP is live). */
  priceLabel: 'NT$30',
  /** App Store / Play SKU — must match store console + server allow-list. */
  productId: 'hither.small_trip_pass',
} as const;

export type EntitlementStatus =
  | 'none'
  | 'active'
  | 'expired'
  | 'revoked'
  | 'refunded'
  | 'invalid'
  | 'duplicate';

export type EntitlementErrorCode =
  | 'not_authenticated'
  | 'not_member'
  | 'not_applicable'
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'refunded'
  | 'duplicate'
  | 'already_used'
  | 'member_limit'
  | 'itinerary_point_limit'
  /** BUILD-02 receipt verifier Edge Function not available / RPC denied to user JWT. */
  | 'verification_service_required'
  | 'unknown';

export interface TripEntitlement {
  ok: boolean;
  isPremium: boolean;
  status: EntitlementStatus | string;
  planCode: string;
  source?: string | null;
  startedAt?: string | null;
  expiresAt?: string | null;
  memberCount?: number;
  memberLimit?: number;
  /** null = unlimited (premium). */
  destinationLimit?: number | null;
  tripApplicable?: boolean;
  smallTripEligible?: boolean;
  entitlementId?: string | null;
  error?: string;
}

export interface EntitlementMutationResult {
  ok: boolean;
  success?: boolean;
  error?: EntitlementErrorCode | string;
  code?: EntitlementErrorCode | string;
  status?: string;
  planCode?: string;
  planName?: string;
  startedAt?: string | null;
  expiresAt?: string | null;
  entitlementId?: string | null;
  isPremium?: boolean;
  message?: string;
}

/**
 * True when a server entitlement snapshot currently grants premium.
 *
 * When `isPremium` is true, the server's effective-premium bit is authoritative
 * (covers leader lifetime on the group even if a historical trip row has
 * status `expired`/`none`). Terminal status only denies when `isPremium` is
 * false. Time-bound grants still fail closed if `expiresAt` is in the past
 * *and* status was `active` without a separate lifetime grant — but when the
 * server already computed `isPremium: true`, trust it.
 */
export function isEntitlementActive(
  ent: Pick<TripEntitlement, 'isPremium' | 'status' | 'expiresAt'> | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!ent) return false;
  // Server is_premium is the group-effective authority.
  if (ent.isPremium) return true;
  const terminal = ['expired', 'revoked', 'refunded', 'invalid', 'none'];
  if (terminal.includes(String(ent.status))) return false;
  if (ent.expiresAt) {
    const exp = Date.parse(ent.expiresAt);
    if (!Number.isNaN(exp) && exp <= nowMs) return false;
  }
  return false;
}

/**
 * Lifetime premium only: profiles.pro with null expiry.
 * Expiring denorm (old trip-pass writes) must never grant global isPro.
 */
export function isLifetimeProfilePremium(
  profilePro: boolean,
  proExpiresAt: string | null | undefined,
): boolean {
  return !!profilePro && (proExpiresAt == null || proExpiresAt === '');
}

/**
 * Effective premium for UI.
 * - With an ok trip snapshot: server `isPremium` is authoritative.
 * - Without a trip: lifetime profile only (never expiring denorm).
 */
export function effectiveIsPro(input: {
  trip: TripEntitlement | null | undefined;
  profilePro: boolean;
  proExpiresAt?: string | null;
  nowMs?: number;
}): boolean {
  if (input.trip && input.trip.ok) {
    // Prefer server is_premium; do not clear premium on non-active status alone.
    return isEntitlementActive(input.trip, input.nowMs ?? Date.now());
  }
  return isLifetimeProfilePremium(input.profilePro, input.proExpiresAt);
}

/** Small Trip Pass purchase eligibility: 2–5 members including Leader. */
export function isSmallTripEligible(memberCount: number, alreadyPremium: boolean): boolean {
  return (
    !alreadyPremium
    && memberCount >= SMALL_TRIP_PASS.minMembers
    && memberCount <= SMALL_TRIP_PASS.maxMembers
  );
}

/** Map free-plan member totals (Leader included) to allow/block. */
export function isWithinFreeMemberLimit(
  totalMembersIncludingLeader: number,
  limit: number = FREE_LIMITS.groupMembers,
): boolean {
  return totalMembersIncludingLeader <= limit;
}

/** True when adding one more person would exceed free cap. */
export function wouldExceedMemberLimit(
  currentTotalIncludingLeader: number,
  limit: number = FREE_LIMITS.groupMembers,
): boolean {
  return currentTotalIncludingLeader >= limit;
}

/** Map itinerary point counts to allow/block for Free Plan. */
export function isWithinFreeDestinationLimit(
  pointCount: number,
  limit: number = FREE_LIMITS.destinationsPerItinerary,
): boolean {
  return pointCount <= limit;
}

export function wouldExceedDestinationLimit(
  currentPoints: number,
  limit: number = FREE_LIMITS.destinationsPerItinerary,
): boolean {
  return currentPoints >= limit;
}

/**
 * Count unfinished gathering points (Spec Free cap: closed_at IS NULL only).
 */
export function countOpenDestinations(
  destinations: ReadonlyArray<{ closedAt?: string | null }>,
): number {
  return destinations.reduce((n, d) => (d.closedAt == null ? n + 1 : n), 0);
}

/**
 * Client pre-check before add: block Paywall only when Free is full AND no credits.
 * Server remains authoritative; Premium never blocked here.
 */
export function shouldBlockNewDestination(input: {
  isPro: boolean;
  openCount: number;
  extraCredits?: number;
  limit?: number;
}): boolean {
  if (input.isPro) return false;
  const limit = input.limit ?? FREE_LIMITS.destinationsPerItinerary;
  if (input.openCount < limit) return false;
  if ((input.extraCredits ?? 0) > 0) return false;
  return true;
}

/** Remaining Free open slots + one-shot credits (non-Premium). */
export function remainingDestinationSlots(input: {
  isPro: boolean;
  openCount: number;
  extraCredits?: number;
  limit?: number;
}): number {
  if (input.isPro) return Number.POSITIVE_INFINITY;
  const limit = input.limit ?? FREE_LIMITS.destinationsPerItinerary;
  const freeLeft = Math.max(0, limit - input.openCount);
  return freeLeft + Math.max(0, input.extraCredits ?? 0);
}

/** Normalize RPC error payloads into stable codes for UI. */
export function normalizeEntitlementError(
  raw: unknown,
): EntitlementErrorCode {
  if (raw == null) return 'unknown';
  const text = String(
    typeof raw === 'object' && raw !== null && 'error' in raw
      ? (raw as { error?: unknown }).error
      : raw,
  ).toLowerCase();

  if (text.includes('not_authenticated') || text.includes('not authenticated')) {
    return 'not_authenticated';
  }
  if (text.includes('not_member') || text.includes('not a member')) {
    return 'not_member';
  }
  if (
    text.includes('verification_service_required')
    || text.includes('verification service required')
    || text.includes('build-02')
  ) {
    return 'verification_service_required';
  }
  if (text.includes('not_applicable') || text.includes('anonymous')) {
    return 'not_applicable';
  }
  if (text.includes('already_used') || text.includes('usage limit')) {
    return 'already_used';
  }
  if (text.includes('duplicate')) return 'duplicate';
  if (text.includes('refunded')) return 'refunded';
  if (text.includes('revoked')) return 'revoked';
  if (text.includes('expired')) return 'expired';
  if (text.includes('member_limit') || text.includes('member limit')) {
    return 'member_limit';
  }
  if (text.includes('itinerary_point_limit') || text.includes('p0004')) {
    return 'itinerary_point_limit';
  }
  if (text.includes('invalid')) return 'invalid';
  return 'unknown';
}

export function mapTripEntitlementRow(raw: Record<string, unknown> | null | undefined): TripEntitlement {
  if (!raw || raw.ok === false) {
    return {
      ok: false,
      isPremium: false,
      status: 'none',
      planCode: 'free',
      error: typeof raw?.error === 'string' ? raw.error : 'unknown',
    };
  }
  return {
    ok: true,
    isPremium: !!raw.is_premium,
    status: String(raw.status ?? (raw.is_premium ? 'active' : 'none')),
    planCode: String(raw.plan_code ?? (raw.is_premium ? 'premium' : 'free')),
    source: (raw.source as string | null | undefined) ?? null,
    startedAt: (raw.started_at as string | null | undefined) ?? null,
    expiresAt: (raw.expires_at as string | null | undefined) ?? null,
    memberCount: typeof raw.member_count === 'number' ? raw.member_count : undefined,
    memberLimit: typeof raw.member_limit === 'number' ? raw.member_limit : FREE_LIMITS.groupMembers,
    destinationLimit:
      raw.destination_limit === null
        ? null
        : typeof raw.destination_limit === 'number'
          ? raw.destination_limit
          : FREE_LIMITS.destinationsPerItinerary,
    tripApplicable: raw.trip_applicable as boolean | undefined,
    smallTripEligible: raw.small_trip_eligible as boolean | undefined,
    entitlementId: (raw.entitlement_id as string | null | undefined) ?? null,
  };
}

/**
 * Anonymous companion rules (OTA-05) — re-exported so callers that already
 * import free-plan / entitlement helpers can discover the registration gate.
 * Authoritative helpers live in `./anonymousAccess`.
 */
export {
  ANONYMOUS_ACCESS_DAYS,
  ANONYMOUS_MAX_GROUP_MEMBERS,
  ANONYMOUS_ACCESS_MS,
  computeAnonymousExpiresAt,
  isAnonymousAccessExpired,
  anonymousLeaderRequiresRegistration,
} from './anonymousAccess';
