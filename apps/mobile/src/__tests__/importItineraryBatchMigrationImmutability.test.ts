/**
 * @jest-environment node
 *
 * Deployed production migration 20260810005000 must stay byte-immutable
 * (including its UTF-8 BOM). Fresh-db parsing belongs in CI/tooling.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  __dirname,
  '../../../../supabase/migrations/20260810005000_import_itinerary_batch.sql',
);

describe('import_itinerary_batch migration immutability (#166)', () => {
  it('keeps the deployed UTF-8 BOM and SQL prefix', () => {
    const buf = readFileSync(migrationPath);
    expect(buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    expect(buf.subarray(3, 16).toString('utf8')).toBe('-- Atomic KML');
  });
});
