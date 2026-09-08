// Run: node supabase/tests/journey_arrival_regression.mjs <path-to-pglite/dist/index.js>
// Test runtime: @electric-sql/pglite@0.5.8 (install in a temporary directory).
// Isolated PostgreSQL fixture: no network, project secrets, or production writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema auth; create schema extensions;
create function auth.uid() returns uuid language sql as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table notification_preferences(user_id uuid primary key);
create table live_activity_sessions(user_id uuid);
create table device_live_activity_tokens(user_id uuid);
create table groups(id uuid primary key, journey_status text, active_destination_id uuid, journey_started_at timestamptz);
create table memberships(group_id uuid, user_id uuid, role text, subgroup_id uuid, primary key(group_id,user_id));
create table itinerary_items(id uuid primary key, group_id uuid, subgroup_id uuid, title text, latitude float8, longitude float8, closed_at timestamptz);
create table navigation_sessions(id uuid primary key, group_id uuid, destination_id uuid, status text, ended_at timestamptz, version integer default 1, updated_at timestamptz);
create table destination_arrivals(id uuid primary key default gen_random_uuid(), group_id uuid, destination_id uuid, user_id uuid, source text, marked_by uuid, arrived_at timestamptz default now(), unique(destination_id,user_id));
create table visited_waypoints(user_id uuid, group_id uuid, destination_id uuid, arrival_id uuid, name text, latitude float8, longitude float8, arrived_at timestamptz default now());
create unique index visited_once on visited_waypoints(group_id,destination_id,user_id) where destination_id is not null and group_id is not null;
create table push_events(payload jsonb);
create function extensions.notify_push(payload jsonb) returns void language sql as $$ insert into public.push_events values(payload) $$;
create function extensions.is_member(g uuid) returns boolean language sql as $$ select exists(select 1 from public.memberships where group_id=g and user_id=auth.uid()) $$;
create function public.can_manage_itinerary_scope(g uuid,s uuid,u uuid) returns boolean language sql as $$ select exists(select 1 from public.memberships where group_id=g and user_id=u and role='leader' and subgroup_id is not distinct from s) $$;
`);
await db.exec(readFileSync(new URL('../migrations/20260908082124_journey_arrival_notifications.sql', import.meta.url), 'utf8'));
await db.exec('create trigger journey_change after update of journey_status on groups for each row execute function public.on_journey_change()');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const uid = async n => db.query("select set_config('test.uid', $1, false)", [id(n)]);
const scalar = async sql => (await db.query(sql)).rows[0].value;
async function seed(group, users) {
  await db.query('insert into groups values($1, $2, $3, now())', [id(group), 'going', id(group + 1)]);
  await db.query('insert into itinerary_items(id,group_id,title,latitude,longitude) values($1,$2,$3,25,121)', [id(group + 1),id(group),'Stop']);
  await db.query("insert into navigation_sessions(id,group_id,destination_id,status) values($1,$2,$3,'active')",[id(group+2),id(group),id(group+1)]);
  for (const [index,user] of users.entries()) await db.query('insert into memberships values($1,$2,$3,null)', [id(group),id(user),index ? 'follower' : 'leader']);
}
async function arrive(group,user) {
  await uid(user);
  await db.query("select record_destination_arrival($1,$2,$3,'automatic',$3)",[id(group),id(group+1),id(user)]);
}
await seed(100,[1]); await arrive(100,1);
assert.equal(await scalar(`select closed_at is not null as value from itinerary_items where id='${id(101)}'`),true);
assert.equal(await scalar('select count(*)::int as value from visited_waypoints'),1);
const pushes = await scalar('select count(*)::int as value from push_events');
await arrive(100,1);
assert.equal(await scalar('select count(*)::int as value from visited_waypoints'),1);
assert.equal(await scalar('select count(*)::int as value from push_events'),pushes);
await seed(200,[2,3]); await arrive(200,2);
assert.equal(await scalar(`select closed_at is null as value from itinerary_items where id='${id(201)}'`),true);
await uid(3);
await assert.rejects(db.query('select complete_gathering_stop($1,$2)',[id(200),id(201)]), /scope leader/);
await arrive(200,3);
assert.equal(await scalar(`select closed_at is not null as value from itinerary_items where id='${id(201)}'`),true);
assert.equal(await scalar(`select count(*)::int as value from visited_waypoints where group_id='${id(200)}'`),2);
await seed(300,[4,5]); await arrive(300,4); await uid(4);
await db.query('select complete_gathering_stop($1,$2)',[id(300),id(301)]);
assert.equal(await scalar(`select count(*)::int as value from visited_waypoints where group_id='${id(300)}'`),2);
await arrive(300,5);
assert.equal(await scalar(`select count(*)::int as value from visited_waypoints where group_id='${id(300)}'`),2);
assert.equal(await scalar("select count(*)::int as value from push_events where payload->>'status'='paused'"),0);
await seed(400,[6,7]);
await db.query('update memberships set subgroup_id=$1 where user_id=$2',[id(999),id(7)]);
await arrive(400,6);
assert.equal(await scalar(`select count(*)::int as value from visited_waypoints where group_id='${id(400)}'`),1);
await uid(99);
await assert.rejects(db.query('select complete_gathering_stop($1,$2)',[id(400),id(401)]),/scope leader/);
await db.query('insert into notification_preferences(user_id) values($1)',[id(1)]);
assert.equal(await scalar('select arrival as value from notification_preferences'),true);
await assert.rejects(db.exec("insert into live_activity_sessions(accent_hex) values('green')"), /check constraint/);
assert.equal(await scalar("select has_function_privilege('authenticated','record_destination_arrival(uuid,uuid,uuid,text,uuid)','EXECUTE') as value"),false);
await seed(600,[8]);
await db.exec(`create function reject_test_close() returns trigger language plpgsql as $$ begin
  if new.closed_at is not null then raise exception 'test write failure'; end if; return new; end; $$;
  create trigger reject_close before update on itinerary_items for each row execute function reject_test_close();`);
await assert.rejects(arrive(600,8), /test write failure/);
assert.equal(await scalar(`select count(*)::int as value from destination_arrivals where group_id='${id(600)}'`),0);
assert.equal(await scalar(`select count(*)::int as value from visited_waypoints where group_id='${id(600)}'`),0);
await db.exec('drop trigger reject_close on itinerary_items');
await arrive(600,8);
assert.equal(await scalar(`select closed_at is not null as value from itinerary_items where id='${id(601)}'`),true);
await db.close();
console.log('PASS: solo, final follower, incomplete follower denied, leader override, scoped history, idempotency, preference default and permissions');
