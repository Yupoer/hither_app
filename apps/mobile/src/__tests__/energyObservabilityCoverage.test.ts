import {
  __resetEnergyObservabilityForTests,
  configureEnergySignpost,
  energyObservability,
} from '../state/energyObservability';

describe('energy observability defensive exports', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetEnergyObservabilityForTests();
  });

  afterEach(() => {
    __resetEnergyObservabilityForTests();
    jest.useRealTimers();
  });

  it('normalizes unknown state/mode values and exposes counter snapshots', () => {
    energyObservability.setAppState('foreground-but-not-active');
    expect(energyObservability.getAppState()).toBe('unknown');
    energyObservability.setTrackingMode('unrecognized-mode');
    expect(energyObservability.getTrackingMode()).toBe('unknown');
    energyObservability.increment('render', 2);
    expect(energyObservability.snapshotCounters()).toMatchObject({
      delta: expect.objectContaining({ render: 2 }),
      cumulative: expect.objectContaining({ render: 2 }),
    });
    energyObservability.markLaunch(Number.NaN);
    energyObservability.markLaunch(100);
  });

  it('isolates native signpost failures and handles rejected sample handlers', async () => {
    configureEnergySignpost(async () => {
      throw new Error('native signpost unavailable');
    });
    energyObservability.event('launch');
    energyObservability.beginSpan('snapshot');
    energyObservability.endSpan('snapshot');
    await Promise.resolve();

    const samples: unknown[] = [];
    energyObservability.setAppState('active');
    const controller = energyObservability.start(async (sample) => {
      samples.push(sample);
      throw new Error('sample consumer failed');
    }, { startupOffsetsMs: [0], steadyIntervalMs: null });
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    expect(samples).toHaveLength(1);
    controller.stop();

    configureEnergySignpost(null);
    energyObservability.event('launch');
    __resetEnergyObservabilityForTests();
    energyObservability.event('launch');
  });
});
