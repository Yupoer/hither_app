/**
 * Contracts for Rewarded Ads Map/Store UX Stability pack (2026-07-30).
 * Source-string contracts only — do not import RN components (Jest RN ESM).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (rel: string) =>
  readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const mapScreen = read('screens/MapScreen.tsx');
const reorderList = read('components/DestinationReorderList.tsx');
const bottomSheet = read('components/BottomSheet.tsx');
const rewardedAds = read('native/rewardedAds.ts');
const infoPlist = readFileSync(
  join(__dirname, '../../ios/Hither/Info.plist'),
  'utf8',
);
const androidManifest = readFileSync(
  join(__dirname, '../../android/app/src/main/AndroidManifest.xml'),
  'utf8',
);

describe('native AdMob alignment (ticket 02)', () => {
  it('ships GADApplicationIdentifier on iOS and APPLICATION_ID on Android', () => {
    expect(infoPlist).toContain('GADApplicationIdentifier');
    expect(infoPlist).toContain('ca-app-pub-8135109277557342~4266216474');
    expect(androidManifest).toContain('com.google.android.gms.ads.APPLICATION_ID');
    expect(androidManifest).toContain('ca-app-pub-8135109277557342~5387726456');
  });

  it('documents that Podfile.lock GMA link is a macOS native gate (not OTA)', () => {
    // Windows CI cannot pod install; package.json must still declare GMA.
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../../package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.['react-native-google-mobile-ads']).toBeTruthy();
  });
});

describe('long-press center rename (ticket 05)', () => {
  it('keeps bottom confirm card and opens center rename on name press', () => {
    expect(mapScreen).toContain('testID="confirm-place-name"');
    expect(mapScreen).toContain('testID="confirm-rename-modal"');
    expect(mapScreen).toContain('openRenameModal');
    expect(mapScreen).toContain('confirmRenameModal');
    expect(mapScreen).toContain('cancelRenameModal');
    expect(mapScreen).toContain("t('confirmGather.add')");
    // Confirm rename only updates draft title — not addDestination.
    const renameStart = mapScreen.indexOf('const confirmRenameModal');
    const renameBlock = mapScreen.slice(renameStart, renameStart + 400);
    expect(renameBlock).toContain('setPendingPlaceTitle');
    expect(renameBlock).not.toContain('addDestination');
    expect(renameBlock).not.toContain('handlePickDestination');
  });

  it('retains draft on add failure and clears only on success dismiss', () => {
    expect(mapScreen).toContain('// Keep confirm card until success');
    expect(mapScreen).toContain('if (ok && token.isCurrent()) dismissConfirmCard()');
    expect(mapScreen).toContain("pendingPlaceSourceRef.current = 'longpress'");
    expect(mapScreen).toContain('cameraAfterSuccessfulAdd');
  });

  it('treats refresh() false as incomplete success (keeps confirm card)', () => {
    expect(mapScreen).toContain('const projected = await refresh()');
    expect(mapScreen).toContain('return projected === true');
  });

  it('uses theme accent for pencil activeColor (not glass.ok)', () => {
    const editStart = mapScreen.indexOf('testID="map-edit-itinerary"');
    expect(editStart).toBeGreaterThan(-1);
    // activeColor is set just above the testID in the AmicroButton props.
    const window = mapScreen.slice(Math.max(0, editStart - 350), editStart + 80);
    expect(window).toContain('activeColor={accent}');
    expect(window).not.toContain('activeColor={glass.ok}');
  });
});

describe('rewarded ad finite timeouts (ticket 03 / review-02)', () => {
  it('defines load and show phase timeouts', () => {
    expect(rewardedAds).toContain('REWARDED_AD_LOAD_TIMEOUT_MS = 45_000');
    expect(rewardedAds).toContain('REWARDED_AD_SHOW_TIMEOUT_MS = 120_000');
    expect(rewardedAds).toContain('phaseTimeoutTimer');
  });
});

describe('emoji picker icon-only (ticket 07)', () => {
  it('uses fixed presets, emoji draft only, no per-stop color grid', () => {
    expect(reorderList).toContain('DESTINATION_EMOJI_PRESETS');
    expect(reorderList).toContain('emojiDraft');
    expect(reorderList).toContain('dest-emoji-preview');
    expect(reorderList).toContain('dest-emoji-confirm');
    expect(reorderList).not.toContain('destEmoji.custom');
    expect(reorderList).not.toContain('customEmoji');
    expect(reorderList).not.toContain('colorDraft');
    expect(reorderList).not.toContain('dest-color-grid');
    expect(reorderList).not.toContain('DESTINATION_PALETTE_LIST');
    expect(reorderList).toContain('destEmoji.saveFailed');
    // Badge / preview use day color, not per-stop markerColor.
    expect(reorderList).toContain('getColorForDay');
    expect(reorderList).toContain('dayColor');
  });

  it('uses uniform accent border on every emoji cell (selection via background)', () => {
    expect(reorderList).toContain('// Ticket 07: every cell uses the same accent border.');
    expect(reorderList).toMatch(/borderColor:\s*colors\.accent/);
    // Selected state must not switch border color away from accent via colors.border
    const gridStart = reorderList.indexOf('testID="dest-emoji-grid"');
    const gridBlock = reorderList.slice(gridStart, gridStart + 900);
    expect(gridBlock).toContain('borderColor: colors.accent');
    expect(gridBlock).toContain('borderWidth: 2');
    expect(gridBlock).not.toContain('borderColor: colors.border');
  });
});

describe('Sheet icon tabs (replaces CoverFlow ticket 08)', () => {
  it('MapScreen uses SheetPaneTabs with four pane keys', () => {
    expect(mapScreen).toContain('SheetPaneTabs');
    expect(mapScreen).toContain("key: 'members'");
    expect(mapScreen).toContain("key: 'route'");
    expect(mapScreen).toContain("key: 'tools'");
    expect(mapScreen).toContain("key: 'store'");
    expect(mapScreen).not.toContain('PaneCoverFlow');
  });

  it('SheetPaneTabs exposes equal-width icon tabs with testIDs', () => {
    const tabs = read('screens/MapScreen/components/SheetPaneTabs.tsx');
    expect(tabs).toContain('testID="sheet-pane-tabs"');
    expect(tabs).toContain('sheet-pane-tab-');
    expect(tabs).toContain('people');
    expect(tabs).toContain('location');
    expect(tabs).toContain('build');
    expect(tabs).toContain('bag-handle');
    expect(tabs).toContain('selectionTick');
    expect(tabs).toContain('SheetPaneKey');
  });

  it('BottomSheet keeps vertical ownership for sheet drag', () => {
    expect(bottomSheet).toContain('SHEET_ACTIVE_OFFSET_Y');
    expect(bottomSheet).toContain('activeOffsetY');
  });
});
