import { nearestDetent, settleTarget } from '../components/sheetMath';

const DETENTS = [78, 460, 840]; // peek / mid / full

describe('nearestDetent', () => {
  it('picks the closest detent', () => {
    expect(nearestDetent(100, DETENTS)).toBe(0);
    expect(nearestDetent(600, DETENTS)).toBe(1);
    expect(nearestDetent(839, DETENTS)).toBe(2);
  });
});

describe('settleTarget (stepwise detent snap)', () => {
  it('stays put on a sub-threshold wobble', () => {
    expect(settleTarget({ dy: -8, vy: -0.1 }, 460, DETENTS)).toBe(1);
  });

  it('an intentional slow up-swipe advances one detent', () => {
    expect(settleTarget({ dy: -60, vy: -0.1 }, 460, DETENTS)).toBe(2);
  });

  it('a strong upward fling from peek still only reaches mid — never skips a stage', () => {
    expect(settleTarget({ dy: -40, vy: -1.2 }, 78, DETENTS)).toBe(1);
  });

  it('a pull-down at full collapses one detent', () => {
    expect(settleTarget({ dy: 90, vy: 0.3 }, 840, DETENTS)).toBe(1);
  });

  it('a long hard drag down from full still stops at mid', () => {
    expect(settleTarget({ dy: 700, vy: 3 }, 840, DETENTS)).toBe(1);
  });

  it('never over-runs the detent range', () => {
    expect(settleTarget({ dy: -900, vy: -3 }, 840, DETENTS)).toBe(2);
    expect(settleTarget({ dy: 900, vy: 3 }, 78, DETENTS)).toBe(0);
  });
});
