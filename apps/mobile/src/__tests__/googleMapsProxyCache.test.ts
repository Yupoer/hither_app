import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, '../native/googleMapsProxy.ts'),
  'utf8',
);

describe('googleMapsProxy cache and dedupe', () => {
  it('shares in-flight promises and keeps a short TTL cache', () => {
    expect(source).toContain('CACHE_TTL_MS = 45_000');
    expect(source).toContain('withDedupeCache');
    expect(source).toContain('inFlight');
    expect(source).toContain('responseCache');
    expect(source).toContain('__resetGoogleMapsProxyCacheForTests');
  });

  it('keys searches and routes without credentials', () => {
    expect(source).toContain('search:${query.trim().toLowerCase()}');
    expect(source).toContain('route:${coordKey(from)}:${coordKey(to)}:${travelMode}');
    expect(source).not.toMatch(/cache.*accessToken|accessToken.*cache/i);
  });
});
