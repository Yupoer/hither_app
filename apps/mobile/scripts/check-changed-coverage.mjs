/**
 * Gate: function coverage ≥ THRESHOLD on production source files changed vs base.
 *
 * Env:
 *   COVERAGE_BASE   git ref (default: origin/master, or origin/$GITHUB_BASE_REF)
 *   COVERAGE_THRESHOLD  0–100 (default: 85)
 *
 * --full-node-tests runs the full default suite even without qualifying sources.
 * Standalone mode skips successfully when no qualifying source changed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { observeShadowPlan } from '../../../scripts/ci-shadow-plan.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '../..');
const fullNodeTests = process.argv.slice(2).includes('--full-node-tests');
const options = new Map();
const flags = new Set(['--full-node-tests', '--plan-only']);
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (flags.has(arg)) continue;
  if (!['--artifact-dir', '--jest-max-workers', '--jest-cache-directory'].includes(arg) || !process.argv[i + 1]) {
    throw new Error(`Unknown or missing option: ${arg}`);
  }
  options.set(arg, process.argv[++i]);
}
const workers = options.get('--jest-max-workers');
if (workers !== undefined && !/^[1-9]\d*$/.test(workers)) throw new Error('--jest-max-workers must be a positive integer');
const artifactDir = path.resolve(appRoot, options.get('--artifact-dir') || 'test-artifacts');
const rawResultPath = path.join(artifactDir, 'node-jest.raw.json');
const receiptPath = path.join(artifactDir, 'node-receipt.json');
const coverageDir = options.has('--artifact-dir') ? path.join(artifactDir, 'coverage') : path.join(appRoot, 'coverage-changed');
const shadowPlanPath = path.join(artifactDir, 'ci-shadow-plan.json');
let diffMode = 'triple-dot';
if (fullNodeTests) {
  fs.rmSync(coverageDir, { recursive: true, force: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  for (const file of [rawResultPath, receiptPath, shadowPlanPath, ...['headless-scenarios.raw.json', 'headless-scenarios.json', 'headless-scenarios.md'].map(file => path.join(artifactDir, file))]) fs.rmSync(file, { force: true });
}
const threshold = Number(process.env.COVERAGE_THRESHOLD || 85);
if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
  console.error('[coverage:changed] threshold must be finite and between 0 and 100');
  process.exit(2);
}

const EXCLUDE_DIR_RE =
  /(?:^|\/)(assets|__tests__|__mocks__|types|constants|i18n|theme|styles)(?:\/|$)/i;
const EXCLUDE_FILE_RE = /\.(d\.ts|styles?\.ts|styles?\.tsx)$/i;

function resolveBase() {
  if (process.env.COVERAGE_BASE) return process.env.COVERAGE_BASE;
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  return 'origin/master';
}

function git(args, cwd = repoRoot) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function listChangedFiles(base) {
  // Ensure base exists when possible (CI with fetch-depth: 0).
  try {
    git(['rev-parse', '--verify', base]);
  } catch {
    try {
      git(['fetch', '--no-tags', 'origin', base.replace(/^origin\//, ''), '--depth=1']);
    } catch {
      /* continue; diff may still work against local master */
    }
  }

  let out = '';
  try {
    out = git(['diff', '--name-only', `${base}...HEAD`]);
  } catch {
    try {
      out = git(['diff', '--name-only', `${base}`, 'HEAD']);
      diffMode = 'endpoints';
    } catch (e) {
      console.error('[coverage:changed] git diff failed:', e.message || e);
      process.exit(2);
    }
  }
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function toAppRel(repoRel) {
  const norm = repoRel.replace(/\\/g, '/');
  const prefix = 'apps/mobile/';
  if (!norm.startsWith(prefix)) return null;
  return norm.slice(prefix.length);
}

function isGateSource(appRel) {
  if (!appRel.startsWith('src/')) return false;
  if (!/\.(ts|tsx)$/.test(appRel)) return false;
  if (appRel.includes('__tests__')) return false;
  if (EXCLUDE_DIR_RE.test(appRel)) return false;
  if (EXCLUDE_FILE_RE.test(appRel)) return false;
  // Pure UI TSX often not exercised by node jest runner — skip unless .ts logic module.
  if (appRel.endsWith('.tsx') && !appRel.includes('/hooks/') && !appRel.includes('/services/')) {
    return false;
  }
  return true;
}

function digest(file) {
  try {
    return createHash('sha256').update(fs.readFileSync(path.join(appRoot, file))).digest('hex');
  } catch {
    return null;
  }
}

function sourceIdentity(base) {
  const resolve = (ref) => {
    try {
      const value = git(['rev-parse', '--verify', ref]);
      return /^[a-f0-9]{40}$/.test(value) ? value : null;
    } catch {
      return null;
    }
  };
  const runNumber = (value) => /^\d+$/.test(value || '') ? value : null;
  return {
    baseSha: resolve(base),
    headSha: resolve('HEAD'),
    treeSha: resolve('HEAD^{tree}'),
    diffMode,
    nodeVersion: process.version,
    configSha256: digest('jest.config.js'),
    lockSha256: digest('package-lock.json'),
    runId: runNumber(process.env.GITHUB_RUN_ID),
    runAttempt: runNumber(process.env.GITHUB_RUN_ATTEMPT),
  };
}

function readSuites() {
  const raw = JSON.parse(fs.readFileSync(rawResultPath, 'utf8'));
  if (typeof raw.success !== 'boolean' || !Array.isArray(raw.testResults)) throw new Error('invalid Jest results');
  const cases = [];
  const suites = raw.testResults.map((result) => {
    if (typeof result.name !== 'string' || !['passed', 'failed', 'pending'].includes(result.status) ||
        !Array.isArray(result.assertionResults)) throw new Error('invalid Jest suite');
    const relative = path.relative(repoRoot, result.name).split(path.sep).join('/');
    if (path.isAbsolute(relative) || relative.startsWith('../') || !relative || /[\x00-\x1f\x7f]/.test(relative)) {
      throw new Error('suite outside repository');
    }
    const counts = { passed: 0, failed: 0, pending: 0, todo: 0 };
    for (const assertion of result.assertionResults) {
      const status = assertion.status === 'disabled' ? 'pending' : assertion.status;
      if (!Object.hasOwn(counts, status)) throw new Error('invalid Jest case status');
      if (typeof assertion.fullName !== 'string') throw new Error('invalid Jest case name');
      cases.push([relative, assertion.fullName, status]);
      counts[status] += 1;
    }
    return { runner: 'node-jest', path: relative, status: result.status, counts };
  });
  if (new Set(suites.map(suite => suite.path)).size !== suites.length) throw new Error('duplicate Jest suites');
  return { success: raw.success, suites, suiteCaseDigest: createHash('sha256').update(JSON.stringify(cases.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex') };
}

function main() {
  const base = resolveBase();
  const changed = listChangedFiles(base)
    .map(toAppRel)
    .filter(Boolean)
    .filter(isGateSource);

  console.log(`[coverage:changed] base=${base} threshold=${threshold}%`);
  if (changed.length === 0 && !fullNodeTests) {
    console.log('[coverage:changed] no qualifying changed source files — skip (ok)');
    return 0;
  }

  console.log(`[coverage:changed] ${changed.length} file(s):`);
  for (const f of changed) console.log(`  - ${f}`);
  fs.rmSync(coverageDir, { recursive: true, force: true });
  const identity = fullNodeTests ? sourceIdentity(base) : null;
  if (process.argv.includes('--plan-only')) {
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, 'node-plan.json'), JSON.stringify({ identity,
      mode: changed.length ? 'full-coverage' : 'full-plain', coverage: { eligibleAppPaths: changed, threshold } }, null, 2) + '\n');
    return 0;
  }
  if (fullNodeTests) {
    const shadowPlan = observeShadowPlan({ identity, eligibleAppPaths: changed, git });
    fs.writeFileSync(shadowPlanPath, JSON.stringify(shadowPlan, null, 2) + '\n');
  }
  const receipt = fullNodeTests ? {
    schemaVersion: 1, identity, mode: changed.length ? 'full-coverage' : 'full-plain',
    status: 'failed', exitCode: 1, suites: [], suiteEvidence: 'unavailable',
    otherRunnerCases: 'unavailable', coverage: { eligibleAppPaths: changed, threshold },
  } : null;
  const finish = (code, reason) => {
    if (receipt) {
      receipt.status = code === 0 ? 'passed' : 'failed';
      receipt.exitCode = code;
      receipt.reason = reason;
      fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    }
    return code;
  };

  const args = changed.length ? [
    'jest',
    ...(!workers ? ['--runInBand'] : []),
    '--silent',
    ...(!fullNodeTests ? ['--forceExit'] : []),
    '--coverage',
    '--coverageDirectory',
    coverageDir,
    '--coverageReporters=json-summary',
    '--coverageReporters=text-summary',
    ...changed.flatMap((f) => ['--collectCoverageFrom', f]),
    ...(!fullNodeTests ? ['--passWithNoTests'] : []),
  ] : ['jest'];
  if (workers) args.push('--maxWorkers', workers);
  if (options.has('--jest-cache-directory')) args.push('--cacheDirectory', path.resolve(appRoot, options.get('--jest-cache-directory')));
  if (fullNodeTests) args.push('--json', `--outputFile=${path.relative(appRoot, rawResultPath)}`);

  const r = spawnSync(process.execPath, [path.join(appRoot, 'node_modules/jest/bin/jest.js'), ...args.slice(1)], {
    cwd: appRoot,
    encoding: 'utf8',
    // Stream diagnostics so spawnSync cannot exhaust its output buffer before coverage is written.
    stdio: 'inherit',
    env: process.env,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  let suiteError = false;
  if (receipt) {
    try {
      const result = readSuites();
      receipt.suites = result.suites;
      receipt.suiteCaseDigest = result.suiteCaseDigest;
      receipt.suiteEvidence = 'available';
      suiteError = !result.success || result.suites.length === 0 ||
        result.suites.some(suite => suite.status === 'failed' || suite.counts.failed > 0) ||
        result.suites.reduce((sum, suite) => sum + suite.counts.passed, 0) === 0;
    } catch {
      suiteError = true;
    }
  }
  if (r.error || r.signal || r.status !== 0) {
    console.error('[coverage:changed] Jest failed:', r.error?.message || r.signal || r.status);
    return finish(Number.isInteger(r.status) && r.status > 0 ? r.status : 1, 'jest-failed');
  }
  if (suiteError) {
    console.error('[coverage:changed] missing, invalid or unsuccessful fresh Jest results — fail');
    return finish(1, 'invalid-jest-results');
  }
  if (changed.length === 0) return finish(0, 'full-plain-passed');

  const summaryPath = path.join(coverageDir, 'coverage-summary.json');
  if (!fs.existsSync(summaryPath)) {
    console.error('[coverage:changed] missing coverage-summary.json — fail');
    return finish(1, 'missing-coverage-summary');
  }

  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  } catch {
    console.error('[coverage:changed] invalid coverage-summary.json — fail');
    return finish(1, 'invalid-coverage-summary');
  }
  const pct = summary?.total?.functions?.pct;
  console.log(`[coverage:changed] functions=${pct}% (need ≥${threshold})`);
  const functions = summary?.total?.functions;
  const validFunctions = value => value && Number.isFinite(value.pct) && value.pct >= 0 && value.pct <= 100 &&
    Number.isSafeInteger(value.total) && value.total >= 0 && Number.isSafeInteger(value.covered) &&
    value.covered >= 0 && value.covered <= value.total;
  if (!validFunctions(functions)) {
    console.error('[coverage:changed] could not read functions pct — fail');
    return finish(1, 'invalid-functions-percentage');
  }
  if (receipt) {
    receipt.coverage.functions = { pct, total: functions.total, covered: functions.covered };
    receipt.coverage.summaryPath = path.relative(repoRoot, summaryPath).split(path.sep).join('/');
  }
  if (pct < threshold) {
    console.error('[coverage:changed] FAIL below threshold');
    return finish(1, 'below-threshold');
  }
  console.log('[coverage:changed] PASS');
  return finish(0, 'coverage-passed');
}

process.exitCode = main();
