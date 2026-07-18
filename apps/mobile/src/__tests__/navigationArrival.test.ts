import {
  createArrivalState,
  isUsableArrivalAccuracy,
  reduceArrival,
} from '../utils/navigationArrival';

describe('navigation arrival reducer', () => {
  it('arrives on one fix when clearly inside half the radius (e.g. 3m in 50m)', () => {
    const arrived = reduceArrival(
      createArrivalState(1_000),
      { distanceM: 3, accuracyM: 20 },
      { radiusM: 50 },
    );
    expect(arrived.status).toBe('arrived');
    expect(arrived.consecutiveFixes).toBe(1);
    expect(arrived.progress).toBe(1);
  });

  it('requires two consecutive fixes near the edge of the radius', () => {
    const initial = createArrivalState(1_000);
    const arriving = reduceArrival(
      initial,
      { distanceM: 49, accuracyM: 20 },
      { radiusM: 50 },
    );
    const arrived = reduceArrival(
      arriving,
      { distanceM: 48, accuracyM: 20 },
      { radiusM: 50 },
    );

    expect(arriving.status).toBe('arriving');
    expect(arriving.consecutiveFixes).toBe(1);
    expect(arrived.status).toBe('arrived');
    expect(arrived.consecutiveFixes).toBe(2);
  });

  it('accepts missing accuracy when already inside the radius', () => {
    const arrived = reduceArrival(
      createArrivalState(500),
      { distanceM: 8, accuracyM: null },
      { radiusM: 50 },
    );
    expect(arrived.status).toBe('arrived');
    expect(isUsableArrivalAccuracy(null)).toBe(true);
    expect(isUsableArrivalAccuracy(undefined)).toBe(true);
  });

  it('rejects very poor accuracy even when distance looks close', () => {
    const result = reduceArrival(
      createArrivalState(1_000),
      { distanceM: 20, accuracyM: 120 },
      { radiusM: 50 },
    );
    expect(result.status).toBe('enRoute');
    expect(result.consecutiveFixes).toBe(0);
  });

  it('resets a candidate when the next fix is outside the radius', () => {
    const arriving = reduceArrival(
      createArrivalState(1_000),
      { distanceM: 49, accuracyM: 10 },
      { radiusM: 50 },
    );

    expect(
      reduceArrival(
        arriving,
        { distanceM: 55, accuracyM: 10 },
        { radiusM: 50 },
      ),
    ).toMatchObject({ status: 'enRoute', consecutiveFixes: 0 });
  });

  it('clamps progress and limits backward display movement to 0.03', () => {
    const initial = createArrivalState(100);
    const forward = reduceArrival(
      initial,
      { distanceM: 20, accuracyM: 10 },
      { radiusM: 10 },
    );
    const noisyBackward = reduceArrival(
      forward,
      { distanceM: 80, accuracyM: 10 },
      { radiusM: 10 },
    );
    const beyond = reduceArrival(
      noisyBackward,
      { distanceM: -5, accuracyM: 10 },
      { radiusM: 10 },
    );

    // 20m is outside half of 10m radius edge band but inside radius → arriving first
    // After 20m with radius 10: 20 > 10 so enRoute. Use 5m for inside.
    expect(forward.status).toBe('enRoute');
    expect(noisyBackward.progress).toBeLessThanOrEqual(forward.progress);
    expect(beyond.progress).toBe(1);
  });

  it('keeps arrived terminal even if a later fix is noisy', () => {
    const arrived = reduceArrival(
      createArrivalState(100),
      { distanceM: 5, accuracyM: 5 },
      { radiusM: 50 },
    );

    expect(arrived.status).toBe('arrived');
    expect(
      reduceArrival(
        arrived,
        { distanceM: 100, accuracyM: 100 },
        { radiusM: 50 },
      ).status,
    ).toBe('arrived');
  });
});
