import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (name: string) => readFileSync(join(root, name), 'utf8');

describe('map chrome native surface contract', () => {
  it('uses one vertical glass surface with plain inner controls', () => {
    const map = read('screens/MapScreen.tsx');
    const native = read('components/MapRecenterControl.ios.tsx');
    expect(map).toContain('<MapRecenterControl');
    expect(map).toContain('chromeStage={chromeStage}');
    expect(map).toContain('chromeBottomOffset={chromeBottomOffset}');
    expect(native).toContain("buttonStyle('plain')");
    expect(native).toContain('glassEffect({ glass: { variant: \'regular\'');
    expect(native).toContain('<Divider />');
  });

  it('keeps iOS map cards neutral and Android fallbacks tokenized', () => {
    const map = read('screens/MapScreen.tsx');
    expect(map).toContain("Platform.OS === 'android'");
    expect(map).toContain('tintColor={Platform.OS === \'android\'');
    expect(map).toContain('styles.locationSharingButton');
    expect(map).toContain('name={sharingEnabled ? \'eye-outline\' : \'eye-off-outline\'}');
    expect(map).toContain('width: 44');
    expect(map).toContain('height: 44');
  });

  it('uses the approved add-place and arrival control sizes', () => {
    const map = read('screens/MapScreen.tsx');
    expect(map).toContain('confirmArrow: {');
    expect(map).toContain('confirmControl: {');
    expect(map).toContain('width: 60');
    expect(map).toContain('height: 60');
    expect(map).not.toContain('size={80}');
    expect(map).not.toContain('height={96}');
    expect((map.match(/size=\{36\}/g) ?? [])).toHaveLength(2);
  });
});
