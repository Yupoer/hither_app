import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import LoginScreen from '../screens/LoginScreen';

const mockSignInWithEmail = jest.fn();
const mockSignUpWithEmail = jest.fn();
const mockResendConfirmation = jest.fn();
const mockRequestPasswordReset = jest.fn();
const mockSignInWithGoogle = jest.fn();

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

jest.mock('../state/SessionContext', () => ({
  useSession: () => ({
    signInWithEmail: mockSignInWithEmail,
    signUpWithEmail: mockSignUpWithEmail,
    resendSignupConfirmation: mockResendConfirmation,
    requestPasswordReset: mockRequestPasswordReset,
    signInWithGoogle: mockSignInWithGoogle,
    signInWithApple: jest.fn(),
  }),
}));

jest.mock('../state/PreferencesContext', () => ({
  useTheme: () => ({ colors: { accent: '#ff9f0a' } }),
}));

jest.mock('../i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children, ...props }: { children: React.ReactNode }) => {
    const ReactRuntime = require('react') as typeof React;
    const { View: NativeView } = require('react-native') as typeof import('react-native');
    return ReactRuntime.createElement(NativeView, props, children);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: (props: { name: string }) => {
    const ReactRuntime = require('react') as typeof React;
    const { Text: NativeText } = require('react-native') as typeof import('react-native');
    return ReactRuntime.createElement(NativeText, null, props.name);
  },
}));

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
}));

jest.mock('../components/CrookIcon', () => () => {
  const ReactRuntime = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return ReactRuntime.createElement(NativeView);
});
jest.mock('../components/GoogleGIcon', () => () => {
  const ReactRuntime = require('react') as typeof React;
  const { Text: NativeText } = require('react-native') as typeof import('react-native');
  return ReactRuntime.createElement(NativeText, null, 'Google G');
});

jest.mock('../utils/activityLog', () => ({
  logEvent: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../components/LanguagePicker', () => () => null);

describe('LoginScreen email flows', () => {
  const navigation = { replace: jest.fn(), navigate: jest.fn(), canGoBack: () => false, goBack: jest.fn() };
  function openPassword(email = 'test@example.com') {
    const screen = render(<LoginScreen navigation={navigation as never} route={{} as never} />);
    fireEvent.press(screen.getByTestId('login-use-email'));
    fireEvent.changeText(screen.getByTestId('login-email'), email);
    fireEvent.press(screen.getByTestId('login-email-next'));
    return screen;
  }
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignInWithEmail.mockResolvedValue(undefined);
    mockSignUpWithEmail.mockResolvedValue({ status: 'signed_in' });
    mockResendConfirmation.mockResolvedValue(undefined);
    mockRequestPasswordReset.mockResolvedValue(undefined);
    mockSignInWithGoogle.mockResolvedValue(null);
  });
  afterEach(() => jest.useRealTimers());

  it('enables the login CTA after test credentials and reaches the app', async () => {
    const screen = openPassword('  test@example.com  ');
    expect(screen.getByTestId('login-submit').props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('login-password'), 'test-password');
    await act(async () => { fireEvent.press(screen.getByTestId('login-submit')); });
    expect(mockSignInWithEmail).toHaveBeenCalledWith({ email: 'test@example.com', password: 'test-password' });
    expect(navigation.replace).toHaveBeenCalledWith('RoleSelect');
  });

  it('submits registration without a nickname or checkbox', async () => {
    const screen = openPassword(' new@example.com ');
    fireEvent.press(screen.getByTestId('login-create-account'));
    fireEvent.changeText(screen.getByTestId('login-password'), 'short');
    expect(screen.getByTestId('login-submit').props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('login-password'), 'test-password');
    expect(screen.queryByTestId('login-nickname')).toBeNull();
    expect(screen.queryByTestId('login-signup-terms')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('login-submit')); });
    expect(mockSignUpWithEmail).toHaveBeenCalledWith({ email: 'new@example.com', password: 'test-password' });
    expect(navigation.replace).toHaveBeenCalledWith('RoleSelect');
  });

  it('keeps submit disabled for an empty password and shows sign-in failure', async () => {
    const screen = openPassword();
    fireEvent.changeText(screen.getByTestId('login-password'), '');
    expect(screen.getByTestId('login-submit').props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('login-password'), 'test-password');
    mockSignInWithEmail.mockRejectedValueOnce(new Error('invalid credentials'));
    await act(async () => { fireEvent.press(screen.getByTestId('login-submit')); });
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.getByText('login.credentialsInvalid')).toBeTruthy();
  });

  it('keeps the login screen mounted and shows a local error when Google rejects', async () => {
    mockSignInWithGoogle.mockRejectedValueOnce(new Error('network unavailable'));
    const screen = render(<LoginScreen navigation={navigation as never} route={{} as never} />);
    await act(async () => { fireEvent.press(screen.getByTestId('login-google')); });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByTestId('login-use-email')).toBeTruthy();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('keeps the email CTA disabled for whitespace-only required values', () => {
    const screen = render(<LoginScreen navigation={navigation as never} route={{} as never} />);
    fireEvent.press(screen.getByTestId('login-use-email'));
    fireEvent.changeText(screen.getByTestId('login-email'), '   ');
    expect(screen.getByTestId('login-email-next').props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('login-email-next'));
    expect(screen.queryByTestId('login-password')).toBeNull();
    expect(mockSignInWithEmail).not.toHaveBeenCalled();
  });

  it('shows verification pending and sends confirmation through the single-flight button', async () => {
    mockSignUpWithEmail.mockResolvedValueOnce({ status: 'verification_required', email: 'pending@example.com' });
    const screen = openPassword('pending@example.com');
    fireEvent.press(screen.getByTestId('login-create-account'));
    fireEvent.changeText(screen.getByTestId('login-password'), 'test-password');
    await act(async () => { fireEvent.press(screen.getByTestId('login-submit')); });
    expect(screen.getByText('login.verificationPending')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('login-resend-confirmation')); });
    expect(mockResendConfirmation).toHaveBeenCalledWith('pending@example.com');
  });

  it('shows reset guidance and enables resend after the cooldown', async () => {
    jest.useFakeTimers();
    const screen = openPassword('reset@example.com');
    fireEvent.press(screen.getByTestId('login-forgot-password'));
    expect(screen.getByText('login.resetHint')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('login-reset-submit')); });
    expect(screen.getByText('login.resetSent')).toBeTruthy();
    expect(screen.getByText('login.resetHelp')).toBeTruthy();
    expect(screen.getByTestId('login-reset-submit').props.accessibilityState?.disabled).toBe(true);
    expect(mockRequestPasswordReset).toHaveBeenCalledWith('reset@example.com');
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(screen.getByTestId('login-reset-submit').props.accessibilityState?.disabled).toBe(false);
    await act(async () => { fireEvent.press(screen.getByTestId('login-reset-submit')); });
    expect(mockRequestPasswordReset).toHaveBeenCalledTimes(2);
  });

  it('keeps reset mode email-only and exposes legal links after returning to provider choices', () => {
    const screen = openPassword();
    fireEvent.press(screen.getByTestId('login-forgot-password'));
    expect(screen.getByTestId('login-reset-email')).toBeTruthy();
    expect(screen.queryByTestId('login-password')).toBeNull();
    fireEvent.press(screen.getByTestId('login-reset-back'));
    fireEvent.press(screen.getByTestId('login-step-back'));
    fireEvent.press(screen.getByTestId('login-step-back'));
    expect(screen.getByTestId('login-privacy')).toBeTruthy();
    expect(screen.getByTestId('login-terms')).toBeTruthy();
  });
});
