import fs from 'node:fs';
import path from 'node:path';

const directory = path.resolve(process.argv[2] || 'test-artifacts');
const read = file => {
  const bytes = fs.readFileSync(path.join(directory, file), 'utf8');
  if (!bytes.trim()) throw new Error(`Missing evidence: ${file}`);
  return bytes;
};
const receipt = JSON.parse(read('node-receipt.json'));
JSON.parse(read('ci-shadow-plan.json'));
const scenarios = JSON.parse(read('headless-scenarios.raw.json'));
const markdown = read('headless-scenarios.md');
if (receipt.status !== 'passed' || receipt.exitCode !== 0 || scenarios.accepted !== true) throw new Error('Evidence must pass its owning gate');
if (receipt.mode === 'full-coverage') {
  const summary = fs.readFileSync(path.resolve(receipt.coverage.summaryPath.startsWith('apps/mobile/')
    ? receipt.coverage.summaryPath.slice('apps/mobile/'.length) : receipt.coverage.summaryPath), 'utf8');
  JSON.parse(summary);
}
const safe = { scope: scenarios.scope, total: scenarios.total, passed: scenarios.passed, percent: scenarios.percent,
  criticalTotal: scenarios.criticalTotal, criticalPassed: scenarios.criticalPassed, accepted: scenarios.accepted,
  rows: scenarios.rows.map(row => ({ id: row.id, critical: row.critical, status: row.status,
    cases: row.cases.map(item => ({ file: item.file, platform: item.platform, status: item.status })) })) };
fs.writeFileSync(path.join(directory, 'headless-scenarios.json'), JSON.stringify(safe, null, 2) + '\n');
fs.writeFileSync(path.join(directory, 'headless-scenarios.md'), markdown.replace(/^Evidence .*$/m, 'Evidence from this invocation. Raw Jest results remain local.'));
for (const file of ['node-receipt.json', 'ci-shadow-plan.json', 'headless-scenarios.json', 'headless-scenarios.md']) read(file);
console.log('Required sanitized Node evidence is present.');
