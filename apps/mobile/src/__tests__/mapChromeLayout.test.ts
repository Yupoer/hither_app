import {
  COMPASS_BELOW_TOP_CHROME,
  COMPASS_HORIZONTAL_CENTER_ADJUSTMENT,
  gatherCardHorizontalInset,
  mapKitChromeLayout,
} from '../utils/mapChromeLayout';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');

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
    expect(layout.compassOffset.x).toBe(inset + COMPASS_HORIZONTAL_CENTER_ADJUSTMENT);
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

  it('places compass above the recenter capsule and hides it at stage two/full', () => {
    const peek = mapKitChromeLayout({
      safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
      topChrome: 140,
      horizontalInset: 14,
      windowHeight: 844,
      bottomChrome: 210,
      stage: 'peek',
    });
    expect(peek.compassVisible).toBe(true);
    expect(peek.compassOffset.y).toBe(844 - 210 - 96 - 8 - 32);
    expect(peek.compassOffset.x).toBe(14 + COMPASS_HORIZONTAL_CENTER_ADJUSTMENT);
    expect(mapKitChromeLayout({
      safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
      topChrome: 140,
      horizontalInset: 14,
      windowHeight: 844,
      bottomChrome: 210,
      stage: 'full',
    }).compassVisible).toBe(false);
  });

  it.each([
    ['portrait', 844, 210, 59],
    ['landscape', 390, 160, 0],
    ['dynamic type', 932, 260, 59],
  ])('reserves an 8pt card gap above the compass in %s', (_name, height, bottomChrome, top) => {
    const layout = mapKitChromeLayout({
      safeArea: { top, right: 0, bottom: 34, left: 0 },
      topChrome: 0,
      horizontalInset: 14,
      windowHeight: height,
      bottomChrome,
      stage: 'peek',
    });
    const carouselTop = top + 8;
    expect(layout.compassOffset.y - carouselTop - 8).toBeGreaterThanOrEqual(0);
  });

  it('derives carousel height from the same compass coordinate', () => {
    expect(mapScreen).toContain('const compassTop = mapKitChromeLayout({');
    expect(mapScreen).toContain('compassTop - (insets.top + 8) - 8');
    expect(mapScreen).toContain('maxHeight: carouselMaxHeight');
  });
});
