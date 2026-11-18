const assert = require('node:assert/strict');
const test = require('node:test');
const { loadServiceRoleKey, smokeWorkerEnvironment } = require('./location-smoke-credentials.cjs');

const env = { SUPABASE_ACCESS_TOKEN: 'mock-management-token' };
const keyResponse = keys => async () => Response.json(keys);

test('requests the legacy service role at the fixed Management API endpoint', async () => {
  const key = await loadServiceRoleKey(env, async (url, options) => {
    assert.equal(url, 'https://api.supabase.com/v1/projects/htqrucnjafhhvxdqslbv/api-keys');
    assert.deepEqual(options.headers, { Authorization: 'Bearer mock-management-token', Accept: 'application/json' });
    assert.equal(options.redirect, 'error');
    return Response.json([
      null,
      { name: 'anon', type: 'legacy', api_key: 'mock-anon-key' },
      { name: 'default', type: 'secret', api_key: null },
      { name: 'service_role', type: 'legacy', api_key: 'mock-service-role' },
    ]);
  });
  assert.equal(key, 'mock-service-role');
});

test('rejects nullable, masked and malformed management responses', async () => {
  for (const api_key of [null, undefined, '', '  ', '******', 10]) {
    await assert.rejects(loadServiceRoleKey(env, keyResponse([
      { name: 'service_role', type: 'legacy', api_key },
    ])), /service_role key unavailable/);
  }
  await assert.rejects(loadServiceRoleKey(env, keyResponse(null)), /was not an array/);
  await assert.rejects(loadServiceRoleKey(env, async () => new Response('unparseable-body')), {
    message: 'Supabase API key response was not valid JSON',
  });
  await assert.rejects(loadServiceRoleKey(env, async () => new Response('private-body', { status: 403 })), {
    message: 'Supabase API key request failed with status 403',
  });
});

test('uses the explicit project key without a management request', async () => {
  const noRequest = () => assert.fail('unexpected Management API request');
  assert.equal(await loadServiceRoleKey({ ...env, SUPABASE_SERVICE_ROLE_KEY: ' mock-service-role ' }, noRequest),
    'mock-service-role');
  await assert.rejects(loadServiceRoleKey({}, noRequest), /Set SUPABASE_ACCESS_TOKEN or SUPABASE_SERVICE_ROLE_KEY/);
});

test('filters worker environment down to the two public Supabase settings and system settings', () => {
  const expected = { EXPO_PUBLIC_SUPABASE_URL: 'https://example.test', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon', Path: 'some-path' };
  assert.deepEqual(smokeWorkerEnvironment({
    ...expected,
    ...env,
    SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role',
    EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'unexpected-prefixed-secret',
    NODE_OPTIONS: '--require some-module',
  }), expected);
});
