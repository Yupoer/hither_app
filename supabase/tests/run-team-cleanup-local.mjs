// Test-only PGlite path: node this-file.mjs /tmp/test-package/node_modules/@electric-sql/pglite/dist/index.js
// No production connection and no application dependency added.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const db = new PGlite();
try {
  await db.exec(`
    create schema auth; create schema extensions;
    create role anon; create role authenticated;
    create table auth.users(id uuid primary key, email text, is_anonymous boolean);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth, extensions to authenticated;
    create publication supabase_realtime;
  `);
  // Reuse the real initial FK and RLS definitions. Later columns used by the
  // tested path are added below; external push/telemetry services are absent.
  await db.exec(read('migrations/20260617000000_supabase_init.sql'));
  await db.exec(`
    alter table public.memberships add column subgroup_id uuid;
    alter table public.itinerary_items add column day integer;
    create table public.subgroups(id uuid primary key, group_id uuid, parent_subgroup_id uuid);
    create table public.core_notification_outbox(group_id uuid);
    create table public.navigation_arrival_events(group_id uuid);
    create table public.subgroup_invites(group_id uuid);
    create table public.token_ledger(group_id uuid);
    create table public.visited_waypoints(destination_id uuid);
    create table public.live_activity_sessions(user_id uuid, group_id uuid);
    alter table public.live_activity_sessions enable row level security;
    create policy "live_activity_sessions: select own" on public.live_activity_sessions
      for select to authenticated using (user_id = (select auth.uid()));
    create policy "live_activity_sessions: write own" on public.live_activity_sessions
      for all to authenticated using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()) and extensions.is_member(group_id));
  `);
  const cleanup = read('migrations/20260920062819_silent_journey_sync_v3.sql')
    .match(/create or replace function public\.delete_empty_group_or_subgroup\(\)[\s\S]*?\$\$;/i)?.[0];
  assert(cleanup, 'existing group cleanup trigger definition');
  await db.exec(cleanup);
  await db.exec(`create trigger trigger_delete_empty_group_or_subgroup
    after delete or update of group_id, subgroup_id on public.memberships
    for each row execute function public.delete_empty_group_or_subgroup();`);
  await db.exec(read('migrations/20260930102815_team_cleanup_and_query_indexes.sql'));
  const results = await db.exec(read('tests/team_cleanup.test.sql'));
  assert(results.some(result => result.rows.some(row => String(row.result).startsWith('PASS:'))));
  const { rows } = await db.query(`select
    (select count(*) from auth.users) as users,
    (select count(*) from public.groups) as groups,
    (select count(*) from pg_indexes where indexname in (
      'core_notification_outbox_group_id_idx', 'navigation_arrival_events_group_id_idx',
      'subgroup_invites_group_id_idx', 'token_ledger_group_id_idx', 'visited_waypoints_destination_id_idx'
    )) as indexes,
    (select count(*) from pg_policies where tablename='live_activity_sessions') as policies`);
  assert.deepEqual(rows[0], { users: 0, groups: 0, indexes: 5, policies: 2 });
  console.log('PASS: local PostgreSQL RLS, clear-all, last-member cascade, location cleanup, five indexes, existing policies preserved and fixture rollback');
} finally { await db.close(); }
