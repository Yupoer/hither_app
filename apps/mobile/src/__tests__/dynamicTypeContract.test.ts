import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GLOBAL_FONT_SCALE_CAP,
  TYPE_MAX_MULTIPLIER,
  cappedFontScale,
  fontScaleBucket,
} from '../theme/typeScale';

const root = join(__dirname, '..');
const appTsx = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
const mapScreen = readFileSync(join(root, 'screens/MapScreen.tsx'), 'utf8');
const quickCommands = readFileSync(join(root, 'components/QuickCommandsCard.tsx'), 'utf8');

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

  it('marks MapScreen commandRow large/xl layout branches', () => {
    expect(mapScreen).toContain('a11y-layout:commandRow');
    expect(mapScreen).toContain("fontBucket === 'large'");
    expect(mapScreen).toContain("fontBucket === 'xl'");
    expect(mapScreen).toContain('commandCol');
    expect(mapScreen).toContain('commandSecondaryRow');
  });

  it('marks QuickCommandsCard bucket-aware grid', () => {
    expect(quickCommands).toContain('a11y-layout:quickCommands');
    expect(quickCommands).toContain('useFontLayout');
    expect(quickCommands).toMatch(/bucket === 'xl'/);
  });

  it('rebuilds map styles from live font scale', () => {
    expect(mapScreen).toContain('useFontLayout');
    expect(mapScreen).toContain('makeStyles(accent, fontLayout.scale)');
    expect(mapScreen).toContain('fontLayout.scale');
  });

  it('marks invite-row stacked layout for large Dynamic Type', () => {
    expect(mapScreen).toContain('a11y-layout:inviteRow');
    expect(mapScreen).toContain('inviteRowStacked');
  });

  it('keeps stage-1 locate capsules clear of the gathering-point carousel', () => {
    expect(mapScreen).toContain('a11y-layout:carouselCapsuleClearance');
    expect(mapScreen).toContain('carouselMaxHeight');
    expect(mapScreen).toContain('CAPSULE_CLEARANCE');
    // Capsules must paint above the carousel.
    expect(mapScreen).toMatch(/recenter:\s*\{[^}]*zIndex:\s*62/);
    expect(mapScreen).toMatch(/teamCapsuleWrap:\s*\{[^}]*zIndex:\s*62/s);
    expect(mapScreen).toMatch(/carouselWrap:\s*\{[^}]*zIndex:\s*50/s);
    // Peek never stacks the command row (keeps card short).
    expect(mapScreen).toContain('detent > 0 && (fontBucket === \'large\' || fontBucket === \'xl\')');
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
});
