/**
 * Contracts for Rewarded Ads Map/Store UX Stability pack (2026-07-30).
 * Source-string contracts only — do not import RN components (Jest RN ESM).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (rel: string) =>
  readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');

/** Mirrors PaneCoverFlow pure geometry (keep in sync with COVERFLOW_* constants). */
function coverFlowCardLeftEdge(args: {
  trackW: number;
  cardIndex: number;
  centerIndex: number;
  cardDivisor: number;
  stepRatio: number;
}): number {
  const cardW = args.trackW / args.cardDivisor;
  const step = cardW * args.stepRatio;
  const offset = args.cardIndex - args.centerIndex;
  return args.trackW / 2 + offset * step - cardW / 2;
}

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

describe('emoji picker 25 + independent color (ticket 07)', () => {
  it('uses fixed presets with independent drafts and no custom emoji UI', () => {
    expect(reorderList).toContain('DESTINATION_EMOJI_PRESETS');
    expect(reorderList).toContain('DESTINATION_PALETTE_LIST');
    expect(reorderList).toContain('emojiDraft');
    expect(reorderList).toContain('colorDraft');
    expect(reorderList).toContain('dest-emoji-preview');
    expect(reorderList).toContain('dest-emoji-confirm');
    expect(reorderList).not.toContain('destEmoji.custom');
    expect(reorderList).not.toContain('customEmoji');
    expect(reorderList).toContain('destEmoji.saveFailed');
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

describe('CoverFlow exclusive gestures (ticket 08)', () => {
  it('BottomSheet fails horizontal so CoverFlow can own X axis', () => {
    expect(bottomSheet).toContain('SHEET_FAIL_OFFSET_X');
    expect(bottomSheet).toContain('SHEET_ACTIVE_OFFSET_Y');
    expect(bottomSheet).toContain('failOffsetX');
    expect(bottomSheet).toContain('activeOffsetY');
  });

  it('CoverFlow clears drag on cancel finalize and i18n a11y actions', () => {
    const cover = read('screens/MapScreen/components/PaneCoverFlow.tsx');
    expect(cover).toContain('didEndSV');
    expect(cover).toContain('onFinalize');
    expect(cover).toContain('dragX.value = 0');
    expect(cover).toContain('coverFlowHapticSteps');
    expect(cover).toContain("t('map.coverFlowNext')");
    expect(cover).toContain("t('map.coverFlowPrev')");
    expect(cover).toContain('SheetPaneKey');
    expect(cover).toContain('COVERFLOW_CARD_DIVISOR');
    expect(cover).toContain('COVERFLOW_STEP_RATIO');
  });

  it('keeps every pane card partially inside track for each center index', () => {
    const cover = read('screens/MapScreen/components/PaneCoverFlow.tsx');
    const divMatch = cover.match(/COVERFLOW_CARD_DIVISOR\s*=\s*([\d.]+)/);
    const stepMatch = cover.match(/COVERFLOW_STEP_RATIO\s*=\s*([\d.]+)/);
    expect(divMatch).toBeTruthy();
    expect(stepMatch).toBeTruthy();
    const cardDivisor = Number(divMatch![1]);
    const stepRatio = Number(stepMatch![1]);
    expect(cardDivisor).toBeGreaterThan(2.5);
    expect(stepRatio).toBeLessThan(0.7);

    const trackW = 360;
    const cardW = trackW / cardDivisor;
    for (let center = 0; center < 4; center += 1) {
      for (let card = 0; card < 4; card += 1) {
        const left = coverFlowCardLeftEdge({
          trackW,
          cardIndex: card,
          centerIndex: center,
          cardDivisor,
          stepRatio,
        });
        const right = left + cardW;
        // At least some of the card must intersect [0, trackW]
        expect(right).toBeGreaterThan(0);
        expect(left).toBeLessThan(trackW);
      }
    }
    // Store (index 3) visible when members (0) is selected — the review regression.
    const storeLeft = coverFlowCardLeftEdge({
      trackW,
      cardIndex: 3,
      centerIndex: 0,
      cardDivisor,
      stepRatio,
    });
    expect(storeLeft).toBeLessThan(trackW);
    expect(storeLeft + cardW).toBeGreaterThan(0);
  });
});
