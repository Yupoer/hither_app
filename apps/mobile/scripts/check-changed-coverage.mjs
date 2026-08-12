/**
 * Gate: function coverage ≥ THRESHOLD on production source files changed vs base.
 *
 * Env:
 *   COVERAGE_BASE   git ref (default: origin/master, or origin/$GITHUB_BASE_REF)
 *   COVERAGE_THRESHOLD  0–100 (default: 85)
 *
 * Skips (exit 0): no qualifying changed source files.
 * Excludes UI-heavy / non-node-jest surfaces (screens, components, etc.).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '../..');
const threshold = Number(process.env.COVERAGE_THRESHOLD || 85);

const EXCLUDE_DIR_RE =
  /(?:^|\/)(screens|components|assets|__tests__|__mocks__|types|constants|i18n|theme|styles)(?:\/|$)/i;
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

function main() {
  const base = resolveBase();
  const changed = listChangedFiles(base)
    .map(toAppRel)
    .filter(Boolean)
    .filter(isGateSource);

  console.log(`[coverage:changed] base=${base} threshold=${threshold}%`);
  if (changed.length === 0) {
    console.log('[coverage:changed] no qualifying changed source files — skip (ok)');
    process.exit(0);
  }

  console.log(`[coverage:changed] ${changed.length} file(s):`);
  for (const f of changed) console.log(`  - ${f}`);

  const coverageDir = path.join(appRoot, 'coverage-changed');
  fs.rmSync(coverageDir, { recursive: true, force: true });

  // Do not pass a coverage-threshold JSON blob on the jest argv: shell:true
  // strips quotes and Jest JSON.parse fails on both bash and PowerShell.
  // This script already enforces the threshold from coverage-summary.json.
  const args = [
    'jest',
    '--coverage',
    '--coverageDirectory',
    coverageDir,
    '--coverageReporters=json-summary',
    '--coverageReporters=text-summary',
    ...changed.flatMap((f) => ['--collectCoverageFrom', f]),
    '--passWithNoTests',
  ];

  const r = spawnSync('npx', args, {
    cwd: appRoot,
    encoding: 'utf8',
    shell: true,
    env: process.env,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);

  const summaryPath = path.join(coverageDir, 'coverage-summary.json');
  if (!fs.existsSync(summaryPath)) {
    console.error('[coverage:changed] missing coverage-summary.json — fail');
    process.exit(1);
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const pct = summary.total?.functions?.pct;
  console.log(`[coverage:changed] functions=${pct}% (need ≥${threshold})`);

  if (typeof pct !== 'number' || Number.isNaN(pct)) {
    console.error('[coverage:changed] could not read functions pct — fail');
    process.exit(1);
  }
  if (pct < threshold) {
    console.error('[coverage:changed] FAIL below threshold');
    process.exit(1);
  }
  if (r.status !== 0 && r.status !== null) {
    // jest coverageThreshold already failed
    process.exit(r.status);
  }
  console.log('[coverage:changed] PASS');
  process.exit(0);
}

main();
