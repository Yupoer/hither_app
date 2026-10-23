// Local PostgreSQL only. CI runs this next to promo_redemption_concurrency.mjs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const database = process.env.HITHER_TEST_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(database).hostname), 'Test requires a local disposable PostgreSQL database');
const [leader, follower, group, token] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const suffix = randomUUID().replaceAll('-', '');
const transaction = `race-trip-${suffix}`;
const promoTransaction = `race-expired-${suffix}`;
const notification = `race-refund-${suffix}`;
const promoNotification = `race-promo-refund-${suffix}`;
const promo = `RACE-${suffix}`;
const trigger = `test_trip_barrier_${suffix}`;
const signedAt = '2026-10-01T00:00:00Z';
const running = new Set();
const gates = [];
function start(statement, name, interactive = false) {
  const child = spawn('psql', [database, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    ...(interactive ? [] : ['-c', statement])], {
    stdio: [interactive ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 30000,
    env: { ...process.env, PGAPPNAME: name,
      PGOPTIONS: '-c statement_timeout=20000 -c lock_timeout=15000 -c idle_in_transaction_session_timeout=25000' },
  });
  let output = '', error = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { error += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', status => status === 0 ? resolve(output.trim()) : reject(new Error(error || `psql exited ${status}`)));
  });
  running.add(done);
  done.finally(() => running.delete(done)).catch(() => {});
  if (interactive) child.stdin.write(statement + '\n');
  return { child, done };
}
const sql = statement => start(statement, `b3-monitor-${suffix}`).done;
const jsonLine = output => JSON.parse(output.split('\n').find(line => line.startsWith('{')));
async function until(statement, message) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await sql(statement) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(message);
}
async function gate(name, key) {
  const session = start(`begin; select pg_advisory_xact_lock(hashtextextended('${key}',0));`, name, true);
  gates.push(session);
  await until(`select exists(select 1 from pg_stat_activity where application_name='${name}' and state='idle in transaction')`, 'barrier did not acquire its lock');
  return async () => {
    session.child.stdin.end('commit;\n');
    await session.done;
  };
}
const blockedBy = (waiter, blocker) => `select exists(
  select 1 from pg_stat_activity w, pg_stat_activity b
   where w.application_name='${waiter}' and b.application_name='${blocker}'
     and b.pid = any(pg_blocking_pids(w.pid)))`;
const grant = tx => `begin; set local role service_role; set local request.jwt.claim.role='service_role';
  select public.apply_verified_trip_storekit_purchase('${leader}','${group}',
    '${tx}','${tx}','hither.small_trip_pass','Sandbox','PURCHASED',
    '${token}',now() - interval '1 hour',now() - interval '1 hour','race-jws'); commit;`;
const refund = (id, tx) => `begin; set local role service_role;
  select public.apply_trip_storekit_notification('${id}','${leader}',
    '${tx}','${tx}','hither.small_trip_pass','${token}','${signedAt}'); commit;`;
try {
  await sql(`
    insert into auth.users(id,email) values ('${leader}','${leader}@race.test'),('${follower}','${follower}@race.test');
    insert into public.profiles(id,nickname) values ('${leader}','Race leader'),('${follower}','${follower}@race.test');
    insert into public.premium_app_account_tokens(user_id,app_account_token) values ('${leader}','${token}');
    insert into public.groups(id,name,invite_code,created_by) values ('${group}','Race trip','R${suffix.slice(0, 7)}','${leader}');
    insert into public.memberships(group_id,user_id,role) values ('${group}','${leader}','leader'),('${group}','${follower}','follower');
    select public.record_storekit_notification('${notification}','REFUND',null,'Sandbox',
      '${transaction}','${transaction}','hither.small_trip_pass','${signedAt}');
    create function public.${trigger}() returns trigger language plpgsql as $$begin
      if tg_op = 'INSERT' and new.transaction_id = '${transaction}' then
        perform pg_advisory_xact_lock(hashtextextended('${transaction}',0));
      elsif tg_op = 'UPDATE' and new.transaction_id = '${promoTransaction}' and new.status = 'expired' then
        perform pg_advisory_xact_lock(hashtextextended('${promoTransaction}',0));
      end if;
      return new;
    end;$$;
    create trigger ${trigger} before insert or update on public.trip_entitlements
      for each row execute function public.${trigger}();
  `);
  const releaseGrant = await gate(`b3-gate-grant-${suffix}`, transaction);
  const purchaseName = `b3-purchase-${suffix}`, refundName = `b3-refund-${suffix}`;
  const purchase = start(grant(transaction), purchaseName).done;
  await until(blockedBy(purchaseName, `b3-gate-grant-${suffix}`), 'purchase did not reach the insert barrier');
  const pendingRefund = start(refund(notification, transaction), refundName).done;
  await until(blockedBy(refundName, purchaseName), 'refund did not overlap the blocked purchase');
  await releaseGrant();
  const [granted, applied] = (await Promise.all([purchase, pendingRefund])).map(jsonLine);
  assert.equal(granted.status, 'active');
  assert.equal(applied.outcome, 'revoked');
  assert.equal(await sql(`select status from public.trip_entitlements where transaction_id='${transaction}'`), 'refunded');
  assert.equal(jsonLine(await sql(refund(notification, transaction))).duplicate, true, 'refund retry is idempotent');
  console.log('PASS: observed overlapping purchase/refund and idempotent retry leave the pass refunded');

  assert.equal(jsonLine(await sql(grant(promoTransaction))).status, 'active');
  await sql(`
    update public.trip_entitlements set expires_at=now() - interval '1 hour' where transaction_id='${promoTransaction}';
    insert into public.promo_codes(code,plan_name,plan_code,duration_days,remaining_uses)
      values ('${promo}','Race','small_trip_pass',7,1);
    select public.record_storekit_notification('${promoNotification}','REFUND',null,'Sandbox',
      '${promoTransaction}','${promoTransaction}','hither.small_trip_pass','${signedAt}');
  `);
  const releasePromo = await gate(`b3-gate-promo-${suffix}`, promoTransaction);
  const redeemName = `b3-redeem-${suffix}`, promoRefundName = `b3-promo-refund-${suffix}`;
  const redeem = start(`begin; set local role authenticated; set local request.jwt.claim.sub='${leader}';
    select public.redeem_promo_code('${promo}','${group}'); commit;`, redeemName).done;
  await until(blockedBy(redeemName, `b3-gate-promo-${suffix}`), 'promo did not reach stale-entitlement expiry');
  const racingRefund = start(refund(promoNotification, promoTransaction), promoRefundName).done;
  await until(blockedBy(promoRefundName, redeemName), 'refund did not overlap promo expiry');
  await releasePromo();
  const [redeemed, refunded] = (await Promise.all([redeem, racingRefund])).map(jsonLine);
  assert.equal(redeemed.success, true, 'promo must complete without a deadlock victim');
  assert.equal(refunded.accepted, true, 'refund must complete without a deadlock victim');
  assert.equal(jsonLine(await sql(refund(promoNotification, promoTransaction))).duplicate, true);
  assert.equal(await sql(`select count(*) from public.trip_entitlements where group_id='${group}' and status='active'`), '1');
  assert.equal(await sql(`select count(*) from public.promo_redemptions where code='${promo}'`), '1');
  assert.equal(await sql(`select remaining_uses from public.promo_codes where code='${promo}'`), '0');
  console.log('PASS: observed overlapping promo expiry/refund both commit, retry stays idempotent, one promo pass remains');
} finally {
  for (const session of gates) if (!session.child.stdin.destroyed) session.child.stdin.end('rollback;\n');
  await Promise.allSettled([...running]);
  await sql(`
    drop trigger if exists ${trigger} on public.trip_entitlements;
    drop function if exists public.${trigger}();
    delete from public.premium_store_notifications where notification_id in ('${notification}','${promoNotification}');
    delete from public.groups where id='${group}';
    delete from auth.users where id in ('${leader}','${follower}');
    delete from public.promo_codes where code='${promo}';
  `);
}
