import {
  configureEnergySignpost,
  __resetEnergyObservabilityForTests,
  ENERGY_SIGNPOST_NAMES,
  ENERGY_STARTUP_SAMPLE_OFFSETS_MS,
  ENERGY_STEADY_SAMPLE_INTERVAL_MS,
  energyObservability,
  type EnergyObservationSample,
} from '../state/energyObservability';

const signpost = jest.fn(async () => undefined);

describe('energyObservability', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetEnergyObservabilityForTests();
    configureEnergySignpost(signpost);
    signpost.mockClear();
  });

  afterEach(() => {
    __resetEnergyObservabilityForTests();
    jest.useRealTimers();
  });

  it('emits one startup sample at each bounded offset and then one steady sample per five minutes', () => {
    const samples: EnergyObservationSample[] = [];
    const controller = energyObservability.start((sample) => {
      samples.push(sample);
    });

    jest.advanceTimersByTime(0);
    expect(samples.map((sample) => sample.startupOffsetMs)).toEqual([0]);

    jest.advanceTimersByTime(120_000);
    expect(samples.map((sample) => sample.startupOffsetMs)).toEqual([
      ...ENERGY_STARTUP_SAMPLE_OFFSETS_MS,
    ]);

    jest.advanceTimersByTime(ENERGY_STEADY_SAMPLE_INTERVAL_MS - 120_000);
    expect(samples).toHaveLength(6);
    expect(samples[5]?.kind).toBe('steady');

    controller.stop();
  });

  it('cancels pending startup samples on background and does not backfill them on foreground', () => {
    const samples: EnergyObservationSample[] = [];
    energyObservability.start((sample) => {
      samples.push(sample);
    });

    jest.advanceTimersByTime(0);
    energyObservability.setAppState('background');
    jest.advanceTimersByTime(120_000);
    expect(samples).toHaveLength(1);

    energyObservability.setAppState('active');
    jest.advanceTimersByTime(ENERGY_STEADY_SAMPLE_INTERVAL_MS);
    expect(samples).toHaveLength(2);
    expect(samples[1]?.kind).toBe('steady');
  });

  it('cancels the steady timer on background so no samples fire while inactive', () => {
    const samples: EnergyObservationSample[] = [];
    energyObservability.start((sample) => {
      samples.push(sample);
    });

    jest.advanceTimersByTime(0);
    expect(samples).toHaveLength(1);

    energyObservability.setAppState('background');
    jest.advanceTimersByTime(ENERGY_STEADY_SAMPLE_INTERVAL_MS * 2);
    expect(samples).toHaveLength(1);

    energyObservability.setAppState('active');
    jest.advanceTimersByTime(ENERGY_STEADY_SAMPLE_INTERVAL_MS);
    expect(samples).toHaveLength(2);
    expect(samples[1]?.kind).toBe('steady');
  });

  it('cancels all unexecuted samples when the controller stops', () => {
    const samples: EnergyObservationSample[] = [];
    const controller = energyObservability.start((sample) => {
      samples.push(sample);
    });
    controller.stop();

    jest.advanceTimersByTime(ENERGY_STEADY_SAMPLE_INTERVAL_MS * 2);
    expect(samples).toHaveLength(0);
  });

  it('captures event counters as deltas and cumulative totals without sensitive fields', () => {
    const samples: EnergyObservationSample[] = [];
    energyObservability.setTrackingMode('teamNavigation');
    energyObservability.start((sample) => {
      samples.push(sample);
    });
    energyObservability.increment('location_callback', 2);
    energyObservability.increment('location_accepted');
    energyObservability.increment('network_request', 3);

    jest.advanceTimersByTime(0);
    expect(samples[0]).toMatchObject({
      appState: 'active',
      trackingMode: 'teamNavigation',
      counters: {
        delta: {
          location_callback: 2,
          location_accepted: 1,
          network_request: 3,
        },
        cumulative: {
          location_callback: 2,
          location_accepted: 1,
          network_request: 3,
        },
      },
    });
    expect(JSON.stringify(samples[0])).not.toMatch(
      /access[_-]?token|invite[_-]?code|transaction|latitude|longitude|coordinate/i,
    );
  });

  it('only forwards the fixed signpost allowlist and opaque span tokens', () => {
    expect(ENERGY_SIGNPOST_NAMES).toEqual([
      'launch',
      'map_ready',
      'location_acquisition',
      'snapshot',
      'route_calculation',
      'marker_tracking',
      'background_transition',
    ]);

    energyObservability.event('map_ready');
    const token = energyObservability.beginSpan('route_calculation');
    energyObservability.endSpan('route_calculation', token ?? undefined);

    expect(signpost).toHaveBeenCalledWith('map_ready', 'event', undefined);
    expect(signpost).toHaveBeenCalledWith('route_calculation', 'begin', token);
    expect(signpost).toHaveBeenCalledWith('route_calculation', 'end', token);
  });
});
