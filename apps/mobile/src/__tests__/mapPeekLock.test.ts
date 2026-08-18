import { halfPeekOffset, oversizedMapStyle } from '../utils/mapPeekLock';

describe('map peek lock', () => {
  it('shifts the map down and right by half the peek height', () => {
    expect(halfPeekOffset(160)).toBe(80);
    const style = oversizedMapStyle(390, 844, 80);
    expect(style.width).toBe(470);
    expect(style.height).toBe(924);
    expect(style.transform).toEqual([{ translateX: 80 }, { translateY: 80 }]);
  });
});
