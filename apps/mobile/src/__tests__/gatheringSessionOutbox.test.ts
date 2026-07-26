/**
 * OTA-01: gathering outbox vs legacy navigation_sessions ordering.
 * Network failure after enqueue must keep start_gathering pending — never flush
 * before a session row can exist.
 */

import { resolveGatheringOutboxAfterSessionStart } from '../utils/gatheringSessionOutbox';
import fs from 'fs';
import path from 'path';

describe('resolveGatheringOutboxAfterSessionStart', () => {
  it('flushes only after session start succeeds', () => {
    expect(resolveGatheringOutboxAfterSessionStart({ ok: true })).toBe('flush');
  });

  it('keeps outbox pending without flush on network error', () => {
    // Regression: previous bug called flushCoreOperationOutbox() here, which
    // could submit start_gathering before navigation_sessions existed.
    expect(
      resolveGatheringOutboxAfterSessionStart({
        ok: false,
        isNetworkError: true,
      }),
    ).toBe('keep_pending');
  });

  it('aborts outbox on non-network business rejection', () => {
    expect(
      resolveGatheringOutboxAfterSessionStart({
        ok: false,
        isNetworkError: false,
      }),
    ).toBe('abort');
  });
});

describe('useJourneyNavigation session/outbox wiring', () => {
  it('routes session errors through the classifier and flushes only on success', () => {
    const journey = fs.readFileSync(
      path.join(__dirname, '../screens/MapScreen/hooks/useJourneyNavigation.ts'),
      'utf8',
    );
    expect(journey).toContain('resolveGatheringOutboxAfterSessionStart');
    expect(journey).toContain('isNetworkRequestError(sessionError)');
    expect(journey).toContain("outboxAction === 'abort'");
    // Success path is the only place that flushes gathering outbox.
    expect(journey.match(/void flushCoreOperationOutbox\(\)/g)?.length).toBe(1);
    // keep_pending path must not flush.
    const keepPendingIdx = journey.indexOf('// keep_pending:');
    expect(keepPendingIdx).toBeGreaterThan(-1);
    const afterKeep = journey.slice(keepPendingIdx, keepPendingIdx + 280);
    expect(afterKeep).not.toContain('flushCoreOperationOutbox');
  });
});
