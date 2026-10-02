import { loadingDotOffset, authLoadingMotionAllowed } from '../utils/loadingDots';

it('repeats continuously with the original 100ms stagger within an 800ms wave', () => {
  for (let dot = 0; dot < 3; dot++) {
    const peak = 0.5 + dot / 8;
    expect(loadingDotOffset(peak, dot)).toBeCloseTo(-20);
    expect(loadingDotOffset(peak + 0.5, dot)).toBeCloseTo(0);
    for (let step = 0; step <= 12; step++) {
      const phase = step / 12;
      expect(loadingDotOffset(phase, dot)).toBeCloseTo(loadingDotOffset(phase + 1, dot));
      expect(loadingDotOffset(phase + dot / 8, dot)).toBeCloseTo(loadingDotOffset(phase, 0));
    }
  }
});

it('keeps visible auth feedback moving while inactive, but respects background and pressure', () => {
  expect(authLoadingMotionAllowed('active', null, null)).toBe(true);
  expect(authLoadingMotionAllowed('inactive', 'nominal', false)).toBe(true);
  expect(authLoadingMotionAllowed('background', 'nominal', false)).toBe(false);
  expect(authLoadingMotionAllowed('inactive', 'critical', false)).toBe(false);
  expect(authLoadingMotionAllowed('active', 'nominal', true)).toBe(false);
});
