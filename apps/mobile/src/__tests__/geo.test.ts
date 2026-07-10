import { etaSecondsFor } from '../utils/geo';

describe('etaSecondsFor', () => {
  it('drive is faster than transit is faster than walk for the same distance', () => {
    const d = 5000;
    const walk = etaSecondsFor(d, 'walk');
    const transit = etaSecondsFor(d, 'transit');
    const drive = etaSecondsFor(d, 'drive');
    expect(drive).toBeLessThan(transit);
    expect(transit).toBeLessThan(walk);
  });

  it('is proportional to distance', () => {
    expect(etaSecondsFor(2000, 'walk')).toBeCloseTo(2 * etaSecondsFor(1000, 'walk'));
  });
});
