// Run: node supabase/tests/navigation_location_regression.mjs <path-to-pglite/dist/index.js>
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

await db.exec(`
alter table groups add departure_date date, add trip_days integer;
alter table memberships add status text default 'active';
alter table itinerary_items add position integer, add day integer default 1, add meet_at timestamptz, add stay_anchor boolean default false;
alter table itinerary_items add constraint stable_slots unique(group_id,position) deferrable initially deferred;
alter table navigation_sessions alter id set default gen_random_uuid(), alter status set default 'active';
alter table navigation_sessions add started_at timestamptz default clock_timestamp(), add expires_at timestamptz default now()+interval '8 hours', add request_id uuid, add started_by uuid, add destination_name text, add destination_latitude float8, add destination_longitude float8;
create unique index one_active_session on navigation_sessions(group_id) where status='active';
create table navigation_member_states(navigation_session_id uuid,user_id uuid,local_status text,detail jsonb,arrived_at timestamptz,acknowledged_at timestamptz,updated_at timestamptz);
create function can_manage_itinerary_scope(g uuid,s uuid) returns boolean language sql as $$ select public.can_manage_itinerary_scope(g,s,auth.uid()) $$;
grant usage on schema public,auth to authenticated;
grant all on all tables in schema public to authenticated;
`);
const reorderSource = readFileSync(new URL('../migrations/20260810030100_accommodation_position_rpc_integration.sql', import.meta.url),'utf8');
await db.exec(reorderSource.slice(reorderSource.indexOf('create or replace function public.reorder_itinerary_items(')));
await db.exec(readFileSync(new URL('../migrations/20260913153757_active_navigation_arrival_order.sql', import.meta.url),'utf8'));
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const uid = n => db.query("select set_config('test.uid',$1,false)",[id(n)]);
const scalar = async sql => (await db.query(sql)).rows[0].value;
await db.query("insert into groups(id,journey_status) values($1,'paused')",[id(100)]);
for(const [n,day,pos,closed] of [[10,1,0,true],[11,1,1,false],[12,1,2,false],[13,1,3,false],[14,2,4,false]]) {
  await db.query('insert into itinerary_items(id,group_id,title,latitude,longitude,day,position,closed_at) values($1,$2,$3,25,121,$4,$5,$6)',[id(n),id(100),'Stop '+n,day,pos,closed?new Date().toISOString():null]);
}
await db.query("insert into memberships(group_id,user_id,role) values($1,$2,'leader'),($1,$3,'follower')",[id(100),id(1),id(2)]);
await db.exec('set role authenticated');
await uid(1);
const start = async (destination,request) => (await db.query('select * from start_navigation_session($1,$2,$3)',[id(100),id(destination),id(request)])).rows[0];
const third = await start(13,101);
assert.deepEqual((await db.query('select id from itinerary_items order by position')).rows.map(row=>row.id),[10,13,11,12,14].map(id));
assert.equal((await start(13,101)).id,third.id);
assert.equal((await start(13,102)).id,third.id);
const second = await start(12,103);
assert.notEqual(second.id,third.id);
assert.equal(await scalar(`select status as value from navigation_sessions where id='${third.id}'`),'cancelled');
assert.equal(await scalar(`select closed_at is null as value from itinerary_items where id='${id(13)}'`),true);
assert.deepEqual((await db.query('select id from itinerary_items order by position')).rows.map(row=>row.id),[10,12,13,11,14].map(id));
assert.equal(await scalar(`select day as value from itinerary_items where id='${id(14)}'`),2);
await db.query('select reorder_itinerary_items($1,$2)',[id(100),JSON.stringify([13,11,12].map(n=>({id:id(n),day:1})))]);
await uid(2);
await assert.rejects(start(11,104), /leader membership/);
await db.query('select set_destination_arrival($1,$2,true)',[id(12),id(2)]);
await db.query('select set_destination_arrival($1,$2,true)',[id(12),id(2)]);
assert.equal(await scalar('select count(*)::int as value from destination_arrivals'),1);
assert.equal(await scalar('select count(*)::int as value from visited_waypoints'),1);
await assert.rejects(db.query('select set_destination_arrival($1,$2,true)',[id(11),id(2)]),/future destination/);
await uid(99);
await assert.rejects(db.query('select set_destination_arrival($1,$2,true)',[id(12),id(99)]),/outside member scope/);
await uid(1);
await assert.rejects(start(10,105),/already closed/);
assert.equal(await scalar("select count(*)::int as value from navigation_sessions where status='active'"),1);

// New migration against the same live-navigation fixture: pool writes must preserve it.
await db.exec(`
reset role;
alter table itinerary_items alter id set default gen_random_uuid();
alter table itinerary_items add kind text default 'stop', add address text, add created_by uuid;
alter table itinerary_items add meet_red_minutes integer, add meet_set_by uuid, add meet_warn_pushed_at timestamptz, add meet_due_pushed_at timestamptz;
create table subgroups(id uuid primary key, group_id uuid);
create table gather_point_requests(id uuid primary key, group_id uuid, subgroup_id uuid, requester_id uuid, status text, items jsonb, reviewed_by uuid, reviewed_at timestamptz);
create table account_import_quotas(user_id uuid primary key, used_count integer default 0, updated_at timestamptz);
create table personal_premium_entitlements(user_id uuid,status text,expires_at timestamptz);
create function profile_has_lifetime_premium(uuid) returns boolean language sql as $$ select false $$;
create function personal_premium_is_live(text,timestamptz) returns boolean language sql as $$ select false $$;
create function group_has_active_premium(uuid) returns boolean language sql as $$ select false $$;
grant all on all tables in schema public to authenticated;
`);
await db.exec('create table auth.users(id uuid primary key)');
await db.query('insert into auth.users values($1),($2)',[id(1),id(2)]);
const coreSchema = readFileSync(new URL('../migrations/20260725000200_core_operation_sync.sql',import.meta.url),'utf8');
await db.exec(coreSchema.slice(0,coreSchema.indexOf('create or replace function public.apply_core_operation(')));
await db.exec(readFileSync(new URL('../migrations/20260919090000_unscheduled_destination_pool.sql',import.meta.url),'utf8'));
await db.exec('set role authenticated');
await uid(1);
const pool = (await db.query("select add_itinerary_item($1,null,'Pool',null,25,121,null) as id",[id(100)])).rows[0].id;
assert.equal(await scalar(`select day as value from itinerary_items where id='${pool}'`), null);
await assert.rejects(db.query('select apply_leader_gathering_switch($1,$2,$3,0,$4)',[id(210),id(100),id(100),pool]),/closed/);
await assert.rejects(db.query('select start_navigation_session($1,$2,$3)',[id(100),pool,id(120)]),/missing or closed/);
await assert.rejects(db.query('select set_destination_arrival($1,$2,true)',[pool,id(1)]));
await assert.rejects(db.query('select complete_gathering_stop($1,$2)',[id(100),pool]),/unscheduled/);
await db.query('select reorder_itinerary_items($1,$2)',[id(100),JSON.stringify([{id:pool,day:2}])]);
assert.equal(await scalar(`select day as value from itinerary_items where id='${pool}'`),2);
await db.query('select reorder_itinerary_items($1,$2)',[id(100),JSON.stringify([{id:pool,day:null}])]);
assert.equal(await scalar(`select day as value from itinerary_items where id='${pool}'`),null);
await assert.rejects(db.query('select reorder_itinerary_items($1,$2)',[id(100),JSON.stringify([{id:pool,day:2},{id:id(12),day:null}])]),/end navigation/);
assert.equal(await scalar(`select day as value from itinerary_items where id='${pool}'`),null); // batch rolled back
await assert.rejects(db.query("select add_itinerary_item($1,null,'Stay',null,25,121,null,'accommodation')",[id(100)]),/accommodation_scheduled/);
await db.query('select import_itinerary_batch($1,null,null,$2)',[id(100),JSON.stringify([{title:'Imported',latitude:25,longitude:121}])]);
assert.equal(await scalar("select day as value from itinerary_items where title='Imported'"),null);
await uid(2);
await assert.rejects(db.query('select reorder_itinerary_items($1,$2)',[id(100),JSON.stringify([{id:pool,day:1}])]),/permission/);
await assert.rejects(db.query("select add_itinerary_item($1,null,'Denied',null,25,121,null)",[id(100)]),/permission/);
await uid(1);
await db.query("insert into gather_point_requests(id,group_id,status,items) values($1,$2,'pending',$3)",[id(200),id(100),JSON.stringify([{title:'Approved',latitude:25,longitude:121,day:1}])]);
await db.query('select resolve_gather_point_request($1,true)',[id(200)]);
assert.equal(await scalar("select day as value from itinerary_items where title='Approved'"),null);
assert.equal(await scalar("select count(*)::int as value from navigation_sessions where status='active'"),1);
console.log('PASS: pool add/import/approval, schedule/unschedule, active-navigation guard, atomic rollback, authorization');
await db.close();
console.log('PASS: third/second promotion, stable day/history/order, retry, switch, arrival/history idempotency, authorization, rollback');
