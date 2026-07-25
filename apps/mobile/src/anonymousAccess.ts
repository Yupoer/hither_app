/**
 * Anonymous companion access rules (OTA-05).
 *
 * Single source of truth for the 14-day expiry window and the 5-person
 * anonymous group ceiling (6th member requires a registered Leader).
 * Server authorization in `join_group` / membership triggers must use the
 * same numbers and timezone-independent timestamp comparisons.
 */

/** Authoritative anonymous access window after first group membership. */
export const ANONYMOUS_ACCESS_DAYS = 14;

/** Total members (including Leader) allowed while the Leader is anonymous. */
export const ANONYMOUS_MAX_GROUP_MEMBERS = 5;

/** Duration of anonymous access in milliseconds. */
export const ANONYMOUS_ACCESS_MS = ANONYMOUS_ACCESS_DAYS * 24 * 60 * 60 * 1_000;

/**
 * Compute `anonymous_expires_at` from the moment access starts
 * (first create/join membership timestamp).
 */
export function computeAnonymousExpiresAt(
  joinedAt: Date | string | number,
): Date {
  const base =
    typeof joinedAt === 'number' ? joinedAt : new Date(joinedAt).getTime();
  return new Date(base + ANONYMOUS_ACCESS_MS);
}

/**
 * Whether anonymous access has ended.
 * Comparison is timezone-independent (epoch ms). At and after expiry → expired.
 * `null`/`undefined` means expiry has not started yet (no membership) → not expired.
 */
export function isAnonymousAccessExpired(
  expiresAt: Date | string | number | null | undefined,
  now: Date | number = Date.now(),
): boolean {
  if (expiresAt == null || expiresAt === '') return false;
  const exp =
    typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime();
  if (!Number.isFinite(exp)) return false;
  const t = typeof now === 'number' ? now : now.getTime();
  return t >= exp;
}

/**
 * True when the next membership would make the group size ≥ 6 and the
 * Leader is still anonymous — registration is required before accepting it.
 */
export function anonymousLeaderRequiresRegistration(
  isLeaderAnonymous: boolean,
  currentMemberCount: number,
): boolean {
  return (
    isLeaderAnonymous &&
    currentMemberCount >= ANONYMOUS_MAX_GROUP_MEMBERS
  );
}

/** Server / client error token for expired anonymous access. */
export const ANON_EXPIRED_ERROR = 'anonymous access expired';

/** Server / client error token for the 6th-member registration gate. */
export const ANON_LEADER_REGISTRATION_REQUIRED =
  'leader registration required before adding member 6';

/** Map a raw Supabase error message into a known anonymous-access failure. */
export function classifyAnonymousAccessError(
  message: string | null | undefined,
): 'expired' | 'registration_required' | null {
  const msg = (message ?? '').toLowerCase();
  if (msg.includes(ANON_EXPIRED_ERROR)) return 'expired';
  if (msg.includes(ANON_LEADER_REGISTRATION_REQUIRED)) {
    return 'registration_required';
  }
  // Tolerate slightly shorter server messages.
  if (msg.includes('registration required') && msg.includes('member 6')) {
    return 'registration_required';
  }
  return null;
}
