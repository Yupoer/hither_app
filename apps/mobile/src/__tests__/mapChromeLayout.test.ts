import { mapKitChromeLayout } from '../utils/mapChromeLayout';

describe('MapKit chrome layout', () => {
  it.each([
    ['iPhone portrait', { top: 59, right: 0, bottom: 34, left: 0 }, 132],
    ['iPhone landscape', { top: 0, right: 44, bottom: 21, left: 44 }, 96],
    ['iPad portrait Peak', { top: 24, right: 0, bottom: 20, left: 0 }, 188],
    ['iPad landscape Stage', { top: 24, right: 24, bottom: 20, left: 24 }, 256],
  ])('%s reserves safe-area and top-card space', (_name, safeArea, topChrome) => {
    const layout = mapKitChromeLayout({ safeArea, topChrome });
    expect(layout.compassOffset.x).toBeGreaterThanOrEqual(56);
    expect(layout.compassOffset.y).toBeGreaterThanOrEqual(topChrome + 16);
    expect(layout.appleLogoInsets.bottom).toBe(safeArea.bottom + 12);
    expect(layout.appleLogoInsets.bottom).not.toBe(topChrome);
  });

  it('does not depend on a bottom-sheet detent', () => {
    const base = mapKitChromeLayout({
      safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
      topChrome: 132,
    });
    const afterSheetResize = mapKitChromeLayout({
      safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
      topChrome: 132,
    });
    expect(afterSheetResize).toEqual(base);
  });
});
