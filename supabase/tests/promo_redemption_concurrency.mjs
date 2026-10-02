// Two real PostgreSQL connections. CI: node supabase/tests/promo_redemption_concurrency.mjs
// Local Supabase only; creates fixture accounts/code, then removes just those fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const database = process.env.HITHER_TEST_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(database).hostname), 'Test requires a local disposable PostgreSQL database');
const users = [randomUUID(), randomUUID()];
const suffix = randomUUID().replaceAll('-', '');
const code = `RACE-${suffix}`;
const trigger = `test_promo_delay_${suffix}`;
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
try {
  await sql(`
    insert into auth.users(id,email) values ${users.map(uid => `('${uid}','${uid}@race.test')`).join(',')};
    insert into public.profiles(id,nickname) values ${users.map(uid => `('${uid}','Race fixture')`).join(',')};
    insert into public.promo_codes(code,plan_name,plan_code,remaining_uses) values ('${code}','Race','lifetime_premium',1);
    create function public.${trigger}() returns trigger language plpgsql as $$begin
      if new.user_id in ('${users[0]}'::uuid,'${users[1]}'::uuid) then perform pg_sleep(0.5); end if;
      return new;
    end;$$;
    create trigger ${trigger} before insert on public.personal_premium_entitlements
      for each row execute function public.${trigger}();
  `);
  const results = await Promise.all(users.map(uid => sql(`
    begin;
    set local role authenticated;
    set local request.jwt.claim.sub='${uid}';
    select public.redeem_promo_code('${code}',null::uuid);
    commit;
  `)));
  const redemptions = results.map(result => JSON.parse(result.split('\n').find(line => line.startsWith('{'))));
  assert.equal(redemptions.filter(result => result.success === true).length, 1);
  assert.equal(redemptions.filter(result => result.code === 'already_used').length, 1);
  assert.equal(await sql(`select remaining_uses from public.promo_codes where code='${code}'`), '0');
  assert.equal(await sql(`select count(*) from public.promo_redemptions where code='${code}'`), '1');
  assert.equal(await sql(`select count(*) from public.personal_premium_entitlements where user_id in ('${users[0]}','${users[1]}')`), '1');
  console.log('PASS: two simultaneous redeemers produce one success, one already_used, one entitlement/redemption, zero remaining uses');
} finally {
  await sql(`
    drop trigger if exists ${trigger} on public.personal_premium_entitlements;
    drop function if exists public.${trigger}();
    delete from auth.users where id in ('${users[0]}','${users[1]}');
    delete from public.promo_codes where code='${code}';
  `);
}
