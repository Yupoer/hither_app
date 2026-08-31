import React from 'react';
import { type PressableProps } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import LoginScreen from '../screens/LoginScreen';

const mockSignInWithEmail = jest.fn();
const mockSignUpWithEmail = jest.fn();
const mockResendConfirmation = jest.fn();
const mockRequestPasswordReset = jest.fn();

jest.mock('../state/SessionContext', () => ({
  useSession: () => ({
    signInWithEmail: mockSignInWithEmail,
    signUpWithEmail: mockSignUpWithEmail,
    resendSignupConfirmation: mockResendConfirmation,
    requestPasswordReset: mockRequestPasswordReset,
    signInWithGoogle: jest.fn(),
    signInWithApple: jest.fn(),
  }),
}));

jest.mock('../state/PreferencesContext', () => ({
  useTheme: () => ({ colors: { accent: '#ff9f0a' } }),
}));

jest.mock('../i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../components/AuthField', () => {
  const ReactRuntime = require('react') as typeof React;
  const { TextInput } = require('react-native') as typeof import('react-native');
  return function TestAuthField(props: Record<string, unknown>) {
    return ReactRuntime.createElement(TextInput, props);
  };
});

jest.mock('../components/AuthModeSelector', () => {
  const ReactRuntime = require('react') as typeof React;
  const { Pressable, Text, View } = require('react-native') as typeof import('react-native');
  return function TestAuthModeSelector({
    mode,
    onChange,
    labels,
    disabled,
  }: {
    mode: 'signin' | 'signup';
    onChange: (next: 'signin' | 'signup') => void;
    labels: { signin: string; signup: string };
    disabled?: boolean;
  }) {
    return ReactRuntime.createElement(
      View,
      null,
      (['signin', 'signup'] as const).map((next) => ReactRuntime.createElement(
        Pressable,
        {
          key: next,
          onPress: () => onChange(next),
          disabled,
          testID: `login-tab-${next}`,
        },
        ReactRuntime.createElement(Text, null, labels[next]),
      )),
    );
  };
});

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
jest.mock('../components/LanguagePicker', () => () => null);

jest.mock('../components/SafePressable', () => ({
  __esModule: true,
  default: function TestSafePressable({
    onPressAction,
    onBusyChange,
    ...props
  }: {
    onPressAction: (token: { isCurrent: () => boolean }) => Promise<void>;
    onBusyChange?: (busy: boolean) => void;
  } & PressableProps) {
    const ReactRuntime = require('react') as typeof React;
    const { Pressable: NativePressable } = require('react-native') as typeof import('react-native');
    return ReactRuntime.createElement(NativePressable, {
        ...props,
        accessibilityState: {
          ...(props.accessibilityState as object | undefined),
          disabled: props.disabled ?? undefined,
        },
        onPress: async () => {
          onBusyChange?.(true);
          try {
            await onPressAction({ isCurrent: () => true });
          } catch {
            // runUiAction consumes task failures in production.
          } finally {
            onBusyChange?.(false);
          }
        }}
    );
  },
}));

describe('LoginScreen email flows', () => {
  const navigation = { replace: jest.fn(), navigate: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSignInWithEmail.mockResolvedValue(undefined);
    mockSignUpWithEmail.mockResolvedValue(undefined);
    mockResendConfirmation.mockResolvedValue(undefined);
    mockRequestPasswordReset.mockResolvedValue(undefined);
  });

  it('enables the login CTA after test credentials and reaches the app', async () => {
    const { getByTestId } = render(<LoginScreen navigation={navigation as never} route={{} as never} />);
    const submit = getByTestId('login-submit');

    expect(submit.props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(getByTestId('login-email'), '  test@example.com  ');
    fireEvent.changeText(getByTestId('login-password'), 'test-password');
    expect(getByTestId('login-submit').props.accessibilityState?.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(getByTestId('login-submit'));
    });

    expect(mockSignInWithEmail).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'test-password',
    });
    expect(navigation.replace).toHaveBeenCalledWith('RoleSelect');
  });

  it('requires the terms checkbox before submitting registration', async () => {
    const { getByTestId } = render(<LoginScreen navigation={navigation as never} route={{} as never} />);
    fireEvent.press(getByTestId('login-tab-signup'));
    await waitFor(() => expect(getByTestId('login-nickname')).toBeTruthy());
    fireEvent.changeText(getByTestId('login-email'), ' new@example.com ');
    fireEvent.changeText(getByTestId('login-password'), 'test-password');
    fireEvent.changeText(getByTestId('login-confirm-password'), 'test-password');
    fireEvent.changeText(getByTestId('login-nickname'), ' Test User ');

    expect(getByTestId('login-signup-terms').props.accessibilityState?.checked).toBe(false);
    expect(getByTestId('login-submit').props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(getByTestId('login-signup-terms'));
    expect(getByTestId('login-signup-terms').props.accessibilityState?.checked).toBe(true);
    expect(getByTestId('login-submit').props.accessibilityState?.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(getByTestId('login-submit'));
    });

    expect(mockSignUpWithEmail).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'test-password',
      nickname: 'Test User',
    });
    expect(navigation.replace).toHaveBeenCalledWith('RoleSelect');
  });

  it('keeps the page on short input and sign-in failure', async () => {
    const { getByTestId, getByText } = render(<LoginScreen navigation={navigation as never} route={{} as never} />);
    fireEvent.changeText(getByTestId('login-email'), 'test@example.com');
    fireEvent.changeText(getByTestId('login-password'), 'short');
    expect(getByTestId('login-submit').props.accessibilityState?.disabled).toBe(true);
    expect(mockSignInWithEmail).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId('login-password'), 'test-password');
    mockSignInWithEmail.mockRejectedValueOnce(new Error('invalid credentials'));
    await act(async () => {
      fireEvent.press(getByTestId('login-submit'));
    });

    expect(navigation.replace).not.toHaveBeenCalled();
    expect(getByText('login.credentialsInvalid')).toBeTruthy();
  });

  it('keeps the email CTA disabled for whitespace-only required values', () => {
    const { getByTestId } = render(<LoginScreen navigation={navigation as never} route={{} as never} />);
    fireEvent.changeText(getByTestId('login-email'), '   ');
    fireEvent.changeText(getByTestId('login-password'), '      ');

    expect(getByTestId('login-submit').props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(getByTestId('login-submit'));
    expect(mockSignInWithEmail).not.toHaveBeenCalled();
  });

  it('shows verification pending and sends confirmation through the single-flight button', async () => {
    mockSignUpWithEmail.mockResolvedValueOnce({
      status: 'verification_required',
      email: 'pending@example.com',
    });
    const { getByTestId, getByText } = render(<LoginScreen navigation={navigation as never} route={{} as never} />);
    fireEvent.press(getByTestId('login-tab-signup'));
    await waitFor(() => expect(getByTestId('login-nickname')).toBeTruthy());
    fireEvent.changeText(getByTestId('login-email'), 'pending@example.com');
    fireEvent.changeText(getByTestId('login-password'), 'test-password');
    fireEvent.changeText(getByTestId('login-confirm-password'), 'test-password');
    fireEvent.changeText(getByTestId('login-nickname'), 'Pending User');
    fireEvent.press(getByTestId('login-signup-terms'));

    await act(async () => {
      fireEvent.press(getByTestId('login-submit'));
    });

    expect(getByText('login.verificationPending')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId('login-resend-confirmation'));
    });
    expect(mockResendConfirmation).toHaveBeenCalledWith('pending@example.com');
  });

  it('shows reset guidance and enables resend after the cooldown', async () => {
    jest.useFakeTimers();
    const { getByTestId, getByText } = render(<LoginScreen navigation={navigation as never} route={{} as never} />);
    fireEvent.changeText(getByTestId('login-email'), 'reset@example.com');
    fireEvent.press(getByTestId('login-forgot-password'));
    await act(async () => {
      fireEvent.press(getByTestId('login-reset-submit'));
    });

    expect(getByText('login.resetSent')).toBeTruthy();
    expect(getByText('login.resetHelp')).toBeTruthy();
    expect(getByTestId('login-reset-submit').props.accessibilityState?.disabled).toBe(true);
    expect(mockRequestPasswordReset).toHaveBeenCalledWith('reset@example.com');

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(getByTestId('login-reset-submit').props.accessibilityState?.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(getByTestId('login-reset-submit'));
    });
    expect(mockRequestPasswordReset).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
