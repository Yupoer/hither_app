import React from 'react';
import { act, create } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import SettingsChildSheet from '../screens/MapScreen/components/SettingsChildSheet';

const mockChecks: Array<(result: { isAvailable: boolean }) => void> = [];
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', TouchableOpacity: 'TouchableOpacity',
  Alert: { alert: jest.fn() }, StyleSheet: { create: (s: unknown) => s },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1' } } }));
jest.mock('expo-updates', () => ({
  isEnabled: true, useUpdates: () => ({}),
  checkForUpdateAsync: jest.fn(() => new Promise(resolve => mockChecks.push(resolve))),
}));
jest.mock('../components/WaveLoading', () => 'WaveLoading');
jest.mock('../components/SystemToggle', () => 'Toggle');
jest.mock('../components/PrefSlider', () => 'Slider');
jest.mock('../components/NotificationPreferencesCard', () => 'Notifications');
jest.mock('../components/PremiumBanner', () => 'Premium');
jest.mock('../components/AccountSheet', () => ({ AccountSheetContent: 'Account' }));
jest.mock('../screens/MapScreen/components/SettingsChildSheet', () => 'SettingsSheet');
jest.mock('../state/SessionContext', () => ({ useSession: () => ({ isPro: false }) }));
jest.mock('../state/PreferencesContext', () => ({
  useTheme: () => ({ colors: { accent: '#fff' } }),
  usePreferences: () => ({ language: 'zh', themeName: 'night', textScale: 1 }),
}));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../utils/otaUpdates', () => ({ applyOtaUpdate: jest.fn() }));
Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true });
const { SettingsOverlay } = require('../screens/MapScreen/components/SettingsOverlay');
const Updates = require('expo-updates');

it('installs one OTA check per opening, fences late results and resets the page for equal new group identity', async () => {
  const noop = jest.fn();
  const group = { id: 'g1', avatar: 'fox', avatarColor: '#111' };
  const props = { visible: true, group, styles: {}, onClose: noop, onArchiveAllForTest: noop,
    onOpenFeedback: noop, onConfirmResetPrefs: noop, onConfirmLeave: noop, onConfirmSignOut: noop,
    onOpenPaywall: noop, onAccountDeleted: noop };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(SettingsOverlay, props)); });
  const languageSheet = () => tree.root.findAllByType(SettingsChildSheet).find(node => node.props.title === 'settings.language')!;
  const openLanguage = async () => {
    const row = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'settings.language')!;
    await act(async () => row.props.onPress());
  };
  expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  await openLanguage();
  expect(languageSheet().props.visible).toBe(true);
  const sheetOwner = languageSheet();
  await act(async () => tree.update(React.createElement(SettingsOverlay, { ...props })));
  expect(languageSheet().props.visible).toBe(true);
  await act(async () => tree.update(React.createElement(SettingsOverlay, { ...props, group: { ...group } })));
  expect(languageSheet().props.visible).toBe(false);
  expect(languageSheet()).toBe(sheetOwner);
  expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(React.createElement(SettingsOverlay, { ...props, visible: false })));
  await act(async () => mockChecks[0]({ isAvailable: true }));
  const hasApply = () => tree.root.findAllByType(TouchableOpacity).some(node => node.props.accessibilityLabel === 'settings.applyOta');
  expect(hasApply()).toBe(false);
  await act(async () => tree.update(React.createElement(SettingsOverlay, props)));
  expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
  await act(async () => mockChecks[1]({ isAvailable: true }));
  expect(hasApply()).toBe(true);
  await act(async () => tree.unmount());
});
