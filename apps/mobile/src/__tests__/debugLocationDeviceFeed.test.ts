import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('debug location device feed', () => {
  const source = readFileSync(
    join(__dirname, '../screens/MapScreen/hooks/useDeviceLocation.ts'),
    'utf8',
  );

  it('updates UI from debug route without enqueuing location outbox', () => {
    const start = source.indexOf('// DEV debug route');
    const end = source.indexOf('// Expo watch is fallback', start);
    const debugSubscription = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(debugSubscription).toContain('applySampleToUi(sample, now)');
    expect(debugSubscription).not.toContain('enqueueUpload(sample');
  });

  it('preserves sample accuracy and uses 20s foreground outbox flush delay', () => {
    expect(source).toContain('? { accuracy: sample.accuracy }');
    expect(source).toContain('const OUTBOX_FLUSH_DELAY_MS = 20_000');
  });
});
