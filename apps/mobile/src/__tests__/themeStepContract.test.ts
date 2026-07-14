import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_ORDER } from '../theme';

const themeStep = readFileSync(
  join(__dirname, '../onboarding/steps/ThemeStep.tsx'),
  'utf8',
);

describe('ThemeStep layout contract', () => {
  it('exposes all four selectable themes', () => {
    expect(THEME_ORDER).toEqual(['night', 'day', 'dusk', 'forest']);
  });

  it('uses fixed 2-row flex layout instead of percent-width flexWrap', () => {
    // Absolute-only preview kids + width:'47%' + flexWrap collapsed cards to 0 height.
    expect(themeStep).toContain('styles.row');
    expect(themeStep).toContain('THEME_ORDER.slice(0, 2)');
    expect(themeStep).toContain('THEME_ORDER.slice(2, 4)');
    expect(themeStep).toContain('flex: 1');
    expect(themeStep).toMatch(/minHeight:\s*15[68]/);
    expect(themeStep).toContain('cardScaffold');
    expect(themeStep).not.toMatch(/width:\s*'47%'/);
    expect(themeStep).not.toMatch(/flexWrap:\s*'wrap'/);
  });

  it('avoids whole-card selected scale (keeps edges crisp)', () => {
    // Permanent selected scale + overflow:hidden looks soft/low-res on iOS.
    expect(themeStep).not.toMatch(/selected\s*\?\s*1\.03/);
    expect(themeStep).toContain('scale: 0.98');
  });

  it('keeps live theme apply and four a11y theme buttons', () => {
    expect(themeStep).toContain('setThemeName');
    expect(themeStep).toContain("accessibilityRole=\"button\"");
    expect(themeStep).toContain('onboarding.theme.night');
    expect(themeStep).toContain('onboarding.theme.day');
    expect(themeStep).toContain('onboarding.theme.dusk');
    expect(themeStep).toContain('onboarding.theme.forest');
  });
});

