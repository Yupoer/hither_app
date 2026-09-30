import { loadingDotOffset } from '../utils/loadingDots';

it('gives all dots the same period with exactly one third of a cycle between peaks', () => {
  for (let dot = 0; dot < 3; dot++) {
    const peak = 0.5 + dot / 3;
    expect(loadingDotOffset(peak, dot)).toBeCloseTo(-20);
    expect(loadingDotOffset(peak + 0.5, dot)).toBeCloseTo(0);
    for (let step = 0; step <= 12; step++) {
      const phase = step / 12;
      expect(loadingDotOffset(phase, dot)).toBeCloseTo(loadingDotOffset(phase + 1, dot));
      expect(loadingDotOffset(phase + dot / 3, dot)).toBeCloseTo(loadingDotOffset(phase, 0));
    }
  }
});
