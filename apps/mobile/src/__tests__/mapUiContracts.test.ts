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
    const heading = mapScreen.indexOf('styles.headingRow');
    const actions = mapScreen.indexOf('styles.memberHeadingActions', heading);
    const accuracy = mapScreen.indexOf('styles.accuracyRow', actions);
    const refresh = mapScreen.indexOf('styles.refreshLocationsButton', actions);

    expect(heading).toBeGreaterThanOrEqual(0);
    expect(actions).toBeGreaterThan(heading);
    expect(accuracy).toBeGreaterThan(actions);
    expect(refresh).toBeGreaterThan(actions);
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

  it('exposes the oblique-locate toggle in Settings', () => {
    expect(settingsOverlay).toContain("t('settings.mapSection')");
    expect(settingsOverlay).toContain("t('settings.obliqueLocate')");
    expect(settingsOverlay).toContain('setObliqueLocate');
    expect(settingsOverlay).toContain('value={obliqueLocate}');
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
    expect(settingsOverlay).toContain('styles.reportButton');
  });

  it('updates the gathering-point navigation state before the network request finishes', () => {
    expect(mapScreen).toContain(
      'isLeader && (journeyActive || journeyBusy) && navTarget?.id === dest.id',
    );
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
