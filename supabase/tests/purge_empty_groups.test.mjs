// Isolated PostgreSQL only: node this-file.mjs <PGlite dist/index.js>
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
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create publication supabase_realtime;
  `);
  await db.exec(read('migrations/20260617000000_supabase_init.sql'));
  await db.exec(`
    alter table public.memberships add column subgroup_id uuid;
    create table public.subgroups(id uuid primary key, group_id uuid, parent_subgroup_id uuid);
    create table public.token_ledger(id int primary key, group_id uuid
      constraint token_ledger_group_id_fkey references public.groups(id) on delete set null);
    create table public.promo_redemptions(id int primary key, group_id uuid
      constraint promo_redemptions_group_id_fkey references public.groups(id) on delete set null);
    insert into auth.users values ('00000000-0000-0000-0000-000000000001');
    insert into public.profiles(id,nickname) values ('00000000-0000-0000-0000-000000000001','Keep user');
    insert into public.groups(id,name,invite_code) values
      ('00000000-0000-0000-0000-000000000002','Empty','EMPTY'),
      ('00000000-0000-0000-0000-000000000003','Occupied','KEEP');
    insert into public.memberships(group_id,user_id,role) values
      ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','leader');
    insert into public.itinerary_items(group_id,title,position) select id,'History',0 from public.groups;
    insert into public.member_locations(group_id,user_id) select id,'00000000-0000-0000-0000-000000000001' from public.groups;
    insert into public.token_ledger select row_number() over ()::int,id from public.groups;
    insert into public.promo_redemptions select row_number() over ()::int,id from public.groups;
  `);
  const cleanup = read('migrations/20260920062819_silent_journey_sync_v3.sql')
    .match(/create or replace function public\.delete_empty_group_or_subgroup\(\)[\s\S]*?\$\$;/i)?.[0];
  assert(cleanup);
  await db.exec(cleanup);
  await db.exec(`create trigger trigger_delete_empty_group_or_subgroup
    after delete or update of group_id, subgroup_id on public.memberships
    for each row execute function public.delete_empty_group_or_subgroup();`);
  await db.exec(read('migrations/20260930111355_purge_empty_groups_completely.sql'));
  const counts = async () => (await db.query(`select
    (select count(*) from public.groups) as groups,
    (select count(*) from public.itinerary_items) as stops,
    (select count(*) from public.member_locations) as locations,
    (select count(*) from public.token_ledger) as ledger,
    (select count(*) from public.promo_redemptions) as redemptions,
    (select count(*) from public.profiles) as profiles,
    (select count(*) from auth.users) as users`)).rows[0];
  assert.deepEqual(await counts(), { groups: 1, stops: 1, locations: 1, ledger: 1, redemptions: 1, profiles: 1, users: 1 });
  await db.exec('delete from public.memberships');
  assert.deepEqual(await counts(), { groups: 0, stops: 0, locations: 0, ledger: 0, redemptions: 0, profiles: 1, users: 1 });
  console.log('PASS: historical empty-group purge and future last-member cleanup remove group data; occupied groups and accounts preserved');
} finally { await db.close(); }
