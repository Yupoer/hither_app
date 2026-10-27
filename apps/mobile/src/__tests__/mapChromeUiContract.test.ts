import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (name: string) => readFileSync(join(root, name), 'utf8');

describe('map chrome native surface contract', () => {
  it('uses one vertical glass surface with plain inner controls', () => {
    const map = read('screens/MapScreen.tsx');
    const native = read('components/MapRecenterControl.ios.tsx');
    const surface = read('components/SwiftUIGlassSurface.ios.tsx');
    expect(map).toContain('<MapRecenterControl');
    expect(map).toContain('chromeStage={chromeStage}');
    expect(map).toContain('chromeBottomOffset={chromeBottomOffset}');
    expect(native).toContain('<SwiftUIGlassSurface shape="capsule"');
    expect(surface).toContain('glassEffect({');
    expect(surface).toContain("variant: 'regular'");
    expect(surface).not.toContain('opacity:');
    expect(native).toContain('<View style={styles.divider} />');
    expect(native).toContain('<Pressable');
  });

  it('keeps iOS map cards neutral and Android fallbacks tokenized', () => {
    const mapStyles = read('screens/MapScreen/styles.ts');
    const map = read('screens/MapScreen.tsx');
    const membersPane = read('screens/MapScreen/components/MembersPane.tsx');
    const addPlaceCard = read('screens/MapScreen/components/AddPlaceConfirmCard.tsx');
    expect(map).toContain("Platform.OS === 'android'");
    expect(addPlaceCard).toContain('tintColor={Platform.OS === \'android\'');
    expect(membersPane).toContain('styles.locationSharingButton');
    expect(membersPane).toContain('name={sharingEnabled ? \'eye-outline\' : \'eye-off-outline\'}');
    expect(mapStyles).toContain('width: 44');
    expect(mapStyles).toContain('height: 44');
    expect(map).toContain('<SwiftUIGlassSurface');
    expect(map).toContain('useSwiftUIGlassSurface');
  });

  it('uses the approved add-place and arrival control sizes', () => {
    const mapStyles = read('screens/MapScreen/styles.ts');
    const map = read('screens/MapScreen.tsx');
    expect(mapStyles).toContain('confirmArrow: {');
    expect(mapStyles).toContain('confirmControl: {');
    expect(mapStyles).toContain('width: 60');
    expect(mapStyles).toContain('height: 60');
    expect(map).not.toContain('size={80}');
    expect(map).not.toContain('height={96}');
    const arrivalSheets = read('screens/MapScreen/components/ArrivalManageSheet.tsx')
      + read('screens/MapScreen/components/ArrivalTimeSheet.tsx');
    expect((arrivalSheets.match(/size=\{36\}/g) ?? [])).toHaveLength(2);
  });

  it('keeps the add-place title and three equally sized touch targets in one top row', () => {
    const card = read('screens/MapScreen/components/AddPlaceConfirmCard.tsx');
    const mapStyles = read('screens/MapScreen/styles.ts');
    const titleRow = card.slice(card.indexOf('<View style={styles.confirmTitleRow}>'), card.indexOf('<View style={styles.confirmTopRow}>'));
    expect(titleRow).toContain('testID="confirm-place-name"');
    expect(titleRow.match(/testID="(?:add-place-favorite-star|add-place-center-btn|confirm-place-cancel)"/g)).toEqual([
      'testID="add-place-favorite-star"',
      'testID="add-place-center-btn"',
      'testID="confirm-place-cancel"',
    ]);
    const targets = ['confirmControl', 'confirmCloseTarget'].map(name => {
      const style = mapStyles.match(new RegExp(`\\b${name}: \\{([^}]+)\\}`))?.[1] ?? '';
      return { width: Number(style.match(/width: ([\d.]+)/)?.[1]), height: Number(style.match(/height: ([\d.]+)/)?.[1]) };
    });
    expect(targets[0].width).toBeGreaterThanOrEqual(44);
    expect(targets[0].height).toBeGreaterThanOrEqual(44);
    expect(targets[1]).toEqual(targets[0]);
  });
});
