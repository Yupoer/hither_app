import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const migrations = readdirSync(join(root, 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(join(root, 'supabase/migrations', name), 'utf8'))
  .join('\n');
const client = readFileSync(join(__dirname, '../api/client.ts'), 'utf8');
const service = readFileSync(
  join(__dirname, '../api/services/CoordinationRequestService.ts'),
  'utf8',
);
const policy = readFileSync(join(__dirname, '../utils/coordinationPolicy.ts'), 'utf8');
const types = readFileSync(join(__dirname, '../types/index.ts'), 'utf8');
const navigationService = readFileSync(
  join(__dirname, '../api/services/NavigationService.ts'),
  'utf8',
);
const startNavMigration = readdirSync(join(root, 'supabase/migrations'))
  .filter((name) => name.includes('navigation'))
  .map((name) => readFileSync(join(root, 'supabase/migrations', name), 'utf8'))
  .join('\n');

describe('OTA-09 coordination request lifecycle contracts', () => {
  it('persists subject, options, deadline, policy, default outcome, and status', () => {
    expect(migrations).toContain('create table if not exists public.coordination_requests');
    expect(migrations).toContain('subject text not null');
    expect(migrations).toContain('options jsonb not null');
    expect(migrations).toContain('deadline timestamptz not null');
    expect(migrations).toContain("'organizer_override'");
    expect(migrations).toContain("'unanimity'");
    expect(migrations).toContain("'majority'");
    expect(migrations).toContain("'timeout_default'");
    expect(migrations).toContain('default_outcome text not null');
    expect(migrations).toContain("status in ('open', 'resolved', 'expired', 'cancelled')");
    expect(migrations).toContain('resolved_outcome text');
    expect(types).toContain('export interface CoordinationRequest');
    expect(types).toContain('defaultOutcome');
    expect(types).toContain('resolvedOutcome');
  });

  it('stores participant responses separately from navigation technical state', () => {
    expect(migrations).toContain('create table if not exists public.coordination_responses');
    expect(migrations).toContain('unique (request_id, user_id)');
    expect(types).toContain('export interface CoordinationResponse');
    expect(types).toContain('optionId');
    // Navigation local_status remains the technical channel.
    expect(navigationService).toContain('local_status');
    expect(service).toContain('respondToCoordinationRequest');
    // Response table must not reuse navigation member columns.
    expect(migrations).not.toMatch(
      /create table if not exists public\.coordination_responses[\s\S]*local_status/,
    );
  });

  it('keeps unanswered as absence of a row — never consent or rejection', () => {
    expect(migrations).toContain('unanswered remains absence of a row');
    expect(policy).toContain('Unanswered members are never treated as consent or rejection');
    expect(policy).toContain('export function isUnanswered');
    expect(service).toContain('silence is not stored as a vote');
  });

  it('rejects responses after closure and keeps a queryable resolved outcome', () => {
    expect(migrations).toContain("raise exception 'request already closed'");
    expect(migrations).toContain('resolved_outcome = p_option_id');
    expect(migrations).toContain('public.respond_to_coordination_request');
    expect(service).toContain('fetchCoordinationRequests');
  });

  it('allows response create and change while open (upsert)', () => {
    expect(migrations).toContain('on conflict (request_id, user_id) do update');
    expect(migrations).toContain('set option_id = excluded.option_id');
  });

  it('does not block immediate navigation start', () => {
    expect(migrations).toContain(
      'start_navigation_session is independent of coordination requests',
    );
    expect(migrations).toContain(
      'No coordination guard is added to navigation session RPCs',
    );
    // start_navigation_session body must not consult coordination_requests.
    expect(startNavMigration).not.toMatch(
      /start_navigation_session[\s\S]{0,2500}coordination_request/,
    );
    expect(client).toContain('createCoordinationRequest');
  });
});

describe('OTA-09 deadline resolution and itinerary apply contracts', () => {
  it('supports organizer override, unanimity, majority, and timeout default', () => {
    expect(migrations).toContain('public.coordination_compute_outcome');
    expect(migrations).toContain('public.override_coordination_request');
    expect(migrations).toContain('public.resolve_coordination_request_deadline');
    expect(policy).toContain("policy === 'unanimity'");
    expect(policy).toContain("policy === 'majority'");
    expect(policy).toContain("policy === 'timeout_default'");
    expect(client).toContain('overrideCoordinationRequest');
    expect(client).toContain('resolveCoordinationRequestDeadline');
  });

  it('makes deadline resolution atomic and idempotent', () => {
    expect(migrations).toContain('for update');
    expect(migrations).toContain('Repeated triggers: one authoritative closed outcome');
    expect(migrations).toContain("and status = 'open'");
    expect(migrations).toContain('Lost the race to another closer');
    expect(service).toContain('one authoritative outcome');
  });

  it('serializes itinerary operation version allocation per group', () => {
    expect(migrations).toContain('pg_advisory_xact_lock');
    expect(migrations).toContain('hashtext(p_request.group_id::text)');
  });

  it('restricts respond eligibility to subgroup scope and filters resolve tallies', () => {
    expect(migrations).toContain('public.coordination_user_eligible');
    expect(migrations).toContain('not eligible for this request');
    expect(migrations).toContain('and cr.user_id = any(v_eligible)');
  });

  it('cancels without inventing a decided outcome', () => {
    expect(migrations).toContain('resolved_outcome = null');
    expect(migrations).toContain('Cancel aborts without applying itinerary');
  });

  it('documents any-leader override for all policies', () => {
    expect(migrations).toContain(
      'Any group leader may force-close any open request (any policy)',
    );
    // Dead secondary auth block removed.
    expect(migrations).not.toMatch(
      /override_coordination_request[\s\S]{0,800}policy <> 'organizer_override'/,
    );
  });

  it('applies accepted results as versioned itinerary operations', () => {
    expect(migrations).toContain('create table if not exists public.itinerary_operations');
    expect(migrations).toContain('unique (group_id, version)');
    expect(migrations).toContain('public.coordination_apply_outcome');
    expect(migrations).toContain("'coordination_apply'");
    expect(migrations).toContain('applied_operation_id');
    expect(types).toContain('export interface ItineraryOperation');
    expect(service).toContain('fetchItineraryOperations');
    expect(client).toContain('fetchItineraryOperations');
  });

  it('does not rewrite existing history on resolution', () => {
    expect(migrations).toContain('Never rewrites destination_arrivals / visited_waypoints history');
    expect(migrations).toContain('and i.closed_at is null');
    expect(migrations).toContain('destination_missing_or_closed');
    // Apply path must not delete or update arrivals/history tables.
    const applyFn = migrations.match(
      /create or replace function public\.coordination_apply_outcome[\s\S]*?\$\$;/,
    )?.[0] ?? '';
    expect(applyFn).not.toContain('destination_arrivals');
    expect(applyFn).not.toContain('visited_waypoints');
  });

  it('publishes realtime so multi-device clients share the resolved outcome', () => {
    expect(migrations).toContain(
      'alter publication supabase_realtime add table public.coordination_requests',
    );
    expect(migrations).toContain(
      'alter publication supabase_realtime add table public.coordination_responses',
    );
    expect(migrations).toContain(
      'alter publication supabase_realtime add table public.itinerary_operations',
    );
  });
});
