import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { recoveryToken, updatePassword } from '../apps/legal-site/auth/recovery/recovery.mjs';

assert.equal(recoveryToken('#type=recovery&access_token=valid'), 'valid');
for (const fragment of ['#type=signup&access_token=valid', '#access_token=valid',
  '#type=recovery&access_token=a&access_token=b', '#type=recovery&access_token=',
  '#type=recovery&access_token=valid&error=expired', '#type=recovery&type=signup&access_token=valid']) {
  assert.equal(recoveryToken(fragment), null);
}
let requests = 0;
const fetcher = async (url, options) => {
  requests++;
  assert.equal(url, 'https://htqrucnjafhhvxdqslbv.supabase.co/auth/v1/user');
  assert.equal(options.method, 'PUT');
  assert.equal(options.headers.Authorization, 'Bearer valid');
  assert.deepEqual(JSON.parse(options.body), { password: 'new-password' });
  assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer');
  return { ok: true };
};
await assert.rejects(updatePassword(null, 'new-password', 'new-password', fetcher));
await assert.rejects(updatePassword('valid', 'short', 'short', fetcher));
await assert.rejects(updatePassword('valid', 'new-password', 'different', fetcher));
assert.equal(requests, 0);
await updatePassword('valid', 'new-password', 'new-password', fetcher);
assert.equal(requests, 1);
await assert.rejects(updatePassword('valid', 'new-password', 'new-password', async () => ({ ok: false })));
await assert.rejects(updatePassword('valid', 'new-password', 'new-password', async () => { throw new Error('offline'); }));
console.log('HTTPS recovery checks passed: invalid/missing/nonrecovery credentials, validation, success, rejection, offline.');

const source = readFileSync(new URL('../apps/legal-site/auth/recovery/recovery.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');
async function browserCheck(fragment, ok) {
  let submit;
  let cleared = false;
  let calls = 0;
  const button = { disabled: false };
  const form = { hidden: true, querySelector: () => button,
    addEventListener: (_, callback) => { submit = callback; }, reset: () => {} };
  const status = { textContent: '' };
  const elements = { recovery: form, status, password: { value: 'new-password' }, confirm: { value: 'new-password' } };
  vm.runInNewContext(source, {
    URLSearchParams, location: { hash: fragment, pathname: '/auth/callback' },
    history: { replaceState: (_, __, path) => { assert.equal(path, '/auth/callback'); cleared = true; } },
    document: { getElementById: (id) => elements[id] },
    fetch: async () => { assert.equal(cleared, true); calls++; return { ok }; },
  });
  assert.equal(cleared, true);
  if (fragment.includes('type=recovery')) {
    assert.equal(form.hidden, false);
    await submit({ preventDefault() {} });
    assert.equal(calls, 1);
    assert.equal(form.hidden, ok);
    assert.match(status.textContent, ok ? /Password updated/ : /Retry/);
    if (ok) { await submit({ preventDefault() {} }); assert.equal(calls, 1); }
  } else {
    assert.equal(form.hidden, true);
    await submit({ preventDefault() {} });
    assert.equal(calls, 0);
  }
}
await browserCheck('#type=recovery&access_token=valid', true);
await browserCheck('#type=recovery&access_token=valid', false);
await browserCheck('#type=signup&access_token=valid', true);
await browserCheck('?code=pkce', true);
console.log('Browser behavior checks passed: URL cleared before requests, legacy callback recovery, signup and PKCE do not submit, successful token cannot replay.');
