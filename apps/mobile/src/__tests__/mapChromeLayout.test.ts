import {
  COMPASS_BELOW_TOP_CHROME,
  gatherCardHorizontalInset,
  mapKitChromeLayout,
} from '../utils/mapChromeLayout';

describe('MapKit chrome layout', () => {
  it.each([
    ['iPhone portrait', { top: 59, right: 0, bottom: 34, left: 0 }, 132, 14],
    ['iPhone landscape', { top: 0, right: 44, bottom: 21, left: 44 }, 96, 14],
    ['iPad portrait Peak', { top: 24, right: 0, bottom: 20, left: 0 }, 188, 14],
    ['narrow gather-card inset', { top: 59, right: 0, bottom: 34, left: 0 }, 132, 10],
  ])('%s aligns compass/logo to card inset, not detent', (_name, safeArea, topChrome, inset) => {
    const layout = mapKitChromeLayout({
      safeArea,
      topChrome,
      horizontalInset: inset,
    });
    expect(layout.compassOffset.x).toBe(inset);
    expect(layout.compassOffset.y).toBe(topChrome + COMPASS_BELOW_TOP_CHROME);
    expect(layout.appleLogoInsets.left).toBe(inset);
    expect(layout.appleLogoInsets.bottom).toBe(safeArea.bottom);
    expect(layout.appleLogoInsets.bottom).not.toBe(topChrome);
  });

  it('does not depend on a bottom-sheet detent', () => {
    const base = mapKitChromeLayout({
      safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
      topChrome: 132,
      horizontalInset: 14,
    });
    const afterSheetResize = mapKitChromeLayout({
      safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
      topChrome: 132,
      horizontalInset: 14,
    });
    expect(afterSheetResize).toEqual(base);
  });

  it('uses 10/14 gather-card inset and keeps compass below the top card', () => {
    expect(gatherCardHorizontalInset(375)).toBe(10);
    expect(gatherCardHorizontalInset(430)).toBe(14);
    const layout = mapKitChromeLayout({
      safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
      topChrome: 140,
      horizontalInset: 10,
    });
    expect(layout.compassOffset.y).toBeGreaterThanOrEqual(140 + COMPASS_BELOW_TOP_CHROME);
  });
});
