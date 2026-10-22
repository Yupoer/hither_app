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
import ts from 'typescript';

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

function isTestPath(p) {
  return /(^|[\\/])__tests__([\\/]|$)|\.test\.[jt]sx?$/.test(p);
}

function isProductionSpec(spec, file) {
  if (spec.startsWith('@/')) return true;
  return spec.startsWith('.') && !isTestPath(path.resolve(path.dirname(file), spec));
}

function unwrap(node) {
  while (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) ||
    ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) {
    node = node.expression;
  }
  return node;
}

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function bindingName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node) && ts.isStringLiteralLike(node.expression)) return node.expression.text;
  return undefined;
}

function bindingEntries(name, at = []) {
  if (ts.isIdentifier(name)) return [{ node: name, path: at }];
  return name.elements.flatMap((element, index) => {
    if (!ts.isBindingElement(element) || element.dotDotDotToken) return [];
    const key = ts.isObjectBindingPattern(name)
      ? bindingName(element.propertyName ?? element.name) : String(index);
    return key === undefined ? [] : bindingEntries(element.name, [...at, key]);
  });
}

function importEntries(clause) {
  if (!clause || clause.isTypeOnly) return [];
  const entries = clause.name ? [{ node: clause.name, path: [] }] : [];
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    entries.push({ node: clause.namedBindings.name, path: [] });
  } else if (clause.namedBindings) {
    for (const specifier of clause.namedBindings.elements) {
      const key = (specifier.propertyName ?? specifier.name).text;
      if (!specifier.isTypeOnly) entries.push({ node: specifier.name, path: key === 'default' ? [] : [key] });
    }
  }
  return entries;
}

/** Parse one test without resolving imports or loading application files. */
function classifyTestSource(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const options = { noLib: true, noResolve: true, target: ts.ScriptTarget.Latest };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => path.resolve(name) === path.resolve(file) ? source : undefined;
  const checker = ts.createProgram([file], options, host).getTypeChecker();
  const productionBindings = new Set();
  const moduleBindings = new Map();
  const variables = [];
  const references = [];
  const calls = [];
  let namesProductionSource = false;
  let importsProduction = false;
  const isGlobal = (node, name) => ts.isIdentifier(node) && node.text === name &&
    !checker.getSymbolAtLocation(node)?.declarations?.length;
  const isJestCall = (node, methods) => {
    if (!ts.isCallExpression(node)) return false;
    const binding = modulePath(node.expression);
    return binding?.spec === '@jest/globals' && binding.path.length === 2 &&
      binding.path[0] === 'jest' && methods.includes(binding.path[1]);
  };
  const moduleSpec = (node) => {
    if (!ts.isCallExpression(node) || !node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0])) return undefined;
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword || isGlobal(node.expression, 'require') ||
      isJestCall(node, ['requireActual'])) return node.arguments[0].text;
    return undefined;
  };
  const modulePath = (expression) => {
    const node = unwrap(expression);
    if (isGlobal(node, 'jest')) return { spec: '@jest/globals', path: ['jest'] };
    if (ts.isIdentifier(node)) return moduleBindings.get(checker.getSymbolAtLocation(node));
    const member = memberName(node);
    if (member !== undefined) {
      const root = modulePath(node.expression);
      return root && { spec: root.spec, path: [...root.path, member] };
    }
    const spec = moduleSpec(node);
    if (FS_MODULES.has(spec) || spec === '@jest/globals') {
      return { spec, path: spec.endsWith('/promises') ? ['promises'] : [] };
    }
    return undefined;
  };
  const addBindings = (entries, spec) => {
    for (const entry of entries) {
      const symbol = checker.getSymbolAtLocation(entry.node);
      if (!symbol) continue;
      if (FS_MODULES.has(spec) || spec === '@jest/globals') {
        moduleBindings.set(symbol, { spec, path: [...(spec.endsWith('/promises') ? ['promises'] : []), ...entry.path] });
      } else if (isProductionSpec(spec, file)) productionBindings.add(symbol);
    }
  };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      addBindings(importEntries(statement.importClause), statement.moduleSpecifier.text);
    }
  }
  function collectVariables(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) variables.push(node);
    ts.forEachChild(node, collectVariables);
  }
  collectVariables(source);
  // Resolve module aliases before excluding mock factories, preserving shadowed symbols.
  let added;
  do {
    added = false;
    for (const variable of variables) {
      const root = modulePath(variable.initializer);
      if (!root) continue;
      for (const entry of bindingEntries(variable.name)) {
        const symbol = checker.getSymbolAtLocation(entry.node);
        if (symbol && !moduleBindings.has(symbol)) {
          moduleBindings.set(symbol, { spec: root.spec, path: [...root.path, ...entry.path] });
          added = true;
        }
      }
    }
  } while (added);
  function visit(node) {
    if (ts.isExpressionWithTypeArguments(node) &&
      node.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent.parent)) {
      visit(node.expression);
      return;
    }
    if (ts.isTypeNode(node) || ts.isExportDeclaration(node) ||
      isJestCall(node, ['mock', 'doMock', 'setMock', 'unmock', 'dontMock'])) return;
    if (ts.isImportDeclaration(node)) return;
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      namesProductionSource ||= PRODUCTION_SOURCE_PATH.test(node.text) && !isTestPath(node.text);
    }
    if (ts.isIdentifier(node)) references.push(node);
    if (ts.isCallExpression(node)) {
      calls.push(node);
      const spec = moduleSpec(node);
      if (spec !== undefined && isProductionSpec(spec, file)) {
        let consumer = node;
        while (consumer.parent && (
          ((ts.isPropertyAccessExpression(consumer.parent) || ts.isElementAccessExpression(consumer.parent)) && consumer.parent.expression === consumer) ||
          ((ts.isParenthesizedExpression(consumer.parent) || ts.isAwaitExpression(consumer.parent) || ts.isAsExpression(consumer.parent) ||
            ts.isNonNullExpression(consumer.parent) || ts.isSatisfiesExpression(consumer.parent)) && consumer.parent.expression === consumer)
        )) consumer = consumer.parent;
        if (ts.isVariableDeclaration(consumer.parent) && consumer.parent.initializer === consumer) {
          addBindings(bindingEntries(consumer.parent.name), spec);
        } else if (!ts.isExpressionStatement(consumer.parent) || unwrap(consumer) !== node) importsProduction = true;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  importsProduction ||= references.some((node) => {
    const parent = node.parent;
    if ((parent.name === node && !ts.isShorthandPropertyAssignment(parent)) ||
      (ts.isBindingElement(parent) && parent.propertyName === node) ||
      (ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
      ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
    const symbol = ts.isShorthandPropertyAssignment(parent)
      ? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(node);
    return productionBindings.has(symbol);
  });
  return {
    readsProductionSource: namesProductionSource && calls.some((node) => {
      const binding = modulePath(node.expression);
      return binding && FS_MODULES.has(binding.spec) &&
        ['readFileSync', 'readFile', 'promises.readFile'].includes(binding.path.join('.'));
    }),
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
