import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translations } from '../i18n';

const read = (rel: string) =>
  readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const groupMap = read('components/GroupMap.tsx');
const mapScreen = read('screens/MapScreen.tsx');
const settings = read('screens/MapScreen/components/SettingsOverlay.tsx');
const nativeSwitch = read('components/NativeSwitch.tsx');
const notifCard = read('components/NotificationPreferencesCard.tsx');
const tabs = read('screens/MapScreen/components/SheetPaneTabs.tsx');
const storePane = read('screens/MapScreen/components/StorePane.tsx');
const paywall = read('components/PaywallSheet.tsx');
const premium = read('components/PremiumPresentation.tsx');
const reorder = read('components/DestinationReorderList.tsx');
const iosMenu = readFileSync(
  join(__dirname, '../../modules/hither-menu/ios/HitherMenuModule.swift'),
  'utf8',
);

describe('#220 map / status / settings / paywall contracts', () => {
  it('fills MapView edge-to-edge without mapPadding letterbox', () => {
    expect(groupMap).toContain('style={StyleSheet.absoluteFill}');
    expect(groupMap).not.toMatch(/mapPadding=\{/);
    expect(groupMap).toContain('gatherCardHorizontalInset');
  });

  it('serializes menu subtitle and selected for iOS UIAction checkmarks', () => {
    expect(iosMenu).toContain('subtitle');
    expect(iosMenu).toContain('.on');
    expect(mapScreen).toContain('NativeMenuHost');
    expect(mapScreen).not.toContain("overlay === 'myStatus'");
    expect(mapScreen).not.toContain('solo.tempLeave');
    expect(mapScreen).toContain('applyPresenceMacroKind');
    expect(mapScreen).toContain('subgroup.createTeam');
  });

  it('omits iOS switch chrome paint and keeps icon tabs', () => {
    expect(nativeSwitch).toContain('trackColor: _trackColor');
    expect(nativeSwitch).toContain('thumbColor: _thumbColor');
    expect(nativeSwitch).toContain('ios_backgroundColor: _iosBackgroundColor');
    expect(notifCard).toContain('<NativeSwitch');
    expect(notifCard).not.toContain('trackColor={{');
    expect(mapScreen).toContain('<NativeSwitch');
    expect(tabs).toContain('testID="sheet-pane-tabs"');
    expect(tabs).not.toContain('NativeSwitch');
    expect(tabs).not.toContain('<Switch');
  });

  it('renders self flock copy as 你 plus role and freshness', () => {
    expect(mapScreen).toContain('{isMe ? t(\'flock.you\') : name}');
    expect(mapScreen).not.toContain('{name}{isMe ? ` · ${t(\'flock.you\')}` : \'\'}');
    expect(mapScreen).toContain('{!isMe && distOrStatus');
    expect(mapScreen).toContain('dist: isSelf');
    expect(translations.zh['trip.setDaysAndDate']).toBe('天數與日期');
    expect(reorder).toContain('REORDER_VISUAL_SCALE = 1.3');
  });

  it('keeps settings mounted under child overlays and hides the subscribe banner when pro', () => {
    expect(mapScreen).toContain('settingsOpen');
    expect(mapScreen).toContain('visible={settingsOpen}');
    expect(settings).toContain('testID="settings-subscribe-banner"');
    expect(settings).toContain('{!isPro ?');
    expect(settings).toContain('<OverlaySheet');
    expect(settings).toContain("setPage('textSize')");
    expect(settings).toContain("setPage('notifications')");
    expect(settings).toContain("setPage('mapJourney')");
    expect(settings.indexOf('<NativeSwitch')).toBeGreaterThan(settings.indexOf("setPage('mapJourney')"));
  });

  it('opens a full-screen paywall pager from Store and waits for projection before unlock', () => {
    expect(storePane).toContain('onOpenSubscribe');
    expect(storePane).not.toContain('<PremiumPresentation');
    expect(paywall).toContain('showIntroPager');
    expect(premium).toContain('PAYWALL_INTRO_SLIDES');
    expect(premium).toContain('waitUntilPremiumProjectionActive');
    expect(premium).toContain('onNativePurchased');
    expect(mapScreen).toContain('testID="purchase-unlock-loading"');
    expect(mapScreen).toContain('styles.loading');
    expect(paywall).toContain('showRestore={showRestore}');
  });
});
