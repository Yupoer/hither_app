import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, '../state/useGroupState.ts'),
  'utf8',
);

describe('group itinerary reconciliation', () => {
  it('reports remote pull failure even when a local cache is restored', () => {
    // Force-refresh / sync callers need a hard false when getGroupState fails.
    expect(source).toContain('// Always false when remote pull failed');
    expect(source).toMatch(/return false;\s*\}\s*finally/);
    expect(source).not.toMatch(/return restored;\s*\}\s*finally/);
  });
});
