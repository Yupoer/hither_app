import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const quickCommandsCard = readFileSync(
  join(__dirname, '../components/QuickCommandsCard.tsx'),
  'utf8',
);
const settingsOverlay = readFileSync(
  join(__dirname, '../screens/MapScreen/components/SettingsOverlay.tsx'),
  'utf8',
);
const preferences = readFileSync(
  join(__dirname, '../state/PreferencesContext.tsx'),
  'utf8',
);
const roleSelect = readFileSync(join(__dirname, '../screens/RoleSelectScreen.tsx'), 'utf8');
const i18n = readFileSync(join(__dirname, '../i18n/index.ts'), 'utf8');

describe('map UI placement contracts', () => {
  it('keeps history in the gathering-points section and preserves both KML entries', () => {
    const gatheringPoints = mapScreen.indexOf("t('map.gatheringPoints')");
    const history = mapScreen.indexOf("t('history.title')", gatheringPoints);
    const routeAddStop = mapScreen.indexOf('t(\'map.addStop\')');
    const routeKml = mapScreen.indexOf('t(\'kml.entry\')', routeAddStop);

    expect(gatheringPoints).toBeGreaterThanOrEqual(0);
    expect(history).toBeGreaterThan(gatheringPoints);
    expect(routeAddStop).toBeGreaterThanOrEqual(0);
    expect(routeKml).toBeGreaterThan(routeAddStop);
  });

  it('groups high accuracy with the refreshed member controls', () => {
    // Members pane: status bar + refresh, then precise-location at the bottom.
    const statusBar = mapScreen.indexOf('styles.myStatusBar');
    const refresh = mapScreen.indexOf('styles.refreshLocationsButton', statusBar);
    const accuracy = mapScreen.indexOf('styles.accuracyRow', refresh);

    expect(statusBar).toBeGreaterThanOrEqual(0);
    expect(refresh).toBeGreaterThan(statusBar);
    expect(accuracy).toBeGreaterThan(refresh);
    expect(mapScreen).toContain("t('settings.preciseLocation')");
    expect(mapScreen).toContain("t('settings.preciseLocationHint')");
  });

  it('keeps account and Hither Pro as the first settings rows', () => {
    const topGroup = settingsOverlay.indexOf('styles.settingsTopGroup');
    const account = settingsOverlay.indexOf("t('settings.account')", topGroup);
    const pro = settingsOverlay.indexOf("t('paywall.title')", account);
    const language = settingsOverlay.indexOf("t('settings.language')", pro);

    expect(topGroup).toBeGreaterThanOrEqual(0);
    expect(account).toBeGreaterThan(topGroup);
    expect(pro).toBeGreaterThan(account);
    expect(language).toBeGreaterThan(pro);
  });

  it('exposes create-or-join home from settings without forcing leave/sign-out', () => {
    expect(settingsOverlay).toContain("t('settings.createOrJoin')");
    expect(settingsOverlay).toContain("t('settings.createOrJoinHint')");
    expect(settingsOverlay).toContain('onGoHome');
    expect(mapScreen).toContain('goHomeCreateOrJoin');
    expect(mapScreen).toContain("navigation.navigate('RoleSelect')");
    // Must not clear membership just to open create/join.
    const goHomeFn = mapScreen.indexOf('goHomeCreateOrJoin = useCallback');
    const goHomeBody = mapScreen.slice(goHomeFn, goHomeFn + 280);
    expect(goHomeBody).not.toContain('leaveGroup');
    expect(goHomeBody).not.toContain('signOut');
    expect(i18n).toContain("'settings.createOrJoin': '創建或加入群組'");
  });

  it('exposes the oblique-locate toggle in Settings', () => {
    expect(settingsOverlay).toContain("t('settings.sectionMapJourney')");
    expect(settingsOverlay).toContain("t('settings.obliqueLocate')");
    expect(settingsOverlay).toContain('setObliqueLocate');
    expect(settingsOverlay).toContain('value={obliqueLocate}');
  });

  it('aligns per-destination meet clocks when itinerary dates change', () => {
    expect(mapScreen).toContain('alignMeetTimeToTripDay');
    expect(mapScreen).toContain('meetAt: alignedMeetAt.toISOString()');
    expect(mapScreen).toContain('const shortcut = new Date(meetTimeEditor.value)');
    expect(mapScreen).toContain('reorderDestinations(groupId, meetUpdates)');
  });

  it('persists the gathering-card default and exposes it in journey settings', () => {
    expect(preferences).toContain("pref.gatherCardDefaultExpanded");
    expect(preferences).toContain('gatherCardDefaultExpanded');
    expect(preferences).toContain('setGatherCardDefaultExpanded');
    expect(settingsOverlay).toContain("t('settings.gatherCardDefaultExpanded')");
    expect(settingsOverlay).toContain('value={gatherCardDefaultExpanded}');
    expect(i18n).toContain("'settings.gatherCardDefaultExpanded': '預設展開集合點卡片'");
  });

  it('uses tap expansion and keeps controls and arrival progress expanded-only', () => {
    expect(mapScreen).toContain('useGatherCardExpansion');
    expect(mapScreen).toContain('toggleCard(dest.id)');
    expect(mapScreen).toContain('registerCardActivity(dest.id)');
    expect(mapScreen).not.toContain('pendingExpandId');
    expect(mapScreen).not.toContain("index === 0 ? t('map.nextTag')");
    expect(mapScreen).toContain('cardExpanded && (');
    expect(mapScreen).toContain('styles.cardCollapsedMetrics');
  });

  it('pins a far fixed gap before viewing my teams and does not vertical-center', () => {
    expect(roleSelect).toContain('styles.myTeamsSpacer');
    expect(roleSelect).toContain('myTeamsSpacer: { height: 64 }');
    // Vertical center on `content` reflowed the create/join ↔ my-teams distance
    // when the CTA mounted after fetch; layout must stay top-down with bottom flex.
    const contentBlock = roleSelect.match(/content:\s*\{[^}]+\}/);
    expect(contentBlock?.[0] ?? '').not.toContain("justifyContent: 'center'");
    expect(roleSelect).toContain('bottomFlex');
    expect(roleSelect).toContain('myTeamsSlot');
    // Instant paint: memory cache + lite fetch (skip profiles on this screen).
    expect(roleSelect).toContain('getCachedMyJoinedGroups');
    expect(roleSelect).toContain('includeProfiles: false');
  });



  it('uses a Traditional Chinese account label', () => {
    expect(i18n).toContain("'settings.account': '帳號'");
  });

  it('returns from account details to settings and keeps the reorder sheet under KML', () => {
    expect(mapScreen).toContain("onClose={() => setOverlay('settings')}");
    expect(mapScreen).toContain("setKmlVisible(true)");
    expect(settingsOverlay).not.toContain("t('account.section')");
    // Feedback lives under 支援 as a nav row (not a standalone report button).
    expect(settingsOverlay).toContain("t('feedback.title')");
    expect(settingsOverlay).toContain('onOpenFeedback');
  });

  it('puts home/settings/leave on the avatar ⋯ menu and keeps settings out of tools', () => {
    const toolsStart = mapScreen.indexOf('// ─── 工具');
    const toolsEnd = mapScreen.indexOf('const sheetChildren');
    const toolsBlock = mapScreen.slice(toolsStart, toolsEnd);
    expect(toolsBlock).not.toContain("t('map.overlaySettings')");

    const menuStart = mapScreen.indexOf('const openGroupMenu');
    const menuEnd = mapScreen.indexOf('useEffect(() => {\n    void refreshSentInvites', menuStart);
    const menuBlock = mapScreen.slice(menuStart, menuEnd > 0 ? menuEnd : menuStart + 1200);
    expect(menuBlock).toContain("t('map.backToHome')");
    expect(menuBlock).toContain("t('map.overlaySettings')");
    expect(menuBlock).toContain("t('group.leave')");
    expect(menuBlock).not.toContain("t('map.inviteMembers')");
    expect(i18n).toContain("'map.backToHome': '回到主畫面'");
  });

  it('updates the gathering-point navigation state before the network request finishes', () => {
    // Leader busy/optimistic + all roles when journeyActive share the flock target.
    expect(mapScreen).toContain('flockNavigatingThis');
    expect(mapScreen).toContain(
      '(journeyActive || (isLeader && journeyBusy)) && navTarget?.id === dest.id',
    );
  });

  it('reloads group state when the groups row changes so followers get journey routes', () => {
    const useGroupState = readFileSync(
      join(__dirname, '../state/useGroupState.ts'),
      'utf8',
    );
    expect(useGroupState).toContain("table: 'groups'");
    expect(useGroupState).toContain('id=eq.${groupId}');
    expect(useGroupState).toContain('scheduleReload');
  });

  it('does not animate the whole card when a child navigation button is pressed', () => {
    const pressIn = mapScreen.indexOf('onPressIn={() => {');
    const pressOut = mapScreen.indexOf('onPressOut={() => {', pressIn);
    expect(mapScreen.slice(pressIn, pressOut)).not.toContain('LayoutAnimation.configureNext');
  });

  it('opens the custom quick command editor as a sheet', () => {
    const quickCommands = readFileSync(
      join(__dirname, '../components/CustomQuickCommandSheet.tsx'),
      'utf8',
    );
    const settingsOverlay = readFileSync(
      join(__dirname, '../screens/MapScreen/components/SettingsOverlay.tsx'),
      'utf8',
    );

    expect(quickCommands).toContain('<OverlaySheet');
    expect(quickCommands).toContain('visible={visible}');
    expect(mapScreen).toContain('onConfigureCustom={openCustomQuickCommand}');
    expect(mapScreen).toContain('onOpenCustomQuickCommand={openCustomQuickCommand}');
    expect(settingsOverlay).toContain('onOpenCustomQuickCommand');
    expect(settingsOverlay).toContain('customQuickCommandConfiguredCount');
  });

  it('returns the report sheet to settings after cancel or submit', () => {
    expect(mapScreen).toMatch(
      /<FeedbackSheet[\s\S]*?onClose=\{\(\) => setOverlay\('settings'\)\}/,
    );
  });

  it('sends the custom command message to the group', () => {
    expect(quickCommandsCard).toContain("sendCommand(groupId, 'custom', message)");
  });

  it('lets users re-edit a configured custom command via long-press with haptics', () => {
    expect(quickCommandsCard).toContain('onLongPress={() => openEditor(item.slot)}');
    expect(quickCommandsCard).toContain('mediumTap()');
    expect(quickCommandsCard).toContain('function openEditor');
  });

  it('notifies everyone except the sender (not leader/member only copy)', () => {
    expect(quickCommandsCard).toContain("t('settings.quickHintAll')");
    expect(mapScreen).toContain("t('map.cmdTitle')");
  });
});
