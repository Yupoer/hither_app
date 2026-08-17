import {
  APPROACH_NOTIFY_RATIO,
  approachNotifyCopy,
  approachNotifyKey,
  shouldFireApproachNotify,
} from '../utils/approachNotify';

describe('shouldFireApproachNotify (#197)', () => {
  const base = {
    remainingM: 200,
    totalM: 1000,
    arrivalRadiusM: 50,
    arrived: false,
    alreadyFired: false,
  };

  it('fires when remaining first crosses total/5', () => {
    expect(APPROACH_NOTIFY_RATIO).toBeCloseTo(0.2);
    expect(shouldFireApproachNotify({ ...base, remainingM: 201 })).toBe(false);
    expect(shouldFireApproachNotify({ ...base, remainingM: 200 })).toBe(true);
    expect(shouldFireApproachNotify({ ...base, remainingM: 50 })).toBe(true);
  });

  it('skips when already arrived', () => {
    expect(shouldFireApproachNotify({ ...base, arrived: true })).toBe(false);
  });

  it('skips when arrival radius is larger than total/5', () => {
    expect(
      shouldFireApproachNotify({
        ...base,
        arrivalRadiusM: 201,
        remainingM: 100,
      }),
    ).toBe(false);
  });

  it('skips when the per-destination flag already fired', () => {
    expect(shouldFireApproachNotify({ ...base, alreadyFired: true })).toBe(false);
  });

  it('is local-only copy with destination title in the body', () => {
    expect(approachNotifyCopy('台北車站')).toEqual({
      title: '快到目的地了',
      body: '「台北車站」',
    });
    expect(approachNotifyKey('sess-1', 'dest-9')).toBe('sess-1:dest-9');
  });
});
