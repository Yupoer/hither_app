// node supabase/tests/installation_capabilities_regression.mjs <pglite/dist/index.js>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('session_id',current_setting('test.sid',true)) $$;
create table public.push_tokens(user_id uuid,token text,primary key(user_id,token));
create table public.device_live_activity_tokens(user_id uuid, device_id text,push_to_start_token text,primary key(user_id,device_id));
create table public.live_activity_sessions(user_id uuid,group_id uuid,activity_id text,push_token text,primary key(user_id,group_id));
`);
await db.exec(readFileSync(new URL('../migrations/20261002061707_revoke_installation_capabilities.sql', import.meta.url), 'utf8'));
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const sid = '33333333-3333-4333-8333-333333333333';
await db.exec(`insert into auth.users values('${a}'),('${b}');
insert into push_tokens(user_id,token,device_id) values('${a}','this-device','device-a'),('${a}','other-device','device-b'),('${b}','other-account','device-a'),('${a}','legacy-push',null);
insert into device_live_activity_tokens values('${a}','device-a','start-a'),('${a}','device-b','start-b'),('${b}','device-a','start-other-account');
insert into live_activity_sessions(user_id,group_id,activity_id,push_token,device_id) values
('${a}','44444444-4444-4444-8444-444444444444','activity-a','activity-token-a','device-a'),
('${a}','55555555-5555-4555-8555-555555555555','activity-b','activity-token-b','device-b'),
('${a}','66666666-6666-4666-8666-666666666666','legacy-activity','legacy-activity-token',null);
set test.uid='${a}'; set test.sid='${sid}';`);
await db.exec(`select revoke_installation_capabilities('device-a','legacy-push',array['legacy-activity']);
select revoke_installation_capabilities('device-a','legacy-push',array['legacy-activity']);`);
assert.deepEqual((await db.query('select token from push_tokens order by token')).rows.map(r => r.token), ['other-account','other-device']);
assert.deepEqual((await db.query('select push_to_start_token from device_live_activity_tokens order by push_to_start_token')).rows.map(r => r.push_to_start_token), ['start-b','start-other-account']);
assert.deepEqual((await db.query('select activity_id from live_activity_sessions')).rows.map(r => r.activity_id), ['activity-b']);
await assert.rejects(db.exec(`insert into push_tokens values('${a}','late-registration','device-a')`), /revoked/);
await assert.rejects(db.exec(`insert into device_live_activity_tokens values('${a}','device-a','late-start')`), /revoked/);
await assert.rejects(db.exec(`insert into live_activity_sessions values('${a}','77777777-7777-4777-8777-777777777777','late-activity','late-token','device-a')`), /revoked/);
await assert.rejects(db.exec(`insert into push_tokens values('${b}','foreign-account-write','device-a')`), /binding/);
await assert.rejects(db.exec(`insert into push_tokens values('${a}','missing-device',null)`), /binding/);
await db.exec("set test.sid='88888888-8888-4888-8888-888888888888'");
await db.exec(`insert into push_tokens values('${a}','fresh-session','device-a')`);
assert.equal((await db.query("select count(*)::int n from push_tokens where token='fresh-session'")).rows[0].n, 1);
await db.exec("set test.uid=''; set test.sid=''");
await assert.rejects(db.exec("select revoke_installation_capabilities('device-a')"), /Authenticated/);
assert.equal((await db.query("select has_function_privilege('anon','public.revoke_installation_capabilities(text,text,text[])','execute') allowed")).rows[0].allowed, false);
await db.close();
console.log('installation capability SQL regression passed');
