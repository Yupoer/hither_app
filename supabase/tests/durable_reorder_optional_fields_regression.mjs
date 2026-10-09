// Isolated PostgreSQL execution of production v3/reorder functions and the
// same assertions used by CI's pgTAP test. No project credentials or writes.
// node supabase/tests/durable_reorder_optional_fields_regression.mjs <pglite/dist/index.js>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
process.on('uncaughtException', error => {
  console.error(error.message, error.code, error.where ?? '');
  process.exit(1);
});
const migration = name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
function functionDefinition(source, name) {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} definition missing`);
  return source.slice(start, source.indexOf('\n$$;', start) + 4);
}
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema extensions;
create table auth.users(id uuid primary key, email text, is_anonymous boolean);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table groups(id uuid primary key, name text, invite_code text, created_by uuid, journey_status text,
 active_destination_id uuid, journey_started_at timestamptz);
create table memberships(group_id uuid,user_id uuid,role text,subgroup_id uuid,primary key(group_id,user_id));
create table itinerary_items(id uuid primary key,group_id uuid,subgroup_id uuid,title text,address text,latitude float8,
 longitude float8,position integer,day integer,kind text,meet_at timestamptz,stay_anchor boolean default false,
 closed_at timestamptz,closed_by_session_id uuid,meet_red_minutes integer,emoji text,marker_color text,provider_place_id text,
 unique(group_id,position) deferrable initially deferred);
create table core_entity_versions(group_id uuid,entity_type text,entity_id text,entity_version integer,state jsonb,
 updated_at timestamptz,primary key(group_id,entity_type,entity_id));
create table core_operations(operation_id uuid primary key,group_id uuid,actor_id uuid,entity_type text,entity_id text,
 base_entity_version integer,operation_type text,payload jsonb,result_entity_version integer,status text,
 created_at timestamptz,client_sequence bigint,dependency_ids uuid[],result_state jsonb,result_effects jsonb,
 device_id text,scope_key text,session_id uuid,occurred_at timestamptz,received_at timestamptz,
 terminal_reason text,rebase_count integer default 0,resolved_at timestamptz);
create table navigation_sessions(id uuid primary key,status text,group_id uuid,scope_key text,scope_subgroup_id uuid,
 destination_id uuid,started_at timestamptz);
create table navigation_session_history(id uuid);
create table gather_point_requests(id uuid);
create table destination_arrivals(id uuid);
create function public.can_manage_itinerary_scope(g uuid,s uuid,u uuid) returns boolean language sql as $$
 select exists(select 1 from public.memberships where group_id=g and user_id=u and role='leader' and subgroup_id is not distinct from s) $$;
`);
await db.exec(functionDefinition(migration('20260919100000_durable_core_operation_outbox.sql'), 'core_itinerary_state'));
await db.exec(functionDefinition(migration('20260920062819_silent_journey_sync_v3.sql'), 'core_v3_conflict'));
await db.exec(functionDefinition(migration('20260920062819_silent_journey_sync_v3.sql'), 'core_v3_operation_resource_key'));
await db.exec(functionDefinition(migration('20260919090000_unscheduled_destination_pool.sql'), 'reorder_itinerary_items'));
await db.exec(migration('20260922000100_idempotent_navigation_end.sql'));
await db.exec(`revoke all on function public.apply_core_operation_v3(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamptz) from public,anon;
 grant execute on function public.apply_core_operation_v3(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamptz) to authenticated,service_role;`);
const metadata = async () => (await db.query(`select proowner::regrole::text as owner,proacl::text as acl,prosecdef,proconfig
 from pg_proc where oid='public.apply_core_operation_v3(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamptz)'::regprocedure`)).rows;
const before = await metadata();
const fix = migration('20261009132855_preserve_durable_reorder_optional_fields.sql');
await db.exec(fix);
assert.deepEqual(await metadata(), before, 'migration changed ownership, ACL or security configuration');
await db.exec(fix);
assert.deepEqual(await metadata(), before, 'idempotent migration changed security configuration');

// Run the actual SQL regression assertions, stripping only pgTAP's wrapper
// and fixture role/transaction directives unavailable in this minimal schema.
const regression = readFileSync(new URL('./durable_reorder_optional_fields.test.sql', import.meta.url), 'utf8');
const fixture = regression.slice(regression.indexOf('insert into auth.users'), regression.indexOf('set local role authenticated;'));
await db.exec(fixture);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", ['b2981111-1111-4111-8111-111111111111']);
const start = regression.indexOf('do $assertions$');
const assertions = regression.slice(start, regression.indexOf('$assertions$;', start) + '$assertions$;'.length);
await db.exec(assertions);
const activitySource = migration('20260713190000_production_push_live_activity.sql');
const activityStart = activitySource.indexOf('create table if not exists public.live_activity_sessions (');
await db.exec(activitySource.slice(activityStart, activitySource.indexOf('\n);', activityStart) + 4));
await db.exec(migration('20261009130347_bicycle_live_activity_mode.sql'));
const bicycleRegression = readFileSync(new URL('./live_activity_bicycle_mode.test.sql', import.meta.url), 'utf8');
const bikeFixtureStart = bicycleRegression.indexOf('create temporary table live_activity_mode_test');
await db.exec(bicycleRegression.slice(bikeFixtureStart, bicycleRegression.indexOf('select lives_ok', bikeFixtureStart)));
const bikeAssertionsStart = bicycleRegression.indexOf('do $bicycle_assertions$');
await db.exec(bicycleRegression.slice(bikeAssertionsStart,
  bicycleRegression.indexOf('$bicycle_assertions$;', bikeAssertionsStart) + '$bicycle_assertions$;'.length));
console.log('PASS durable reorder omitted-field preservation, explicit null clears, UUID replay, migration idempotence and security metadata; production bicycle constraint accepts all supported modes and rejects unknown modes');
await db.close();
