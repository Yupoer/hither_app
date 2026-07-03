import { nearestDetent, settleTarget } from '../components/sheetMath';

const DETENTS = [78, 460, 840]; // peek / mid / full

describe('nearestDetent', () => {
  it('picks the closest detent', () => {
    expect(nearestDetent(100, DETENTS)).toBe(0);
    expect(nearestDetent(600, DETENTS)).toBe(1);
    expect(nearestDetent(839, DETENTS)).toBe(2);
  });
});

describe('settleTarget (velocity first, then nearest anchor)', () => {
  it('stays put on a small slow wobble', () => {
    expect(settleTarget({ vy: -0.1 }, 452, 1, DETENTS)).toBe(1);
  });

  it('a slow drag released past the midpoint carries to the next detent', () => {
    expect(settleTarget({ vy: -0.05 }, 300, 0, DETENTS)).toBe(1);
  });

  it('a slow drag released short of the midpoint snaps back', () => {
    expect(settleTarget({ vy: -0.05 }, 220, 0, DETENTS)).toBe(0);
  });

  it('an upward flick steps up regardless of distance travelled', () => {
    expect(settleTarget({ vy: -0.8 }, 120, 0, DETENTS)).toBe(1);
  });

  it('a downward flick overrides being nearer the taller detent', () => {
    expect(settleTarget({ vy: 0.8 }, 400, 0, DETENTS)).toBe(0);
  });

  it('a hard fling never skips a stage', () => {
    expect(settleTarget({ vy: -3 }, 460, 1, DETENTS)).toBe(2);
    expect(settleTarget({ vy: 3 }, 840, 2, DETENTS)).toBe(1);
  });

  it('never over-runs the detent range', () => {
    expect(settleTarget({ vy: -3 }, 840, 2, DETENTS)).toBe(2);
    expect(settleTarget({ vy: 3 }, 78, 0, DETENTS)).toBe(0);
  });
});
