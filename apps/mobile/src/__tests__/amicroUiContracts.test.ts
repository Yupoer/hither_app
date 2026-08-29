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
      'refresh',
    ]) {
      expect(map + passive).toMatch(new RegExp(`(?:icon|activeIcon)="${icon}"`));
    }
    expect(map).toContain("name={sharingEnabled ? 'eye-outline' : 'eye-off-outline'}");
    expect(map).toContain('width: 44');
    expect(map).toContain('height: 44');
    expect(map).not.toContain('activeIcon="pause"');
    expect(map).toContain('style={styles.headerIconBtn}');
    // Search holds complete frame until OverlaySheet onOpenComplete (not rAF×2).
    expect(map).toContain('setSearchVisible(true)');
    expect(map).toContain('searchOpenCompleteResolveRef');
    expect(map).toContain('onOpenComplete={handleSearchOpenComplete}');
    expect(map).toMatch(/onAnimationComplete=\{async\s*\(\)\s*=>\s*\{[\s\S]*setSearchVisible\(true\)/);
    expect(map).not.toMatch(
      /setSearchVisible\(true\);[\s\S]*requestAnimationFrame\(\(\)\s*=>\s*requestAnimationFrame/,
    );
    expect(passive).toContain('onAnimationComplete={handleSwitchBack}');
  });

  it('holds edit success until the route sheet is fully open', () => {
    expect(map).toContain('active={editButtonActive}');
    expect(map).toContain('resetAfterComplete={false}');
    expect(map).toContain('setEditButtonActive(false)');
    expect(map).toContain('setRouteScrollEnabled(true)');
    // Dismiss commits draft then closes (local UI first, network flush async).
    expect(map).toMatch(/setEditButtonActive\(false\);\s+setOverlay\(null\);/);
    expect(map).toContain('flushRouteDraft');
  });

  it('places reorder as a standalone framed full-row action outside listGroup', () => {
    expect(map).toContain('styles.reorderActionCard');
    expect(map).toContain('testID="map-reorder-action-card"');
    expect(map).toContain('testID="map-edit-itinerary"');
    expect(map).toContain('styles.reorderActionPressable');
    expect(map).toContain('labelColor="#fff"');
    // Theme accent for pencil (not secondary grey).
    expect(map).toMatch(/map-edit-itinerary[\s\S]*?color=\{accent\}|color=\{accent\}[\s\S]*?map-edit-itinerary/);
  });

  it('keeps invite actions labeled, framed, and makes sharing longer', () => {
    expect(map).toContain("label={t('map.share')}");
    expect(map).toContain("label={t('map.copy')}");
    expect(map).toContain('durationMs={420}');
    expect(map).toContain('style={styles.inviteActionButton}');
    expect(map).toContain('fontSize: 32');
    expect(map).toContain('adjustsFontSizeToFit');
    expect(map).toContain('minimumFontScale={0.7}');
    // Share awaits system share settle before Amicro reset.
    expect(map).toMatch(/onAnimationComplete=\{async\s*\(\)\s*=>\s*\{[\s\S]*await shareCode\(\)/);
  });

  it('supports external Promise settle in Amicro finish path', () => {
    expect(button).toContain('Promise.resolve(result)');
    expect(button).toContain('releaseBusyAndMaybeReset');
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
