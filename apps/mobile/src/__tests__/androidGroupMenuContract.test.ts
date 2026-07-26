import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');

describe('sheet more-button settings contract', () => {
  it('opens Settings directly without an Android Alert or iOS action sheet menu', () => {
    const openIdx = source.indexOf('const openSettingsFromSheet');
    expect(openIdx).toBeGreaterThanOrEqual(0);
    const openBlock = source.slice(openIdx, openIdx + 500);
    expect(openBlock).toContain("'map.open_settings'");
    expect(openBlock).toContain("setOverlay('settings')");
    expect(openBlock).not.toContain('ActionSheetIOS');
    expect(openBlock).not.toContain('Alert.alert');
    expect(source).not.toContain('const openGroupMenu');
    expect(source).not.toContain('ActionSheetIOS');
  });
});
