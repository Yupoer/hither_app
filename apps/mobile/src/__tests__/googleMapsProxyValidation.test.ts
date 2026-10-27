const { handleGoogleMapsRequest } = jest.requireActual(
  '../../../../supabase/functions/google-maps/handler',
) as { handleGoogleMapsRequest: (request: Request) => Response };

describe('disabled Google Maps proxy', () => {
  it.each(['search', 'route'])('rejects %s without calling Google', async action => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    try {
      const response = handleGoogleMapsRequest(new Request('http://localhost/google-maps', {
        method: 'POST',
        body: JSON.stringify({ action }),
      }));
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: 'upstream_unavailable' });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects unsupported methods', async () => {
    const response = handleGoogleMapsRequest(new Request('http://localhost/google-maps'));
    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ error: 'method not allowed' });
  });
});
