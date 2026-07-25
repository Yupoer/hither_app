import {
  ANONYMOUS_ACCESS_DAYS,
  ANONYMOUS_ACCESS_MS,
  ANONYMOUS_MAX_GROUP_MEMBERS,
  ANON_EXPIRED_ERROR,
  ANON_LEADER_REGISTRATION_REQUIRED,
  anonymousLeaderRequiresRegistration,
  classifyAnonymousAccessError,
  computeAnonymousExpiresAt,
  isAnonymousAccessExpired,
} from '../anonymousAccess';

describe('anonymous access constants (OTA-05)', () => {
  it('uses a 14-day expiry window', () => {
    expect(ANONYMOUS_ACCESS_DAYS).toBe(14);
    expect(ANONYMOUS_ACCESS_MS).toBe(14 * 24 * 60 * 60 * 1_000);
  });

  it('caps anonymous-led groups at 5 total members', () => {
    expect(ANONYMOUS_MAX_GROUP_MEMBERS).toBe(5);
  });
});

describe('computeAnonymousExpiresAt / isAnonymousAccessExpired', () => {
  const joinedAt = Date.UTC(2026, 6, 1, 12, 0, 0); // 2026-07-01T12:00:00Z
  const expiresAt = computeAnonymousExpiresAt(joinedAt);

  it('expires exactly 14 days after join', () => {
    expect(expiresAt.getTime()).toBe(joinedAt + ANONYMOUS_ACCESS_MS);
  });

  it('is not expired just before 14 days', () => {
    const justBefore = expiresAt.getTime() - 1;
    expect(isAnonymousAccessExpired(expiresAt, justBefore)).toBe(false);
  });

  it('is expired at the exact expiry instant', () => {
    expect(isAnonymousAccessExpired(expiresAt, expiresAt.getTime())).toBe(true);
  });

  it('is expired just after 14 days', () => {
    const justAfter = expiresAt.getTime() + 1;
    expect(isAnonymousAccessExpired(expiresAt, justAfter)).toBe(true);
  });

  it('treats missing expiry as not yet started (not expired)', () => {
    expect(isAnonymousAccessExpired(null)).toBe(false);
    expect(isAnonymousAccessExpired(undefined)).toBe(false);
    expect(isAnonymousAccessExpired('')).toBe(false);
  });

  it('accepts ISO strings for timezone-independent comparison', () => {
    const iso = expiresAt.toISOString();
    expect(isAnonymousAccessExpired(iso, expiresAt.getTime() - 1)).toBe(false);
    expect(isAnonymousAccessExpired(iso, expiresAt.getTime())).toBe(true);
  });
});

describe('anonymousLeaderRequiresRegistration (5 vs 6 gate)', () => {
  it('allows inviting while count is under 5 for anonymous leaders', () => {
    expect(anonymousLeaderRequiresRegistration(true, 1)).toBe(false);
    expect(anonymousLeaderRequiresRegistration(true, 4)).toBe(false);
  });

  it('requires registration at 5 members (before the 6th)', () => {
    expect(anonymousLeaderRequiresRegistration(true, 5)).toBe(true);
    expect(anonymousLeaderRequiresRegistration(true, 6)).toBe(true);
  });

  it('does not gate registered leaders at 5 or 6 members', () => {
    expect(anonymousLeaderRequiresRegistration(false, 5)).toBe(false);
    expect(anonymousLeaderRequiresRegistration(false, 6)).toBe(false);
  });
});

describe('classifyAnonymousAccessError', () => {
  it('recognizes expired and registration-required tokens', () => {
    expect(classifyAnonymousAccessError(ANON_EXPIRED_ERROR)).toBe('expired');
    expect(classifyAnonymousAccessError(ANON_LEADER_REGISTRATION_REQUIRED)).toBe(
      'registration_required',
    );
  });

  it('returns null for unrelated errors', () => {
    expect(classifyAnonymousAccessError('group not found')).toBeNull();
    expect(classifyAnonymousAccessError(null)).toBeNull();
  });
});
