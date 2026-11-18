const projectRef = 'htqrucnjafhhvxdqslbv';
const projectOrigin = `https://${projectRef}.supabase.co`;
const apiKeysUrl = `https://api.supabase.com/v1/projects/${projectRef}/api-keys`;
const publicSettings = new Set(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']);
const systemSettings = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA',
  'LOCALAPPDATA', 'TZ', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY',
]);

async function loadServiceRoleKey(env, fetchKeys = fetch) {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceRoleKey) return serviceRoleKey;

  const accessToken = env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new Error('Set SUPABASE_ACCESS_TOKEN or SUPABASE_SERVICE_ROLE_KEY for admin smoke setup');
  }

  const response = await fetchKeys(apiKeysUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Supabase API key request failed with status ${response.status}`);

  let keys;
  try {
    keys = await response.json();
  } catch {
    throw new Error('Supabase API key response was not valid JSON');
  }
  if (!Array.isArray(keys)) throw new Error('Supabase API key response was not an array');
  const key = keys.find(entry => entry?.name === 'service_role'
    && (entry.type === 'legacy' || entry.type == null))?.api_key;
  if (typeof key !== 'string' || !key.trim() || /^\*+$/.test(key.trim())) {
    throw new Error('Supabase service_role key unavailable; set SUPABASE_SERVICE_ROLE_KEY for this project');
  }
  return key.trim();
}

function smokeWorkerEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) =>
    publicSettings.has(name) || systemSettings.has(name.toUpperCase())));
}

module.exports = { projectOrigin, loadServiceRoleKey, smokeWorkerEnvironment };
