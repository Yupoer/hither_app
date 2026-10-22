import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('Amicro native animation contracts', () => {
  const button = read('components/AmicroButton.tsx');
  const wave = read('components/WaveLoading.tsx');
  const map = read('screens/MapScreen.tsx');
  const inviteMembersOverlay = read('screens/MapScreen/components/InviteMembersOverlay.tsx');
  const routeEditorSheet = read('screens/MapScreen/components/RouteEditorSheet.tsx');
  const carousel = read('screens/MapScreen/components/GatheringCarousel.tsx');
  const mapStyles = read('screens/MapScreen/styles.ts');
  const passive = read('screens/MapScreen/components/PassiveCompanionPanel.tsx');
  const refreshButton = read('screens/MapScreen/components/RefreshLocationsButton.tsx');
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
      expect(map + passive + refreshButton + carousel + routeEditorSheet + inviteMembersOverlay).toMatch(new RegExp(`(?:icon|activeIcon)="${icon}"`));
    }
    expect(map).toContain("name={sharingEnabled ? 'eye-outline' : 'eye-off-outline'}");
    expect(mapStyles).toContain('width: 44');
    expect(mapStyles).toContain('height: 44');
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
    expect(routeEditorSheet).toContain('setRouteScrollEnabled(true)');
    // Dismiss commits draft then closes (local UI first, network flush async).
    expect(routeEditorSheet).toMatch(/setEditButtonActive\(false\);\s+setOverlay\(null\);/);
    expect(map).toContain('flushRouteDraft');
  });

  it('places reorder as a standalone framed full-row action outside listGroup', () => {
    expect(map).toContain('styles.reorderActionCard');
    expect(map).toContain("testID={scopeKey === 'main' ? 'map-reorder-action-card'");
    expect(map).toContain("testID={scopeKey === 'main' ? 'map-edit-itinerary'");
    expect(map).toContain('styles.reorderActionPressable');
    expect(map).toContain('labelColor="#fff"');
    // Theme accent for pencil (not secondary grey).
    expect(map).toMatch(/map-edit-itinerary[\s\S]*?color=\{accent\}|color=\{accent\}[\s\S]*?map-edit-itinerary/);
  });

  it('keeps invite actions labeled, framed, and makes sharing longer', () => {
    expect(inviteMembersOverlay).toContain("label={t('map.share')}");
    expect(inviteMembersOverlay).toContain("label={t('map.copy')}");
    expect(inviteMembersOverlay).toContain('durationMs={420}');
    expect(inviteMembersOverlay).toContain('style={styles.inviteActionButton}');
    expect(mapStyles).toContain('fontSize: 32');
    expect(carousel).toContain('adjustsFontSizeToFit');
    expect(inviteMembersOverlay).toContain('minimumFontScale={0.7}');
    // Share awaits system share settle before Amicro reset.
    expect(inviteMembersOverlay).toMatch(/onAnimationComplete=\{async\s*\(\)\s*=>\s*\{[\s\S]*await shareCode\(\)/);
  });

  it('supports external Promise settle in Amicro finish path', () => {
    expect(button).toContain('Promise.resolve(result)');
    expect(button).toContain('releaseBusyAndMaybeReset');
  });

  it('renders centered Bouncing Dots without moving the logo', () => {
    expect(app).toContain('testID="splash-bouncing-dots"');
    expect(app).toContain('bottom: \'33%\'');
    expect(app).toContain('<WaveLoading size="large" color={colors.accent} />');
    expect(wave).toContain('loadingDotOffset(phase.value, 0)');
    expect(wave).toContain('loadingDotOffset(phase.value, 1)');
    expect(wave).toContain('loadingDotOffset(phase.value, 2)');
    expect(wave).toContain('withRepeat');
    expect(wave).toContain('Easing.linear');
  });
});
