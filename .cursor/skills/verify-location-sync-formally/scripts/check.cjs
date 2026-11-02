const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

const skill = path.resolve(__dirname, '..');
const repo = path.resolve(skill, '../../..');
const output = path.join(skill, '.tmp');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const pinnedJar = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
const safetyViolationExitCode = 12;

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const summaryPath = path.join(output, 'summary.json');
  fs.rmSync(summaryPath, { force: true });
  const jar = process.env.TLA2TOOLS_JAR || path.join(output, 'tools/stable-v1.7.4/tla2tools.jar');
  if (!fs.existsSync(jar)) {
    throw new Error('Pinned TLA2TOOLS jar missing. Set TLA2TOOLS_JAR or install it at ' + jar + '. See SKILL.md.');
  }
  if (sha256(fs.readFileSync(jar)) !== pinnedJar) throw new Error('TLA2TOOLS_JAR SHA-256 mismatch. Use the pinned artifact in SKILL.md.');
  const model = path.join(skill, 'models/MixedSync.tla');
  const results = [];
  for (const [name, mutant, violation] of [
    ['baseline', 0, null],
    ['ack-all-mutant', 1, 'NoUnacknowledgedDeletion'],
    ['actor-fence-mutant', 2, 'NoCrossActorProjection'],
  ]) {
    const dir = path.join(output, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(model, path.join(dir, 'MixedSync.tla'));
    fs.writeFileSync(path.join(dir, 'MixedSync.cfg'), `CONSTANT Mutant = ${mutant}\nSPECIFICATION Spec\nINVARIANTS NoUnacknowledgedDeletion NoCrossActorProjection Conservation\nCHECK_DEADLOCK FALSE\n`);
    const run = cp.spawnSync('java', ['-XX:+UseParallelGC', '-Xmx512m', '-cp', path.resolve(jar), 'tlc2.TLC', '-workers', '1', '-cleanup', '-metadir', path.join(dir, 'states'), 'MixedSync'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
    if (run.error) throw run.error;
    const log = run.stdout + run.stderr;
    fs.writeFileSync(path.join(dir, 'tlc.log'), log);
    if (violation ? run.status !== safetyViolationExitCode || !log.includes(`Invariant ${violation} is violated`) : run.status !== 0 || !log.includes('No error has been found')) {
      throw new Error(`${name} unexpected TLC result. See ${path.join(dir, 'tlc.log')}`);
    }
    const states = log.match(/([\d,]+) states generated, ([\d,]+) distinct states found/);
    results.push({ name, expectedViolation: violation, exitCode: run.status, distinctStates: states ? Number(states[2].replaceAll(',', '')) : null });
    console.log(`${name}: ${violation ? 'expected ' + violation + ' caught' : 'passed'}`);
  }
  const replay = await require('./replay.cjs').run(repo);
  const coverage = JSON.parse(fs.readFileSync(path.join(skill, 'source-map.json'), 'utf8'));
  for (const [file, digest] of Object.entries(replay.sourceSha256)) {
    if (coverage.sources[file]?.sha256 !== digest) throw new Error(`Source mapping drift for ${file}: ${digest}. Review the mapping and update source-map.json before claiming synchronized verification.`);
  }
  const summary = { coverageStatus: coverage.status, syncCommit: coverage.syncCommit, toolSha256: pinnedJar, modelSha256: sha256(fs.readFileSync(model)), bounds: { actors: 2, coreEvents: 3, gpsEvents: 3, dependentCorePair: 1, exchanges: 2, accountSwitches: 1 }, models: results, replay };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  console.log('Source replay and scratch mutation passed. Coverage: ' + coverage.status + '. Evidence: ' + path.relative(repo, summaryPath));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
