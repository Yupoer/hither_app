/**
 * Contract tests for OTA-05 anonymous expiry, registration gate, upgrade
 * preservation, and idempotent cleanup. Pattern matches anonymousSignOut /
 * migration contract tests elsewhere in the suite.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// __dirname = apps/mobile/src/__tests__ → hither_app is four levels up.
const hitherAppRoot = join(__dirname, '../../../../');
const mobileSrc = join(__dirname, '..');
const migrationsDir = join(hitherAppRoot, 'supabase/migrations');
const supabaseConfig = readFileSync(join(hitherAppRoot, 'supabase/config.toml'), 'utf8');

const migrationPath = join(
  migrationsDir,
  '20260725000000_anonymous_access_expiry_and_gate.sql',
);
const hardeningPath = join(
  migrationsDir,
  '20260725010000_anonymous_access_hardening.sql',
);
const expiryIsMemberPath = join(
  migrationsDir,
  '20260726000000_anonymous_expiry_is_member.sql',
);
const expiryDefinerRpcsPath = join(
  migrationsDir,
  '20260726000200_anonymous_expiry_definer_rpcs.sql',
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const hardening = existsSync(hardeningPath)
  ? readFileSync(hardeningPath, 'utf8')
  : '';
const expiryIsMember = existsSync(expiryIsMemberPath)
  ? readFileSync(expiryIsMemberPath, 'utf8')
  : '';
const expiryDefinerRpcs = existsSync(expiryDefinerRpcsPath)
  ? readFileSync(expiryDefinerRpcsPath, 'utf8')
  : '';

/** Last create-or-replace of join_group across all migrations (apply order). */
function lastJoinGroupDefinition(): string {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let last = '';
  for (const f of files) {
    const body = readFileSync(join(migrationsDir, f), 'utf8');
    if (/create or replace function public\.join_group\s*\(/i.test(body)) {
      last = body;
    }
  }
  return last;
}

const i18n = [
  readFileSync(join(mobileSrc, 'i18n/locales/zh.ts'), 'utf8'),
  readFileSync(join(mobileSrc, 'i18n/locales/en.ts'), 'utf8'),
].join('\n');
const session = readFileSync(join(mobileSrc, 'state/SessionContext.tsx'), 'utf8');
const authFlow = readFileSync(join(mobileSrc, 'state/useAuthFlow.ts'), 'utf8');
const groupService = readFileSync(
  join(mobileSrc, 'api/services/GroupService.ts'),
  'utf8',
);
const loginScreen = readFileSync(join(mobileSrc, 'screens/LoginScreen.tsx'), 'utf8');
const accountSheet = readFileSync(
  join(mobileSrc, 'components/AccountSheet.tsx'),
  'utf8',
);
const anonymousAccess = readFileSync(
  join(mobileSrc, 'anonymousAccess.ts'),
  'utf8',
);
const mapScreen = readFileSync(join(mobileSrc, 'screens/MapScreen.tsx'), 'utf8');
const entitlements = readFileSync(join(mobileSrc, 'entitlements.ts'), 'utf8');
const productMd = existsSync(join(hitherAppRoot, 'docs/PRODUCT.md'))
  ? readFileSync(join(hitherAppRoot, 'docs/PRODUCT.md'), 'utf8')
  : '';

describe('anonymous access migration contract', () => {
  it('ships the OTA-05 migration', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migration.length).toBeGreaterThan(0);
  });

  it('ships the hardening migration after paid_entitlement timestamp', () => {
    expect(existsSync(hardeningPath)).toBe(true);
    // Basename timestamps: 25010000 > 25000000 so hardening applies last.
    const hardName = '20260725010000_anonymous_access_hardening.sql';
    const paidName = '20260725000100_paid_entitlement.sql';
    const baseName = '20260725000000_anonymous_access_expiry_and_gate.sql';
    expect(hardName > paidName).toBe(true);
    expect(hardName > baseName).toBe(true);
    expect(hardening).toContain('create or replace function public.create_group');
    expect(hardening).toContain('delete_orphan_group');
    expect(hardening).toMatch(/before insert or update on public\.profiles/i);
  });

  it('stores a shared 14-day anonymous_expires_at on profiles', () => {
    expect(migration).toContain('anonymous_expires_at');
    expect(migration).toContain("interval '14 days'");
    expect(migration).toContain('ensure_anonymous_expiry');
  });

  it('adds memberships.created_at for the join timestamp', () => {
    expect(migration).toContain('alter table public.memberships');
    expect(migration).toContain('created_at timestamptz');
  });

  it('enforces the 6th-member registration gate for anonymous leaders', () => {
    expect(migration).toContain(
      'leader registration required before adding member 6',
    );
    expect(migration).toContain('v_count >= 5');
    expect(migration).toContain('is_auth_user_anonymous');
  });

  it('rejects expired anonymous access on join/create membership', () => {
    expect(migration).toContain('anonymous access expired');
    expect(migration).toContain('P0401');
    expect(migration).toContain('P0406');
  });

  it('provides idempotent cleanup that skips upgraded identities', () => {
    expect(migration).toContain(
      'create or replace function public.cleanup_expired_anonymous_accounts()',
    );
    expect(migration).toContain('coalesce(u.is_anonymous, false) = true');
    expect(migration).toContain('and coalesce(is_anonymous, false) = true');
    // Retry-safe: exception path continues the batch.
    expect(migration).toContain('cleanup_expired_anonymous_accounts skipped');
    expect(migration).toContain('grant execute on function public.cleanup_expired_anonymous_accounts() to service_role');
  });

  it('locks anonymous_expires_at from direct client writes on INSERT and UPDATE', () => {
    expect(hardening).toContain('prevent_client_anonymous_expires_mutation');
    expect(hardening).toContain('app.anonymous_expiry_write');
    expect(hardening).toContain('allow_anonymous_expiry_write');
    expect(hardening).toContain("tg_op = 'INSERT'");
    expect(hardening).toContain('new.anonymous_expires_at := null');
    expect(hardening).toMatch(/before insert or update on public\.profiles/i);
  });

  it('final join_group after all migrations still has P0401 and P0406 before Free Plan cap', () => {
    const finalJoin = lastJoinGroupDefinition();
    expect(finalJoin.length).toBeGreaterThan(0);
    expect(finalJoin).toContain('anonymous access expired');
    expect(finalJoin).toContain('P0401');
    expect(finalJoin).toContain('leader registration required before adding member 6');
    expect(finalJoin).toContain('P0406');
    expect(finalJoin).toContain('ensure_anonymous_expiry');
    // Order: P0406 must appear before Free Plan member_limit raise for count >= 5.
    const gateIdx = finalJoin.indexOf('leader registration required before adding member 6');
    const freeIdx = finalJoin.indexOf("raise exception 'member_limit'");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(freeIdx).toBeGreaterThan(gateIdx);
  });

  it('cleanup hardening falls back to memberships.created_at when profile expiry is null', () => {
    expect(hardening).toContain('first_joined + interval \'14 days\'');
    expect(hardening).toContain('cleanup_expired_anonymous_accounts');
  });

  it('ships expiry-aware is_member after hardening (ongoing access gate)', () => {
    expect(existsSync(expiryIsMemberPath)).toBe(true);
    expect(expiryIsMember.length).toBeGreaterThan(0);
    // Applies after hardening by filename timestamp.
    expect('20260726000000_anonymous_expiry_is_member.sql' > '20260725010000_anonymous_access_hardening.sql').toBe(
      true,
    );
    expect(expiryIsMember).toContain(
      'create or replace function public.anonymous_access_is_active',
    );
    expect(expiryIsMember).toContain(
      'create or replace function extensions.is_member(gid uuid)',
    );
    expect(expiryIsMember).toContain('anonymous_access_is_active');
    expect(expiryIsMember).toContain("interval '14 days'");
    // Registered path short-circuits; anonymous requires unexpired stamp/fallback.
    expect(expiryIsMember).toContain('is_auth_user_anonymous');
    expect(expiryIsMember).toMatch(/v_expires_at > now\(\)/);
  });

  it('gates groups SELECT creator path and member_locations UPDATE with active access', () => {
    expect(expiryIsMember).toContain('groups: select if member or creator');
    expect(expiryIsMember).toContain(
      'created_by = (select auth.uid())',
    );
    expect(expiryIsMember).toContain('anonymous_access_is_active((select auth.uid()))');
    expect(expiryIsMember).toContain('member_locations: update own');
    expect(expiryIsMember).toMatch(
      /member_locations: update own[\s\S]*extensions\.is_member\(group_id\)/,
    );
  });

  it('routes critical DEFINER membership auth through expiry-aware is_member', () => {
    expect(expiryIsMember).toContain('extensions.is_member(p_group)');
    expect(expiryIsMember).toContain('extensions.is_member(p_group_id)');
    expect(expiryIsMember).toContain('create or replace function public.set_solo');
    expect(expiryIsMember).toContain('create or replace function public.self_split');
    expect(expiryIsMember).toContain('create or replace function public.self_merge');
    expect(expiryIsMember).toContain('create or replace function public.get_trip_entitlement');
    // apply_core_operation patched to is_member (dynamic or inline).
    expect(expiryIsMember).toMatch(
      /apply_core_operation[\s\S]*extensions\.is_member\(p_group_id\)/,
    );
  });

  it('routes coordination and location_refresh DEFINER guards through is_member', () => {
    expect(existsSync(expiryDefinerRpcsPath)).toBe(true);
    expect(expiryDefinerRpcs.length).toBeGreaterThan(0);
    // Applies after is_member + gathering validation migrations.
    expect(
      '20260726000200_anonymous_expiry_definer_rpcs.sql' >
        '20260726000000_anonymous_expiry_is_member.sql',
    ).toBe(true);
    expect(
      '20260726000200_anonymous_expiry_definer_rpcs.sql' >
        '20260726000100_apply_core_operation_gathering_validation.sql',
    ).toBe(true);

    expect(expiryDefinerRpcs).toContain(
      'create or replace function public.create_coordination_request',
    );
    expect(expiryDefinerRpcs).toContain(
      'create or replace function public.override_coordination_request',
    );
    expect(expiryDefinerRpcs).toContain(
      'create or replace function public.cancel_coordination_request',
    );
    expect(expiryDefinerRpcs).toContain(
      'create or replace function public.respond_to_coordination_request',
    );
    expect(expiryDefinerRpcs).toContain(
      'create or replace function public.resolve_coordination_request_deadline',
    );
    expect(expiryDefinerRpcs).toContain(
      'create or replace function public.request_group_location_refresh',
    );

    // Authorization guards use expiry-aware is_member, not raw memberships alone.
    expect(expiryDefinerRpcs).toMatch(
      /create or replace function public\.create_coordination_request[\s\S]*extensions\.is_member\(p_group_id\)/,
    );
    expect(expiryDefinerRpcs).toMatch(
      /create or replace function public\.override_coordination_request[\s\S]*extensions\.is_member\(v_request\.group_id\)/,
    );
    expect(expiryDefinerRpcs).toMatch(
      /create or replace function public\.cancel_coordination_request[\s\S]*extensions\.is_member\(v_request\.group_id\)/,
    );
    expect(expiryDefinerRpcs).toMatch(
      /create or replace function public\.respond_to_coordination_request[\s\S]*extensions\.is_member\(v_request\.group_id\)/,
    );
    expect(expiryDefinerRpcs).toMatch(
      /create or replace function public\.resolve_coordination_request_deadline[\s\S]*extensions\.is_member\(v_request\.group_id\)/,
    );
    expect(expiryDefinerRpcs).toMatch(
      /create or replace function public\.request_group_location_refresh[\s\S]*extensions\.is_member\(p_group_id\)/,
    );
    expect(expiryDefinerRpcs).toContain(
      'anonymous_access_is_active(p_user_id)',
    );
  });

  it('documents SQL tests proving expired anonymous cannot read shared group data', () => {
    const sqlTestPath = join(
      hitherAppRoot,
      'supabase/tests/anonymous_expiry_is_member.test.sql',
    );
    expect(existsSync(sqlTestPath)).toBe(true);
    const sqlTest = readFileSync(sqlTestPath, 'utf8');
    expect(sqlTest).toContain('extensions.is_member');
    expect(sqlTest).toContain('expired anonymous cannot select group via RLS');
    expect(sqlTest).toContain('expired anonymous cannot select itinerary via RLS');
    expect(sqlTest).toContain('anonymous_expires_at');
    expect(sqlTest).toContain('is_anonymous');
    // Coordination + location refresh DEFINER paths.
    expect(sqlTest).toContain(
      'expired anonymous cannot request_group_location_refresh',
    );
    expect(sqlTest).toContain(
      'expired anonymous cannot respond_to_coordination_request',
    );
    expect(sqlTest).toContain(
      'expired anonymous leader cannot create_coordination_request',
    );
    expect(sqlTest).toContain(
      'expired anonymous leader cannot cancel_coordination_request',
    );
    expect(sqlTest).toContain(
      'expired anonymous leader cannot override_coordination_request',
    );
  });
});

describe('client 14-day copy and expiry wiring', () => {
  it('uses 14 days in anon UI strings (no stale 3-day retention copy)', () => {
    expect(i18n).toMatch(/最多保留 14 天/);
    expect(i18n).toMatch(/at most 14 days/);
    expect(i18n).not.toMatch(/最多保留 3 天/);
    expect(i18n).not.toMatch(/at most 3 days after you join/);
  });

  it('documents 14-day cleanup on the session signIn contract', () => {
    expect(session).toContain('14 days after the');
    expect(session).toContain('anonymous_expires_at');
    expect(session).not.toContain('cleanup 3 days after');
  });

  it('hydrates anonymousExpiresAt from profiles with null-aware assignment', () => {
    expect(session).toContain('anonymous_expires_at');
    expect(session).toContain('anonymousExpiresAt');
    // Null-aware path: row present → server null clears local (not ?? prev).
    expect(session).toMatch(
      /anonymousExpiresAt:\s*row\s*\?[\s\S]*anonymous_expires_at \?\? undefined/,
    );
  });

  it('login guest modal discloses the 14-day limit', () => {
    expect(loginScreen).toContain("t('anon.expiryWarning')");
    expect(loginScreen).not.toContain('3-day data');
  });

  it('account sheet surfaces expiry until / expired messaging and refreshes on open', () => {
    expect(accountSheet).toContain('anon.expiryUntil');
    expect(accountSheet).toContain('anon.expired');
    expect(accountSheet).toContain('isAnonymousAccessExpired');
    expect(accountSheet).toContain('refreshProfile');
  });

  it('exports shared client constants matching the product rule', () => {
    expect(anonymousAccess).toContain('ANONYMOUS_ACCESS_DAYS = 14');
    expect(anonymousAccess).toContain('ANONYMOUS_MAX_GROUP_MEMBERS = 5');
    expect(entitlements).toContain("from './anonymousAccess'");
    expect(entitlements).toContain('ANONYMOUS_ACCESS_DAYS');
  });

  it('PRODUCT.md no longer documents 3-day anonymous retention', () => {
    expect(productMd).toMatch(/14 天/);
    expect(productMd).not.toMatch(/最多保留 3 天/);
    expect(productMd).not.toMatch(/匿名帳號 3 天自動清理/);
  });
});

describe('registration upgrade preservation contract', () => {
  it('upgrades via updateUser on the same session (UID preserved)', () => {
    expect(authFlow).toContain('supabase.auth.updateUser');
    expect(authFlow).toMatch(/\*same\* auth\.uid\(\)|same auth\.uid\(\)/);
    expect(authFlow).toContain('keyed by uid are preserved');
  });

  it('clears expiry only via SECURITY DEFINER RPC when registered (no raw client update)', () => {
    expect(authFlow).toContain('clear_anonymous_expiry_if_registered');
    // Must not raw-update the authoritative column (locked server-side).
    expect(authFlow).not.toContain("update({ anonymous_expires_at: null })");
    // Local isAnonymous follows getUser().is_anonymous, not optimistic false.
    expect(authFlow).toContain('getUser()');
    expect(authFlow).toContain('stillAnon');
  });

  it('uses clear_anonymous_expiry_if_registered on Google/Apple linkIdentity paths', () => {
    expect(authFlow).toContain('linkIdentity');
    const rpcClears = authFlow.split("rpc('clear_anonymous_expiry_if_registered'");
    expect(rpcClears.length).toBeGreaterThanOrEqual(3);
  });

  it('enables manual identity linking for anonymous account upgrades', () => {
    expect(supabaseConfig).toContain('enable_manual_linking = true');
  });

  it('session docs that upgrade keeps profiles/memberships on the same uid', () => {
    expect(session).toContain('same');
    expect(session).toContain('auth.uid()');
    expect(session).toMatch(/profiles\/memberships|memberships/);
  });
});

describe('membership mutation gate contract', () => {
  it('maps join_group registration and expiry errors for the client', () => {
    expect(groupService).toContain("rpc('join_group'");
    expect(groupService).toContain('classifyAnonymousAccessError');
    expect(groupService).toContain('ANON_LEADER_REGISTRATION_REQUIRED');
    expect(groupService).toContain('ANON_EXPIRED_ERROR');
    expect(groupService).toContain("code === 'P0406'");
    expect(groupService).toContain("code === 'P0401'");
  });

  it('createGroup uses atomic create_group RPC (no two-step insert orphan)', () => {
    expect(groupService).toContain("rpc('create_group'");
    expect(groupService).toContain('ANON_EXPIRED_ERROR');
    expect(groupService).toContain('ANON_LEADER_REGISTRATION_REQUIRED');
    // Must not rely on groups.delete under leader-only RLS after failed membership.
    expect(groupService).not.toMatch(
      /from\('groups'\)\s*\.delete\(\)/,
    );
  });

  it('blocks invite share/copy for anonymous leaders via shared helper', () => {
    expect(mapScreen).toContain('inviteBlockedForAnonymousLeader');
    expect(mapScreen).toContain('anonymousLeaderRequiresRegistration');
    expect(mapScreen).toContain('anon.registrationRequiredBody');
  });
});
