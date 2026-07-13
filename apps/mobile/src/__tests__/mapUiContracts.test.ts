import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
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
    const actions = mapScreen.indexOf('styles.memberHeadingActions');
    const accuracy = mapScreen.indexOf("t('settings.highAccuracyCompact')", actions);
    const refresh = mapScreen.indexOf('styles.refreshLocationsButton', actions);

    expect(actions).toBeGreaterThanOrEqual(0);
    expect(accuracy).toBeGreaterThan(actions);
    expect(refresh).toBeGreaterThan(accuracy);
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

  it('adds visible separation before viewing my teams', () => {
    expect(roleSelect).toContain("marginTop: 48");
  });

  it('uses a Traditional Chinese account label', () => {
    expect(i18n).toContain("'settings.account': '帳號設定'");
  });
});
