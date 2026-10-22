import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockReplace = jest.fn();
const mockSignup = jest.fn(async () => ({ status: 'verification_required', email: 'a@example.test' }));
const mockClear = jest.fn();
const mockRefreshProfile = jest.fn(async () => undefined);
const mockKeyboardListeners = new Map<string, (event: { endCoordinates: { height: number } }) => void>();
const mockConsume = jest.fn(async () => true);
let mockForeground = true;
const mockSession: {
  user: { id: string } | null;
  isAnonymous: boolean;
  refreshProfile: typeof mockRefreshProfile;
  signUpWithEmail: typeof mockSignup;
  isPasswordRecovery: boolean;
  passwordRecoverySuccess: boolean;
  clearPasswordRecovery: typeof mockClear;
} = {
  user: null,
  isAnonymous: false,
  refreshProfile: mockRefreshProfile,
  signUpWithEmail: mockSignup,
  isPasswordRecovery: true,
  passwordRecoverySuccess: false,
  clearPasswordRecovery: mockClear,
};
jest.mock('../state/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../state/PreferencesContext', () => ({ useTheme: () => ({ colors: { accent: '#abc' } }) }));
jest.mock('../state/foregroundUi', () => ({ useForegroundClock: () => ({ now: Date.now(), lifecycle: null }), useOptionalVisuals: () => true, useForegroundUi: () => mockForeground }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native', () => ({
  Keyboard: { addListener: (event: string, listener: (value: { endCoordinates: { height: number } }) => void) => {
    mockKeyboardListeners.set(event, listener); return { remove: () => mockKeyboardListeners.delete(event) };
  } },
  Animated: { Value: class { stopAnimation() {} }, View: 'AnimatedView', timing: () => ({}),
    parallel: () => ({ start: (callback?: (result: { finished: boolean }) => void) => callback?.({ finished: true }) }) },
  Alert: { alert: jest.fn() }, TextInput: 'TextInput',
  Platform: { OS: 'ios' }, StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView',
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-constants', () => ({ expoConfig: { version: 'test' } }));
jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: async () => false }));
jest.mock('../glass', () => ({ accentMix: () => '#abc', glass: {} }));
jest.mock('../utils/otaUpdates', () => ({ consumeOtaAppliedNotice: () => mockConsume() }));
jest.mock('../components/OverlaySheet', () => 'OverlaySheet');
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn() }));
jest.mock('../utils/uiAction', () => ({ runUiAction: jest.fn() }));
jest.mock('../utils/haptics', () => ({ errorTap: jest.fn(), lightTap: jest.fn(), mediumTap: jest.fn(), selectionTick: jest.fn(), successTap: jest.fn() }));
jest.mock('../components/WaveLoading', () => 'WaveLoading');
jest.mock('../components/AuthField', () => 'AuthField');
jest.mock('../components/AuthModeSelector', () => 'AuthModeSelector');
jest.mock('../components/CrookIcon', () => 'CrookIcon');
jest.mock('../components/SafePressable', () => 'SafePressable');
jest.mock('../components/NativeGlassButton', () => 'NativeGlassButton');
jest.mock('../components/LanguagePicker', () => 'LanguagePicker');
jest.mock('../components/MetalforgeBackground', () => 'MetalforgeBackground');
jest.mock('../components/BlockingAuthOverlay', () => 'BlockingAuthOverlay');
jest.mock('../components/GoogleGIcon', () => 'GoogleGIcon');
jest.mock('../components/SwiftUIGlassSurface', () => 'SwiftUIGlassSurface');
const LoginScreen = require('../screens/LoginScreen').default;
const PasswordRecoveryScreen = require('../screens/PasswordRecoveryScreen').default;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps login drafts while changing modes and navigates pending verification on full User identity', async () => {
  let tree!: ReactTestRenderer;
  const navigation = { replace: mockReplace };
  const app = () => React.createElement(LoginScreen, { navigation });
  await act(async () => { tree = create(app()); });
  await act(async () => { tree.root.findByProps({ testID: 'login-email' }).props.onChangeText('a@example.test'); });
  await act(async () => { tree.root.findByProps({ mode: 'signin' }).props.onChange('signup'); });
  expect(tree.root.findByProps({ testID: 'login-email' }).props.value).toBe('a@example.test');
  await act(async () => {
    tree.root.findByProps({ testID: 'login-password' }).props.onChangeText('secret123');
    tree.root.findByProps({ testID: 'login-confirm-password' }).props.onChangeText('secret123');
  });
  await act(async () => { await tree.root.findByProps({ testID: 'login-submit' }).props.onPressAction({ isCurrent: () => true }); });
  expect(mockReplace).not.toHaveBeenCalled();
  mockSession.user = { id: 'a' };
  await act(async () => { tree.update(app()); });
  expect(mockReplace).toHaveBeenCalledTimes(1);
  await act(async () => { tree.update(app()); });
  expect(mockReplace).toHaveBeenCalledTimes(1);
  mockSession.user = { id: 'a' };
  await act(async () => { tree.update(app()); });
  expect(mockReplace).toHaveBeenCalledTimes(2);
  await act(async () => { tree.unmount(); });
});

it('restarts recovery dismissal for a new callback and cancels it when recovery leaves success', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  mockSession.passwordRecoverySuccess = true;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(PasswordRecoveryScreen)); });
  await act(async () => { jest.advanceTimersByTime(600); });
  const next = jest.fn();
  mockSession.clearPasswordRecovery = next;
  await act(async () => { tree.update(React.createElement(PasswordRecoveryScreen)); });
  await act(async () => { jest.advanceTimersByTime(600); });
  expect(mockClear).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
  mockSession.passwordRecoverySuccess = false;
  await act(async () => { tree.update(React.createElement(PasswordRecoveryScreen)); });
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => { jest.advanceTimersByTime(2000); tree.unmount(); });
  expect(next).not.toHaveBeenCalled();
  jest.useRealTimers();
});

it('keeps the account scroll owner while installing visible keyboard and callback-identity refresh jobs', async () => {
  const AccountSheetContent = require('../components/AccountSheet').AccountSheetContent;
  mockSession.isAnonymous = true;
  mockSession.refreshProfile = mockRefreshProfile;
  let tree!: ReactTestRenderer;
  const onClose = jest.fn();
  const app = (visible: boolean) => React.createElement(AccountSheetContent, { visible, accent: '#abc', onClose });
  await act(async () => { tree = create(app(true)); });
  expect(mockKeyboardListeners.size).toBe(2);
  expect(mockRefreshProfile).toHaveBeenCalledTimes(1);
  const scroll = tree.root.findByProps({ keyboardDismissMode: 'interactive' });
  await act(async () => { mockKeyboardListeners.get('keyboardWillShow')?.({ endCoordinates: { height: 300 } }); });
  expect(tree.root.findByProps({ keyboardDismissMode: 'interactive' })).toBe(scroll);
  const next = jest.fn(async () => undefined);
  mockSession.refreshProfile = next;
  await act(async () => { tree.update(app(true)); });
  expect(next).toHaveBeenCalledTimes(1);
  expect(mockKeyboardListeners.size).toBe(2);
  await act(async () => { tree.update(app(false)); });
  expect(mockKeyboardListeners.size).toBe(0);
  expect(tree.root.findByProps({ keyboardDismissMode: 'interactive' })).toBe(scroll);
  await act(async () => { tree.unmount(); });
  mockSession.isAnonymous = false;
});

it('cancels late OTA notice presentation and its hide timer on foreground changes', async () => {
  const OtaUpdateToast = require('../components/OtaUpdateToast').default;
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  let resolve!: (show: boolean) => void;
  mockConsume.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(OtaUpdateToast)); });
  mockForeground = false;
  await act(async () => { tree.update(React.createElement(OtaUpdateToast)); });
  await act(async () => { resolve(true); });
  expect(tree.toJSON()).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  mockForeground = true;
  await act(async () => { tree.update(React.createElement(OtaUpdateToast)); });
  expect(tree.toJSON()).not.toBeNull();
  expect(jest.getTimerCount()).toBe(1);
  mockForeground = false;
  await act(async () => { tree.update(React.createElement(OtaUpdateToast)); });
  expect(tree.toJSON()).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => { tree.unmount(); });
  jest.useRealTimers();
});
