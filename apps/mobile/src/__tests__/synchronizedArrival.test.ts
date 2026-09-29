import { canEvaluateSynchronizedArrival, synchronizedArrivalTargetKey } from '../utils/synchronizedArrival';
import { shouldFireApproachNotify } from '../utils/approachNotify';

describe('synchronized arrival', () => {
  const fix = { sampledAt: 10_000, now: 20_000, accuracyM: 10, radiusM: 50 };
  it('evaluates a fresh fix immediately when a target arrives without movement', () => {
    expect(canEvaluateSynchronizedArrival(fix)).toBe(true);
  });
  it.each([null, undefined, -1, NaN, Infinity, 51, 90])('rejects uncertain accuracy %s', accuracyM => {
    expect(canEvaluateSynchronizedArrival({ ...fix, accuracyM })).toBe(false);
  });
  it.each([null, -10_000, 20_001, NaN])('rejects stale or invalid timestamps %s', sampledAt => {
    expect(canEvaluateSynchronizedArrival({ ...fix, sampledAt })).toBe(false);
  });
  it('does not replay approach before an already-inside arrival is persisted', () => {
    expect(shouldFireApproachNotify({ remainingM: 20, totalM: 2000, arrivalRadiusM: 50,
      arrived: false, alreadyFired: false })).toBe(false);
    expect(shouldFireApproachNotify({ remainingM: 200, totalM: 2000, arrivalRadiusM: 50,
      arrived: false, alreadyFired: false })).toBe(true);
  });
  it('invalidates fix deduplication when the same target moves or its arrival radius changes', () => {
    const target = { id: 'same-stop', coordinates: { latitude: 25, longitude: 121 } };
    const key = synchronizedArrivalTargetKey('trip', target, 50);
    expect(synchronizedArrivalTargetKey('trip', { ...target }, 50)).toBe(key);
    expect(synchronizedArrivalTargetKey('trip', { ...target, coordinates: { latitude: 25.1, longitude: 121 } }, 50)).not.toBe(key);
    expect(synchronizedArrivalTargetKey('trip', target, 100)).not.toBe(key);
    expect(synchronizedArrivalTargetKey(null, target, 50)).not.toBe(key);
    expect(canEvaluateSynchronizedArrival({ ...fix, radiusM: Infinity })).toBe(false);
  });
});
