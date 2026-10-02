// Isolated PostgreSQL fallback when Docker is unavailable. Runtime supplied by caller.
// SQL functions/triggers/RLS execute unchanged; only Supabase infrastructure and
// pgTAP output are shimmed. This single-session engine does not prove races.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const runtime = resolve(process.argv[2]);
const { PGlite } = await import(pathToFileURL(runtime).href);
const { pgcrypto } = await import(pathToFileURL(resolve(runtime, '../contrib/pgcrypto.js')).href);
const db = new PGlite({ extensions: { pgcrypto } });
const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create schema storage;
    create schema vault; create schema cron; create schema net;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key, email text, is_anonymous boolean default false,
      created_at timestamptz default now(), raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims', true), ''),'{}')::jsonb$$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now());
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
    create table vault.decrypted_secrets(name text, decrypted_secret text);
    create table cron.job(jobid bigint, jobname text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
    create function cron.unschedule(bigint) returns boolean language sql as $$select true$$;
    create publication supabase_realtime;
    grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to authenticated, service_role;
    alter default privileges in schema storage grant all on tables to authenticated, service_role;
    grant all on storage.objects to authenticated, service_role;
  `);
  let applied = 0;
  for (const name of readdirSync(new URL('migrations/', root)).filter(name => name.endsWith('.sql')).sort()) {
    // PGlite lacks external HTTP and background scheduler workers.
    const sql = read('migrations/' + name).replace(/create extension if not exists (pg_net|pg_cron)[^;]*;/gi, '');
    try { await db.exec(sql); applied++; }
    catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
  }
  console.log(`PASS: applied ${applied} real migrations in isolated PostgreSQL`);
  // Assertion shims throw on failure; no production function or policy is replaced.
  await db.exec(`
    create function extensions.plan(integer) returns text language sql as $$select '1..'||$1$$;
    create function extensions.pass(text) returns text language sql as $$select 'ok - '||$1$$;
    create function extensions.finish() returns setof text language sql as $$select 'finished'::text$$;
    create function extensions.ok(boolean,text) returns text language plpgsql as $$begin
      assert coalesce($1,false), $2; return 'ok - '||$2; end$$;
    create function extensions.is(anycompatible,anycompatible,text) returns text language plpgsql as $$begin
      assert $1 is not distinct from $2, $3 || ': actual=' || coalesce($1::text,'NULL') || ' expected=' || coalesce($2::text,'NULL');
      return 'ok - '||$3; end$$;
    create function extensions.isnt(anycompatible,anycompatible,text) returns text language plpgsql as $$begin
      assert $1 is distinct from $2, $3; return 'ok - '||$3; end$$;
    create function extensions.cmp_ok(anycompatible,text,anycompatible,text) returns text language plpgsql as $$
    declare result boolean; begin
      assert $2=any(array['=','<>','>','>=','<','<=']), 'unsupported test operator';
      execute format('select $1 %s $2',$2) into result using $1,$3;
      assert coalesce(result,false),$4; return 'ok - '||$4; end$$;
    create function extensions.throws_ok(text,text,text,text) returns text language plpgsql as $$
    declare caught boolean:=false; begin
      begin execute $1; exception when others or assert_failure then
        caught:=true; assert $2 is null or sqlstate=$2, $4||': actual SQLSTATE='||sqlstate;
        assert $3 is null or sqlerrm=$3, $4||': actual error='||sqlerrm;
      end; assert caught,$4||': no exception'; return 'ok - '||$4; end$$;
    create function extensions.lives_ok(text,text) returns text language plpgsql as $$begin
      execute $1; return 'ok - '||$2; end$$;
    create function extensions.results_eq(text,text,text) returns text language plpgsql as $$
    declare actual text[]; expected text[]; begin
      execute 'select array_agg(q::text) from ('||$1||') q' into actual;
      execute 'select array_agg(q::text) from ('||$2||') q' into expected;
      assert actual is not distinct from expected, $3; return 'ok - '||$3; end$$;
  `);
  const tests = process.argv.slice(3);
  for (const name of tests.length ? tests : ['security_group_command_import_arrival.test.sql', 'feedback_limits.test.sql']) {
    try {
      const output = await db.exec(read('tests/' + name).replace(/create extension if not exists pgtap[^;]*;/gi, ''));
      assert(output.length > 0);
      console.log(`PASS: ${name} (real SQL assertions, rollback-only fixtures)`);
    } catch (error) { throw new Error(`Test ${name}: ${error.message}`, { cause: error }); }
  }
} finally { await db.close(); }
