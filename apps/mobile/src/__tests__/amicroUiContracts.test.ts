import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('Amicro native animation contracts', () => {
  const button = read('components/AmicroButton.tsx');
  const map = read('screens/MapScreen.tsx');
  const passive = read('screens/MapScreen/components/PassiveCompanionPanel.tsx');
  const app = read('../App.tsx');

  it('haptics first, then runs the handler once at animation completion', () => {
    expect(button).toContain('if (disabled || busyRef.current) return;');
    expect(button.indexOf('onPress?.();')).toBeLessThan(button.indexOf('withTiming(target'));
    expect(button).toContain('runOnJS(finish)()');
    expect(button).toContain('if (reducedMotion) {');
    expect(button).toContain('finish();');
  });

  it('keeps the requested icon mappings on native controls', () => {
    for (const icon of [
      'link-outline', 'send-outline', 'settings-outline', 'copy-outline', 'checkmark',
      'search', 'close', 'pencil-outline', 'expand-outline', 'contract-outline',
      'refresh', 'eye-off-outline', 'eye-outline',
    ]) {
      expect(map + passive).toMatch(new RegExp(`(?:icon|activeIcon)="${icon}"`));
    }
    expect(map).not.toContain('activeIcon="pause"');
    expect(map).toContain('style={styles.headerIconBtn}');
    expect(map).toContain('onAnimationComplete={() => setSearchVisible(true)}');
    expect(passive).toContain('onAnimationComplete={handleSwitchBack}');
  });

  it('holds edit success until the route sheet is fully open', () => {
    expect(map).toContain('active={editButtonActive}');
    expect(map).toContain('resetAfterComplete={false}');
    expect(map).toContain('onOpenComplete={() => setEditButtonActive(false)}');
    expect(map).toMatch(/setEditButtonActive\(false\);\s+setOverlay\(null\);/);
  });

  it('keeps invite actions labeled, framed, and makes sharing longer', () => {
    expect(map).toContain("label={t('map.share')}");
    expect(map).toContain("label={t('map.copy')}");
    expect(map).toContain('durationMs={420}');
    expect(map).toContain('style={styles.inviteActionButton}');
    expect(map).toContain('fontSize: 32');
    expect(map).toContain('adjustsFontSizeToFit');
    expect(map).toContain('minimumFontScale={0.7}');
  });

  it('renders centered Bouncing Dots without moving the logo', () => {
    expect(app).toContain('testID="splash-bouncing-dots"');
    expect(app).toContain('bottom: \'33%\'');
    expect(app).toContain('<BouncingDots color={colors.accent} />');
    expect(button).toContain('withDelay');
    expect(button).toContain('withRepeat');
    expect(button).toContain('withTiming(-20');
  });
});
