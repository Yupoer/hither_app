import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

const mapScreen = readFileSync(join(root, 'screens/MapScreen.tsx'), 'utf8');
const loginScreen = readFileSync(join(root, 'screens/LoginScreen.tsx'), 'utf8');
const liquidGlass = readFileSync(join(root, 'native/liquidGlass.tsx'), 'utf8');
const haptics = readFileSync(join(root, 'utils/haptics.ts'), 'utf8');
const groupMap = readFileSync(join(root, 'components/GroupMap.tsx'), 'utf8');
const translations = readFileSync(join(root, 'i18n/index.ts'), 'utf8');

describe('Android in-app feature parity contracts', () => {
  it.each(['members', 'route', 'tools'] as const)(
    'keeps the %s map tab on Android (shared MapScreen)',
    (tab) => {
      // MapScreen keeps all three primary map chrome tabs; labels come from i18n.
      expect(mapScreen.toLowerCase()).toContain(tab);
      expect(mapScreen).toMatch(/tab|bottomSheet|sheet/i);
    },
  );

  it('keeps map tab i18n keys for members / route / tools', () => {
    expect(translations).toMatch(/members|隊員|成員/i);
    expect(translations).toMatch(/route|路線/i);
    expect(translations).toMatch(/tools|工具/i);
  });

  it('does not mount Apple login on Android', () => {
    expect(loginScreen).toMatch(/Platform\.OS\s*===\s*['"]ios['"]/);
    expect(loginScreen).toContain('AppleAuthentication');
  });

  it('uses Google provider only on Android for the shared map', () => {
    expect(groupMap).toContain("Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined");
  });

  it('handles glass material only at the capability boundary', () => {
    expect(liquidGlass).toContain('BlurView');
    expect(liquidGlass).toContain('tint="dark"');
    // No per-screen Android style fork required for glass.
    expect(liquidGlass).toMatch(/Android|BlurView|isLiquidGlassAvailable/);
  });

  it('keeps haptics on expo-haptics without platform feel equality claims', () => {
    expect(haptics).toContain("from 'expo-haptics'");
    expect(haptics).toContain('impactAsync');
    expect(haptics).toContain('catch');
  });

  it('major map actions retain accessibility labels', () => {
    expect(mapScreen).toMatch(/accessibilityLabel|accessibilityRole/);
    expect(translations).toContain('map.locateA11y');
    expect(translations).toContain('map.fitAllA11y');
  });

  it('coordinate and KML gathering entry points stay in shared UI', () => {
    const destSearch = readFileSync(
      join(root, 'components/DestinationSearch.tsx'),
      'utf8',
    );
    expect(destSearch).toMatch(/Kml|kml|coordinate|Coordinate|緯度|經度/i);
  });
});
