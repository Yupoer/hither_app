const fs = require('node:fs');
const path = require('node:path');
const matrix = require('./functional-scenarios.json');

function evaluate(results, families = matrix.families) {
  const rows = families.map(family => {
    const cases = family.cases.flatMap(scenario => scenario.platforms.map(platform => {
      const suite = results.testResults.find(result => result.name.replaceAll('\\', '/').endsWith('/' + scenario.file));
      const assertions = (suite?.assertionResults ?? []).filter(result => result.fullName.includes(scenario.pattern)
        && (platform === 'mixed' || new RegExp('\\b' + platform + '\\b').test(result.fullName)));
      const status = suite?.status === 'failed' || suite?.testExecError ? 'failed'
        : suite?.status !== 'passed' || !assertions.length ? 'unexecuted' : assertions.some(result => result.status === 'failed') ? 'failed'
        : assertions.every(result => result.status === 'passed') ? 'passed' : 'unexecuted';
      return { ...scenario, platform, status, tests: assertions.map(result => ({ name: result.fullName, status: result.status })) };
    }));
    const status = family.gap ? 'missing' : cases.some(scenario => scenario.status === 'failed') ? 'failed'
      : cases.length && cases.every(scenario => scenario.status === 'passed') ? 'passed' : 'unexecuted';
    return { ...family, status, cases };
  });
  const passed = rows.filter(row => row.status === 'passed').length;
  const critical = rows.filter(row => row.critical);
  const criticalPassed = critical.filter(row => row.status === 'passed').length;
  return { scope: matrix.scope, total: rows.length, passed, percent: 100 * passed / rows.length,
    criticalTotal: critical.length, criticalPassed, accepted: passed / rows.length >= 0.95 && criticalPassed === critical.length,
    evidenceStartTime: results.startTime, rows };
}

module.exports = { evaluate };
if (require.main === module) {
  const [resultPath, output] = process.argv.slice(2);
  if (!resultPath) throw new Error('Usage: node test/headless/scenario-coverage.cjs <same-source-jest-results.json> [report.md]');
  const result = evaluate(JSON.parse(fs.readFileSync(resultPath, 'utf8')));
  if (output) {
    const lines = ['# Headless functional scenario evidence', '', matrix.scope, '',
      `Evidence ${path.resolve(resultPath)}.`, '',
      `Passed ${result.passed}/${result.total} families (${result.percent.toFixed(2)}%). Critical ${result.criticalPassed}/${result.criticalTotal}. Acceptance ${result.accepted ? 'PASS' : 'FAIL'}.`, '',
      '| ID | Required behavior | Critical | Status | Evidence |', '| --- | --- | --- | --- | --- |'];
    for (const row of result.rows) lines.push(`| ${row.id} | ${row.title} | ${row.critical ? 'yes' : 'no'} | ${row.status} | ${row.gap ?? row.cases.map(scenario => `${scenario.file} / ${scenario.pattern} / ${scenario.platform}: ${scenario.status}`).join('<br>')} |`);
    fs.writeFileSync(output, lines.join('\n') + '\n');
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.accepted ? 0 : 1;
}
