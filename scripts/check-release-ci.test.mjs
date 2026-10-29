import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readReleaseCi, runReleaseCiFromEnv, verifyReleaseCiEvidence } from './check-release-ci.mjs';

const context = { repository: 'Yupoer/hither_app', repositoryId: 1272211619, sourceSha: 'a'.repeat(40) };
const input = { ...context, token: 'PRIVATE_TOKEN' };
const repository = { id: context.repositoryId, full_name: context.repository };
const run = (overrides = {}) => ({
  id: 41, run_attempt: 2, workflow_id: 306667059, head_sha: context.sourceSha,
  head_branch: 'master', path: '.github/workflows/ci.yml', event: 'push',
  repository, head_repository: repository, status: 'completed', conclusion: 'success',
  created_at: '2026-10-29T00:18:42Z', ...overrides,
});
const job = (overrides = {}) => ({
  id: 51, run_id: 41, run_attempt: 2, name: 'ci-required',
  status: 'completed', conclusion: 'success', ...overrides,
});
const evidence = (overrides = {}) => verifyReleaseCiEvidence({
  ...context, runs: [run()], jobs: [job()], ...overrides,
});
const rejectsWith = (promise, code) => assert.rejects(promise, error => error.code === code);
const throwsWith = (action, code) => assert.throws(action, error => error.code === code);

function fixture({ runs = [run()], jobs = [job()], current, finalRuns, transform } = {}) {
  const calls = [];
  let runLists = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    const path = url.pathname;
    const page = Number(url.searchParams.get('page') || 1);
    let body;
    let headers = {};
    if (path.endsWith('/workflows/ci.yml/runs') || path.endsWith('/jobs')) {
      const isRuns = path.endsWith('/workflows/ci.yml/runs');
      if (isRuns && page === 1) runLists++;
      const values = isRuns ? runLists === 1 ? runs : finalRuns ?? (current ? [current] : runs) : jobs;
      body = { total_count: values.length, [isRuns ? 'workflow_runs' : 'jobs']: values.slice((page - 1) * 100, page * 100) };
      if (values.length > page * 100) {
        const next = new URL(url);
        next.searchParams.set('page', String(page + 1));
        headers = { link: `<${next}>; rel="next"` };
      }
    } else assert.fail(`unexpected API path: ${path}`);
    return transform?.({ body, headers, page, url, options })
      ?? new Response(JSON.stringify(body), { headers });
  };
  return { fetchImpl, calls };
}

test('pure exact-source success emits only allowlisted identifiers and fixed conclusions', () => {
  assert.deepEqual(evidence({ runs: [run({ html_url: 'PRIVATE_URL', display_title: 'PRIVATE_TEXT' })] }), {
    schemaVersion: 1, sourceSha: context.sourceSha, repositoryId: context.repositoryId,
    workflowPath: '.github/workflows/ci.yml', workflowId: 306667059,
    runId: 41, runAttempt: 2, jobId: 51, status: 'completed', conclusion: 'success',
  });
  assert.doesNotMatch(JSON.stringify(evidence()), /PRIVATE/);
});

test('newest matching run and current attempt must be green; older success cannot mask it', () => {
  for (const [status, conclusion] of [
    ['queued', null], ['requested', null], ['waiting', null], ['in_progress', null],
    ['completed', 'failure'], ['completed', 'cancelled'], ['completed', 'timed_out'],
    ['completed', 'neutral'], ['completed', 'skipped'], ['queued', 'success'],
  ]) {
    throwsWith(() => evidence({ runs: [run(), run({ id: 42, created_at: '2026-10-29T00:18:43Z', status, conclusion })] }), 'ci-not-successful');
  }
  throwsWith(() => evidence({ runs: [run(), run({ id: 42, status: 'queued', conclusion: null })] }), 'ci-not-successful');
  throwsWith(() => evidence({ runs: [run({ run_attempt: 3 })] }), 'api-response-invalid');
});

test('exact SHA, repository identities, push/master and workflow path are all required', () => {
  const untrusted = [
    { head_sha: 'b'.repeat(40) }, { head_branch: 'deliver/release' }, { event: 'pull_request' },
    { event: 'workflow_dispatch' }, { path: '.github/workflows/other.yml' },
    { repository: { ...repository, id: repository.id + 1 } },
    { repository: { ...repository, full_name: 'somebody/hither_app' } },
    { head_repository: { ...repository, id: repository.id + 1 } },
    { head_repository: { ...repository, full_name: 'somebody/hither_app' } },
  ];
  for (const changes of untrusted) {
    throwsWith(() => evidence({ runs: [run(changes)] }), 'matching-ci-missing');
    assert.equal(evidence({ runs: [run(), run({ ...changes, id: 42 })] }).runId, 41);
  }
  for (const changes of [{ repository: 'owner/repo/extra' }, { repository: '../repo' },
    { repository: 'owner/..' }, { repository: 'https://example.com/repo' },
    { repositoryId: '1272211619' }, { repositoryId: 0 }, { repositoryId: 1.5 },
    { sourceSha: 'A'.repeat(40) }, { sourceSha: 'a'.repeat(39) }, { sourceSha: `${context.sourceSha}\n` }]) {
    throwsWith(() => evidence(changes), 'invalid-input');
  }
});

test('exactly one completed successful ci-required from the same run and attempt is required', () => {
  for (const jobs of [[], [job({ name: 'verify' })], [job(), job({ id: 52 })],
    [job({ status: 'queued', conclusion: null })], [job({ conclusion: 'failure' })],
    [job({ conclusion: 'skipped' })], [job({ conclusion: 'cancelled' })]]) {
    throwsWith(() => evidence({ jobs }), 'aggregate-not-successful');
  }
  for (const jobs of [[job({ run_attempt: 1 })], [job({ run_id: 40 })],
    [job(), job({ id: 52, name: 'scope', run_attempt: 1 })], [job(), job()]]) {
    throwsWith(() => evidence({ jobs }), 'api-response-invalid');
  }
  assert.equal(evidence({ jobs: [job({ id: 52, name: 'scope' }), job()] }).jobId, 51);
});

test('malformed run/job evidence fails closed without throwing raw data', () => {
  for (const changes of [{ id: '41' }, { id: Number.MAX_SAFE_INTEGER + 1 }, { run_attempt: 0 },
    { workflow_id: null }, { repository: null }, { head_repository: {} },
    { head_sha: null }, { head_branch: null }, { path: null }, { event: null },
    { created_at: '2026-02-30T00:18:42Z' }, { created_at: 'PRIVATE_TEXT' },
    { status: 'PRIVATE_TEXT' }, { conclusion: 'PRIVATE_TEXT' }]) {
    throwsWith(() => evidence({ runs: [run(changes)] }), 'api-response-invalid');
  }
  for (const runs of [null, {}, [null], [run(), run()]]) {
    throwsWith(() => evidence({ runs }), 'api-response-invalid');
  }
  for (const jobs of [null, {}, [null], [job({ id: null })], [job({ status: 'PRIVATE_TEXT' })]]) {
    throwsWith(() => evidence({ jobs }), 'api-response-invalid');
  }
});

test('reader uses only fixed-origin GETs, unfiltered run status and an attempt-specific jobs URL', async () => {
  const api = fixture();
  assert.equal((await readReleaseCi(input, api)).runAttempt, 2);
  assert.equal(api.calls.length, 3);
  const first = api.calls[0].url;
  assert.equal(first.origin, 'https://api.github.com');
  assert.equal(first.pathname, `/repos/${context.repository}/actions/workflows/ci.yml/runs`);
  assert.deepEqual(Object.fromEntries(first.searchParams), {
    head_sha: context.sourceSha, event: 'push', branch: 'master', per_page: '100', page: '1',
  });
  assert.equal(api.calls[1].url.pathname, `/repos/${context.repository}/actions/runs/41/attempts/2/jobs`);
  for (const { url, options } of api.calls) {
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer PRIVATE_TOKEN');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('reader examines all run and job pages before accepting evidence', async () => {
  const runs = Array.from({ length: 101 }, (_, index) => run({ id: 1000 + index }));
  const jobs = Array.from({ length: 101 }, (_, index) => job({
    id: 2000 + index, run_id: 1100, name: index === 100 ? 'ci-required' : `worker-${index}`,
  }));
  const api = fixture({ runs, jobs });
  const receipt = await readReleaseCi(input, api);
  assert.equal(receipt.runId, 1100);
  assert.equal(receipt.jobId, 2100);
  assert.equal(api.calls.filter(call => call.url.pathname.endsWith('/workflows/ci.yml/runs')).length, 4);
  assert.equal(api.calls.filter(call => call.url.pathname.endsWith('/jobs')).length, 2);

  const pending = fixture({ runs: [...runs.slice(0, 100), run({ id: 1100, status: 'queued', conclusion: null })] });
  await rejectsWith(readReleaseCi(input, pending), 'ci-not-successful');
  assert.equal(pending.calls.length, 2);
});

test('reruns or changed success during job readback cannot reuse old green evidence', async () => {
  await rejectsWith(readReleaseCi(input, fixture({ current: run({ run_attempt: 3 }) })), 'ci-evidence-changed');
  await rejectsWith(readReleaseCi(input, fixture({ current: run({ head_sha: 'b'.repeat(40) }) })), 'matching-ci-missing');
  await rejectsWith(readReleaseCi(input, fixture({ current: run({ status: 'in_progress', conclusion: null }) })), 'ci-not-successful');
});

test('a newer queued or failed matching run created during job pagination invalidates the receipt', async () => {
  const jobs = Array.from({ length: 101 }, (_, index) => job({
    id: 2000 + index, name: index === 100 ? 'ci-required' : `worker-${index}`,
  }));
  for (const [status, conclusion] of [['queued', null], ['completed', 'failure']]) {
    const api = fixture({
      jobs, finalRuns: [run(), run({ id: 42, created_at: '2026-10-29T00:18:43Z', status, conclusion })],
    });
    await rejectsWith(readReleaseCi(input, api), 'ci-evidence-changed');
    assert.equal(api.calls.filter(call => call.url.pathname.endsWith('/jobs')).length, 2);
    assert.equal(api.calls.at(-1).url.pathname, `/repos/${context.repository}/actions/workflows/ci.yml/runs`);
  }
});

test('malformed API payloads, denied requests and transport failures fail closed', async () => {
  for (const body of [null, {}, [], { total_count: '1', workflow_runs: [run()] },
    { total_count: -1, workflow_runs: [] }, { total_count: 1, workflow_runs: {} }]) {
    await rejectsWith(readReleaseCi(input, { fetchImpl: async () => new Response(JSON.stringify(body)) }), 'api-response-invalid');
  }
  await rejectsWith(readReleaseCi(input, { fetchImpl: async () => new Response('{PRIVATE_TEXT') }), 'api-response-invalid');
  await rejectsWith(readReleaseCi(input, { fetchImpl: async () => new Response(' '.repeat(4 * 1024 * 1024 + 1)) }), 'api-response-invalid');
  for (const status of [301, 401, 403, 404, 429, 500]) {
    await rejectsWith(readReleaseCi(input, { fetchImpl: async () => new Response('PRIVATE_TEXT', { status }) }), 'api-error');
  }
  await rejectsWith(readReleaseCi(input, { fetchImpl: async () => { throw new Error('PRIVATE_TEXT'); } }), 'api-error');
});

test('missing pages, contradictory links, duplicate IDs and page/count limits fail closed', async () => {
  for (const body of [
    { total_count: 1, workflow_runs: [] },
    { total_count: 0, workflow_runs: [run()] },
    { total_count: 501, workflow_runs: [] },
    { total_count: 1000, workflow_runs: [] },
  ]) {
    await rejectsWith(readReleaseCi(input, { fetchImpl: async () => new Response(JSON.stringify(body)) }), 'api-results-incomplete');
  }
  const maliciousLink = fixture({ transform: ({ body }) => new Response(JSON.stringify(body), {
    headers: { link: '<https://attacker.invalid/PRIVATE_TEXT>; rel="next"' },
  }) });
  await rejectsWith(readReleaseCi(input, maliciousLink), 'api-results-incomplete');
  assert.equal(maliciousLink.calls.length, 1);
  const runs = Array.from({ length: 101 }, (_, index) => run({ id: 1000 + index }));
  const scenarios = [
    { code: 'api-results-incomplete', transform: ({ body }) => new Response(JSON.stringify(body)) },
    { code: 'api-response-invalid', transform: ({ body }) => new Response(JSON.stringify(body), { headers: { link: 'PRIVATE_TEXT' } }) },
    { code: 'api-results-incomplete', transform: ({ body, headers, page }) => new Response(JSON.stringify({ ...body, total_count: page === 2 ? 100 : 101 }), { headers }) },
    { code: 'api-response-invalid', transform: ({ body, headers, page }) => new Response(JSON.stringify(page === 2 ? { ...body, workflow_runs: [runs[0]] } : body), { headers }) },
  ];
  for (const { code, transform } of scenarios) {
    await rejectsWith(readReleaseCi(input, fixture({ runs, transform })), code);
  }
  const duplicateJobs = fixture({ jobs: [job(), job()] });
  await rejectsWith(readReleaseCi(input, duplicateJobs), 'api-response-invalid');
});

test('whole-read timeout bounds hanging transport and response bodies', async () => {
  await rejectsWith(readReleaseCi(input, { timeoutMs: 5, fetchImpl: () => new Promise(() => {}) }), 'api-timeout');
  await rejectsWith(readReleaseCi(input, {
    timeoutMs: 5, fetchImpl: async () => ({ status: 200, text: () => new Promise(() => {}) }),
  }), 'api-timeout');
});

test('environment entrypoint emits safe JSON on success and fixed error codes on failure', async () => {
  const env = {
    SOURCE_SHA: context.sourceSha, GITHUB_REPOSITORY: context.repository,
    GITHUB_REPOSITORY_ID: String(context.repositoryId), GITHUB_TOKEN: input.token,
    GITHUB_API_URL: 'https://attacker.invalid/PRIVATE_URL',
  };
  const invoke = async (overrides, fetchImpl) => {
    let stdout = '';
    let stderr = '';
    const status = await runReleaseCiFromEnv({ ...env, ...overrides }, {
      fetchImpl, stdout: text => { stdout += text; }, stderr: text => { stderr += text; },
    });
    return { status, stdout, stderr };
  };
  const api = fixture({ runs: [run({ jobs_url: 'https://attacker.invalid/PRIVATE_URL' })] });
  const good = await invoke({}, api.fetchImpl);
  assert.equal(good.status, 0);
  assert.equal(JSON.parse(good.stdout).runAttempt, 2);
  assert.equal(good.stderr, '');
  assert.doesNotMatch(good.stdout, /PRIVATE/);
  assert.ok(api.calls.every(call => call.url.origin === 'https://api.github.com'));
  for (const overrides of [{ GITHUB_REPOSITORY: 'PRIVATE_URL/repo/extra' },
    { GITHUB_REPOSITORY_ID: '01' }, { GITHUB_REPOSITORY_ID: '9007199254740992' },
    { SOURCE_SHA: 'PRIVATE_SHA' }, { GITHUB_TOKEN: '' }, { GITHUB_TOKEN: 'PRIVATE_TOKEN\n' }]) {
    assert.deepEqual(await invoke(overrides, () => { assert.fail('invalid input must not call the API'); }), {
      status: 1, stdout: '', stderr: 'Release CI preflight failed: invalid-input\n',
    });
  }
  assert.deepEqual(await invoke({}, async () => { throw new Error('PRIVATE_EXCEPTION'); }), {
    status: 1, stdout: '', stderr: 'Release CI preflight failed: api-error\n',
  });
});

function workflowJob(source, name) {
  return new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  \\S|$(?![\\s\\S]))`, 'm').exec(source)?.[1];
}

function evaluateCondition(condition, mode) {
  if (!condition) return true;
  return condition.split(' || ').some(clause => clause.split(' && ').every(atom => {
    const match = /^inputs\.mode (==|!=) '([a-z-]+)'$/.exec(atom);
    assert.ok(match, `unsupported routing condition: ${atom}`);
    return (mode === match[2]) === (match[1] === '==');
  }));
}

test('actual workflow routes guard to four release modes with step-only token and job-local read permission', () => {
  const source = readFileSync(new URL('../.github/workflows/cd-ios-testflight.yml', import.meta.url), 'utf8');
  const ios = workflowJob(source, 'ios');
  const inventory = workflowJob(source, 'inventory');
  assert.ok(ios && inventory);
  const steps = ios.split(/(?=^      - (?:name:|uses:))/m);
  const guard = steps.find(step => /^      - name: Verify exact-source master CI$/m.test(step));
  assert.ok(guard);
  const guardCondition = /^        if: (.+)$/m.exec(guard)?.[1];
  const jobCondition = /^    if: (.+)$/m.exec(ios)?.[1];
  for (const mode of ['inspect-release', 'ota', 'preflight', 'validate-release', 'build-only', 'submit']) {
    const enabled = evaluateCondition(jobCondition, mode) && evaluateCondition(guardCondition, mode);
    assert.equal(enabled, ['ota', 'validate-release', 'build-only', 'submit'].includes(mode), mode);
  }
  assert.match(guard, /^        working-directory: \.$/m);
  assert.match(guard, /^          GITHUB_TOKEN: \$\{\{ github\.token \}\}$/m);
  assert.match(guard, /^          node scripts\/check-release-ci\.mjs >> "\$GITHUB_STEP_SUMMARY"$/m);
  assert.equal([...guard.matchAll(/node scripts\/check-release-ci\.mjs/g)].length, 1);
  assert.match(ios, /^    permissions:\n      contents: read\n      actions: read$/m);
  assert.equal([...source.matchAll(/^\s*GITHUB_TOKEN:/gm)].length, 1);
  assert.equal([...source.matchAll(/^\s*actions: read$/gm)].length, 1);
  assert.doesNotMatch(inventory, /check-release-ci|actions: read|GITHUB_TOKEN/);
  assert.ok(ios.indexOf('node-version: 22.16.0') < ios.indexOf(guard));
  assert.ok(ios.indexOf(guard) < ios.indexOf('- name: Install and verify native dependencies'));
  assert.match(source, /^concurrency:\n  group: \$\{\{ contains\(fromJSON\('\["ota","build-only","submit"\]'\), inputs\.mode\) && 'cd-ios-production' \|\| format\('cd-ios-diagnostic-\{0\}-\{1\}', github\.run_id, github\.run_attempt\) \}\}\n  cancel-in-progress: false$/m);
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflowJob(ci, 'scope'), /^          node --test .+ scripts\/check-release-ci\.test\.mjs$/m);
});
