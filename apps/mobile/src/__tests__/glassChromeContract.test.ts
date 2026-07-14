import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const liquidGlass = readFileSync(join(root, 'native/liquidGlass.tsx'), 'utf8');
const glassTokens = readFileSync(join(root, 'glass.ts'), 'utf8');
const appJson = readFileSync(join(__dirname, '../../app.json'), 'utf8');
const infoPlist = readFileSync(join(__dirname, '../../ios/Hither/Info.plist'), 'utf8');

/**
 * Glass chrome is always dark (Apple Maps-style) — independent of OS light
 * mode and of the map day/night theme. These contracts stop regressions that
 * reintroduce white card edges or washed search-sheet materials.
 */
describe('glass chrome always-dark contract', () => {
  it('documents always-dark glass tokens', () => {
    expect(glassTokens).toMatch(/ALWAYS a dark/i);
  });

  it('forces Expo GlassView colorScheme to dark (not auto/OS)', () => {
    expect(liquidGlass).toContain('colorScheme="dark"');
    expect(liquidGlass).not.toMatch(/colorScheme=["']auto["']/);
  });

  it('uses dark blur tint regardless of map theme or OS appearance', () => {
    expect(liquidGlass).toContain('tint="dark"');
    // Must not reintroduce day-theme light blur (washes sheet in light OS).
    expect(liquidGlass).not.toContain("themeName === 'day' ? 'light'");
    expect(liquidGlass).not.toMatch(/blurTint\s*=\s*themeName/);
  });

  it('aligns Expo config and native Info.plist to forced dark UI', () => {
    expect(appJson).toContain('"userInterfaceStyle": "dark"');
    expect(infoPlist).toMatch(
      /<key>UIUserInterfaceStyle<\/key>\s*<string>Dark<\/string>/,
    );
    expect(infoPlist).not.toMatch(
      /<key>UIUserInterfaceStyle<\/key>\s*<string>Automatic<\/string>/,
    );
  });
});
