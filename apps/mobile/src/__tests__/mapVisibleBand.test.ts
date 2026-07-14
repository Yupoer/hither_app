import {
  DEFAULT_LATITUDE_DELTA,
  latOffsetForVisibleBand,
} from '../components/mapCameraMath';

describe('latOffsetForVisibleBand', () => {
  const H = 800;
  const delta = DEFAULT_LATITUDE_DELTA;

  it('returns 0 when top and bottom pads are equal', () => {
    expect(latOffsetForVisibleBand(delta, 100, 100, H)).toBe(0);
  });

  it('returns 0 when window height is non-positive', () => {
    expect(latOffsetForVisibleBand(delta, 0, 200, 0)).toBe(0);
    expect(latOffsetForVisibleBand(delta, 0, 200, -1)).toBe(0);
  });

  it('returns positive when bottom pad dominates (center shifts up)', () => {
    // bottom 300, top 100 → pin should sit above geometric center
    const offset = latOffsetForVisibleBand(delta, 100, 300, H);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeCloseTo((delta * 200) / (2 * H));
  });

  it('returns negative when top pad dominates (center shifts down)', () => {
    const offset = latOffsetForVisibleBand(delta, 300, 100, H);
    expect(offset).toBeLessThan(0);
    expect(offset).toBeCloseTo((delta * -200) / (2 * H));
  });

  it('swapping top/bottom flips the sign', () => {
    const a = latOffsetForVisibleBand(delta, 80, 220, H);
    const b = latOffsetForVisibleBand(delta, 220, 80, H);
    expect(a).toBeCloseTo(-b);
  });

  it('stage-1-like pads use both top and bottom (not bottom-only)', () => {
    // carousel ~160 + safe top ~50; peek sheet ~80 + bottom float ~50
    // top pad dominates → slight down shift; still must differ from bottom-only.
    const topPad = 50 + 8 + 160;
    const bottomPad = 78 + 53; // sheetHeaderH + (inset.bottom + 19)
    const offset = latOffsetForVisibleBand(delta, topPad, bottomPad, H);
    const bottomOnly = latOffsetForVisibleBand(delta, 0, bottomPad, H);
    // Default toBeCloseTo precision (2) is too coarse for these small deltas.
    expect(offset).not.toBeCloseTo(bottomOnly, 6);
    expect(offset).toBeCloseTo((delta * (bottomPad - topPad)) / (2 * H), 10);
  });
});
