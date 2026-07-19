import {
  debugRouteSampleAt,
  getDebugLocationSample,
  isDebugRouteActive,
  startDebugRoute,
  stopDebugRoute,
} from '../native/debugLocation';

describe('debugRouteSampleAt', () => {
  const config = {
    destination: { latitude: 25.05, longitude: 121.52 },
    simulatedDurationMs: 60_000,
    playbackRate: 5,
  };

  it('starts at progress 0 with finite coordinates', () => {
    const sample = debugRouteSampleAt(config, 0);
    expect(sample.progress).toBe(0);
    expect(Number.isFinite(sample.coordinates.latitude)).toBe(true);
    expect(Number.isFinite(sample.coordinates.longitude)).toBe(true);
    expect(Number.isFinite(sample.timestamp)).toBe(true);
  });

  it('hits midpoint at half effective duration', () => {
    // playbackRate 5 → wall 6s covers 30s of simulated time → progress 0.5
    expect(debugRouteSampleAt(config, 6_000).progress).toBeCloseTo(0.5);
  });

  it('ends at destination with progress 1', () => {
    const end = debugRouteSampleAt(config, 12_000);
    expect(end.progress).toBe(1);
    expect(end.coordinates.latitude).toBe(config.destination.latitude);
    expect(end.coordinates.longitude).toBe(config.destination.longitude);
  });

  it('clamps progress above the simulated duration', () => {
    expect(debugRouteSampleAt(config, 999_000).progress).toBe(1);
  });
});

describe('startDebugRoute / stopDebugRoute', () => {
  afterEach(() => {
    stopDebugRoute();
  });

  it('activates only while started and exposes a sample', () => {
    expect(isDebugRouteActive()).toBe(false);
    startDebugRoute({
      destination: { latitude: 25.05, longitude: 121.52 },
      simulatedDurationMs: 60_000,
      playbackRate: 1,
    });
    expect(isDebugRouteActive()).toBe(true);
    const sample = getDebugLocationSample();
    expect(sample).not.toBeNull();
    expect(sample!.coordinates.latitude).toBeGreaterThan(25.05);
    stopDebugRoute();
    expect(isDebugRouteActive()).toBe(false);
    expect(getDebugLocationSample()).toBeNull();
  });
});
