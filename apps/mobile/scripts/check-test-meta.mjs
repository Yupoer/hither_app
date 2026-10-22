/**
 * Meta gates for formal tests:
 *   L1 — acceptance-map.json entries resolve to real test files / name patterns
 *   L2 — anti-fake static scan on test sources (and optionally whole __tests__)
 *
 * Env:
 *   META_SCOPE=changed|all  (default: all for L2; L1 always validates entire map)
 *   COVERAGE_BASE           used when META_SCOPE=changed
 *   META_PARENT             parent issue number → require ≥1 matching map entry and validate them;
 *                           "pure-chore" → empty map allowed (standalone chore with no ticket acceptances);
 *                           unset → validate all entries (empty map OK for unscoped local runs)
 *
 * PR metadata (CI must set META_PARENT from this durable marker in the PR body):
 *   <!-- hither-test-meta parent: 123 -->
 *   <!-- hither-test-meta parent: pure-chore -->
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '../..');
const testsRoot = process.env.META_TESTS_ROOT
  ? path.resolve(process.env.META_TESTS_ROOT)
  : path.join(appRoot, 'src', '__tests__');
const sourceOnlyBaselinePath = process.env.META_SOURCE_ONLY_BASELINE
  ? path.resolve(process.env.META_SOURCE_ONLY_BASELINE)
  : path.join(appRoot, 'scripts', 'source-only-tests-baseline.json');
const mapPath = path.join(testsRoot, 'acceptance-map.json');

const FAKE_PATTERNS = [
  {
    id: 'expect-true-true',
    re: /expect\s*\(\s*true\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)/,
    msg: 'trivial expect(true).toBe(true)',
  },
  {
    id: 'expect-1-1',
    re: /expect\s*\(\s*1\s*\)\s*\.\s*toBe\s*\(\s*1\s*\)/,
    msg: 'trivial expect(1).toBe(1)',
  },
  {
    id: 'empty-it',
    re: /\bit\s*\(\s*['"`][^'"`]+['"`]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/,
    msg: 'empty it() body',
  },
];

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function resolveBase() {
  if (process.env.COVERAGE_BASE) return process.env.COVERAGE_BASE;
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  return 'origin/master';
}

function walkTests(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTests(p, out);
    else if (/\.test\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

function changedTestFiles() {
  const base = resolveBase();
  let out = '';
  try {
    out = git(['diff', '--name-only', `${base}...HEAD`]);
  } catch {
    try {
      out = git(['diff', '--name-only', base, 'HEAD']);
    } catch {
      return null;
    }
  }
  const prefix = 'apps/mobile/';
  return out
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/\\/g, '/'))
    .filter((s) => s.startsWith(prefix) && /\.test\.(ts|tsx)$/.test(s))
    .map((s) => path.join(repoRoot, s));
}

function checkL2(files) {
  const findings = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      for (const p of FAKE_PATTERNS) {
        if (p.re.test(line)) {
          findings.push({
            level: 'L2',
            file: path.relative(appRoot, file).replace(/\\/g, '/'),
            line: i + 1,
            id: p.id,
            msg: p.msg,
          });
        }
      }
    }
  }
  return findings;
}

const PRODUCTION_SOURCE_PATH = /\.(?:tsx?|jsx?|swift|mm?|h|kt|java)$/;
const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const REGEX_PRECEDERS = new Set([...'(,=:[!&|?{};+-*%~^']);
const REGEX_PRECEDING_WORDS = /\b(?:return|typeof|case|in|of|void|delete|throw|new|yield|await)$/;
const ID = '[A-Za-z_$][\\w$]*';

function isTestPath(p) {
  return /(^|[\\/])__tests__([\\/]|$)|\.test\.[jt]sx?$/.test(p);
}

/**
 * Blanks comments and the bodies of strings, templates and regex literals with
 * spaces, so offsets in `code` match the original text. Quote characters stay;
 * `strings` maps each quote's offset to the literal's value. Template `${}`
 * expressions stay as code. Quote strings and regex literals end at a newline
 * so a stray apostrophe in JSX text cannot swallow the rest of the file.
 */
function lex(text) {
  const out = text.split('');
  const strings = new Map();
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  const braceStack = [];
  let i = 0;
  const startsRegex = () => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(out[k])) k--;
    if (k < 0 || REGEX_PRECEDERS.has(out[k])) return true;
    let w = k;
    while (w >= 0 && /[\w$]/.test(out[w])) w--;
    return REGEX_PRECEDING_WORDS.test(out.slice(w + 1, k + 1).join(''));
  };

  const scanTemplate = (start) => {
    let j = start + 1;
    let value = '';
    while (j < text.length) {
      const ch = text[j];
      if (ch === '\\') {
        value += text[j + 1] ?? '';
        j += 2;
        continue;
      }
      if (ch === '`' || (ch === '$' && text[j + 1] === '{')) break;
      value += ch;
      j++;
    }
    blank(start + 1, j);
    strings.set(start, value);
    if (text[j] === '$') {
      braceStack.push('template');
      return j + 2;
    }
    return j + 1;
  };

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let value = '';
      while (j < text.length && text[j] !== ch && text[j] !== '\n') {
        if (text[j] === '\\') {
          value += text[j + 1] ?? '';
          j += 2;
        } else {
          value += text[j++];
        }
      }
      blank(i + 1, j);
      strings.set(i, value);
      i = j + 1;
      continue;
    }
    if (ch === '`') {
      i = scanTemplate(i);
      continue;
    }
    if (ch === '{') {
      braceStack.push('brace');
    } else if (ch === '}') {
      if (braceStack.pop() === 'template') {
        i = scanTemplate(i);
        continue;
      }
    } else if (ch === '/') {
      if (startsRegex()) {
        let j = i + 1;
        let inClass = false;
        while (j < text.length && text[j] !== '\n') {
          const c = text[j];
          if (c === '\\') j++;
          else if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) break;
          j++;
        }
        blank(i + 1, j);
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return { code: out.join(''), strings };
}

/** Offset just past the `)` closing the `(` at `open`, or -1. */
function matchParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Bindings introduced by a destructuring pattern, each with the property path
 * it reads: `{ a, b: { c: d } }` gives a ← [a] and d ← [b, c].
 */
function patternEntries(pattern, at = []) {
  const p = pattern.trim();
  if (!/^[{[]/.test(p)) {
    const m = p.match(new RegExp(`^(?:\\.\\.\\.)?(${ID})`));
    return m ? [{ name: m[1], path: at }] : [];
  }
  const inner = p.slice(1, -1);
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    if ('{[('.includes(inner[i])) depth++;
    else if ('}])'.includes(inner[i])) depth--;
    else if (inner[i] === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.flatMap((part) => {
    const t = part.trim().replace(/\s*=[^]*$/, '');
    if (!t) return [];
    if (p[0] === '{' && !t.startsWith('...')) {
      const colon = t.indexOf(':');
      const key = (colon === -1 ? t : t.slice(0, colon)).trim();
      return patternEntries(colon === -1 ? t : t.slice(colon + 1), [...at, key]);
    }
    return patternEntries(t, at);
  });
}

/** Bindings of an import clause, skipping `type` specifiers; default and namespace bindings get path []. */
function importClauseEntries(clause) {
  const entries = [];
  const braces = clause.match(/\{([^}]*)\}/);
  const head = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
  const ns = head.match(new RegExp(`\\*\\s*as\\s+(${ID})`));
  if (ns) entries.push({ name: ns[1], path: [] });
  const def = head.replace(/\*\s*as\s+\S+/, '').trim();
  if (def) entries.push({ name: def, path: [] });
  for (const spec of braces ? braces[1].split(',') : []) {
    const t = spec.trim();
    if (!t || /^type\s/.test(t)) continue;
    const m = t.match(new RegExp(`^(${ID})(?:\\s+as\\s+(${ID}))?$`));
    if (m) entries.push({ name: m[2] ?? m[1], path: m[1] === 'default' ? [] : [m[1]] });
  }
  return entries;
}

/** Blanks every jest.mock/doMock/setMock/unmock call, factory included. */
function stripMockDeclarations(code) {
  let out = code;
  for (const m of code.matchAll(/\bjest\s*\.\s*(?:mock|doMock|setMock|unmock|dontMock)\s*\(/g)) {
    const end = matchParen(code, m.index + m[0].length - 1);
    const stop = end === -1 ? code.length : end;
    out = out.slice(0, m.index) + code.slice(m.index, stop).replace(/[^\n]/g, ' ') + out.slice(stop);
  }
  return out;
}

/**
 * Every value-level module load: static imports (`import type` excluded),
 * `require`, `jest.requireActual` and dynamic `import()` (outside `typeof`).
 * `entries` lists the bindings the load introduces. `inlineUse` marks a load
 * whose result is consumed in place, as in `require('x').f()` or
 * `expect(require('x'))`, rather than discarded as a bare statement.
 */
function moduleLoads(code, strings) {
  const loads = [];
  const staticImport = new RegExp(
    `(^|[;}\\n])\\s*import\\s+(?!type\\b)([^'"\`;]*?)\\s+from\\s*(['"])`,
    'g',
  );
  for (const m of code.matchAll(staticImport)) {
    const quote = m.index + m[0].length - 1;
    loads.push({
      spec: strings.get(quote),
      entries: importClauseEntries(m[2]),
      inlineUse: false,
      span: [m.index + m[1].length, quote + 1],
    });
  }
  const assignment = new RegExp(
    `(?:\\b(?:const|let|var)\\s+)?(${ID}|\\{[^=]*\\}|\\[[^=]*\\])\\s*(?::[^=]*)?=\\s*(?:await\\s+)?$`,
  );
  const dynamic = /(\btypeof\s+)?\b(?:require|jest\s*\.\s*requireActual|import)\s*\(\s*(['"`])/g;
  for (const m of code.matchAll(dynamic)) {
    if (m[1]) continue;
    const quote = m.index + m[0].length - 1;
    const end = matchParen(code, code.lastIndexOf('(', quote));
    if (end === -1) continue;
    const before = code.slice(Math.max(0, m.index - 400), m.index);
    const chained = /^\s*[.[]/.test(code.slice(end));
    const assigned = chained ? null : before.match(assignment);
    const bare =
      /(?:^|[;{}\n])[ \t]*(?:await\s+)?$/.test(before) && /^[ \t]*(?:[;\n}]|$)/.test(code.slice(end));
    loads.push({
      spec: strings.get(quote),
      entries: assigned ? patternEntries(assigned[1]) : [],
      inlineUse: !assigned && !bare,
      span: [assigned ? m.index - assigned[0].length : m.index, end],
    });
  }
  return loads;
}

/** True when `name` is read somewhere outside `span` (assignment targets and property keys excluded). */
function isReferenced(code, name, span) {
  const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
  for (const m of code.matchAll(re)) {
    if (m.index >= span[0] && m.index < span[1]) continue;
    if (/\b(?:let|const|var)\s+$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue;
    if (/^\s*=(?![=>])/.test(code.slice(m.index + name.length))) continue;
    return true;
  }
  return false;
}

function isProductionSpec(spec, file) {
  if (spec.startsWith('@/')) return true;
  if (!spec.startsWith('.')) return false;
  return !isTestPath(path.resolve(path.dirname(file), spec));
}

/** True when the code calls a file reader from `fs`, through any import or alias form. */
function readsFile(code, loads) {
  if (/(?<![\w$])readFileSync\s*\(/.test(code)) return true;
  const fsMember = '(?:promises\\s*\\.\\s*)?readFile(?:Sync)?';
  const promisesMember = 'readFile';
  for (const load of loads.filter((l) => FS_MODULES.has(l.spec))) {
    const root = load.spec.endsWith('promises') ? ['promises'] : [];
    const tail = code.slice(load.span[1]);
    const member = root.length ? promisesMember : fsMember;
    if (load.inlineUse && new RegExp(`^\\s*\\.\\s*${member}\\s*\\(`).test(tail)) return true;
    for (const { name, path: at } of load.entries) {
      const full = [...root, ...at].join('.');
      const escaped = name.replace(/\$/g, '\\$');
      if (['readFileSync', 'readFile', 'promises.readFile'].includes(full)) {
        if (new RegExp(`(?<![\\w$.])${escaped}\\s*\\(`).test(code)) return true;
      } else if (full === '' || full === 'promises') {
        const m = full === '' ? fsMember : promisesMember;
        if (new RegExp(`(?<![\\w$.])${escaped}\\s*\\.\\s*${m}\\s*\\(`).test(code)) return true;
      }
    }
  }
  return false;
}

/**
 * A test "reads production source" when it calls an fs file reader and names a
 * non-test source file in a string. It "imports production" only through an
 * executable value import of a relative or `@/` module outside __tests__ whose
 * binding (or inline result) the test actually uses; type imports, mock
 * declarations, comments and unused imports do not count.
 */
function classifyTestSource(text, file) {
  const { code, strings } = lex(text);
  const loads = moduleLoads(stripMockDeclarations(code), strings);
  const namesProductionSource = [...strings.values()].some(
    (s) => PRODUCTION_SOURCE_PATH.test(s) && !isTestPath(s),
  );
  const importsProduction = loads.some(
    (load) =>
      load.spec !== undefined &&
      isProductionSpec(load.spec, file) &&
      (load.inlineUse || load.entries.some(({ name }) => isReferenced(code, name, load.span))),
  );
  return {
    readsProductionSource: namesProductionSource && readsFile(code, loads),
    importsProduction,
  };
}

function sourceOnlyTests(files, root) {
  return files
    .filter((file) => {
      const c = classifyTestSource(fs.readFileSync(file, 'utf8'), file);
      return c.readsProductionSource && !c.importsProduction;
    })
    .map((file) => path.relative(root, file).replace(/\\/g, '/'))
    .sort();
}

/**
 * Ratchet: the set of tests that string-match production source without
 * exercising it may only shrink.
 */
function checkSourceOnlyRatchet(files, baselinePath) {
  const current = sourceOnlyTests(files, testsRoot);
  if (process.env.META_WRITE_SOURCE_ONLY_BASELINE === '1') {
    fs.writeFileSync(baselinePath, `${JSON.stringify({ files: current }, null, 2)}
`);
    console.log(`[test:meta] wrote ${current.length} source-only test(s) to ${path.basename(baselinePath)}`);
    return [];
  }
  const baseline = fs.existsSync(baselinePath)
    ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')).files
    : [];
  const baselineSet = new Set(baseline);
  const currentSet = new Set(current);
  const added = current.filter((f) => !baselineSet.has(f));
  const removed = baseline.filter((f) => !currentSet.has(f));
  const rel = path.basename(baselinePath);
  if (removed.length) {
    console.log(
      `[test:meta] source-only ratchet: ${removed.length} file(s) left the set; shrink ${rel} by removing:\n` +
        removed.map((f) => `  - ${f}`).join('\n'),
    );
  }
  return added.map((f) => ({
    level: 'L2',
    file: f,
    line: 1,
    id: 'source-only-test',
    msg: `reads production source with readFileSync but imports no production module; test behavior through the module instead (baseline: ${rel})`,
  }));
}

/**
 * @returns {{ kind: 'unset' } | { kind: 'pure-chore' } | { kind: 'parent', n: number } | { kind: 'invalid', raw: string }}
 */
function parseMetaParent(raw) {
  if (raw == null) return { kind: 'unset' };
  const s = String(raw).trim();
  if (s === '') return { kind: 'unset' };
  if (s.toLowerCase() === 'pure-chore') return { kind: 'pure-chore' };
  if (!/^\d+$/.test(s)) return { kind: 'invalid', raw: s };
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) return { kind: 'invalid', raw: s };
  return { kind: 'parent', n };
}

function checkL1() {
  const findings = [];
  if (!fs.existsSync(mapPath)) {
    findings.push({
      level: 'L1',
      file: 'src/__tests__/acceptance-map.json',
      line: 0,
      id: 'map-missing',
      msg: 'acceptance-map.json missing — create { "entries": [] } at minimum',
    });
    return findings;
  }

  let map;
  try {
    map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  } catch (e) {
    findings.push({
      level: 'L1',
      file: 'src/__tests__/acceptance-map.json',
      line: 0,
      id: 'map-invalid-json',
      msg: String(e.message || e),
    });
    return findings;
  }

  if (!map || !Array.isArray(map.entries)) {
    findings.push({
      level: 'L1',
      file: 'src/__tests__/acceptance-map.json',
      line: 0,
      id: 'map-shape',
      msg: 'expected { "entries": [ ... ] }',
    });
    return findings;
  }

  const parentMeta = parseMetaParent(process.env.META_PARENT);
  if (parentMeta.kind === 'invalid') {
    findings.push({
      level: 'L1',
      file: 'src/__tests__/acceptance-map.json',
      line: 0,
      id: 'meta-parent-invalid',
      msg: `META_PARENT must be a positive integer parent issue id or "pure-chore" (got ${JSON.stringify(parentMeta.raw)})`,
    });
    return findings;
  }

  const indexed = map.entries.map((ent, idx) => ({ ent, idx }));
  let scoped = indexed;
  if (parentMeta.kind === 'parent') {
    scoped = indexed.filter(({ ent }) => Number(ent.parent) === parentMeta.n);
    if (scoped.length === 0) {
      findings.push({
        level: 'L1',
        file: 'src/__tests__/acceptance-map.json',
        line: 0,
        id: 'parent-entries-missing',
        msg: `META_PARENT=${parentMeta.n} requires ≥1 acceptance-map entry with parent=${parentMeta.n}; found 0 (use <!-- hither-test-meta parent: pure-chore --> for empty-map chores)`,
      });
      return findings;
    }
  }
  // pure-chore | unset: empty scoped list is valid; still validate any present entries

  for (const { ent, idx } of scoped) {
    const req = ['parent', 'child', 'acceptance', 'testFile', 'testNamePattern'];
    for (const k of req) {
      if (ent[k] === undefined || ent[k] === null || ent[k] === '') {
        findings.push({
          level: 'L1',
          file: 'src/__tests__/acceptance-map.json',
          line: 0,
          id: 'map-entry-field',
          msg: `entries[${idx}] missing ${k}`,
        });
      }
    }
    if (!ent.testFile) continue;

    const testPath = [
      path.join(testsRoot, ent.testFile),
      path.join(repoRoot, ent.testFile),
      path.join(appRoot, ent.testFile),
    ].find((candidate) => fs.existsSync(candidate));
    if (!testPath) {
      findings.push({
        level: 'L1',
        file: 'src/__tests__/acceptance-map.json',
        line: 0,
        id: 'map-test-missing',
        msg: `entries[${idx}] testFile not found: ${ent.testFile}`,
      });
      continue;
    }
    const body = fs.readFileSync(testPath, 'utf8');
    let re;
    try {
      re = new RegExp(ent.testNamePattern);
    } catch (e) {
      findings.push({
        level: 'L1',
        file: 'src/__tests__/acceptance-map.json',
        line: 0,
        id: 'map-bad-regex',
        msg: `entries[${idx}] testNamePattern invalid: ${e.message}`,
      });
      continue;
    }
    if (!re.test(body)) {
      findings.push({
        level: 'L1',
        file: path.join('src/__tests__', ent.testFile).replace(/\\/g, '/'),
        line: 0,
        id: 'map-name-missing',
        msg: `entries[${idx}] pattern /${ent.testNamePattern}/ not found in ${ent.testFile}`,
      });
    }
  }

  return findings;
}

function main() {
  const scope = process.env.META_SCOPE || 'all';
  let l2Files = walkTests(testsRoot);
  if (scope === 'changed') {
    const ch = changedTestFiles();
    if (ch && ch.length) l2Files = ch;
    else if (ch && ch.length === 0) {
      console.log('[test:meta] L2: no changed test files — skip L2 body scan');
      l2Files = [];
    }
  }

  const findings = [
    ...checkL1(),
    ...checkL2(l2Files),
    ...checkSourceOnlyRatchet(walkTests(testsRoot), sourceOnlyBaselinePath),
  ];

  if (findings.length === 0) {
    console.log('[test:meta] PASS (L1 map + L2 anti-fake)');
    process.exit(0);
  }

  console.error(`[test:meta] FAIL ${findings.length} finding(s):`);
  for (const f of findings) {
    console.error(`  [${f.level}/${f.id}] ${f.file}:${f.line} ${f.msg}`);
  }
  process.exit(1);
}

main();
