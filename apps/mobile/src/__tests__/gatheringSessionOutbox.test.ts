/** OTA-01: gathering commands are durable before any remote reconciliation. */

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

describe('useJourneyNavigation durable command wiring', () => {
  it('queues gathering commands before the single outbox flush path', () => {
    const journey = fs.readFileSync(
      path.join(__dirname, '../screens/MapScreen/hooks/useJourneyNavigation.ts'),
      'utf8',
    );
    expect(journey).toContain('enqueueLeaderGatheringStart');
    expect(journey).toContain('enqueueLeaderGatheringSwitch');
    expect(journey).toContain('enqueueLeaderGatheringEnd');
    expect(journey).toContain('flushImmediately: false');
    expect(journey).toContain('void flushCoreOperationOutbox().then');
    // There is no independent online-only session mutation or partial reorder.
    expect(journey).not.toContain('startSession(');
    expect(journey).not.toContain('reorderForNavigation(');
    expect(journey).not.toContain('promoteDestinationWithinDay');
  });
});
