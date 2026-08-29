import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const liquidGlass = readFileSync(join(root, 'native/liquidGlass.tsx'), 'utf8');
const glassTokens = readFileSync(join(root, 'glass.ts'), 'utf8');
const mapScreen = readFileSync(join(root, 'screens/MapScreen.tsx'), 'utf8');
const bottomSheet = readFileSync(join(root, 'components/BottomSheet.tsx'), 'utf8');
const recenterIos = readFileSync(join(root, 'components/MapRecenterControl.ios.tsx'), 'utf8');
const appJson = readFileSync(join(__dirname, '../../app.json'), 'utf8');
const infoPlist = readFileSync(join(__dirname, '../../ios/Hither/Info.plist'), 'utf8');

/**
 * Native Liquid Glass follows the device appearance/accessibility settings;
 * the legacy blur fallback remains available for older runtimes.
 */
describe('glass chrome native material contract', () => {
  it('keeps stable fallback glass tokens for older runtimes', () => {
    expect(glassTokens).toMatch(/dark fallback/i);
  });

  it('does not force Expo GlassView color scheme or add an artificial underlay', () => {
    expect(liquidGlass).not.toContain('colorScheme="dark"');
    expect(liquidGlass).not.toContain('underlayForTint');
    expect(liquidGlass).toContain('expoIsLiquidGlassAvailable');
    expect(liquidGlass).not.toMatch(/colorScheme=["']auto["']/);
  });

  it('keeps the legacy fallback blur stable without affecting native glass', () => {
    expect(liquidGlass).toContain('tint="dark"');
    // Must not reintroduce day-theme light blur (washes sheet in light OS).
    expect(liquidGlass).not.toContain("themeName === 'day' ? 'light'");
    expect(liquidGlass).not.toMatch(/blurTint\s*=\s*themeName/);
  });

  it('lets Expo and native iOS follow the device appearance', () => {
    expect(appJson).toContain('"userInterfaceStyle": "automatic"');
    expect(infoPlist).toMatch(
      /<key>UIUserInterfaceStyle<\/key>\s*<string>Automatic<\/string>/,
    );
    expect(infoPlist).not.toMatch(
      /<key>UIUserInterfaceStyle<\/key>\s*<string>Dark<\/string>/,
    );
  });

  it('applies map opacity to material layers only', () => {
    expect(glassTokens).toContain('MAP_SURFACE_OPACITY = 0.8');
    expect(liquidGlass).toContain('surfaceOpacity?: number');
    expect(liquidGlass).toMatch(/opacity: surfaceOpacity/);
    expect(bottomSheet).toContain('surfaceOpacity={surfaceOpacity}');
    expect(mapScreen).toContain('surfaceOpacity={MAP_SURFACE_OPACITY}');
    expect(recenterIos).toContain('opacity: MAP_SURFACE_OPACITY');
    // Foreground controls stay outside the opacity wrapper.
    expect(recenterIos.indexOf('</Host>')).toBeLessThan(recenterIos.indexOf('<Pressable'));
  });
});
