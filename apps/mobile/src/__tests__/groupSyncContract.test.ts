import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, '../state/useGroupState.ts'),
  'utf8',
);

describe('group itinerary reconciliation', () => {
  it('keeps a slow reconciliation poll even when Realtime is subscribed', () => {
    expect(source).toContain('GROUP_POLL_INTERVAL_MS');
    expect(source).toMatch(/setInterval\([\s\S]*loadRef\.current\(\)/);
    expect(source).not.toMatch(/if \(!realtimeReadyRef\.current\) \{\s*void loadRef\.current\(\);\s*\}/);
  });
});
