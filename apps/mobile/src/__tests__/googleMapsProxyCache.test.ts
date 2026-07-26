import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, '../native/googleMapsProxy.ts'),
  'utf8',
);
const edge = readFileSync(
  join(__dirname, '../../../../supabase/functions/google-maps/index.ts'),
  'utf8',
);

describe('googleMapsProxy cache and dedupe (source contracts)', () => {
  it('shares in-flight promises and keeps a short TTL success cache', () => {
    expect(source).toContain('CACHE_TTL_MS = 45_000');
    expect(source).toContain('withDedupeCache');
    expect(source).toContain('inFlight');
    expect(source).toContain('responseCache');
    expect(source).toContain('globalFailureCooldown');
    expect(source).toContain('__resetGoogleMapsProxyCacheForTests');
  });

  it('keys searches and routes without credentials', () => {
    expect(source).toContain('search:${query.trim().toLowerCase()}');
    expect(source).toContain('route:${coordKey(from)}:${coordKey(to)}:${travelMode}');
    expect(source).not.toMatch(/cache.*accessToken|accessToken.*cache/i);
  });

  it('classifies 503 into quota_rpc / missing_config / upstream / network', () => {
    expect(source).toContain("'quota_rpc_failed'");
    expect(source).toContain("'missing_config'");
    expect(source).toContain("'upstream_unavailable'");
    expect(source).toContain("'network'");
    expect(source).toContain('isMapsQuotaFailure');
    expect(edge).toContain('quota_rpc_failed');
    expect(edge).toContain('missing_config');
    expect(edge).toContain('upstream_unavailable');
  });

  it('classifies missing/malformed admin key as missing_config 503 (not throw/500)', () => {
    // readSupabaseAdminKey must return null, never throw, so Deno.serve can respond 503.
    expect(edge).toContain('function readSupabaseAdminKey(): string | null');
    expect(edge).toContain('return null');
    expect(edge).not.toMatch(/throw new Error\(["']Supabase admin key/);
    // Handler short-circuits before createClient when key is absent.
    expect(edge).toMatch(
      /const adminKey = readSupabaseAdminKey\(\);[\s\S]*if \(!adminKey\)[\s\S]*missing_config[\s\S]*503/,
    );
    // Malformed SUPABASE_SECRET_KEYS JSON must not escape as 500.
    expect(edge).toMatch(/JSON\.parse\(secretKeys\)[\s\S]*catch\s*\{/);
  });

  it('uses bounded failure cooldown and never infinite auto-retry', () => {
    expect(source).toContain('FAILURE_COOLDOWN_MS');
    expect(source).toContain('failureCooldown');
    expect(source).toContain('rememberFailure');
    expect(source).toContain('usesGlobalCooldown');
    expect(source).toMatch(/quota_exceeded:\s*60_000/);
    expect(source).toMatch(/upstream_unavailable:\s*8_000/);
    expect(source).not.toMatch(/setInterval|while\s*\(\s*true/);
  });
});

describe('maps 503 classification runtime', () => {
  it('MapsProxyError codes are distinguishable for diagnostics', async () => {
    jest.resetModules();
    const mod = await import('../native/googleMapsProxy');
    const a = new mod.MapsProxyError('quota_rpc_failed', 503);
    const b = new mod.MapsProxyError('missing_config', 503);
    const c = new mod.MapsProxyError('upstream_unavailable', 503);
    const d = new mod.MapsProxyError('quota_exceeded', 429);
    expect(mod.isMapsQuotaFailure(a.code)).toBe(true);
    expect(mod.isMapsQuotaFailure(b.code)).toBe(false);
    expect(mod.isMapsQuotaFailure(c.code)).toBe(false);
    expect(mod.isMapsQuotaFailure(d.code)).toBe(true);
    expect(a.code).not.toBe(b.code);
    expect(a.code).not.toBe(c.code);
  });
});

describe('googleMapsProxy withDedupeCache runtime behavior', () => {
  const from = { latitude: 25.033, longitude: 121.5654 };
  const to = { latitude: 25.0478, longitude: 121.517 };
  const to2 = { latitude: 25.05, longitude: 121.52 };

  let fetchMock: jest.Mock;
  let proxyGetDirections: typeof import('../native/googleMapsProxy').proxyGetDirections;
  let MapsProxyError: typeof import('../native/googleMapsProxy').MapsProxyError;
  let __resetGoogleMapsProxyCacheForTests: typeof import('../native/googleMapsProxy').__resetGoogleMapsProxyCacheForTests;

  beforeEach(async () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';

    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    jest.doMock('../api/supabase', () => ({
      supabase: {
        auth: {
          getSession: jest.fn(async () => ({
            data: { session: { access_token: 'test-access-token' } },
            error: null,
          })),
        },
      },
    }));
    // Avoid performance import side effects when recording failures.
    jest.doMock('../state/performance', () => ({
      recordClassifiedError: jest.fn(async () => undefined),
    }));

    const mod = await import('../native/googleMapsProxy');
    proxyGetDirections = mod.proxyGetDirections;
    MapsProxyError = mod.MapsProxyError;
    __resetGoogleMapsProxyCacheForTests = mod.__resetGoogleMapsProxyCacheForTests;
    __resetGoogleMapsProxyCacheForTests();
  });

  afterEach(() => {
    __resetGoogleMapsProxyCacheForTests();
    jest.resetModules();
    jest.dontMock('../api/supabase');
    jest.dontMock('../state/performance');
  });

  function jsonResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }

  it('shares one in-flight network call for concurrent identical routes', async () => {
    let resolveFetch!: (value: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const p1 = proxyGetDirections(from, to, 'walk');
    const p2 = proxyGetDirections(from, to, 'walk');
    // Auth + withDedupeCache are async — wait until the shared fetch is issued.
    for (let i = 0; i < 20 && fetchMock.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(
      jsonResponse(200, {
        action: 'route',
        route: {
          distanceMeters: 100,
          expectedTravelTimeSeconds: 60,
          // minimal valid polyline for decode (empty → null result is fine)
          encodedPolyline: '',
        },
      }),
    );

    await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves success from TTL cache without a second network call', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        action: 'route',
        route: {
          distanceMeters: 100,
          expectedTravelTimeSeconds: 60,
          encodedPolyline: '',
        },
      }),
    );

    await proxyGetDirections(from, to, 'walk');
    await proxyGetDirections(from, to, 'walk');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-network during same-key failure cooldown', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, { error: 'upstream_unavailable' }),
    );

    await expect(proxyGetDirections(from, to, 'walk')).rejects.toMatchObject({
      name: 'MapsProxyError',
      code: 'upstream_unavailable',
    });
    await expect(proxyGetDirections(from, to, 'walk')).rejects.toBeInstanceOf(
      MapsProxyError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('global-cools quota so a different route key does not re-hit the network', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'quota_exceeded' }));

    await expect(proxyGetDirections(from, to, 'walk')).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    // Different destination — still blocked by global quota cool-down.
    await expect(proxyGetDirections(from, to2, 'walk')).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not apply global cool-down for upstream so a different key may retry', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503, { error: 'upstream_unavailable' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          action: 'route',
          route: {
            distanceMeters: 50,
            expectedTravelTimeSeconds: 30,
            encodedPolyline: '',
          },
        }),
      );

    await expect(proxyGetDirections(from, to, 'walk')).rejects.toMatchObject({
      code: 'upstream_unavailable',
    });
    await expect(proxyGetDirections(from, to2, 'walk')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
