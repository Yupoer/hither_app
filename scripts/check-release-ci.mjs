import { pathToFileURL } from 'node:url';

const API_ORIGIN = 'https://api.github.com';
const WORKFLOW_PATH = '.github/workflows/ci.yml';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/;
const STATUSES = new Set(['queued', 'requested', 'waiting', 'pending', 'in_progress', 'completed']);
const CONCLUSIONS = new Set([null, 'success', 'failure', 'neutral', 'cancelled', 'skipped',
  'timed_out', 'action_required', 'stale', 'startup_failure']);
const FAILURE_CODES = new Set(['invalid-input', 'api-error', 'api-timeout', 'api-response-invalid',
  'api-results-incomplete', 'matching-ci-missing', 'ci-not-successful',
  'aggregate-not-successful', 'ci-evidence-changed']);

class ReleaseCiFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = code => { throw new ReleaseCiFailure(code); };
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const repositoryName = value => typeof value === 'string' && REPOSITORY.test(value)
  && !['.', '..'].includes(value.split('/')[1]);

function contextFrom({ repository, repositoryId, sourceSha }) {
  if (!repositoryName(repository) || !positiveInteger(repositoryId)
      || typeof sourceSha !== 'string' || !SHA.test(sourceSha)) fail('invalid-input');
  return { repository, repositoryId, sourceSha };
}

function validRepository(value) {
  return record(value) && positiveInteger(value.id) && repositoryName(value.full_name);
}

function validRun(run) {
  return record(run) && positiveInteger(run.id) && positiveInteger(run.run_attempt)
    && positiveInteger(run.workflow_id) && typeof run.head_sha === 'string' && SHA.test(run.head_sha)
    && typeof run.head_branch === 'string' && typeof run.path === 'string' && run.path.length > 0
    && typeof run.event === 'string' && run.event.length > 0
    && validRepository(run.repository) && validRepository(run.head_repository)
    && STATUSES.has(run.status) && CONCLUSIONS.has(run.conclusion)
    && typeof run.created_at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(run.created_at)
    && Number.isFinite(Date.parse(run.created_at))
    && new Date(run.created_at).toISOString() === run.created_at.replace('Z', '.000Z');
}

function trustedRun(run, context) {
  return run.head_sha === context.sourceSha && run.head_branch === 'master'
    && run.event === 'push' && run.path === WORKFLOW_PATH
    && [run.repository, run.head_repository].every(repository =>
      repository.id === context.repositoryId && repository.full_name === context.repository);
}

function latestTrustedRun(runs, context) {
  if (!Array.isArray(runs) || runs.some(run => !validRun(run))
      || new Set(runs.map(run => run.id)).size !== runs.length) fail('api-response-invalid');
  const matches = runs.filter(run => trustedRun(run, context));
  if (matches.length === 0) fail('matching-ci-missing');
  return matches.reduce((latest, run) => run.created_at > latest.created_at
    || (run.created_at === latest.created_at && run.id > latest.id) ? run : latest);
}

function requireSuccessfulRun(run) {
  if (run.status !== 'completed' || run.conclusion !== 'success') fail('ci-not-successful');
}

/** Pure validation of one complete run/job snapshot; never echoes API data. */
export function verifyReleaseCiEvidence({ runs, jobs, ...input }) {
  const context = contextFrom(input);
  const run = latestTrustedRun(runs, context);
  requireSuccessfulRun(run);
  if (!Array.isArray(jobs) || jobs.some(job => !record(job) || !positiveInteger(job.id)
      || job.run_id !== run.id || job.run_attempt !== run.run_attempt
      || typeof job.name !== 'string' || job.name.length === 0
      || !STATUSES.has(job.status) || !CONCLUSIONS.has(job.conclusion))
      || new Set(jobs.map(job => job.id)).size !== jobs.length) fail('api-response-invalid');
  const aggregate = jobs.filter(job => job.name === 'ci-required');
  if (aggregate.length !== 1 || aggregate[0].status !== 'completed'
      || aggregate[0].conclusion !== 'success') fail('aggregate-not-successful');
  return {
    schemaVersion: 1,
    sourceSha: context.sourceSha,
    repositoryId: context.repositoryId,
    workflowPath: WORKFLOW_PATH,
    workflowId: run.workflow_id,
    runId: run.id,
    runAttempt: run.run_attempt,
    jobId: aggregate[0].id,
    status: 'completed',
    conclusion: 'success',
  };
}

function nextPageAdvertised(response) {
  const link = response.headers.get('link');
  if (link === null) return false;
  if (link.length > 8192) fail('api-response-invalid');
  const relations = link.split(',').map(part => {
    const match = /^\s*<[^<>\s]+>\s*;\s*rel="(next|prev|first|last)"\s*$/.exec(part);
    if (!match) fail('api-response-invalid');
    return match[1];
  });
  if (new Set(relations).size !== relations.length) fail('api-response-invalid');
  return relations.includes('next');
}

/** GET-only reader for github.com. No caller-supplied API origin or response URL is used. */
export async function readReleaseCi(input, { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const context = contextFrom(input);
  if (typeof input.token !== 'string' || input.token.length === 0 || input.token.length > 4096
      || /\s/.test(input.token) || typeof fetchImpl !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > TIMEOUT_MS) fail('invalid-input');
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ReleaseCiFailure('api-timeout'));
    }, timeoutMs);
  });
  const repositoryPath = context.repository.split('/').map(encodeURIComponent).join('/');
  const actionsPath = `/repos/${repositoryPath}/actions`;
  async function getJson(path, parameters = {}) {
    const url = new URL(path, API_ORIGIN);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${input.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'hither-release-ci-preflight',
      },
    });
    if (response.status !== 200) fail('api-error');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) fail('api-response-invalid');
    let payload;
    try { payload = JSON.parse(text); } catch { fail('api-response-invalid'); }
    return { payload, response };
  }
  async function collect(path, field, parameters = {}) {
    const items = [];
    const seen = new Set();
    let count;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { payload, response } = await getJson(path, { ...parameters, per_page: PAGE_SIZE, page });
      if (!record(payload) || !Number.isSafeInteger(payload.total_count) || payload.total_count < 0
          || !Array.isArray(payload[field])) fail('api-response-invalid');
      if (payload.total_count > MAX_PAGES * PAGE_SIZE) fail('api-results-incomplete');
      if (count !== undefined && count !== payload.total_count) fail('api-results-incomplete');
      count = payload.total_count;
      const expected = Math.min(PAGE_SIZE, count - items.length);
      if (payload[field].length !== expected) fail('api-results-incomplete');
      for (const item of payload[field]) {
        if (!record(item) || !positiveInteger(item.id) || seen.has(item.id)) fail('api-response-invalid');
        seen.add(item.id);
        items.push(item);
      }
      const more = items.length < count;
      if (nextPageAdvertised(response) !== more) fail('api-results-incomplete');
      if (!more) return items;
    }
    fail('api-results-incomplete');
  }
  async function read() {
    const runFilters = {
      head_sha: context.sourceSha, event: 'push', branch: 'master',
    };
    const runsPath = `${actionsPath}/workflows/ci.yml/runs`;
    const runs = await collect(runsPath, 'workflow_runs', runFilters);
    const run = latestTrustedRun(runs, context);
    requireSuccessfulRun(run);
    const jobs = await collect(`${actionsPath}/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
    const confirmedRuns = await collect(runsPath, 'workflow_runs', runFilters);
    const current = latestTrustedRun(confirmedRuns, context);
    if (current.id !== run.id || current.run_attempt !== run.run_attempt || current.workflow_id !== run.workflow_id
        || current.created_at !== run.created_at) fail('ci-evidence-changed');
    return verifyReleaseCiEvidence({ ...context, runs: [current], jobs });
  }
  try {
    return await Promise.race([read(), timeout]);
  } catch (error) {
    if (error instanceof ReleaseCiFailure) throw error;
    fail(controller.signal.aborted ? 'api-timeout' : 'api-error');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function runReleaseCiFromEnv(env, {
  fetchImpl = globalThis.fetch,
  stdout = text => process.stdout.write(text),
  stderr = text => process.stderr.write(text),
} = {}) {
  try {
    const id = env.GITHUB_REPOSITORY_ID;
    if (typeof id !== 'string' || !/^[1-9][0-9]*$/.test(id)) fail('invalid-input');
    const receipt = await readReleaseCi({
      repository: env.GITHUB_REPOSITORY,
      repositoryId: Number(id),
      sourceSha: env.SOURCE_SHA,
      token: env.GITHUB_TOKEN,
    }, { fetchImpl });
    stdout(`${JSON.stringify(receipt)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof ReleaseCiFailure && FAILURE_CODES.has(error.code) ? error.code : 'api-error';
    stderr(`Release CI preflight failed: ${code}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runReleaseCiFromEnv(process.env);
}
