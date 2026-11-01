import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

export function parseOptions(args) {
  const options = { candidateWorkers: 2 };
  const seen = new Set();
  const names = { '--mode': 'mode', '--base': 'base', '--candidate-workers': 'candidateWorkers', '--output-dir': 'outputDir' };
  for (let index = 0; index < args.length; index += 2) {
    const name = names[args[index]];
    if (!name || !args[index + 1] || seen.has(name)) throw new Error('Invalid benchmark arguments');
    seen.add(name);
    options[name] = args[index + 1];
  }
  options.candidateWorkers = Number(options.candidateWorkers);
  if (!['plain', 'coverage'].includes(options.mode) || !/^[a-f0-9]{40}$/.test(options.base || '') ||
      !Number.isSafeInteger(options.candidateWorkers) || options.candidateWorkers < 1) {
    throw new Error('Use --mode plain|coverage --base <40-character SHA> [--candidate-workers <positive integer>] [--output-dir <path>]');
  }
  options.outputDir = path.resolve(appRoot, options.outputDir || `test-artifacts/benchmark-${options.mode}`);
  return options;
}

export function compareSamples(samples) {
  if (samples.length !== 10) throw new Error('Benchmark requires five complete pairs');
  const reference = JSON.stringify(samples[0].evidence);
  for (let pair = 1; pair <= 5; pair += 1) {
    const paired = samples.filter(sample => sample.pair === pair);
    const expectedOrder = pair % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    if (JSON.stringify(paired.map(sample => sample.arm)) !== JSON.stringify(expectedOrder)) throw new Error('Benchmark pair order is invalid');
  }
  for (const sample of samples) {
    if (!Number.isFinite(sample.elapsedMs) || sample.elapsedMs <= 0 || JSON.stringify(sample.evidence) !== reference) {
      throw new Error('Benchmark timing or correctness evidence differs');
    }
  }
  const range = arm => {
    const times = samples.filter(sample => sample.arm === arm).map(sample => sample.elapsedMs).sort((a, b) => a - b);
    return { minMs: times[0], medianMs: times[2], maxMs: times[4] };
  };
  const baseline = range('baseline');
  const candidate = range('candidate');
  return { accepted: candidate.maxMs < baseline.minMs, baseline, candidate, rule: 'max(candidate) < min(baseline)' };
}

function invoke(script, args, env, capture = false) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: appRoot, env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status !== 0) throw new Error(`Benchmark command failed (${path.basename(script)})`);
  return result.stdout;
}

function sampleEvidence(directory, plan) {
  const receipt = read(path.join(directory, 'node-receipt.json'));
  const scenarios = read(path.join(directory, 'headless-scenarios.json'));
  if (receipt.status !== 'passed' || receipt.exitCode !== 0 || receipt.mode !== plan.mode || !receipt.suites?.length ||
      !/^[a-f0-9]{64}$/.test(receipt.suiteCaseDigest || '') || JSON.stringify(receipt.identity) !== JSON.stringify(plan.identity)) {
    throw new Error('Benchmark requires fresh accepted same-source Node evidence');
  }
  const counts = receipt.suites.reduce((sum, suite) => {
    for (const key of ['passed', 'failed', 'pending', 'todo']) sum[key] += suite.counts[key];
    return sum;
  }, { passed: 0, failed: 0, pending: 0, todo: 0 });
  if (!(counts.passed > 0) || counts.failed !== 0 || !scenarios.accepted || !scenarios.rows?.length) {
    throw new Error('Benchmark requires passed assertions and accepted scenario evidence');
  }
  const scenarioOutcomes = scenarios.rows.map(row => ({ id: row.id, critical: row.critical, status: row.status,
    cases: row.cases.map(item => ({ file: item.file, pattern: item.pattern, platform: item.platform, status: item.status,
      tests: item.tests.map(test => [test.name, test.status]).sort() })) })).sort((a, b) => a.id.localeCompare(b.id));
  let coverage = { eligibleAppPaths: receipt.coverage.eligibleAppPaths, threshold: receipt.coverage.threshold,
    ...(receipt.coverage.functions ? { functions: receipt.coverage.functions } : {}) };
  if (JSON.stringify(coverage.eligibleAppPaths) !== JSON.stringify(plan.coverage.eligibleAppPaths) || coverage.threshold !== plan.coverage.threshold) {
    throw new Error('Benchmark coverage scope differs from preflight');
  }
  if (plan.mode === 'full-coverage') {
    const summary = read(path.join(directory, 'coverage/coverage-summary.json'));
    const functions = summary.total?.functions;
    if (!(functions?.total > 0) || !Number.isSafeInteger(functions.total) || !Number.isSafeInteger(functions.covered) ||
        functions.covered < 0 || functions.covered > functions.total || !Number.isFinite(functions.pct) ||
        Math.abs(functions.pct - 100 * functions.covered / functions.total) > 0.011) {
      throw new Error('Benchmark requires a positive coherent function coverage denominator');
    }
    for (const file of coverage.eligibleAppPaths) {
      const absolute = path.resolve(appRoot, file);
      if (fs.existsSync(absolute) && !Number.isFinite(summary[absolute]?.functions?.pct)) {
        throw new Error('Benchmark is missing function coverage for an existing eligible source');
      }
    }
    const repoRoot = path.resolve(appRoot, '../..');
    const files = Object.entries(summary).filter(([file]) => file !== 'total').map(([file, metrics]) => [
      path.relative(repoRoot, file).split(path.sep).join('/'), metrics.functions,
    ]).sort(([left], [right]) => left.localeCompare(right));
    coverage = { ...coverage, functionEvidenceDigest: digest({ total: summary.total.functions, files }) };
  }
  return { identity: receipt.identity, mode: receipt.mode, suites: receipt.suites.length, counts,
    suiteCaseDigest: receipt.suiteCaseDigest, coverage,
    scenarios: { total: scenarios.total, passed: scenarios.passed, criticalTotal: scenarios.criticalTotal,
      criticalPassed: scenarios.criticalPassed, outcomeDigest: digest(scenarioOutcomes) } };
}

export function runBenchmark(options) {
  const outputDir = options.outputDir;
  if (fs.existsSync(outputDir)) throw new Error('Benchmark output directory must be new');
  fs.mkdirSync(outputDir, { recursive: true });
  const env = { ...process.env, COVERAGE_BASE: options.base };
  const owner = path.join(appRoot, 'scripts/check-changed-coverage.mjs');
  const preflightDir = path.join(outputDir, 'preflight');
  invoke(owner, ['--full-node-tests', '--artifact-dir', preflightDir, '--plan-only'], env);
  const plan = read(path.join(preflightDir, 'node-plan.json'));
  if (plan.mode !== `full-${options.mode}` || plan.identity.baseSha !== options.base ||
      (options.mode === 'plain' ? plan.coverage.eligibleAppPaths.length !== 0 : plan.coverage.eligibleAppPaths.length === 0)) {
    throw new Error('Benchmark preflight did not establish the requested mode and coverage scope');
  }
  const npmVersion = process.platform === 'win32'
    ? execFileSync(process.execPath, [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), '--version'], { encoding: 'utf8' }).trim()
    : execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
  const cpu = os.cpus();
  const result = { schemaVersion: 1, mode: options.mode, candidateWorkers: options.candidateWorkers,
    context: { nodeVersion: process.version, npmVersion, platform: process.platform, arch: process.arch,
      osRelease: os.release(), cpuCount: cpu.length, cpuModel: cpu[0]?.model, totalMemoryBytes: os.totalmem(),
      initialLoadAverage: os.loadavg(), imageOS: process.env.ImageOS || null, imageVersion: process.env.ImageVersion || null },
    cachePolicy: 'empty identical Jest and headless compiled caches before every sample',
    timedScope: 'Node gate including Jest and report acceptance, followed by scenario evaluation', preflight: plan, samples: [] };
  const jestCache = path.join(outputDir, 'jest-cache');
  const compilerCache = path.join(appRoot, 'node_modules/.cache/hither-headless/compiled');
  for (let pair = 1; pair <= 5; pair += 1) {
    for (const arm of pair % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline']) {
      fs.rmSync(jestCache, { recursive: true, force: true });
      fs.rmSync(compilerCache, { recursive: true, force: true });
      const directory = path.join(outputDir, `pair-${pair}-${arm}`);
      const args = ['--full-node-tests', '--artifact-dir', directory, '--jest-cache-directory', jestCache];
      if (arm === 'candidate') args.push('--jest-max-workers', String(options.candidateWorkers));
      const start = process.hrtime.bigint();
      invoke(owner, args, env);
      const scenarioJson = invoke(path.join(appRoot, 'test/headless/scenario-coverage.cjs'),
        [path.join(directory, 'node-jest.raw.json'), path.join(directory, 'headless-scenarios.md')], env, true);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      fs.writeFileSync(path.join(directory, 'headless-scenarios.json'), scenarioJson);
      result.samples.push({ pair, arm, workerPolicy: arm === 'candidate' ? `maxWorkers=${options.candidateWorkers}`
        : options.mode === 'coverage' ? 'runInBand' : 'jest-default', elapsedMs, evidence: sampleEvidence(directory, plan) });
      write(path.join(outputDir, 'comparison.json'), result);
    }
  }
  result.comparison = compareSamples(result.samples);
  write(path.join(outputDir, 'comparison.json'), result);
  console.log(JSON.stringify(result.comparison));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runBenchmark(parseOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(`[benchmark-ci] ${error.message}`);
    process.exitCode = 1;
  }
}
