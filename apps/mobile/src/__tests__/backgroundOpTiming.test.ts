import {
  compactBackgroundTimeline,
  exceedsWatchdogBudget,
  nextBackgroundCallbackId,
  timeBackgroundStage,
  type BackgroundOpTimingEntry,
} from '../utils/backgroundOpTiming';
import { classifyCrashClass } from '../utils/crashClass';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('background op timing helpers', () => {
  it('records stage elapsed and success flags', async () => {
    const stages: BackgroundOpTimingEntry[] = [];
    const value = await timeBackgroundStage(stages, 'config_load', async () => 42);
    expect(value).toBe(42);
    expect(stages).toHaveLength(1);
    expect(stages[0].stage).toBe('config_load');
    expect(stages[0].success).toBe(true);
    expect(stages[0].elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('records failed stages then rethrows', async () => {
    const stages: BackgroundOpTimingEntry[] = [];
    await expect(
      timeBackgroundStage(stages, 'outbox_flush', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(stages[0]).toMatchObject({ stage: 'outbox_flush', success: false });
  });

  it('compacts timeline without coordinates or tokens', () => {
    const text = compactBackgroundTimeline({
      callbackId: 'bg-3',
      startedAt: 1,
      totalMs: 120,
      stages: [
        { stage: 'config_load', elapsedMs: 10, success: true },
        { stage: 'outbox_flush', elapsedMs: 80, success: false },
      ],
    });
    expect(text).toContain('bg-3');
    expect(text).toContain('config_load:10');
    expect(text).toContain('outbox_flush:80!');
    expect(text).not.toMatch(/\d+\.\d{3,}/); // no lat/lng
    expect(text.length).toBeLessThanOrEqual(200);
  });

  it('flags near-watchdog budgets at 8s default', () => {
    expect(exceedsWatchdogBudget(7_999)).toBe(false);
    expect(exceedsWatchdogBudget(8_000)).toBe(true);
  });

  it('issues distinct callback ids', () => {
    const a = nextBackgroundCallbackId();
    const b = nextBackgroundCallbackId();
    expect(a).not.toBe(b);
  });

  it('background journey task wires timed stages (source contract)', () => {
    const src = readFileSync(
      join(__dirname, '../state/backgroundJourney.ts'),
      'utf8',
    );
    expect(src).toContain('timeBackgroundStage');
    expect(src).toContain('background_op_timeline');
    expect(src).toContain('background_op_near_watchdog');
    expect(src).toContain('compactBackgroundTimeline');
    // Budget headroom does not mark completed callbacks as success:false.
    expect(src).toContain('success: true');
    expect(src).toMatch(/void diagnostics[\s\S]*background_op/);
    // Semantics preserved — still ack / outbox / Live Activity.
    expect(src).toContain('ackNavigationSession');
    expect(src).toContain('flushLocationOutbox');
    expect(src).toContain('updateAllGroupActivities');
    expect(src).toContain("timeBackgroundStage(stages, 'outbox_flush', () => purgeLocationOutbox())");
  });
});

describe('crash class distinction', () => {
  it('separates react_render, watchdog, sig11, sig10', () => {
    expect(classifyCrashClass({ event: 'react_render' })).toBe('react_render');
    expect(
      classifyCrashClass({ terminationReason: '0x8BADF00D watchdog' }),
    ).toBe('watchdog');
    expect(classifyCrashClass({ signal: 11 })).toBe('sig11');
    expect(classifyCrashClass({ signal: 10 })).toBe('sig10');
    expect(
      classifyCrashClass({ exceptionType: 'EXC_BAD_ACCESS' }),
    ).toBe('sig11');
    expect(
      classifyCrashClass({ event: 'previous_launch_incomplete' }),
    ).toBe('previous_launch_incomplete');
  });

  it('classifies MetricKit spool JSON without requiring full schema', () => {
    const { classifyMetricPayload } = require('../utils/crashClass') as typeof import('../utils/crashClass');
    expect(
      classifyMetricPayload(
        'diagnostic',
        JSON.stringify({ terminationReason: '0x8BADF00D watchdog' }),
      ),
    ).toBe('watchdog');
    expect(
      classifyMetricPayload(
        'diagnostic',
        JSON.stringify({ exceptionType: 'EXC_BAD_ACCESS' }),
      ),
    ).toBe('sig11');
  });

  it('App wires crash class into previous_launch and metric drain (source)', () => {
    const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toContain('classifyCrashClass');
    expect(app).toContain('classifyMetricPayload');
    expect(app).toContain('metric_payload_classified');
    expect(app).toContain("event: 'previous_launch_incomplete'");
  });
});
