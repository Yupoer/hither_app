/**
 * Node-side contract tests mirroring Edge Function validation rules so
 * M2 gate still holds when Deno is unavailable on the agent host.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../../supabase/functions/google-maps');
const googleSrc = readFileSync(join(root, 'google.ts'), 'utf8');
const typesSrc = readFileSync(join(root, 'types.ts'), 'utf8');
const indexSrc = readFileSync(join(root, 'index.ts'), 'utf8');
const migration = readFileSync(
  join(__dirname, '../../../../supabase/migrations/20260720_google_maps_quota.sql'),
  'utf8',
);

describe('google-maps Edge Function contracts', () => {
  it('exports restricted Places and Routes field masks', () => {
    expect(typesSrc).toContain(
      'places.id,places.displayName,places.formattedAddress,places.location',
    );
    expect(typesSrc).toContain(
      'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    );
    expect(googleSrc).toContain('PLACES_FIELD_MASK');
    expect(googleSrc).toContain('ROUTES_FIELD_MASK');
  });

  it('validates blank/overlong search queries before Google', () => {
    expect(googleSrc).toContain('MAX_QUERY_LENGTH');
    expect(googleSrc).toContain('validateRequest');
    expect(googleSrc).toMatch(/query\.trim\(\)/);
  });

  it('enforces auth → validate → quota → Google order and fail-closed statuses', () => {
    expect(indexSrc).toContain('req.method !== "POST"');
    expect(indexSrc).toContain('401');
    expect(indexSrc).toContain('quota_exceeded');
    expect(indexSrc).toContain('429');
    expect(indexSrc).toContain('consume_google_maps_quota');
    expect(indexSrc).toContain('GOOGLE_MAPS_SERVER_API_KEY');
    expect(indexSrc).toContain('503');
    // Must not return the server key in responses.
    expect(indexSrc).not.toMatch(/json\(\s*\{\s*error:.*apiKey/);
  });

  it('ships atomic daily quota table and RPC', () => {
    expect(migration).toContain('google_maps_daily_usage');
    expect(migration).toContain('primary key (day, user_id, action)');
    expect(migration).toContain('consume_google_maps_quota');
    expect(migration).toContain("action in ('search', 'route')");
    expect(migration).toContain('security definer');
  });
});
