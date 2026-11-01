import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

export function installedIdentity(root) {
  const lockBytes = fs.readFileSync(path.join(root, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  const installedBytes = fs.readFileSync(path.join(root, 'node_modules/.package-lock.json'));
  const installed = JSON.parse(installedBytes);
  const packages = Object.entries(installed.packages).sort(([a], [b]) => a.localeCompare(b)).map(([location, entry]) => {
    const manifest = read(path.join(root, location, 'package.json'));
    if (entry.version !== lock.packages[location]?.version || manifest.version !== entry.version) {
      throw new Error(`Installed package does not match the lock (${location})`);
    }
    return [location, manifest.name, manifest.version];
  });
  if (!packages.length) throw new Error('Installed dependency identity is empty');
  const targets = new Set();
  const patches = fs.readdirSync(path.join(root, 'patches')).filter(name => name.endsWith('.patch')).sort().map(name => {
    const bytes = fs.readFileSync(path.join(root, 'patches', name));
    const matches = [...bytes.toString('utf8').matchAll(/^\+\+\+ b\/(node_modules\/[^\r\n]+)$/gm)];
    if (!matches.length) throw new Error(`Patch contains no installed targets (${name})`);
    for (const match of matches) targets.add(match[1]);
    return { name, sha256: hash(bytes) };
  });
  if (!patches.length) throw new Error('Installed patch identity is empty');
  const patchedTargets = [...targets].sort().map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }));
  return { lockSha256: hash(lockBytes), installedLockSha256: hash(installedBytes), packageCount: packages.length,
    packagesSha256: hash(JSON.stringify(packages)), patches, patchedTargets };
}

export function comparePair(baseline, candidate) {
  if (baseline.schemaVersion !== 1 || candidate.schemaVersion !== 1 || !Number.isInteger(baseline.pair) ||
      baseline.pair < 1 || baseline.pair > 5 || !baseline.key ||
      !(baseline.identity?.packageCount > 0) || !baseline.identity.patchedTargets?.length ||
      baseline.arm !== 'baseline' || candidate.arm !== 'candidate' || baseline.pair !== candidate.pair ||
      baseline.key !== candidate.key || candidate.cacheHit !== true || baseline.cacheHit !== false ||
      baseline.runtimeAlignment !== 'passed' || candidate.runtimeAlignment !== 'passed' ||
      JSON.stringify(baseline.identity) !== JSON.stringify(candidate.identity) ||
      [baseline.elapsedMs, candidate.elapsedMs].some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Install pair requires an exact cache hit and equal locked dependency, patch and runtime evidence');
  }
  return { schemaVersion: 1, pair: baseline.pair, key: baseline.key, correctnessEqual: true,
    baselineMs: baseline.elapsedMs, candidateMs: candidate.elapsedMs, identity: baseline.identity,
    runtimeAlignment: 'passed', candidateCacheHit: true, adoptionRequires: 'five pairs with max(candidate) < min(baseline)' };
}

function main(args) {
  const [command, ...flags] = args;
  const options = {};
  const allowed = command === 'start' ? ['output'] : command === 'finish'
    ? ['start', 'output', 'arm', 'pair', 'key', 'cache-hit'] : command === 'compare' ? ['baseline', 'candidate', 'output'] : [];
  if (!allowed.length) throw new Error('Use start, finish or compare');
  for (let index = 0; index < flags.length; index += 2) {
    const name = flags[index].replace(/^--/, '');
    if (!flags[index].startsWith('--') || !allowed.includes(name) || !flags[index + 1] || Object.hasOwn(options, name)) {
      throw new Error('Invalid install benchmark arguments');
    }
    options[name] = flags[index + 1];
  }
  if (!options.output) throw new Error('--output is required');
  if (command === 'start') {
    write(options.output, { startNs: String(process.hrtime.bigint()) });
  } else if (command === 'finish') {
    const end = process.hrtime.bigint();
    if (!options.start || !['baseline', 'candidate'].includes(options.arm) || !/^[1-5]$/.test(options.pair || '') ||
        !options.key || !['true', 'false'].includes(options['cache-hit'] || '')) {
      throw new Error('finish requires --start, --arm baseline|candidate, --pair 1..5, --key and --cache-hit true|false');
    }
    const elapsedMs = Number(end - BigInt(read(options.start).startNs)) / 1e6;
    const identity = installedIdentity(appRoot);
    const runtime = spawnSync(process.execPath, ['scripts/verify-runtime-alignment.mjs'], { cwd: appRoot, stdio: 'inherit' });
    if (runtime.error || runtime.signal || runtime.status !== 0) throw new Error('Installed dependency runtime alignment failed');
    write(options.output, { schemaVersion: 1, pair: Number(options.pair), arm: options.arm, key: options.key,
      cacheHit: options['cache-hit'] === 'true', elapsedMs, identity, runtimeAlignment: 'passed' });
  } else {
    if (!options.baseline || !options.candidate) throw new Error('compare requires --baseline and --candidate');
    write(options.output, comparePair(read(options.baseline), read(options.candidate)));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[benchmark-install] ${error.message}`);
    process.exitCode = 1;
  }
}
