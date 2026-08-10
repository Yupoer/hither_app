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
const i18n = [
  readFileSync(join(__dirname, '../i18n/locales/zh.ts'), 'utf8'),
  readFileSync(join(__dirname, '../i18n/locales/en.ts'), 'utf8'),
].join('\n');
const overflowMarquee = readFileSync(join(__dirname, '../components/OverflowMarquee.tsx'), 'utf8');
const useGroupState = readFileSync(join(__dirname, '../state/useGroupState.ts'), 'utf8');

describe('map UI placement contracts', () => {
  it('coalesces full group-state reloads at a single-flight root', () => {
    expect(useGroupState).toContain('loadInFlightRef');
    expect(useGroupState).toContain('if (loadInFlightRef.current) {');
    expect(useGroupState).toContain('pendingReloadRef.current = true');
    const subStart = useGroupState.indexOf('.subscribe((status)');
    const subEnd = useGroupState.indexOf('const timer = setInterval', subStart);
    const statusCallback = useGroupState.slice(subStart, subEnd);
    expect(subStart).toBeGreaterThanOrEqual(0);
    expect(statusCallback).toContain("status === 'SUBSCRIBED'");
    expect(statusCallback).toContain("status === 'CHANNEL_ERROR'");
    expect(statusCallback).toContain('loadRef.current()');
  });

  it('subscribes to daily_accommodations for remote stay convergence (#159)', () => {
    expect(useGroupState).toContain("table: 'daily_accommodations'");
    expect(useGroupState).toContain('scheduleReload');
  });
  it('renders arrival radius hint with tertiary subhint style', () => {
    expect(mapScreen).toContain("styles.accuracySubhint}>{t('arrival.radiusHint')}");
    expect(mapScreen).toMatch(/accuracySubhint:\s*\{[\s\S]*?color:\s*glass\.textTertiary/);
  });

  it('scopes itinerary to current open scope for everyone including leaders (#154)', () => {
    const scopeStart = mapScreen.indexOf('const rawDestinations');
    const scopeEnd = mapScreen.indexOf('const [optimisticDestinations', scopeStart);
    const scopeBlock = mapScreen.slice(scopeStart, scopeEnd);

    // Leaders no longer receive the unscoped full list — route editor stays
    // on current/open scope (main vs subgroup).
    expect(scopeBlock).not.toContain('if (isLeader) return all;');
    expect(scopeBlock).toContain('d.subgroupId === myScopeId');
    expect(scopeBlock).toContain('d.subgroupId == null');
  });

  it('keeps history and KML on the route pane; reorder overlay wires import CTA (#151/#154)', () => {
    // Route sheet pane body (not the full-screen reorder overlay).
    const routePane = mapScreen.indexOf('// ─── 路線');
    const toolsPane = mapScreen.indexOf('// ─── 工具', routePane);
    const routeBlock = mapScreen.slice(routePane, toolsPane > 0 ? toolsPane : routePane + 2500);

    expect(routeBlock).toContain("t('map.stopsReorder'");
    expect(routeBlock).toContain("t('arrival.manage')");
    expect(routeBlock).toContain("t('kml.entry')");
    expect(routeBlock).toContain("t('history.title')");
    expect(routeBlock).toContain("setOverlay('arrivalManage')");

    // Reorder overlay: import via DestinationReorderList (no bottom add row).
    const overlayRoute = mapScreen.indexOf("visible={overlay === 'route'}");
    const overlayRouteEnd = mapScreen.indexOf('<SettingsOverlay', overlayRoute);
    const overlayBlock = mapScreen.slice(
      overlayRoute,
      overlayRouteEnd > 0 ? overlayRouteEnd : overlayRoute + 3500,
    );
    expect(overlayBlock).toContain('DestinationReorderList');
    expect(overlayBlock).toContain('onImport={() => setKmlVisible(true)}');
    expect(overlayBlock).not.toContain("t('map.addStop')");
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
    // Manual apply shares single-flight lifecycle with auto bootstrap.
    expect(settingsOverlay).toContain('applyOtaUpdate');
    expect(settingsOverlay).toContain('handleApplyOta');
    expect(settingsOverlay).toContain('showOtaApply');
    expect(settingsOverlay).toContain("t('settings.applyOta')");
    expect(settingsOverlay).toContain("t('settings.applyingOta')");
    expect(i18n).toContain("'settings.applyOta': '立即更新'");
    expect(i18n).toContain("'settings.applyOta': 'Update now'");
  });

  it('exposes return-to-home from settings without forcing leave/sign-out', () => {
    expect(settingsOverlay).toContain("t('map.backToHome')");
    expect(settingsOverlay).toContain("t('settings.createOrJoinHint')");
    expect(settingsOverlay).toContain('onGoHome');
    expect(settingsOverlay).not.toContain("t('settings.createOrJoin')");
    expect(settingsOverlay).not.toContain("t('map.switchGroup')");
    expect(mapScreen).toContain('goHomeCreateOrJoin');
    expect(mapScreen).toContain("navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] })");
    // Must not clear membership just to open create/join.
    const goHomeFn = mapScreen.indexOf('goHomeCreateOrJoin = useCallback');
    const goHomeBody = mapScreen.slice(goHomeFn, goHomeFn + 520);
    expect(goHomeBody).not.toContain('leaveGroup');
    expect(goHomeBody).not.toContain('signOut');
    expect(goHomeBody).not.toContain("navigation.navigate('RoleSelect')");
    expect(i18n).toContain("'map.backToHome': '回到主畫面'");
  });

  it('places Leave group in the personal section with consistent label for all roles', () => {
    const personal = settingsOverlay.indexOf("t('settings.sectionPersonal')");
    const leave = settingsOverlay.indexOf("t('group.leave')", personal);
    const language = settingsOverlay.indexOf("t('settings.sectionLanguageAppearance')", personal);
    expect(personal).toBeGreaterThanOrEqual(0);
    expect(leave).toBeGreaterThan(personal);
    expect(leave).toBeLessThan(language);
    expect(settingsOverlay).not.toContain("t('settings.sectionGroupAdmin')");
    expect(settingsOverlay).not.toContain("t('map.endGroupCurrent')");
    expect(settingsOverlay).toContain('onConfirmLeave');
  });

  it('keeps Tools lean and parks map/journey chrome prefs in Settings', () => {
    const toolsStart = mapScreen.indexOf('// ─── 工具');
    const toolsEnd = mapScreen.indexOf('const sheetChildren');
    const toolsBlock = mapScreen.slice(toolsStart, toolsEnd > 0 ? toolsEnd : toolsStart + 5000);

    const passive = toolsBlock.indexOf("t('passive.enter')");
    const sharing = toolsBlock.indexOf("t('settings.locationSharing')");
    const arrival = toolsBlock.indexOf("t('arrival.radiusSection')");
    const commands = toolsBlock.indexOf("t('map.cmdTitle')");

    expect(passive).toBeGreaterThanOrEqual(0);
    expect(sharing).toBeGreaterThan(passive);
    expect(arrival).toBeGreaterThan(sharing);
    expect(commands).toBeGreaterThan(arrival);

    expect(toolsBlock).toContain('setPassiveCompanionMode');
    expect(toolsBlock).toContain('testID="tools-enter-passive"');
    expect(toolsBlock).toContain('handleSharingEnabledChange');
    expect(toolsBlock).toContain('PrefSlider');
    expect(toolsBlock).toContain('AmicroButton');
    // Preference clutter moved out of Tools (Live Activity toggle stays in Settings).
    // Tools may show a locked entitlement deep-link using settings.liveActivity label.
    expect(toolsBlock).not.toContain("t('settings.obliqueLocate')");
    expect(toolsBlock).not.toContain("t('settings.gatherCardDefaultExpanded')");
    expect(toolsBlock).not.toContain("t('settings.gatherCardTitleMarquee')");
    expect(toolsBlock).toContain('tools-live-activity-locked');
    expect(toolsBlock).not.toContain('setLiveActivityEnabled');

    expect(settingsOverlay).toContain("t('settings.sectionMapJourney')");
    expect(settingsOverlay).toContain("t('settings.obliqueLocate')");
    expect(settingsOverlay).toContain("t('settings.liveActivity')");
    expect(settingsOverlay).toContain("t('settings.gatherCardDefaultExpanded')");
    expect(settingsOverlay).toContain("t('settings.gatherCardTitleMarquee')");
    expect(settingsOverlay).not.toContain("t('settings.passiveCompanionMode')");
    expect(settingsOverlay).not.toContain("t('settings.locationSharing')");
  });

  it('aligns per-destination meet clocks when itinerary dates change', () => {
    expect(mapScreen).toContain('alignMeetTimeToTripDay');
    expect(mapScreen).toContain('meetAt: alignedMeetAt.toISOString()');
    expect(mapScreen).toContain('addMinutesToPickerValue(meetTimeEditor.value, m)');
    expect(mapScreen).toContain('reorderDestinations(groupId, meetUpdates)');
  });

  it('persists the gathering-card default and exposes it in Settings', () => {
    expect(preferences).toContain("pref.gatherCardDefaultExpanded");
    expect(preferences).toContain('gatherCardDefaultExpanded');
    expect(preferences).toContain('setGatherCardDefaultExpanded');
    expect(settingsOverlay).toContain("t('settings.gatherCardDefaultExpanded')");
    expect(settingsOverlay).toContain('value={gatherCardDefaultExpanded}');
    expect(i18n).toContain("'settings.gatherCardDefaultExpanded': '預設展開集合點卡片'");
  });

  it('persists title marquee preference and wires it to collapsed cards', () => {
    expect(preferences).toContain("pref.gatherCardTitleMarquee");
    expect(preferences).toContain('gatherCardTitleMarquee');
    expect(preferences).toContain('setGatherCardTitleMarquee');
    expect(preferences).toContain("pref.gatherCardMarqueeSpeed");
    expect(preferences).toContain('gatherCardMarqueeSpeed');
    expect(preferences).toContain('setGatherCardMarqueeSpeed');
    expect(preferences).toContain('clampMarqueeSpeed');
    expect(settingsOverlay).toContain("t('settings.gatherCardTitleMarquee')");
    expect(settingsOverlay).toContain('Boolean(gatherCardTitleMarquee)');
    expect(settingsOverlay).toContain('setGatherCardTitleMarquee(Boolean(v))');
    expect(settingsOverlay).toContain('PrefSlider');
    expect(settingsOverlay).toContain("t('settings.gatherCardMarqueeSpeed')");
    expect(settingsOverlay).toContain('setGatherCardMarqueeSpeed');
    expect(i18n).toContain("'settings.gatherCardTitleMarquee': '集合點名稱跑馬燈'");
    expect(i18n).toContain("'settings.gatherCardMarqueeSpeed': '跑馬燈速度'");
    expect(mapScreen).toContain('enabled={gatherCardTitleMarquee}');
    expect(mapScreen).toContain('pixelsPerSecond={gatherCardMarqueeSpeed}');
    expect(mapScreen).toContain('active={active}');
    expect(mapScreen).toContain('activationDelayMs={1600}');
    expect(mapScreen).toContain('OverflowMarquee');
    expect(overflowMarquee).toContain('activationDelayMs');
    expect(overflowMarquee).toContain('setArmed');
    // Stable single style object — not an inline array that re-creates every render.
    expect(mapScreen).toContain('style={styles.cardTitleCollapsed}');
    expect(mapScreen).not.toMatch(
      /OverflowMarquee[\s\S]{0,200}style=\{\[styles\.cardTitle/,
    );
    // Measure outside clip (outer); only mouth/viewport use overflow:hidden.
    expect(overflowMarquee).toContain('measureHost');
    expect(overflowMarquee).toContain('onTextLayout');
    expect(overflowMarquee).toContain('width: 10000');
    expect(overflowMarquee).toContain('styles.outer');
    expect(overflowMarquee).toContain('styles.mouth');
    expect(overflowMarquee).toMatch(/mouth:\s*\{[\s\S]*?overflow:\s*'hidden'/);
    // Constant px/s (no travel*28 clamps that change speed by title length).
    expect(overflowMarquee).toContain('pixelsPerSecond');
    expect(overflowMarquee).toContain('travel / pxPerSec');
    expect(overflowMarquee).not.toContain('travel * 28');
    // Reset text width on content/font metrics, never style-array identity alone.
    expect(overflowMarquee).toContain('[text, fontKey]');
    expect(overflowMarquee).not.toMatch(/setTextW\(0\);\s*\}, \[text, style\]/);
    // Loop via withRepeat on UI runtime — never restart from completion callback.
    expect(overflowMarquee).toContain('withRepeat');
    expect(overflowMarquee).toContain('withSequence');
    expect(overflowMarquee).not.toMatch(/if\s*\(\s*finished\s*\)\s*loop/);
    // Single-line track: explicit measured width so Text cannot wrap to mouth.
    expect(overflowMarquee).toContain('width: textW');
    // Static path uses system tail ellipsis; scrolling path must not.
    expect(overflowMarquee).toContain('ellipsizeMode="tail"');
    expect(overflowMarquee).toContain('styles.scrollText');
    expect(overflowMarquee).not.toMatch(
      /styles\.scrollText[^\n]*numberOfLines/,
    );
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
    const cardBodyStart = mapScreen.indexOf(
      '{cardExpanded ? (',
      mapScreen.indexOf('Collapsed / expanded swap in-tree'),
    );
    const cardBodyEnd = mapScreen.indexOf(') : (', cardBodyStart);
    expect(cardBodyStart).toBeGreaterThanOrEqual(0);
    expect(cardBodyEnd).toBeGreaterThan(cardBodyStart);
    expect(mapScreen.slice(cardBodyStart, cardBodyEnd)).not.toContain('ZoomIn');
    expect(mapScreen.slice(cardBodyStart, cardBodyEnd)).not.toContain('ZoomOut');
    // Arrival feedback uses a centered solid check overlay (not kicker badge);
    // the expanded/collapsed card body must remain a one-shot swap.
    expect(mapScreen).toContain('arrivalCenterCheckLayer');
    // Ease-only ZoomIn — no springify bounce on the celebrate check.
    expect(mapScreen).toContain('entering={ZoomIn.duration(240)}');
    expect(mapScreen).not.toMatch(
      /arrivalCenterCheckLayer[\s\S]{0,400}ZoomIn\.duration\([^)]+\)\.springify/,
    );
    expect(mapScreen).toContain('backgroundColor: glass.ok');
    expect(mapScreen).not.toContain('arrivalCheckBadge');
  });

  it('keeps gathering-card page dots lightweight during stage morphs', () => {
    expect(mapScreen).toContain('styles.dots');
    expect(mapScreen).toContain('styles.dotActive');
    // Static dots — layout transitions were too expensive during sheet stage changes.
    expect(mapScreen).not.toContain('layout={LinearTransition.springify()');
    expect(mapScreen).toContain('style={[styles.dot, i2 === selectedIndex && styles.dotActive]}');
  });

  it('uses gathering-card press without scale bounce on expand or collapse', () => {
    expect(mapScreen).toContain('GatheringCardPressable');
    expect(mapScreen).not.toContain('scale: 0.96');
    expect(mapScreen).not.toContain('pressedCardId');
    expect(mapScreen).not.toContain('withTiming(1.02');
    // Marquee uses withSequence; card press shell must not scale-bounce.
    expect(mapScreen).toContain('lastPressAtRef');
    expect(mapScreen).toMatch(/now - lastPressAtRef\.current < 300/);
  });

  it('removes straggler configuration UI while keeping detection wiring', () => {
    expect(mapScreen).not.toContain('StragglerConfigSection');
    expect(mapScreen).not.toContain('stragglerOverride');
    expect(mapScreen).not.toContain('persistStragglerConfig');
    expect(mapScreen).not.toContain('setStragglerConfig');
    expect(mapScreen).not.toContain('onOpenStraggler');
    expect(settingsOverlay).not.toContain('onOpenStraggler');
    expect(settingsOverlay).not.toContain("t('straggler.section')");
    const toolsStart = mapScreen.indexOf('// ─── 工具');
    const toolsEnd = mapScreen.indexOf('const sheetChildren');
    const toolsBlock = mapScreen.slice(toolsStart, toolsEnd > 0 ? toolsEnd : toolsStart + 5000);
    expect(toolsBlock).not.toContain("t('straggler.section')");
    // Detection + APNs fan-out stay on group fields.
    expect(mapScreen).toContain('useStragglerAlerts');
    expect(mapScreen).toContain('alertsEnabled: group?.stragglerAlerts ?? true');
    expect(mapScreen).toContain('thresholdM: group?.stragglerThresholdM ?? 500');
    expect(mapScreen).toContain('reportStraggler');
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

  it('renders Members/Route/Tools/Store as compact icon tabs without Liquid Glass rim', () => {
    const optionsStart = mapScreen.indexOf('const sheetPaneOptions = useMemo');
    const sheetChildrenEnd = mapScreen.indexOf('if (loading && !state)', optionsStart);
    const sheetBlock = mapScreen.slice(
      optionsStart,
      sheetChildrenEnd > 0 ? sheetChildrenEnd : optionsStart + 3000,
    );
    // Tab shell is solid fill (no GlassView) so liquid-glass white rims never appear.
    expect(sheetBlock).toContain('SheetPaneTabs');
    expect(sheetBlock).toContain('sheetPaneToggleGlass');
    expect(sheetBlock).not.toContain('liquidGlass.GlassView');
    expect(sheetBlock).toContain("key: 'members'");
    expect(sheetBlock).toContain("key: 'route'");
    expect(sheetBlock).toContain("key: 'tools'");
    expect(sheetBlock).toContain("key: 'store'");
    expect(sheetBlock).toContain('selectSheetPane');
    expect(sheetBlock).not.toContain('viewportCount={3}');
    expect(sheetBlock).not.toContain('PaneCoverFlow');
    // Shared Settings segmented controls stay non-glass icon-tab-free.
    expect(settingsOverlay).toContain('<Segmented');
    expect(settingsOverlay).not.toContain('unstyledTrack');
    expect(settingsOverlay).not.toContain('liquidGlass');
    expect(settingsOverlay).not.toContain('SheetPaneTabs');
    expect(settingsOverlay).not.toContain('PaneCoverFlow');
  });

  it('keeps arrival beside navigation controls and auto-applies current time', () => {
    const commandRow = mapScreen.indexOf('styles.commandRow');
    const arrivalButton = mapScreen.indexOf('arrivalCmdSquare', commandRow);
    const meetButton = mapScreen.indexOf('styles.meetBtn', commandRow);
    // Product order: nav | arrived | transport | countdown (transport before meet).
    const transportRef = mapScreen.indexOf("setTourTargetRef('transport'", commandRow);
    const meetRef = mapScreen.indexOf("setTourTargetRef('meetTime'", commandRow);

    expect(arrivalButton).toBeGreaterThan(commandRow);
    expect(arrivalButton).toBeLessThan(meetButton);
    expect(transportRef).toBeGreaterThan(commandRow);
    expect(transportRef).toBeLessThan(meetRef);
    expect(mapScreen).toContain('ARRIVED_SPLIT_MS');
    expect(mapScreen).toContain('FadeInRight');
    expect(mapScreen).toContain('setDestinationArrivalAt');
    // Arrive is one-tap now — no multi-option time-choice Alert.
    expect(mapScreen).toContain('handleSelfArrival');
    expect(mapScreen).toContain('submitArrivalWithTimestamp(destination, targetUserId, new Date().toISOString())');
    expect(mapScreen).not.toContain("arrival.timeLeader");
    expect(mapScreen).not.toContain("arrival.timeNow");
    expect(mapScreen).not.toContain("arrival.timeAutomatic");
    expect(mapScreen).not.toContain('handleArrival(dest, user.id, true)');
    expect(mapScreen).not.toContain('await syncFromDatabase();\n        await setDestinationArrivalAt');
    expect(mapScreen).toContain('sharedTargetId === dest.id');
    expect(mapScreen).toContain('expanded={!showArrivalControl}');
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
    expect(roleSelect).toContain("t('role.myTeams'");
  });

  it('avoids Android elevation black-frame on translucent rounded role tiles', () => {
    // Opaque Android fills + elevation:0 on rounded action chrome.
    expect(roleSelect).toContain("Platform.OS === 'android'");
    expect(roleSelect).toContain('JOIN_FILL');
    expect(roleSelect).toMatch(/actionTile:\s*\{[\s\S]*?elevation:\s*0/);
    expect(roleSelect).toMatch(/actionTile:\s*\{[\s\S]*?overflow:\s*'hidden'/);
  });

  it('marquees overflow collapsed titles and uses role-correct nav labels', () => {
    expect(mapScreen).toContain('OverflowMarquee');
    expect(mapScreen).toContain('endPauseMs={1500}');
    expect(mapScreen).toContain('enabled={gatherCardTitleMarquee}');
    expect(mapScreen).toContain('resolveNavCommand');
    expect(mapScreen).toContain('deriveCardNavFlags');
    expect(mapScreen).toContain('projectTeamGatheringState');
    expect(mapScreen).toContain('teamGatheringState');
    expect(mapScreen).toContain('overlayPersonalOnTeamState');
    expect(mapScreen).toContain('teamSurfaceView');
    expect(mapScreen).toContain('requestTeamEnd');
    expect(mapScreen).toContain("navCmd.action === 'end_point'");
    expect(mapScreen).toContain('runCompleteGatheringStop');
    // Complete uses the stop RPC; End navigation cancels session separately.
    expect(mapScreen).toContain('navigationSessionState.refresh()');
    const completeFn = mapScreen.slice(
      mapScreen.indexOf('runCompleteGatheringStop = useCallback'),
      mapScreen.indexOf('runCompleteGatheringStop = useCallback') + 1200,
    );
    expect(completeFn).toContain('completeGatheringStop(groupId, destination.id)');
    expect(completeFn).not.toContain('stopNavigation()');
    expect(completeFn).not.toContain('requestTeamEnd');
    expect(mapScreen).toContain('sharedTargetId');
    expect(mapScreen).toContain("navCmd.action === 'request_start'");
    expect(mapScreen).toContain('requestLeaderStart(dest)');
    expect(mapScreen).not.toContain('startLocalRoutePlan');
    expect(mapScreen).not.toContain('pendingCompleteDestIds');
    expect(mapScreen).toContain('resolveCompletePrompt');
    // Must not gate flock nav on journeyActive (true for local plans).
    expect(mapScreen).not.toMatch(
      /flockNavigatingThis\s*=\s*\(\s*journeyActive/,
    );
    // Member confirm never calls leader-only complete RPC.
    expect(mapScreen).toContain("prompt.kind === 'member_leader_already_done'");
    expect(mapScreen).toContain('member_leader_already_done');
    // Arrived green check is pressable for undo (anti mis-tap).
    expect(mapScreen).toContain("handleArrival(dest, user.id, false)");
    expect(mapScreen).toContain("accessibilityLabel={t('arrival.undo')}");
    // Expanded mock: day + people chip; dist | eta | maps metrics row.
    expect(mapScreen).toContain('styles.cardSubRow');
    expect(mapScreen).toContain('styles.cardDayLine');
    expect(mapScreen).toContain('styles.arrivalPeopleChip');
    expect(mapScreen).toContain('arrivedHere}/{totalMembers');
    expect(mapScreen).not.toContain('arrivalHairline');
    expect(mapScreen).not.toContain('arrivalHairlineFill');
    expect(mapScreen).toContain('styles.metricsRow');
    expect(mapScreen).toContain('styles.mapsChip');
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

  it('opens Settings directly from the sheet ⋯ button without a platform menu', () => {
    const toolsStart = mapScreen.indexOf('// ─── 工具');
    const toolsEnd = mapScreen.indexOf('const sheetChildren');
    const toolsBlock = mapScreen.slice(toolsStart, toolsEnd);
    expect(toolsBlock).not.toContain("t('map.overlaySettings')");

    const openStart = mapScreen.indexOf('const openSettingsFromSheet');
    const openEnd = mapScreen.indexOf('useEffect(() => {\n    void refreshSentInvites', openStart);
    const openBlock = mapScreen.slice(openStart, openEnd > 0 ? openEnd : openStart + 600);
    expect(openBlock).toContain("'map.open_settings'");
    expect(openBlock).toContain("setOverlay('settings')");
    expect(openBlock).not.toContain('ActionSheetIOS');
    expect(openBlock).not.toContain('Alert.alert');
    expect(mapScreen).not.toContain('const openGroupMenu');
    expect(mapScreen).not.toContain('ActionSheetIOS');
    expect(i18n).toContain("'map.backToHome': '回到主畫面'");
  });

  it('updates the gathering-point navigation state before the network request finishes', () => {
    // Shared flock vs local plan derived from sharedTargetId / localTargetId
    // (not journeyActive — that is true for member local plans too).
    expect(mapScreen).toContain('flockNavigatingThis');
    expect(mapScreen).toContain('deriveCardNavFlags');
    expect(mapScreen).toContain('pendingLeaderTargetId');
    expect(mapScreen).toContain('sharedTargetId');
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

  it('opens the custom quick command editor as a sheet from the full command catalogue only', () => {
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
    // Settings no longer hosts a duplicate custom-quick-command editor.
    expect(settingsOverlay).not.toContain("t('settings.customQuickCommand')");
    expect(settingsOverlay).not.toContain('customQuickCommandConfiguredCount');
    expect(settingsOverlay).not.toContain('onOpenCustomQuickCommand');
    expect(mapScreen).not.toContain('onOpenCustomQuickCommand={openCustomQuickCommand}');
  });

  it('auto-completes when all arrived and confirms missing with x/x destructive complete', () => {
    expect(mapScreen).toContain("prompt.kind === 'auto_complete'");
    // This-device notify via native boundary (no Platform.OS in MapScreen).
    expect(mapScreen).toContain('notifyThisDeviceAutoComplete');
    expect(mapScreen).not.toMatch(/notifyThisDeviceAutoComplete[\s\S]{0,200}Platform\.OS/);
    expect(mapScreen).toContain("t('gathering.autoCompleteTitle')");
    expect(mapScreen).toContain('arrivedCount');
    expect(mapScreen).toContain('totalCount');
    // Scoped counts (subgroup destination must not count whole group).
    expect(mapScreen).toContain('deriveScopedArrivalCounts');
    expect(mapScreen).toContain('destination.subgroupId');
    // Card people chip uses scoped totals (not members.length).
    expect(mapScreen).toContain('cardArrival.arrivedCount');
    expect(mapScreen).toContain('cardArrival.totalCount');
    // Remote final arrival (not only personal-arrive path).
    expect(mapScreen).toContain('remoteAutoCompleteDestIdsRef');
    expect(mapScreen).toContain('executeAutoCompleteStop');
    // Complete only after arrival write succeeds; failed write clears optimistic self.
    expect(mapScreen).toContain('promptComplete: false');
    expect(mapScreen).toContain('setAutoArrivedDestId((cur) => (cur === navTarget.id ? null : cur))');
    // Manual Complete must not invent self arrival (includeSelf opt-in only).
    expect(mapScreen).toContain('includeUserId: opts?.includeSelf ? user?.id : null');
    // i18n for missing-members confirm (not zh-hardcoded Alert strings).
    expect(mapScreen).toContain("t('gathering.completeMissingTitle')");
    expect(mapScreen).toContain("t('gathering.completeMissingMessage'");
    expect(mapScreen).toContain("t('gathering.completeConfirm')");
    expect(i18n).toContain("'gathering.completeMissingMessage'");
    // In-flight guard against double complete RPC.
    expect(mapScreen).toContain('completingDestIdsRef');
    // Cancel first, destructive complete second (left-cancel / right-destructive intent).
    const promptBlock = mapScreen.slice(
      mapScreen.indexOf('const promptCompleteAfterArrival'),
      mapScreen.indexOf('const promptCompleteAfterArrival') + 4500,
    );
    expect(promptBlock).toContain("style: 'cancel'");
    expect(promptBlock).toContain("style: isMissing ? 'destructive'");
  });

  it('chooses Google or Apple Maps before opening external navigation', () => {
    expect(mapScreen).toContain('openExternalNavigation');
    const journeyNav = readFileSync(
      join(__dirname, '../screens/MapScreen/hooks/useJourneyNavigation.ts'),
      'utf8',
    );
    expect(journeyNav).toContain('presentExternalMapsChooser');
    expect(journeyNav).toContain("t('map.googleMaps')");
    expect(journeyNav).toContain("t('map.appleMaps')");
    expect(journeyNav).toContain("t('map.externalMapsOpenFailed')");
    expect(i18n).toContain("'map.googleMaps'");
    expect(i18n).toContain("'map.appleMaps'");
    expect(i18n).toContain("'map.externalMapsOpenFailed'");
  });

  it('uses theme accent for create-team and passive enter without Enter… copy', () => {
    expect(mapScreen).toContain("t('subgroup.createTeam')");
    expect(mapScreen).toMatch(/createTeam[\s\S]{0,80}color: accent|color: accent[\s\S]{0,80}createTeam/);
    expect(i18n).toContain("'passive.enter': '被動模式'");
    expect(i18n).toContain("'passive.enter': 'Passive mode'");
    expect(i18n).not.toContain("'passive.enter': '進入被動模式'");
    expect(i18n).not.toContain("'passive.enter': 'Enter passive mode'");
  });

  it('returns the report sheet to settings after cancel or submit', () => {
    expect(mapScreen).toMatch(
      /<FeedbackSheet[\s\S]*?onClose=\{\(\) => setOverlay\('settings'\)\}/,
    );
  });

  it('sends the custom command label (fallback message) to the group', () => {
    // Prefer short label so push/local titles read 隊長/成員：{label}.
    expect(quickCommandsCard).toContain("sendCommand(groupId, 'custom', label.trim() || message)");
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
