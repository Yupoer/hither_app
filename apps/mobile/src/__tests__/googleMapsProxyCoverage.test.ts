const mockFetch = jest.fn();
const mockGetSession = jest.fn(async (..._args: unknown[]): Promise<any> => undefined);
const mockRecordClassifiedError = jest.fn(async (..._args: unknown[]) => undefined);
const mockConnectivity = { online: true };

jest.mock('../store/connectivity', () => ({
  getNavigatorOnline: () => mockConnectivity.online,
}));
jest.mock('../api/supabase', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));
jest.mock('../state/performance', () => ({
  recordClassifiedError: (...args: unknown[]) => mockRecordClassifiedError(...args),
}));

const from = { latitude: 25.033, longitude: 121.5654 };
const to = { latitude: 25.0478, longitude: 121.517 };
const otherTo = { latitude: 25.05, longitude: 121.52 };

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    headers: {
      get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null,
    },
  } as Response;
}

describe('google maps proxy runtime coverage', () => {
  let mod!: typeof import('../native/googleMapsProxy');

  beforeEach(async () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    mockConnectivity.online = true;
    mockFetch.mockReset();
    mockGetSession.mockReset().mockResolvedValue({
      data: { session: { access_token: 'access-token' } },
      error: null,
    });
    mockRecordClassifiedError.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;
    mod = await import('../native/googleMapsProxy');
    mod.__resetGoogleMapsProxyCacheForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
    mod.__resetGoogleMapsProxyCacheForTests();
  });

  it('maps search responses and shares the success cache', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, {
      action: 'search',
      places: [{ id: 'p-1', name: 'Station', address: 'Taipei', coordinates: to }],
    }));
    await expect(mod.proxySearchPlaces(' Station ')).resolves.toEqual([{
      id: 'p-1',
      providerPlaceId: 'google:p-1',
      name: 'Station',
      address: 'Taipei',
      coordinates: to,
    }]);
    await expect(mod.proxySearchPlaces('station')).resolves.toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/google-maps',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token', apikey: 'anon' }),
        body: expect.stringContaining('"action":"search"'),
      }),
    );
  });

  it('decodes route geometry, returns null routes, and drops malformed responses', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, {
      action: 'route',
      route: {
        distanceMeters: 1_200,
        expectedTravelTimeSeconds: 900,
        encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      },
    }));
    const route = await mod.proxyGetDirections(from, to, 'walk');
    expect(route).toMatchObject({
      distanceMeters: 1_200,
      expectedTravelTimeSeconds: 900,
      source: 'google',
    });
    expect(route?.points.length).toBeGreaterThan(1);

    mockFetch.mockResolvedValueOnce(jsonResponse(200, { action: 'route', route: null }));
    await expect(mod.proxyGetDirections(from, otherTo, 'drive')).resolves.toBeNull();

    mockFetch.mockResolvedValueOnce(jsonResponse(200, { action: 'unexpected' }));
    await expect(mod.proxySearchPlaces('malformed')).rejects.toMatchObject({
      code: 'upstream_unavailable',
      status: 503,
    });
    expect(mockRecordClassifiedError).toHaveBeenCalled();
  });

  it('classifies auth and quota failures globally across coordinate keys', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }));
    await expect(mod.proxyGetDirections(from, to, 'walk')).rejects.toMatchObject({
      code: 'unauthorized',
      retryAfterMs: null,
    });
    await expect(mod.proxyGetDirections(from, otherTo, 'walk')).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mod.__resetGoogleMapsProxyCacheForTests();
    mockFetch.mockResolvedValueOnce(jsonResponse(503, { error: 'quota_rpc_failed' }));
    await expect(mod.proxySearchPlaces('quota-rpc')).rejects.toMatchObject({ code: 'quota_rpc_failed' });
    expect(mod.isMapsQuotaFailure('quota_rpc_failed')).toBe(true);
    expect(mod.isMapsQuotaFailure('upstream_unavailable')).toBe(false);
  });

  it('honors Retry-After dates and permits exactly one half-open probe', async () => {
    jest.useFakeTimers({ now: 0 });
    mockFetch
      .mockResolvedValueOnce(jsonResponse(503, { error: 'upstream_unavailable' }, {
        'Retry-After': new Date(60_000).toUTCString(),
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        action: 'route',
        route: { distanceMeters: 10, expectedTravelTimeSeconds: 5, encodedPolyline: '' },
      }));

    await expect(mod.proxyGetDirections(from, to, 'walk')).rejects.toMatchObject({
      code: 'upstream_unavailable',
      retryAfterMs: expect.any(Number),
    });
    expect(mod.isMapsServiceCircuitOpen()).toBe(true);
    jest.advanceTimersByTime(60_000);
    const probe = mod.proxyGetDirections(from, otherTo, 'walk');
    const blocked = mod.proxyGetDirections(otherTo, from, 'walk');
    await expect(blocked).rejects.toMatchObject({ code: 'upstream_unavailable' });
    await expect(probe).resolves.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mod.isMapsServiceCircuitOpen()).toBe(false);
  });

  it('pauses network failures across keys and recovers after the first backoff', async () => {
    jest.useFakeTimers();
    mockFetch
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce(jsonResponse(200, {
        action: 'route',
        route: { distanceMeters: 10, expectedTravelTimeSeconds: 5, encodedPolyline: '' },
      }));
    await expect(mod.proxyGetDirections(from, to, 'walk')).rejects.toMatchObject({ code: 'network' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await expect(mod.proxyGetDirections(from, otherTo, 'walk')).rejects.toMatchObject({ code: 'network' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(15_000);
    await expect(mod.proxyGetDirections(from, otherTo, 'walk')).resolves.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('fails closed before auth when offline or credentials are absent', async () => {
    mockConnectivity.online = false;
    await expect(mod.proxySearchPlaces('offline')).rejects.toMatchObject({ code: 'network', status: 0 });
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();

    mod.__resetGoogleMapsProxyCacheForTests();
    mockConnectivity.online = true;
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    await expect(mod.proxySearchPlaces('missing-config')).rejects.toMatchObject({ code: 'unauthorized' });

    mod.__resetGoogleMapsProxyCacheForTests();
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(mod.proxySearchPlaces('missing-session')).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('classifies invalid input and accepts a numeric Retry-After floor', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_input' }, { 'Retry-After': '2' }));
    await expect(mod.proxySearchPlaces('bad')).rejects.toMatchObject({
      code: 'invalid_input',
      status: 400,
      retryAfterMs: 2_000,
    });
    mod.__resetGoogleMapsProxyCacheForTests();
    mockFetch.mockResolvedValueOnce(jsonResponse(429, { error: 'quota_exceeded' }));
    await expect(mod.proxySearchPlaces('quota')).rejects.toMatchObject({ code: 'quota_exceeded' });
    await expect(mod.proxySearchPlaces('other-quota')).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(mod.isMapsQuotaFailure('quota_exceeded')).toBe(true);
  });
});
