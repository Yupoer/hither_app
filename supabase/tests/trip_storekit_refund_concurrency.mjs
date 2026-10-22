// Two real PostgreSQL connections. CI: node supabase/tests/trip_storekit_refund_concurrency.mjs
// Local Supabase only; creates fixture accounts/group/notification, then removes just those fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const database = process.env.HITHER_TEST_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(database).hostname), 'Test requires a local disposable PostgreSQL database');
const [leader, follower, group, token] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const suffix = randomUUID().replaceAll('-', '');
const transaction = `race-trip-${suffix}`;
const notification = `race-refund-${suffix}`;
const signedAt = '2026-10-01T00:00:00Z';
const trigger = `test_trip_grant_delay_${suffix}`;
function sql(statement) {
  return new Promise((resolve, reject) => {
    const process = spawn('psql', [database, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    process.stdout.on('data', chunk => { output += chunk; });
    process.stderr.on('data', chunk => { error += chunk; });
    process.on('error', reject);
    process.on('close', status => status === 0 ? resolve(output.trim()) : reject(new Error(error)));
  });
}
const jsonLine = output => JSON.parse(output.split('\n').find(line => line.startsWith('{')));
try {
  await sql(`
    insert into auth.users(id,email) values ('${leader}','${leader}@race.test'),('${follower}','${follower}@race.test');
    insert into public.profiles(id,nickname) values ('${leader}','Race leader'),('${follower}','Race follower');
    insert into public.premium_app_account_tokens(user_id,app_account_token) values ('${leader}','${token}');
    insert into public.groups(id,name,invite_code,created_by) values ('${group}','Race trip','R${suffix.slice(0, 7)}','${leader}');
    insert into public.memberships(group_id,user_id,role) values ('${group}','${leader}','leader'),('${group}','${follower}','follower');
    select public.record_storekit_notification('${notification}','REFUND',null,'Sandbox',
      '${transaction}','${transaction}','hither.small_trip_pass','${signedAt}');
    create function public.${trigger}() returns trigger language plpgsql as $$begin
      if new.transaction_id = '${transaction}' then perform pg_sleep(3); end if;
      return new;
    end;$$;
    create trigger ${trigger} before insert on public.trip_entitlements
      for each row execute function public.${trigger}();
  `);
  const purchase = sql(`
    begin;
    set local role service_role;
    set local request.jwt.claim.role='service_role';
    select public.apply_verified_trip_storekit_purchase('${leader}','${group}',
      '${transaction}','${transaction}','hither.small_trip_pass','Sandbox','PURCHASED',
      '${token}',now() - interval '1 hour',now() - interval '1 hour','race-jws');
    commit;
  `);
  purchase.catch(() => {});
  // Start the refund only once the grant has passed its refund check and is
  // inside the insert, the window the race needs.
  for (let attempt = 0; ; attempt++) {
    assert(attempt < 100, 'purchase never reached the delayed insert');
    const sleeping = await sql(`select count(*) from pg_stat_activity
      where wait_event = 'PgSleep' and query like '%apply_verified_trip_storekit_purchase%${suffix}%'`);
    if (sleeping !== '0') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const refund = sql(`
    begin;
    set local role service_role;
    select public.apply_trip_storekit_notification('${notification}','${leader}',
      '${transaction}','${transaction}','hither.small_trip_pass','${token}','${signedAt}');
    commit;
  `);
  const [granted, applied] = (await Promise.all([purchase, refund])).map(jsonLine);
  assert.equal(granted.status, 'active', 'the grant that started first commits');
  assert.equal(applied.outcome, 'revoked', 'the refund waits for the grant and then revokes it');
  assert.equal(await sql(`select status from public.trip_entitlements where transaction_id='${transaction}'`), 'refunded');
  assert.equal(await sql(`select accepted from public.premium_store_notifications where notification_id='${notification}'`), 't');
  assert.equal(await sql(`select count(*) from public.trip_entitlements where group_id='${group}' and status='active'`), '0');
  console.log('PASS: a refund applied during an in-flight grant of the same transaction leaves no active trip pass');
} finally {
  await sql(`
    drop trigger if exists ${trigger} on public.trip_entitlements;
    drop function if exists public.${trigger}();
    delete from public.premium_store_notifications where notification_id='${notification}';
    delete from public.groups where id='${group}';
    delete from auth.users where id in ('${leader}','${follower}');
  `);
}
