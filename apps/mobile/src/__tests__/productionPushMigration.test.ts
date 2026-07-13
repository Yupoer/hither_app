import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(
    __dirname,
    '../../../../supabase/migrations/20260713190000_production_push_live_activity.sql',
  ),
  'utf8',
);
const vaultConfigMigration = readFileSync(
  join(
    __dirname,
    '../../../../supabase/migrations/20260713210000_push_webhook_vault_config.sql',
  ),
  'utf8',
);
const triggerHardeningMigration = readFileSync(
  join(
    __dirname,
    '../../../../supabase/migrations/20260713220000_harden_push_trigger_functions.sql',
  ),
  'utf8',
);

describe('production push and live activity migration', () => {
  it('persists one authoritative journey destination', () => {
    expect(migration).toContain('active_destination_id uuid');
    expect(migration).toContain('journey_started_at timestamptz');
    expect(migration).toContain('create or replace function public.set_journey_target');
  });

  it('allows the app custom quick command in the database constraint', () => {
    expect(migration).toMatch(/commands_type_check[\s\S]*'custom'/);
  });

  it('creates owner-only live activity sessions with RLS', () => {
    expect(migration).toContain('create table public.live_activity_sessions');
    expect(migration).toContain('alter table public.live_activity_sessions enable row level security');
    expect(migration).toMatch(/live_activity_sessions: select own[\s\S]*auth\.uid\(\)/);
    expect(migration).toMatch(/live_activity_sessions: write own[\s\S]*auth\.uid\(\)/);
  });

  it('uses the approved inclusive 30 metre arrival boundary', () => {
    expect(migration).toContain('v_distance_m <= 30');
    expect(migration).toContain("status = 'arrived'");
  });

  it('keeps arrival sticky until the target changes', () => {
    const locationTrigger = migration.match(
      /create or replace function public\.on_member_location_arrival[\s\S]*?\$\$;/,
    )?.[0];
    expect(locationTrigger).toContain("and m.status <> 'arrived'");

    const journeyRpc = migration.match(
      /create or replace function public\.set_journey_target[\s\S]*?\$\$;/,
    )?.[0];
    expect(journeyRpc).toContain("where status = 'arrived'");
  });

  it('reads a custom webhook secret from Vault without a database service-role setting', () => {
    expect(migration).toContain("name = 'push_webhook_secret'");
    expect(migration).toContain("'x-hither-webhook-secret'");
    expect(migration).not.toContain("current_setting('app.settings.service_role'");
  });

  it('loads both webhook values from Vault on hosted Supabase', () => {
    expect(vaultConfigMigration).toContain("ds.name = 'push_edge_url'");
    expect(vaultConfigMigration).toContain("ds.name = 'push_webhook_secret'");
    expect(vaultConfigMigration).not.toContain(
      "current_setting('app.settings.edge_url'",
    );
  });

  it('does not expose trigger-only functions as client RPCs', () => {
    for (const functionName of [
      'on_member_location_arrival',
      'on_live_activity_progress',
      'on_membership_presence_change',
    ]) {
      expect(triggerHardeningMigration).toContain(
        `revoke execute on function public.${functionName}() from public, anon, authenticated`,
      );
    }
  });
});
