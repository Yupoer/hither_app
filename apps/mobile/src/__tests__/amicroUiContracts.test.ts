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
      'play', 'pause', 'pencil-outline', 'expand-outline', 'contract-outline',
      'refresh', 'eye-off-outline', 'eye-outline',
    ]) {
      expect(map + passive).toMatch(new RegExp(`(?:icon|activeIcon)="${icon}"`));
    }
    expect(map).toContain("const isStartCommand = navCmd.action === 'start_nav'");
    expect(map).toContain('onAnimationComplete={runNavAction}');
    expect(passive).toContain('onAnimationComplete={handleSwitchBack}');
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
