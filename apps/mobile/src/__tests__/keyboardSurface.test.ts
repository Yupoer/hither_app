import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KEYBOARD_SURFACE_GAP_PT,
  keyboardAvoidBottomOffset,
  keyboardScrollPaddingBottom,
} from '../utils/keyboardSurface';

const map = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const account = readFileSync(join(__dirname, '../components/AccountSheet.tsx'), 'utf8');
const addPlaceTour = readFileSync(join(__dirname, '../featureTour/addPlaceTour.ts'), 'utf8');

describe('keyboard surface + inline rename (#172)', () => {
  it('uses 12pt gap above keyboard and restores base when dismissed', () => {
    expect(KEYBOARD_SURFACE_GAP_PT).toBe(12);
    expect(
      keyboardAvoidBottomOffset({ baseBottom: 40, keyboardHeight: 0 }),
    ).toBe(40);
    expect(
      keyboardAvoidBottomOffset({ baseBottom: 40, keyboardHeight: 300 }),
    ).toBe(312);
    expect(
      keyboardAvoidBottomOffset({ baseBottom: 400, keyboardHeight: 300 }),
    ).toBe(400);
  });

  it('scroll padding includes gap for redeem focus', () => {
    expect(
      keyboardScrollPaddingBottom({ safeAreaBottom: 20, keyboardHeight: 0 }),
    ).toBe(20);
    expect(
      keyboardScrollPaddingBottom({ safeAreaBottom: 20, keyboardHeight: 280 }),
    ).toBe(292);
  });

  it('confirm card uses inline TextInput and no rename Modal', () => {
    expect(map).toContain('testID="confirm-place-name"');
    expect(map).toContain('keyboardAvoidBottomOffset');
    // Inline title input owns pendingPlaceTitle (no separate rename draft Modal).
    const nameIdx = map.indexOf('testID="confirm-place-name"');
    expect(nameIdx).toBeGreaterThan(-1);
    expect(map.slice(Math.max(0, nameIdx - 900), nameIdx + 40)).toMatch(/TextInput/);
    expect(map).toContain('onChangeText={setPendingPlaceTitle}');
    expect(map).not.toContain('renameModalVisible');
    expect(map).not.toContain('testID="confirm-rename-modal"');
    expect(map).not.toContain('openRenameModal');
  });

  it('AccountSheet redeem uses keyboard gap and scroll restore', () => {
    expect(account).toContain('keyboardScrollPaddingBottom');
    expect(account).toContain('KEYBOARD_SURFACE_GAP_PT');
    expect(account).toContain('testID="account-redeem-input"');
  });

  it('add-place tour step 0 targets star only (not Add / center)', () => {
    expect(addPlaceTour).toContain("id: 'star'");
    expect(addPlaceTour).toContain("target: 'addPlaceFavoriteStar'");
    expect(map).toContain("target: 'addPlaceFavoriteStar'");
    // Start path must set star rect, never center as first hole.
    expect(map).toMatch(/setAddPlaceTourTargetRect\(starRect\)/);
    expect(map).not.toMatch(/setAddPlaceTourStep\(0\)[\s\S]{0,80}centerRect/);
  });
});
