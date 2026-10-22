/**
 * Rebuilds the live body of every function that migrations patched in place
 * with pg_get_functiondef() + replace(), by replaying those DO blocks over the
 * function's last full definition. The replay runs the migrations' own
 * statements (assignments, replace(), strpos/position anchor checks, raise,
 * early return, execute) so every anchor assertion fails here exactly as it
 * would have failed in Postgres.
 *
 *   node supabase/scripts/function-source-of-truth.mjs --write   regenerate the canonical migration
 *   node supabase/scripts/function-source-of-truth.mjs --check   fail on drift or a new catalog patch
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CANONICAL_MIGRATION = '20261022200000_canonical_patched_function_sources.sql';
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const BODY_TAG = '$function$';

export function normalizeSource(text) {
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

export function readMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: normalizeSource(readFileSync(join(dir, name), 'utf8')) }));
}

const MULTI_CHAR_OPS = ['::', ':=', '||', '<>', '!=', '<=', '>=', '=>'];

export function lex(src) {
  const tokens = [];
  let i = 0;
  const push = (type, value, start, end) => tokens.push({ type, value, start, end });
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (src.startsWith('--', i)) {
      const n = src.indexOf('\n', i);
      i = n < 0 ? src.length : n;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const n = src.indexOf('*/', i + 2);
      if (n < 0) throw new Error('unterminated block comment');
      i = n + 2;
      continue;
    }
    const start = i;
    if (c === '$') {
      const tag = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;
      tag.lastIndex = i;
      const m = tag.exec(src);
      if (m) {
        const close = src.indexOf(m[0], i + m[0].length);
        if (close < 0) throw new Error(`unterminated ${m[0]} string`);
        push('str', src.slice(i + m[0].length, close), start, close + m[0].length);
        i = close + m[0].length;
        continue;
      }
    }
    if ((c === 'E' || c === 'e') && src[i + 1] === "'") {
      let value = '';
      i += 2;
      for (;;) {
        if (i >= src.length) throw new Error('unterminated E string');
        const ch = src[i];
        if (ch === '\\') {
          const esc = src[i + 1];
          value += { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[esc] ?? esc;
          i += 2;
        } else if (ch === "'" && src[i + 1] === "'") { value += "'"; i += 2; }
        else if (ch === "'") { i += 1; break; }
        else { value += ch; i += 1; }
      }
      push('str', value, start, i);
      continue;
    }
    if (c === "'") {
      let value = '';
      i += 1;
      for (;;) {
        if (i >= src.length) throw new Error('unterminated string');
        if (src[i] === "'" && src[i + 1] === "'") { value += "'"; i += 2; }
        else if (src[i] === "'") { i += 1; break; }
        else { value += src[i]; i += 1; }
      }
      push('str', value, start, i);
      continue;
    }
    if (c === '"') {
      const n = src.indexOf('"', i + 1);
      if (n === -1) throw new Error(`unterminated quoted identifier at ${start}`);
      push('ident', src.slice(i + 1, n), start, n + 1);
      i = n + 1;
      continue;
    }
    const word = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/y;
    word.lastIndex = i;
    const w = word.exec(src);
    if (w) { push('ident', w[0].toLowerCase(), start, i + w[0].length); i += w[0].length; continue; }
    const num = /[0-9]+(?:\.[0-9]+)?/y;
    num.lastIndex = i;
    const n = num.exec(src);
    if (n) { push('num', Number(n[0]), start, i + n[0].length); i += n[0].length; continue; }
    const op = MULTI_CHAR_OPS.find((o) => src.startsWith(o, i)) ?? c;
    push('op', op, start, i + op.length);
    i += op.length;
  }
  return tokens;
}

function splitStatements(sql) {
  const statements = [];
  let current = [];
  for (const token of lex(sql)) {
    if (token.type === 'op' && token.value === ';') {
      if (current.length) statements.push({ tokens: current, text: sql.slice(current[0].start, token.start) });
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length) statements.push({ tokens: current, text: sql.slice(current[0].start) });
  return statements;
}

const TYPE_ALIASES = new Map([
  ['timestamptz', 'timestamp with time zone'],
  ['timestamp', 'timestamp without time zone'],
  ['int', 'integer'], ['int4', 'integer'], ['int8', 'bigint'], ['int2', 'smallint'],
  ['bool', 'boolean'], ['float8', 'double precision'], ['varchar', 'character varying'],
]);
const TYPE_LEAD_WORDS = new Set(['double', 'timestamp', 'time', 'character', 'bit', 'interval']);

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let last = 0;
  for (const token of lex(text)) {
    if (token.type !== 'op') continue;
    if (token.value === '(') depth += 1;
    else if (token.value === ')') depth -= 1;
    else if (token.value === ',' && depth === 0) { parts.push(text.slice(last, token.start)); last = token.end; }
  }
  parts.push(text.slice(last));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function argType(arg) {
  const withoutDefault = arg.replace(/\s+(default\b|=)[\s\S]*$/i, '').trim();
  let words = withoutDefault.split(/\s+/);
  if (['in', 'variadic'].includes(words[0].toLowerCase())) words = words.slice(1);
  if (['out', 'inout'].includes(words[0].toLowerCase())) throw new Error(`unsupported ${words[0]} argument: ${arg}`);
  if (words.length > 1 && !TYPE_LEAD_WORDS.has(words[0].toLowerCase())) words = words.slice(1);
  const type = words.join(' ').toLowerCase().replace(/\s+/g, ' ');
  const bare = type.replace(/(\[\])+$/, '');
  const alias = TYPE_ALIASES.get(bare);
  return alias ? alias + type.slice(bare.length) : type;
}

export function functionKey(name, argList) {
  const qualified = name.includes('.') ? name : `public.${name}`;
  return `${qualified.toLowerCase()}(${splitTopLevel(argList).map(argType).join(',')})`;
}

function regprocedureKey(text) {
  const m = /^\s*([A-Za-z_][\w.]*)\s*\(([\s\S]*)\)\s*$/.exec(text);
  if (!m) throw new Error(`cannot parse regprocedure '${text}'`);
  return functionKey(m[1], m[2]);
}

function matchingParen(tokens, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'op') continue;
    if (tokens[i].value === '(') depth += 1;
    if (tokens[i].value === ')' && --depth === 0) return i;
  }
  throw new Error('unbalanced parentheses');
}

/** Parses `create [or replace] function name(args) ... as $tag$body$tag$ ...`. */
export function parseCreateFunction(text) {
  const tokens = lex(text);
  const words = tokens.map((t) => (t.type === 'ident' ? t.value : null));
  if (words[0] !== 'create') return null;
  let i = 1;
  if (words[1] === 'or' && words[2] === 'replace') i = 3;
  if (words[i] !== 'function') return null;
  const name = tokens[i + 1].value;
  const open = i + 2;
  const close = matchingParen(tokens, open);
  const argList = text.slice(tokens[open].end, tokens[close].start);
  const asIndex = tokens.findIndex((t, k) => k > close && t.type === 'ident' && t.value === 'as');
  const bodyToken = tokens[asIndex + 1];
  if (asIndex < 0 || bodyToken?.type !== 'str') throw new Error(`function ${name} has no body string`);
  return {
    key: functionKey(name, argList),
    name,
    argList,
    attributes: text.slice(tokens[close].end, tokens[asIndex].start),
    body: bodyToken.value,
    trailer: text.slice(bodyToken.end),
  };
}

function aclTargetKey(tokens, text) {
  let fn = tokens.findIndex((t) => t.type === 'ident' && t.value === 'function');
  if (fn < 0) return null;
  if (tokens[fn + 1]?.value === 'if' && tokens[fn + 2]?.value === 'exists') fn += 2;
  if (tokens[fn + 2]?.value !== '(') return null;
  const close = matchingParen(tokens, fn + 2);
  return functionKey(tokens[fn + 1].value, text.slice(tokens[fn + 2].end, tokens[close].start));
}

/** pg_get_functiondef-shaped text; patches see this, so a patch that edits the header is detectable. */
function functionDef(fn) {
  const attributes = fn.attributes.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ` ${l}\n`).join('');
  const args = fn.argList.split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
  return `CREATE OR REPLACE FUNCTION ${fn.name}(${args})\n${attributes}AS ${BODY_TAG}${fn.body}${BODY_TAG}\n`;
}

class EarlyReturn {}

class BlockInterpreter {
  constructor(file, tokens, functions, trace) {
    Object.assign(this, { file, tokens, functions, trace, pos: 0, vars: new Map(), executed: [] });
  }

  peek(offset = 0) { return this.tokens[this.pos + offset]; }
  isWord(word, offset = 0) { const t = this.peek(offset); return t?.type === 'ident' && t.value === word; }
  isOp(op, offset = 0) { const t = this.peek(offset); return t?.type === 'op' && t.value === op; }
  fail(message) {
    const t = this.peek();
    throw new Error(`${this.file}: ${message} near token ${t ? JSON.stringify(t.value) : 'EOF'}`);
  }
  expectWord(word) { if (!this.isWord(word)) this.fail(`expected ${word}`); this.pos += 1; }
  expectOp(op) { if (!this.isOp(op)) this.fail(`expected ${op}`); this.pos += 1; }

  run() {
    if (this.isWord('declare')) {
      this.pos += 1;
      while (!this.isWord('begin')) this.declaration();
    }
    this.expectWord('begin');
    try {
      this.statements();
    } catch (signal) {
      if (!(signal instanceof EarlyReturn)) throw signal;
      return { returnedEarly: true, executed: this.executed };
    }
    this.expectWord('end');
    if (this.isOp(';')) this.pos += 1;
    if (this.peek()) this.fail('unexpected tokens after block end');
    return { returnedEarly: false, executed: this.executed };
  }

  declaration() {
    const name = this.peek();
    if (name?.type !== 'ident') this.fail('expected variable name');
    this.pos += 1;
    while (!this.isOp(':=') && !this.isOp(';')) {
      if (!this.peek()) this.fail('unterminated declaration');
      this.pos += 1;
    }
    let value = null;
    if (this.isOp(':=')) { this.pos += 1; value = this.expression(); }
    this.expectOp(';');
    this.vars.set(name.value, value);
  }

  statements() {
    while (!this.isWord('end')) {
      if (!this.peek()) this.fail('missing end');
      this.statement();
    }
  }

  statement() {
    const t = this.peek();
    if (t.type === 'ident' && this.isOp(':=', 1)) {
      if (!this.vars.has(t.value)) this.fail(`assignment to undeclared ${t.value}`);
      this.pos += 2;
      this.vars.set(t.value, this.expression());
    } else if (this.isWord('if')) {
      this.pos += 1;
      const condition = this.expression();
      this.expectWord('then');
      if (condition === true) {
        this.statements();
      } else {
        this.skipToEndIf();
      }
      this.expectWord('end');
      this.expectWord('if');
    } else if (this.isWord('execute')) {
      this.pos += 1;
      this.execute(this.expression());
    } else if (this.isWord('raise')) {
      this.pos += 1;
      const level = this.peek().value;
      this.pos += 1;
      const message = this.peek().value;
      while (!this.isOp(';')) this.pos += 1;
      if (level === 'exception') throw new Error(`${this.file}: raise exception '${message}'`);
      this.trace.push(`${this.file}: raise ${level} '${message}'`);
    } else if (this.isWord('return')) {
      this.pos += 1;
      this.expectOp(';');
      throw new EarlyReturn();
    } else {
      this.fail('unsupported statement');
    }
    this.expectOp(';');
  }

  skipToEndIf() {
    let depth = 0;
    while (this.peek()) {
      if (this.isWord('if') && !this.isWord('end', -1)) depth += 1;
      if (this.isWord('elsif') || (this.isWord('else') && depth === 0)) this.fail('elsif/else is not supported');
      if (this.isWord('end') && this.isWord('if', 1)) {
        if (depth === 0) return;
        depth -= 1;
      }
      this.pos += 1;
    }
    this.fail('missing end if');
  }

  execute(text) {
    if (typeof text !== 'string') this.fail('execute needs text');
    const fn = parseCreateFunction(text);
    if (!fn) this.fail('execute only supports create function');
    const current = this.functions.get(fn.key);
    if (!current) this.fail(`execute redefines untracked ${fn.key}`);
    const def = functionDef(current);
    const header = def.slice(0, def.indexOf(`AS ${BODY_TAG}`) + 3 + BODY_TAG.length);
    if (!text.startsWith(header) || !text.endsWith(`${BODY_TAG}\n`)) {
      this.fail(`patch changed the header of ${fn.key}; reconstruct it by hand`);
    }
    const body = text.slice(header.length, text.length - BODY_TAG.length - 1);
    if (body.includes(BODY_TAG)) this.fail(`body of ${fn.key} contains ${BODY_TAG}`);
    this.functions.set(fn.key, { ...current, body, patchedBy: [...current.patchedBy, this.file] });
    this.executed.push(fn.key);
  }

  expression() { return this.orExpr(); }

  orExpr() {
    let left = this.andExpr();
    while (this.isWord('or')) { this.pos += 1; const right = this.andExpr(); left = left || right; }
    return left;
  }

  andExpr() {
    let left = this.comparison();
    while (this.isWord('and')) { this.pos += 1; const right = this.comparison(); left = left && right; }
    return left;
  }

  comparison() {
    const left = this.additive();
    for (const op of ['=', '<>', '!=']) {
      if (this.isOp(op)) {
        this.pos += 1;
        const right = this.additive();
        return op === '=' ? left === right : left !== right;
      }
    }
    return left;
  }

  additive() {
    let left = this.multiplicative();
    for (;;) {
      if (this.isOp('||')) { this.pos += 1; left = this.text(left) + this.text(this.multiplicative()); }
      else if (this.isOp('+')) { this.pos += 1; left += this.multiplicative(); }
      else if (this.isOp('-')) { this.pos += 1; left -= this.multiplicative(); }
      else return left;
    }
  }

  multiplicative() {
    let left = this.cast();
    for (;;) {
      if (this.isOp('/')) { this.pos += 1; left = Math.trunc(left / this.cast()); }
      else if (this.isOp('*')) { this.pos += 1; left *= this.cast(); }
      else return left;
    }
  }

  cast() {
    let value = this.primary();
    while (this.isOp('::')) {
      this.pos += 1;
      const type = this.peek().value;
      this.pos += 1;
      if (type === 'regprocedure') value = { regprocedure: regprocedureKey(value) };
      else if (type !== 'text') this.fail(`unsupported cast to ${type}`);
    }
    return value;
  }

  text(value) {
    if (typeof value !== 'string') this.fail('expected text');
    return value;
  }

  primary() {
    const t = this.peek();
    if (!t) this.fail('unexpected end of expression');
    if (t.type === 'str' || t.type === 'num') { this.pos += 1; return t.value; }
    if (this.isOp('(')) {
      this.pos += 1;
      const value = this.expression();
      this.expectOp(')');
      return value;
    }
    if (t.type === 'ident' && this.isOp('(', 1)) return this.call(t.value);
    if (t.type === 'ident' && this.vars.has(t.value)) { this.pos += 1; return this.vars.get(t.value); }
    return this.fail('unsupported expression');
  }

  call(name) {
    this.pos += 2;
    if (name === 'position') {
      const needle = this.text(this.additive());
      this.expectWord('in');
      const haystack = this.text(this.additive());
      this.expectOp(')');
      return needle === '' ? 1 : haystack.indexOf(needle) + 1;
    }
    const args = [];
    while (!this.isOp(')')) {
      args.push(this.expression());
      if (this.isOp(',')) this.pos += 1;
    }
    this.expectOp(')');
    switch (name) {
      case 'replace': {
        const [source, from, to] = args.map((a) => this.text(a));
        if (from === '') return source;
        const count = source.split(from).length - 1;
        const label = from.replace(/\s+/g, ' ').trim().slice(0, 60) || JSON.stringify(from);
        this.trace.push(`${this.file}: replace [${label}] x${count}`);
        return source.split(from).join(to);
      }
      case 'strpos': {
        const [haystack, needle] = args.map((a) => this.text(a));
        return needle === '' ? 1 : haystack.indexOf(needle) + 1;
      }
      case 'length':
        return this.text(args[0]).length;
      case 'pg_get_functiondef': {
        const key = args[0]?.regprocedure;
        const fn = this.functions.get(key);
        if (!fn) this.fail(`pg_get_functiondef of untracked ${key}`);
        return functionDef(fn);
      }
      default:
        return this.fail(`unsupported function ${name}`);
    }
  }
}

function catalogPatchTargets(tokens) {
  const targets = new Set();
  tokens.forEach((t, i) => {
    if (t.type === 'str' && tokens[i + 1]?.value === '::' && tokens[i + 2]?.value === 'regprocedure') {
      targets.add(regprocedureKey(t.value));
    }
  });
  return targets;
}

function usesCatalogTextPatch(tokens) {
  const words = new Set(tokens.filter((t) => t.type === 'ident').map((t) => t.value));
  return words.has('pg_get_functiondef') && (words.has('replace') || words.has('regexp_replace'));
}

function doBlockBody(statement) {
  const [first, second] = statement.tokens;
  return first.type === 'ident' && first.value === 'do' && second?.type === 'str' ? second.value : null;
}

/** Every statement of every migration, with DO bodies lexed for catalog patches. */
function events(migrations) {
  const out = [];
  for (const { name, sql } of migrations) {
    for (const statement of splitStatements(sql)) {
      const [first] = statement.tokens;
      const head = first.type === 'ident' ? first.value : null;
      const body = doBlockBody(statement);
      if (body !== null) {
        const tokens = lex(body);
        if (usesCatalogTextPatch(tokens)) out.push({ kind: 'patch', file: name, tokens, targets: catalogPatchTargets(tokens) });
      } else if (head === 'create') {
        const fn = parseCreateFunction(statement.text);
        if (fn) out.push({ kind: 'create', file: name, fn });
      } else if (head === 'grant' || head === 'revoke' || head === 'drop' || head === 'alter') {
        const blanket = statement.tokens.some((t, i) => t.value === 'all' && statement.tokens[i + 1]?.value === 'functions');
        if (blanket) out.push({ kind: 'blanket-acl', file: name, text: statement.text });
        const key = aclTargetKey(statement.tokens, sql);
        if (key) out.push({ kind: head === 'drop' ? 'drop' : head === 'alter' ? 'alter' : 'acl', file: name, key, text: statement.text });
      }
    }
  }
  return out;
}

/**
 * Replays the migrations and returns the current definition of every function
 * any of them patched through pg_get_functiondef text, plus its grant/revoke
 * history since it was last created from scratch.
 */
export function reconstructPatchedFunctions(migrations) {
  const all = events(migrations);
  const patched = new Set(all.filter((e) => e.kind === 'patch').flatMap((e) => [...e.targets]));
  const lastCreate = new Map();
  all.forEach((e, i) => { if (e.kind === 'create' && patched.has(e.fn.key)) lastCreate.set(e.fn.key, i); });
  const functions = new Map();
  const acl = new Map();
  const trace = [];
  all.forEach((event, index) => {
    if (event.kind === 'create' && patched.has(event.fn.key)) {
      functions.set(event.fn.key, { ...event.fn, createdIn: event.file, patchedBy: [] });
      if (!acl.has(event.fn.key)) acl.set(event.fn.key, []);
    } else if (event.kind === 'drop' && patched.has(event.key)) {
      functions.delete(event.key);
      acl.delete(event.key);
    } else if (event.kind === 'acl' && acl.has(event.key)) {
      acl.get(event.key).push(event.text);
    } else if (event.kind === 'alter' && functions.has(event.key)) {
      throw new Error(`${event.file}: alter function ${event.key} is not replayed; fold it into the canonical source`);
    } else if (event.kind === 'blanket-acl' && functions.size) {
      throw new Error(`${event.file}: blanket function ACL changes are not replayed: ${event.text}`);
    } else if (event.kind === 'patch') {
      const live = [...event.targets].filter((key) => (lastCreate.get(key) ?? -1) < index);
      if (!live.length) {
        trace.push(`${event.file}: superseded by a later full definition of ${[...event.targets].join(', ')}`);
        return;
      }
      const result = new BlockInterpreter(event.file, event.tokens, functions, trace).run();
      if (result.returnedEarly) trace.push(`${event.file}: returned early`);
      const missed = live.filter((key) => !result.executed.includes(key));
      if (missed.length) trace.push(`${event.file}: did not redefine ${missed.join(', ')}`);
    }
  });
  const reconstructed = [...patched]
    .filter((key) => functions.has(key) && functions.get(key).patchedBy.length)
    .map((key) => ({ ...functions.get(key), acl: [...new Set(acl.get(key))] }))
    .sort((a, b) => lastCreate.get(a.key) - lastCreate.get(b.key));
  return { functions: reconstructed, trace };
}

export function renderCanonicalMigration(functions) {
  const lines = [
    '-- Canonical source for functions that earlier migrations patched in place',
    '-- through pg_get_functiondef() + replace(). Generated by',
    '-- supabase/scripts/function-source-of-truth.mjs, whose --check proves this file',
    '-- equals the replay of every earlier migration. Change these functions with a',
    '-- full create or replace in a new migration, never by patching catalog text.',
    '',
  ];
  for (const fn of functions) {
    const name = fn.name;
    lines.push(`-- ${fn.key}: ${fn.createdIn} patched by ${fn.patchedBy.join(', ')}.`);
    const trailer = fn.trailer.trim() ? ` ${fn.trailer.trim()}` : '';
    lines.push(`create or replace function ${name}(${fn.argList})${fn.attributes}as ${BODY_TAG}${fn.body}${BODY_TAG}${trailer};`);
    lines.push(...fn.acl.map((text) => `${text.trim()};`));
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Migrations at or after the canonical one must not execute SQL derived from
 * catalog definition text. The rule is file-wide (catalog text can travel
 * through temp tables or variables across statements) and keyed on EXECUTE,
 * so read-only inspection of a definition stays allowed.
 */
export function findCatalogTextPatches(migrations, canonical = CANONICAL_MIGRATION) {
  return migrations
    .filter(({ name, sql }) => {
      if (name < canonical) return false;
      const words = splitStatements(sql).flatMap((s) => withNestedTokens(s.tokens))
        .filter((t) => t.type === 'ident')
        .map((t) => t.value.toLowerCase());
      const readsDefinition = words.some((w) => w === 'pg_get_functiondef' || w.endsWith('.pg_get_functiondef'));
      return readsDefinition && words.includes('execute');
    })
    .map(({ name }) => name);
}

/** Dynamic SQL hides in string literals (DO bodies, execute text), so lex those too. */
function withNestedTokens(tokens) {
  return tokens.flatMap((t) => {
    if (t.type !== 'str') return [t];
    try { return [t, ...withNestedTokens(lex(t.value))]; } catch { return [t]; }
  });
}

export function checkMigrations(migrations, canonical = CANONICAL_MIGRATION) {
  const problems = findCatalogTextPatches(migrations, canonical)
    .map((name) => `${name}: redefines a function from pg_get_functiondef() text; write a full create or replace instead`);
  const canonicalFile = migrations.find((m) => m.name === canonical);
  if (!canonicalFile) return [...problems, `${canonical} is missing; run --write`];
  const { functions } = reconstructPatchedFunctions(migrations.filter((m) => m.name < canonical));
  if (renderCanonicalMigration(functions) !== canonicalFile.sql) {
    problems.push(`${canonical} differs from the replay of earlier migrations; run --write and review the diff`);
  }
  return problems;
}

function main(argv) {
  const migrations = readMigrations();
  if (argv.includes('--write')) {
    const { functions, trace } = reconstructPatchedFunctions(migrations.filter((m) => m.name < CANONICAL_MIGRATION));
    trace.forEach((line) => console.error(line));
    writeFileSync(join(MIGRATIONS_DIR, CANONICAL_MIGRATION), renderCanonicalMigration(functions));
    console.log(`wrote ${CANONICAL_MIGRATION}: ${functions.map((f) => f.key).join(', ')}`);
    return 0;
  }
  if (argv.includes('--check')) {
    const problems = checkMigrations(migrations);
    problems.forEach((p) => console.error(p));
    if (!problems.length) console.log(`function sources OK: ${CANONICAL_MIGRATION} matches replay, no later catalog text patches`);
    return problems.length ? 1 : 0;
  }
  console.error('usage: function-source-of-truth.mjs --write | --check');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
