import { accentOver, shade } from '../glass';
import { themes, type ThemeName } from '../theme';
import { shouldHighlightStayDuplicate } from '../utils/accommodationSemantics';

const place = (overrides: Partial<Parameters<typeof shouldHighlightStayDuplicate>[0]> = {}) => ({
  kind: 'stop' as const,
  title: 'Comfort Hotel Tokyo Kiyosumi Shirakawa',
  coordinates: { latitude: 35.681236, longitude: 139.767125 },
  ...overrides,
});

describe('stay duplicate warning semantics', () => {
  it('does not warn ordinary stops when no accommodation is set', () => {
    expect(shouldHighlightStayDuplicate(place())).toBe(false);
  });

  it('requires the same normalized name and coordinates', () => {
    const daily = place({ kind: undefined });
    expect(shouldHighlightStayDuplicate(place(), daily)).toBe(true);
    expect(shouldHighlightStayDuplicate(place(), { ...daily, title: 'Different hotel' })).toBe(false);
    expect(shouldHighlightStayDuplicate(place(), {
      ...daily,
      coordinates: { latitude: 35.6813, longitude: 139.767125 },
    })).toBe(false);
  });

  it('never highlights accommodation rows or incomplete places', () => {
    const daily = place();
    expect(shouldHighlightStayDuplicate(place({ kind: 'accommodation' }), daily)).toBe(false);
    expect(shouldHighlightStayDuplicate(place({ coordinates: undefined }), daily)).toBe(false);
    expect(shouldHighlightStayDuplicate(place(), { ...daily, coordinates: undefined })).toBe(false);
  });

  it('produces a muted theme-derived color for every palette', () => {
    (Object.keys(themes) as ThemeName[]).forEach((themeName) => {
      const palette = themes[themeName];
      const color = accentOver(palette.accent, shade(palette.surface, -0.20), 28);
      expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      expect(color).not.toBe(palette.danger);
    });
  });
});
