import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOLD_TEXT_LAYOUT_FACTOR,
  GLOBAL_FONT_SCALE_CAP,
  LAYOUT_SCALE_ABS_CAP,
  TYPE_MAX_MULTIPLIER,
  cappedFontScale,
  fontScaleBucket,
  layoutFontScale,
} from '../theme/typeScale';

const root = join(__dirname, '..');
const appTsx = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
const mapScreen = readFileSync(join(root, 'screens/MapScreen.tsx'), 'utf8');
const quickCommands = readFileSync(join(root, 'components/QuickCommandsCard.tsx'), 'utf8');
const groupMap = readFileSync(join(root, 'components/GroupMap.tsx'), 'utf8');
const myTeams = readFileSync(join(root, 'screens/MyTeamsScreen.tsx'), 'utf8');
const settingsOverlay = readFileSync(
  join(root, 'screens/MapScreen/components/SettingsOverlay.tsx'),
  'utf8',
);
const preferences = readFileSync(join(root, 'state/PreferencesContext.tsx'), 'utf8');
const hitherText = readFileSync(join(root, 'components/HitherText.tsx'), 'utf8');

describe('Dynamic Type contract', () => {
  it('caps emoji at 1.0 so avatar shells stay fixed', () => {
    expect(TYPE_MAX_MULTIPLIER.emoji).toBe(1);
  });

  it('keeps a global ceiling and role multipliers within it', () => {
    expect(GLOBAL_FONT_SCALE_CAP).toBe(1.25);
    expect(TYPE_MAX_MULTIPLIER.body).toBe(GLOBAL_FONT_SCALE_CAP);
    expect(TYPE_MAX_MULTIPLIER.display).toBeLessThanOrEqual(GLOBAL_FONT_SCALE_CAP);
    expect(TYPE_MAX_MULTIPLIER.metric).toBeLessThanOrEqual(GLOBAL_FONT_SCALE_CAP);
    for (const m of Object.values(TYPE_MAX_MULTIPLIER)) {
      expect(m).toBeLessThanOrEqual(GLOBAL_FONT_SCALE_CAP);
    }
  });

  it('installs GLOBAL_FONT_SCALE_CAP as App.tsx Text/TextInput default (not hard 1.0)', () => {
    expect(appTsx).toContain('GLOBAL_FONT_SCALE_CAP');
    expect(appTsx).toContain('maxFontSizeMultiplier: GLOBAL_FONT_SCALE_CAP');
    // Never freeze all type at 1.0 again.
    expect(appTsx).not.toMatch(/maxFontSizeMultiplier\s*:\s*1\b/);
  });

  it('marks MapScreen commandRow single-row density branches', () => {
    expect(mapScreen).toContain('a11y-layout:commandRow');
    expect(mapScreen).toContain('a11y-layout:narrowScreen');
    expect(mapScreen).toContain("fontBucket === 'large'");
    expect(mapScreen).toContain("fontBucket === 'xl'");
    expect(mapScreen).toContain('narrowScreen');
    // Always one row — no multi-row stack styles in the gather card.
    expect(mapScreen).not.toContain('commandCol');
    expect(mapScreen).not.toContain('commandSecondaryRow');
    expect(mapScreen).toContain('flexWrap: \'nowrap\'');
  });

  it('marks QuickCommandsCard bucket-aware grid', () => {
    expect(quickCommands).toContain('a11y-layout:quickCommands');
    expect(quickCommands).toContain('useFontLayout');
    expect(quickCommands).toMatch(/bucket === 'xl'/);
  });

  it('rebuilds map styles from live font scale, narrow width, font bucket, app textScale, and boldText', () => {
    expect(mapScreen).toContain('useFontLayout');
    expect(mapScreen).toContain('fontLayout.textScale');
    expect(mapScreen).toContain('fontLayout.scale');
    expect(mapScreen).toContain('fontLayout.boldText');
    expect(mapScreen).toContain('windowWidth < 400');
    expect(mapScreen).toContain('applyAppTextScale');
    expect(mapScreen).toContain('applyBoldTextWeights');
  });

  it('clips avatar shells and freezes map/header emoji glyphs', () => {
    expect(mapScreen).toMatch(/headerAvatar:\s*\{[\s\S]*?overflow:\s*'hidden'/);
    expect(mapScreen).toMatch(/peekStackAv:\s*\{[\s\S]*?overflow:\s*'hidden'/);
    expect(mapScreen).toContain("typeRole=\"emoji\"");
    expect(groupMap).toContain("typeRole=\"emoji\"");
    expect(groupMap).toMatch(/memberPin:\s*\{[\s\S]*?overflow:\s*'hidden'/);
    expect(myTeams).toContain("typeRole=\"emoji\"");
    expect(myTeams).toMatch(/avatarBubble:\s*\{[\s\S]*?overflow:\s*'hidden'/);
    expect(myTeams).toMatch(/detailAvatarBig:\s*\{[\s\S]*?overflow:\s*'hidden'/);
  });

  it('exposes Settings text size multiplier preference (incl. smallest 0.8)', () => {
    expect(preferences).toContain('pref.textScale');
    expect(preferences).toContain('TextScalePref');
    expect(preferences).toContain('setTextScale');
    expect(preferences).toContain('0.8');
    expect(preferences).toMatch(/TEXT_SCALE_OPTIONS\s*=\s*\[[^\]]*0\.8/);
    expect(settingsOverlay).toContain("settings.textSize");
    expect(settingsOverlay).toContain("settings.textSizeXs");
    expect(settingsOverlay).toContain("key: '0.8'");
    expect(settingsOverlay).toContain('setTextScale');
    expect(hitherText).toContain('textScale');
    expect(hitherText).toContain("typeRole === 'emoji'");
  });

  it('scales gathering-point card chrome and shows day + date when expanded', () => {
    expect(mapScreen).toContain('formatTripDayLine');
    expect(mapScreen).toContain('cardDayLine');
    expect(mapScreen).toContain('optimisticDepartureDate ?? group?.departureDate');
    // Expanded mock layout: day + people chip, metrics row (dist | eta | map).
    expect(mapScreen).toContain('cardSubRow');
    expect(mapScreen).toContain('arrivalPeopleChip');
    expect(mapScreen).toContain('metricsRow');
    expect(mapScreen).toContain('metricValue');
    expect(mapScreen).toContain("map.distanceToGather");
    expect(mapScreen).toContain("map.routeEstimate");
    expect(mapScreen).toContain("map.localEstimate");
    expect(mapScreen).toContain("map.meetCountdown");
    expect(mapScreen).toContain("subgroup.itineraryBadge");
    expect(mapScreen).toContain('a11y-layout:commandRowCompact');
    expect(mapScreen).toContain('meetBtn');
    expect(mapScreen).toContain('meetBtnStack');
    // Apple Maps only after expand, in metrics row (not in the command row).
    expect(mapScreen).toContain('mapsChip');
    expect(mapScreen).toMatch(/cardExpanded\s*\?\s*\([\s\S]*?openExternalNavigation/);
    // Card padding is scale/density-aware (horizontal pad + top/bottom).
    expect(mapScreen).toMatch(/cardPad\s*=\s*compact\s*\?\s*s\(/);
    expect(mapScreen).toMatch(/card:\s*\{[\s\S]*?paddingHorizontal:\s*cardPad/);
    expect(mapScreen).toContain('cardKickerRow');
    // Logo removed.
    expect(mapScreen).not.toMatch(/styles\.cardIcon/);
  });

  it('marks invite-row stacked layout for large Dynamic Type', () => {
    expect(mapScreen).toContain('a11y-layout:inviteRow');
    expect(mapScreen).toContain('inviteRowStacked');
  });

  it('stacks gathering cards above capsules and below the sheet layer', () => {
    expect(mapScreen).toContain('a11y-layout:carouselCapsuleClearance');
    expect(mapScreen).toContain('carouselMaxHeight');
    expect(mapScreen).toContain('CAPSULE_CLEARANCE');
    // cards (58) > capsules (50); sheet wrapper sibling must beat carousel.
    expect(mapScreen).toMatch(/carouselWrap:\s*\{[\s\S]*?zIndex:\s*58/);
    expect(mapScreen).toMatch(/recenter:\s*\{[^}]*zIndex:\s*50/);
    expect(mapScreen).toMatch(/teamCapsuleWrap:\s*\{[\s\S]*?zIndex:\s*50/);
    expect(mapScreen).toMatch(/sheetLayer:\s*\{[\s\S]*?zIndex:\s*70/);
    // No permanent black fog strip under the carousel.
    expect(mapScreen).not.toContain('carouselFog');
    // Command row density follows device/font — never multi-row / never detent.
    expect(mapScreen).toContain('a11y-layout:commandRowCompact');
    expect(mapScreen).not.toMatch(/stacked\s*=/);
    expect(mapScreen).not.toMatch(/detent\s*>\s*0\s*&&/);
  });

  it('lets meet countdown grow instead of clipping under large Dynamic Type', () => {
    expect(mapScreen).toMatch(/meetBtn:\s*\{[\s\S]*?minHeight:\s*cmdSize/);
    expect(mapScreen).toMatch(/meetBtn:\s*\{[\s\S]*?overflow:\s*'visible'/);
    // Fixed height would clip 集合倒數 under bold/large type.
    expect(mapScreen).not.toMatch(/meetBtn:\s*\{[\s\S]*?height:\s*cmdSize/);
    expect(mapScreen).toContain('metricNumSize');
    expect(mapScreen).toContain('adjustsFontSizeToFit');
    // Metric values must not shrink to unreadable; captions wrap + floor size.
    expect(mapScreen).toContain('minimumFontScale={0.85}');
    expect(mapScreen).not.toContain('minimumFontScale={0.65}');
    expect(mapScreen).toMatch(/metricCaption[\s\S]{0,80}numberOfLines=\{2\}/);
    expect(mapScreen).toMatch(/const metricCaptionSize = tight \? 11/);
  });

  it('clamps font scale for layout and maps buckets under the global cap', () => {
    expect(cappedFontScale(2)).toBe(GLOBAL_FONT_SCALE_CAP);
    expect(cappedFontScale(1)).toBe(1);
    expect(fontScaleBucket(1)).toBe('regular');
    expect(fontScaleBucket(1.09)).toBe('regular');
    expect(fontScaleBucket(1.1)).toBe('large');
    expect(fontScaleBucket(1.19)).toBe('large');
    expect(fontScaleBucket(1.2)).toBe('xl');
    // System accessibility sizes above the cap still bucket as xl (capped).
    expect(fontScaleBucket(2)).toBe('xl');
  });

  it('combines system + app textScale for layout without exceeding abs cap', () => {
    expect(layoutFontScale(1, 1)).toBe(1);
    expect(layoutFontScale(1, 1.2)).toBeCloseTo(1.2);
    expect(layoutFontScale(1, 0.8)).toBeCloseTo(0.8);
    expect(layoutFontScale(1.25, 1.2)).toBe(LAYOUT_SCALE_ABS_CAP);
    // System alone is still capped before multiply.
    expect(layoutFontScale(2, 1)).toBe(GLOBAL_FONT_SCALE_CAP);
    expect(LAYOUT_SCALE_ABS_CAP).toBe(1.5);
  });

  it('folds iOS Bold Text into layout scale (not Text fontSize) and densifies early', () => {
    expect(BOLD_TEXT_LAYOUT_FACTOR).toBeGreaterThan(1);
    // Default size + bold should land at least in the `large` density bucket.
    const boldDefault = layoutFontScale(1, 1, true);
    expect(boldDefault).toBeCloseTo(BOLD_TEXT_LAYOUT_FACTOR);
    expect(fontScaleBucket(boldDefault)).not.toBe('regular');
    // Bold does not raise beyond abs cap with large system × app scale.
    expect(layoutFontScale(1.25, 1.2, true)).toBe(LAYOUT_SCALE_ABS_CAP);
    // Smallest app scale + bold stays under large unless system is already big.
    expect(layoutFontScale(1, 0.8, true)).toBeCloseTo(0.8 * BOLD_TEXT_LAYOUT_FACTOR);
    // Hook + MapScreen must observe boldText for live re-layout.
    const fontHook = readFileSync(join(root, 'a11y/useFontScaleBucket.ts'), 'utf8');
    expect(fontHook).toContain('isBoldTextEnabled');
    expect(fontHook).toContain('boldTextChanged');
    expect(fontHook).toContain('boldText');
    expect(mapScreen).toContain('fontLayout.boldText');
    expect(mapScreen).toContain('applyBoldTextWeights');
  });
});
