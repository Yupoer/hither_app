/**
 * Meta gates for formal tests:
 *   L1 — acceptance-map.json entries resolve to real test files / name patterns
 *   L2 — anti-fake static scan on test sources (and optionally whole __tests__)
 *
 * Env:
 *   META_SCOPE=changed|all  (default: all for L2; L1 always validates entire map)
 *   COVERAGE_BASE           used when META_SCOPE=changed
 *   META_PARENT             if set, only L1 entries with this parent number are required non-empty
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '../..');
const testsRoot = path.join(appRoot, 'src', '__tests__');
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

    // Implementation-detail-only: has readFileSync + toMatch/regex assert, no non-fs production import.
    const hasReadFile = /readFileSync\s*\(/.test(text);
    const hasRegexAssert = /\.toMatch\s*\(/.test(text) || /\.toMatchObject\s*\(/.test(text);
    const hasProdImport =
      /from\s+['"]\.\.\/(?!__tests__)[^'"]+['"]/.test(text) ||
      /from\s+['"]\.\.\/\.\.\/(?!__tests__)[^'"]+['"]/.test(text) ||
      /from\s+['"]@\//.test(text) ||
      /require\s*\(\s*['"]\.\.\//.test(text);
    // Contract tests that only read repo files are allowed if they also assert on structured exports
    // or package.json — flag only when the file is tiny and exclusively readFileSync-driven.
    if (hasReadFile && hasRegexAssert && !hasProdImport) {
      const nonComment = lines.filter((l) => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('import');
      });
      const onlyFsStyle = nonComment.every(
        (l) =>
          /readFileSync|writeFileSync|existsSync|readdirSync|path\.|fs\.|expect\(|describe\(|it\(|test\(|toMatch|toContain|toEqual|toBe|JSON\.|Buffer|utf-?8|join\(|resolve\(/.test(
            l,
          ) || l === '}' || l === '{' || l.startsWith('const ') || l.startsWith('let '),
      );
      // Many existing *Contract* tests are file-based by design — only fail when NOT named Contract
      // and not under an allowlist pattern.
      const base = path.basename(file);
      const allowed =
        /Contract\.test\./.test(base) ||
        /Inventory\.test\./.test(base) ||
        /Migration\.test\./.test(base) ||
        /Parity\.test\./.test(base) ||
        /Config\.test\./.test(base) ||
        /Versions\.test\./.test(base);
      if (!allowed && onlyFsStyle) {
        findings.push({
          level: 'L2',
          file: path.relative(appRoot, file).replace(/\\/g, '/'),
          line: 1,
          id: 'readfilesync-only',
          msg: 'test appears to only read files + regex without importing production modules (rename to *Contract* if intentional)',
        });
      }
    }
  }
  return findings;
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

  const parentFilter = process.env.META_PARENT
    ? Number(process.env.META_PARENT)
    : null;

  for (const [idx, ent] of map.entries.entries()) {
    if (parentFilter != null && Number(ent.parent) !== parentFilter) continue;

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

    const testPath = path.join(testsRoot, ent.testFile);
    if (!fs.existsSync(testPath)) {
      // also allow path relative to src/__tests__ with subdirs already in testFile
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

  const findings = [...checkL1(), ...checkL2(l2Files)];

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
