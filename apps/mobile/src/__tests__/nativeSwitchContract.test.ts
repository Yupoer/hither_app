import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) =>
  readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const systemToggle = read('components/SystemToggle.tsx');
const nativeSwitch = read('components/NativeSwitch.tsx');
const settings = read('screens/MapScreen/components/SettingsOverlay.tsx');
const notifCard = read('components/NotificationPreferencesCard.tsx');
const mapScreen = read('screens/MapScreen.tsx');

describe('SystemToggle iOS/Android chrome', () => {
  it('renders @expo/ui Switch inside Host and is not RN Switch', () => {
    expect(systemToggle).toContain("from '@expo/ui'");
    expect(systemToggle).toContain('<Switch');
    expect(systemToggle).toContain('<Host');
    expect(systemToggle).not.toContain("Switch } from 'react-native'");
    expect(systemToggle).not.toContain('trackColor');
    expect(systemToggle).not.toContain('thumbColor');
    expect(systemToggle).not.toContain('ios_backgroundColor');
  });

  it('screens use SystemToggle instead of NativeSwitch / RN Switch', () => {
    expect(settings).toContain('<SystemToggle');
    expect(notifCard).toContain('<SystemToggle');
    expect(mapScreen).toContain('<SystemToggle');
    expect(settings).not.toContain('<NativeSwitch');
    expect(notifCard).not.toContain('<NativeSwitch');
    expect(mapScreen).not.toContain('<NativeSwitch');
    expect(nativeSwitch).toContain("from './SystemToggle'");
  });
});
