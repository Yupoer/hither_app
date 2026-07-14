import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TYPE_MAX_MULTIPLIER, fontScaleBucket } from '../theme/typeScale';

const root = join(__dirname, '..');
const appTsx = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
const mapScreen = readFileSync(join(root, 'screens/MapScreen.tsx'), 'utf8');
const quickCommands = readFileSync(join(root, 'components/QuickCommandsCard.tsx'), 'utf8');

describe('Dynamic Type contract', () => {
  it('caps emoji at 1.0 so avatar shells stay fixed', () => {
    expect(TYPE_MAX_MULTIPLIER.emoji).toBe(1);
  });

  it('keeps body/title/display multipliers in the agreed range', () => {
    expect(TYPE_MAX_MULTIPLIER.body).toBe(1.3);
    expect(TYPE_MAX_MULTIPLIER.title).toBe(1.25);
    expect(TYPE_MAX_MULTIPLIER.display).toBe(1.2);
    expect(TYPE_MAX_MULTIPLIER.metric).toBe(1.15);
  });

  it('does not reintroduce a global maxFontSizeMultiplier = 1 in App.tsx', () => {
    expect(appTsx).not.toMatch(/maxFontSizeMultiplier\s*:\s*1/);
    expect(appTsx).not.toMatch(/defaultProps.*maxFontSizeMultiplier/);
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
    expect(quickCommands).toContain('useFontScaleBucket');
    expect(quickCommands).toMatch(/bucket === 'xl'/);
  });

  it('marks invite-row stacked layout for large Dynamic Type', () => {
    expect(mapScreen).toContain('a11y-layout:inviteRow');
    expect(mapScreen).toContain('inviteRowStacked');
  });

  it('maps fontScale thresholds to regular / large / xl', () => {
    expect(fontScaleBucket(1)).toBe('regular');
    expect(fontScaleBucket(1.14)).toBe('regular');
    expect(fontScaleBucket(1.15)).toBe('large');
    expect(fontScaleBucket(1.34)).toBe('large');
    expect(fontScaleBucket(1.35)).toBe('xl');
    expect(fontScaleBucket(2)).toBe('xl');
  });
});
