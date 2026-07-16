import {
  createArrivalState,
  reduceArrival,
} from '../utils/navigationArrival';

describe('navigation arrival reducer', () => {
  it('requires two consecutive accurate fixes inside the radius', () => {
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

  it('resets arrival confirmation for inaccurate fixes', () => {
    const arriving = reduceArrival(
      createArrivalState(1_000),
      { distanceM: 49, accuracyM: 20 },
      { radiusM: 50 },
    );

    const result = reduceArrival(
      arriving,
      { distanceM: 20, accuracyM: 80 },
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

    expect(forward.progress).toBe(0.8);
    expect(noisyBackward.progress).toBeCloseTo(0.77);
    expect(beyond.progress).toBe(1);
  });

  it('keeps arrived terminal even if a later fix is noisy', () => {
    const once = reduceArrival(
      createArrivalState(100),
      { distanceM: 5, accuracyM: 5 },
      { radiusM: 10 },
    );
    const arrived = reduceArrival(
      once,
      { distanceM: 5, accuracyM: 5 },
      { radiusM: 10 },
    );

    expect(
      reduceArrival(
        arrived,
        { distanceM: 100, accuracyM: 100 },
        { radiusM: 10 },
      ).status,
    ).toBe('arrived');
  });
});
