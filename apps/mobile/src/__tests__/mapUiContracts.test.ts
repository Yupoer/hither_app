import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const bottomSheet = readFileSync(join(__dirname, '../components/BottomSheet.tsx'), 'utf8');
const segmented = readFileSync(
  join(__dirname, '../screens/MapScreen/components/Segmented.tsx'),
  'utf8',
);
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
  it('lets the leader see subgroup destinations after approving a request', () => {
    const scopeStart = mapScreen.indexOf('const rawDestinations');
    const scopeEnd = mapScreen.indexOf('const [optimisticDestinations', scopeStart);
    const scopeBlock = mapScreen.slice(scopeStart, scopeEnd);

    expect(scopeBlock).toContain('if (isLeader) return all;');
  });

  it('keeps history and KML on the route pane with arrival manage; no add/import on reorder overlay', () => {
    // Route sheet pane body (not the full-screen reorder overlay).
    const routePane = mapScreen.indexOf('// ─── 路線');
    const toolsPane = mapScreen.indexOf('// ─── 工具', routePane);
    const routeBlock = mapScreen.slice(routePane, toolsPane > 0 ? toolsPane : routePane + 2500);

    expect(routeBlock).toContain("t('map.stopsReorder'");
    expect(routeBlock).toContain("t('arrival.manage')");
    expect(routeBlock).toContain("t('kml.entry')");
    expect(routeBlock).toContain("t('history.title')");
    expect(routeBlock).toContain("setOverlay('arrivalManage')");

    // Reorder overlay lists destinations only — no bottom add/import rows.
    const overlayRoute = mapScreen.indexOf("visible={overlay === 'route'}");
    const overlayRouteEnd = mapScreen.indexOf('<SettingsOverlay', overlayRoute);
    const overlayBlock = mapScreen.slice(
      overlayRoute,
      overlayRouteEnd > 0 ? overlayRouteEnd : overlayRoute + 3500,
    );
    expect(overlayBlock).toContain('DestinationReorderList');
    expect(overlayBlock).not.toContain("t('map.addStop')");
    expect(overlayBlock).not.toContain("t('kml.entry')");
  });

  it('groups high accuracy with the refreshed member controls', () => {
    // Members pane: status bar + refresh, then precise-location at the bottom.
    // Refresh control is isolated as RefreshLocationsButton (1 Hz clock stays local).
    const statusBar = mapScreen.indexOf('styles.myStatusBar');
    const refresh = mapScreen.indexOf('RefreshLocationsButton', statusBar);
    const accuracy = mapScreen.indexOf('styles.accuracyRow', refresh);

    expect(statusBar).toBeGreaterThanOrEqual(0);
    expect(refresh).toBeGreaterThan(statusBar);
    expect(accuracy).toBeGreaterThan(refresh);
    expect(mapScreen).toContain("t('settings.preciseLocation')");
    expect(mapScreen).toContain("t('settings.preciseLocationHint')");
    expect(mapScreen).toContain('styles.refreshLocationsButton');
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

  it('exposes a settings OTA apply CTA only when an update is available', () => {
    expect(settingsOverlay).toContain('checkForUpdateAsync');
    expect(settingsOverlay).toContain('fetchUpdateAsync');
    expect(settingsOverlay).toContain('reloadAsync');
    expect(settingsOverlay).toContain('showOtaApply');
    expect(settingsOverlay).toContain("t('settings.applyOta')");
    expect(settingsOverlay).toContain("t('settings.applyingOta')");
    expect(i18n).toContain("'settings.applyOta': '立即更新'");
    expect(i18n).toContain("'settings.applyOta': 'Update now'");
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

  it('sheet next-stop summary uses ordered first active stop, not activePoint/card', () => {
    expect(mapScreen).toContain('nextOrderedDestination(destinations)');
    expect(mapScreen).toContain('const nextStopTitle = nextStop?.title');
    expect(mapScreen).not.toContain('activePoint?.title ?? destinations[0]?.title');
    expect(mapScreen).toContain('filterActiveDestinations');
    expect(mapScreen).toContain('resolveAddDay');
    expect(mapScreen).toContain('mergeHistoryWithPastStops');
  });

  it('avoids Zoom enter/exit on gathering-card body (no shrink-then-pop)', () => {
    expect(mapScreen).not.toContain('ZoomIn');
    expect(mapScreen).not.toContain('ZoomOut');
    expect(mapScreen).not.toMatch(/entering=\{ZoomIn/);
    expect(mapScreen).not.toMatch(/exiting=\{ZoomOut/);
  });

  it('uses gathering-card press without scale bounce on expand or collapse', () => {
    expect(mapScreen).toContain('GatheringCardPressable');
    expect(mapScreen).not.toContain('scale: 0.96');
    expect(mapScreen).not.toContain('pressedCardId');
    expect(mapScreen).not.toContain('withTiming(1.02');
    expect(mapScreen).not.toContain('withSequence');
  });

  it('keeps straggler toggle UI-first with dirty/last-write-wins (not forced by DB props)', () => {
    expect(mapScreen).toContain('dirtyRef');
    expect(mapScreen).toContain('lastSubmittedRef');
    expect(mapScreen).toContain('seqRef');
    expect(mapScreen).toContain('onLocalChange');
    expect(mapScreen).toContain('stragglerOverride');
    expect(mapScreen).toContain('alertsEnabled: effectiveStragglerAlerts');
    expect(mapScreen).toContain('thresholdM: effectiveStragglerThresholdM');
    // Must not full-refresh after setStragglerConfig success (causes snap-back).
    const persistIdx = mapScreen.indexOf('const persistStragglerConfig');
    const persistBlock = mapScreen.slice(persistIdx, persistIdx + 400);
    expect(persistBlock).toContain('setStragglerConfig');
    expect(persistBlock).not.toContain('refresh()');
  });

  it('keeps peek/mid sheet width stable so tab Segmented does not scale between stages', () => {
    // detents may be read via SharedValue alias `d` (stable pan) but side insets stay [10,10,0].
    expect(bottomSheet).toMatch(/interpolate\(h, \w+, \[10, 10, 0\]/);
    expect(bottomSheet).not.toMatch(/interpolate\(h, \w+, \[20, 10, 0\]/);
  });

  it('snaps Segmented pill when track width appears (tools pane reveal)', () => {
    expect(segmented).toContain('widthAppeared');
    expect(segmented).toContain('prevSegWRef');
  });

  it('keeps arrival beside navigation controls and offers timestamp choices', () => {
    const commandRow = mapScreen.indexOf('styles.commandRow');
    const arrivalButton = mapScreen.indexOf('arrivalCmdSquare', commandRow);
    const meetButton = mapScreen.indexOf('styles.meetBtn', commandRow);

    expect(arrivalButton).toBeGreaterThan(commandRow);
    expect(arrivalButton).toBeLessThan(meetButton);
    expect(mapScreen).toContain('setDestinationArrivalAt');
    expect(mapScreen).toContain("arrival.timeLeader");
    expect(mapScreen).toContain("arrival.timeNow");
    expect(mapScreen).toContain("arrival.timeAutomatic");
    expect(mapScreen).not.toContain('handleArrival(dest, user.id, true)');
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

  it('keeps create/join static and only fades in My Teams', () => {
    expect(roleSelect).not.toContain('SlideInDown');
    // Create/join action row is a plain View (no entering animation).
    expect(roleSelect).toContain('<View style={styles.actionRow}>');
    expect(roleSelect).toContain('entering={FadeIn.duration(400)}');
    expect(roleSelect).toContain('查看我的隊伍');
  });

  it('marquees overflow collapsed titles and uses role-correct nav labels', () => {
    expect(mapScreen).toContain('OverflowMarquee');
    expect(mapScreen).toContain('endPauseMs={2000}');
    expect(mapScreen).toContain('resolveNavCommand');
    expect(mapScreen).toContain('startLocalRoutePlan');
    expect(mapScreen).toContain('pendingCompleteDestIds');
    expect(mapScreen).toContain('runCompleteGatheringStop');
    expect(mapScreen).toContain('resolveCompletePrompt');
    // Arrived green check is pressable for undo (anti mis-tap).
    expect(mapScreen).toContain("handleArrival(dest, user.id, false)");
    expect(mapScreen).toContain("accessibilityLabel={t('arrival.undo')}");
    // ETA/dist sit near maps; day line above arrival progress.
    expect(mapScreen).toContain('styles.cardMapsCol');
    expect(mapScreen).toContain('styles.cardDayLine');
    expect(mapScreen).toContain('styles.cardMetaRowAfterDay');
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
