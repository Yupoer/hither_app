import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const step = workflow.split('      - name: Resolve META_PARENT')[1]
  .split('      - name: Test meta (L1 map + L2 anti-fake)')[0];
const script = step.split('          script: |\n')[1].split('\n')
  .map((line) => line.replace(/^ {12}/, '')).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const resolve = new AsyncFunction('context', 'github', 'core', script);
const marker = (parent) => `<!-- hither-test-meta parent: ${parent} -->`;

async function run({ ref = 'refs/pull/314/merge', eventName = 'pull_request', body = '',
  currentBody = marker('pure-chore'), prs, error } = {}) {
  const outputs = {};
  const failures = [];
  const calls = [];
  await resolve({
    ref, eventName, repo: { owner: 'Yupoer', repo: 'hither_app' },
    payload: { pull_request: { number: 314, body } },
  }, { rest: { pulls: {
    async get(args) {
      calls.push(['get', args]);
      if (error) throw error;
      return { data: { body: currentBody } };
    },
    async list(args) {
      calls.push(['list', args]);
      if (error) throw error;
      return { data: prs ?? [{ body: currentBody }] };
    },
  } } }, {
    setOutput: (key, value) => { outputs[key] = value; },
    setFailed: (message) => { failures.push(message); },
    info() {},
  });
  return { outputs, failures, calls };
}

const stale = await run();
assert.deepEqual(stale.outputs, { parent: 'pure-chore' }, 'a marker added after PR creation must be read');
assert.deepEqual(stale.failures, []);
assert.deepEqual(stale.calls, [['get', { owner: 'Yupoer', repo: 'hither_app', pull_number: 314 }]]);

const changed = await run({ body: marker('pure-chore'), currentBody: marker('178') });
assert.deepEqual(changed.outputs, { parent: '178' }, 'current metadata must replace a stale marker');
const removed = await run({ body: marker('pure-chore'), currentBody: null });
assert.deepEqual(removed.outputs, {}, 'a removed marker must not fall back to stale metadata');
assert.match(removed.failures[0], /Missing durable PR meta marker/);

for (const currentBody of ['', '<!-- hither-test-meta parent: -->']) {
  const result = await run({ currentBody });
  assert.deepEqual(result.outputs, {});
  assert.match(result.failures[0], /Missing durable PR meta marker/);
}

for (const ref of ['refs/heads/master', 'refs/heads/main']) {
  const result = await run({ ref, eventName: 'push' });
  assert.deepEqual(result.outputs, { parent: '' });
  assert.deepEqual(result.calls, []);
}

const direct = await run({ ref: 'refs/heads/deliver/local-workflow', eventName: 'push', prs: [] });
assert.deepEqual(direct.outputs, { parent: '' });
assert.deepEqual(direct.calls, []);

const manualDirect = await run({ ref: 'refs/heads/deliver/local-workflow', eventName: 'workflow_dispatch', prs: [] });
assert.deepEqual(manualDirect.outputs, { parent: '' }, 'a manual direct-delivery run validates the whole map');
assert.deepEqual(manualDirect.calls, []);

const dispatch = await run({ ref: 'refs/heads/feature/ci', eventName: 'workflow_dispatch' });
assert.deepEqual(dispatch.outputs, { parent: 'pure-chore' });
assert.deepEqual(dispatch.calls, [['list', {
  owner: 'Yupoer', repo: 'hither_app', head: 'Yupoer:feature/ci', state: 'open', per_page: 5,
}]]);
const noPr = await run({ ref: 'refs/heads/feature/ci', eventName: 'workflow_dispatch', prs: [] });
assert.deepEqual(noPr.outputs, {});
assert.match(noPr.failures[0], /No open PR for branch feature\/ci/);
await assert.rejects(run({ body: marker('pure-chore'), error: new Error('API denied') }), /API denied/);

console.log('CI metadata checks passed');
