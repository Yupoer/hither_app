import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkMigrations,
  reconstructPatchedFunctions,
  renderCanonicalMigration,
} from './function-source-of-truth.mjs';

const create = (body) => `create or replace function public.f(p_id uuid, p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$${body}$$;
revoke all on function public.f(uuid, timestamptz) from public, anon;
grant execute on function public.f(uuid, timestamptz) to authenticated;
`;

const patch = (from, to, message = 'f anchor missing') => `do $m$
declare definition text; anchor text := ${from};
begin
  definition := replace(pg_get_functiondef('public.f(uuid,timestamp with time zone)'::regprocedure), E'\\r\\n', E'\\n');
  if strpos(definition, anchor) = 0 then raise exception '${message}'; end if;
  execute replace(definition, anchor, ${to});
end;
$m$;
`;

const sources = (...sqls) => sqls.map((sql, i) => ({ name: `2026010100000${i}_m.sql`, sql }));

test('replays patches made after the last full definition and ignores superseded ones', () => {
  const { functions } = reconstructPatchedFunctions(sources(
    create('\nbegin return 1; end;\n'),
    patch("'return 1'", "'return 2'"),
    create('\nbegin return 10; end;\n'),
    patch("'return 10'", "$r$return 10 + 1$r$"),
    patch(`E'10 + 1; end;\\n'`, "'10 + 2; end;\n'"),
  ));
  assert.equal(functions.length, 1);
  assert.equal(functions[0].body, '\nbegin return 10 + 2; end;\n');
  assert.equal(functions[0].createdIn, '20260101000002_m.sql');
  assert.deepEqual(functions[0].patchedBy, ['20260101000003_m.sql', '20260101000004_m.sql']);
});

test('fails with the migration own message when an anchor is missing', () => {
  assert.throws(
    () => reconstructPatchedFunctions(sources(create('\nbegin return 1; end;\n'), patch("'return 7'", "'x'", 'v3 anchor gone'))),
    /20260101000001_m\.sql: raise exception 'v3 anchor gone'/,
  );
});

test('fails when a patch rewrites the function header instead of the body', () => {
  assert.throws(
    () => reconstructPatchedFunctions(sources(create('\nbegin return 1; end;\n'), patch("'security definer'", "'security invoker'"))),
    /changed the header of public\.f/,
  );
});

test('an early return leaves the definition as it was', () => {
  const skip = `do $m$
declare definition text; n integer;
begin
  definition := pg_get_functiondef('public.f(uuid,timestamptz)'::regprocedure);
  n := (length(definition) - length(replace(definition, 'return 1', ''))) / length('return 1');
  if n = 1 and n <> 0 then return; end if;
  execute replace(definition, 'return 1', 'return 3');
end;
$m$;`;
  const { functions, trace } = reconstructPatchedFunctions(sources(create('\nbegin return 1; end;\n'), skip));
  assert.deepEqual(functions, []);
  assert.ok(trace.includes('20260101000001_m.sql: returned early'));
});

test('the canonical migration must match the replay and later migrations may not patch catalog text', () => {
  const history = sources(create('\nbegin return 1; end;\n'), patch("'return 1'", "'return 2'"));
  const canonical = '20260101000009_canonical.sql';
  const rendered = renderCanonicalMigration(reconstructPatchedFunctions(history).functions);
  assert.match(rendered, /as \$function\$\nbegin return 2; end;\n\$function\$;/);
  assert.match(rendered, /grant execute on function public\.f\(uuid, timestamptz\) to authenticated;/);

  assert.deepEqual(checkMigrations([...history, { name: canonical, sql: rendered }], canonical), []);
  assert.match(
    checkMigrations([...history, { name: canonical, sql: rendered.replace('return 2', 'return 5') }], canonical)[0],
    /differs from the replay/,
  );
  const later = { name: '20260101000010_later.sql', sql: patch("'return 2'", "'return 3'") };
  assert.match(
    checkMigrations([...history, { name: canonical, sql: rendered }, later], canonical)[0],
    /20260101000010_later\.sql: redefines a function from pg_get_functiondef/,
  );
  const fullRedefinition = { name: '20260101000010_later.sql', sql: create('\nbegin return 3; end;\n') };
  assert.deepEqual(checkMigrations([...history, { name: canonical, sql: rendered }, fullRedefinition], canonical), []);
});
