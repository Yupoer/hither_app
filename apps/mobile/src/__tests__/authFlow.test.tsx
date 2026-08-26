import React from 'react';
import { type PressableProps } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import AuthScreen from '../screens/AuthScreen';

const mockSignIn = jest.fn();
const mockUpdateNickname = jest.fn();
const mockSetMembership = jest.fn();
const mockRefreshProfile = jest.fn();
const mockCreateGroup = jest.fn();
const mockJoinGroup = jest.fn();

jest.mock('../state/SessionContext', () => ({
  useSession: () => ({
    signIn: mockSignIn,
    user: null,
    updateNickname: mockUpdateNickname,
    setMembership: mockSetMembership,
    refreshProfile: mockRefreshProfile,
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

jest.mock('../api/client', () => ({
  createGroup: (...args: unknown[]) => mockCreateGroup(...args),
  joinGroup: (...args: unknown[]) => mockJoinGroup(...args),
}));

jest.mock('../utils/activityLog', () => ({
  logEvent: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../utils/haptics', () => ({
  mediumTap: jest.fn(),
}));

jest.mock('../anonymousAccess', () => ({
  classifyAnonymousAccessError: jest.fn(() => 'other'),
}));

jest.mock('../utils/uiAction', () => ({
  runUiAction: jest.fn(async (_actionId: string, task: (token: { isCurrent: () => boolean }) => unknown, options: { onBusyChange?: (busy: boolean) => void }) => {
    options.onBusyChange?.(true);
    try {
      return await task({ isCurrent: () => true });
    } finally {
      options.onBusyChange?.(false);
    }
  }),
}));

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
        } finally {
          onBusyChange?.(false);
        }
      },
    });
  },
}));

describe('AuthScreen form actions', () => {
  const navigation = {
    replace: jest.fn(),
    canGoBack: () => false,
    goBack: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSignIn.mockResolvedValue({ id: 'anon-1' });
    mockUpdateNickname.mockResolvedValue(undefined);
    mockSetMembership.mockImplementation(() => undefined);
    mockRefreshProfile.mockResolvedValue(undefined);
    mockCreateGroup.mockResolvedValue({ id: 'group-1', name: 'Trip' });
    mockJoinGroup.mockResolvedValue({ id: 'group-1', name: 'Trip' });
  });

  it('enables create-and-start after non-whitespace leader fields and trims the payload', async () => {
    const { getByTestId } = render(
      <AuthScreen navigation={navigation as never} route={{ params: { role: 'leader' } } as never} />,
    );

    expect(getByTestId('auth-create-group').props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(getByTestId('auth-name'), ' Alex ');
    fireEvent.changeText(getByTestId('auth-group-name'), ' Trip ');
    expect(getByTestId('auth-create-group').props.accessibilityState?.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(getByTestId('auth-create-group'));
    });

    expect(mockSignIn).toHaveBeenCalledWith({ name: 'Alex' });
    expect(mockCreateGroup).toHaveBeenCalledWith('Trip', expect.any(String), expect.any(String));
    expect(navigation.replace).toHaveBeenCalledWith('Map', { groupId: 'group-1' });
  });

  it('keeps create-and-start disabled for whitespace-only leader fields', () => {
    const { getByTestId } = render(
      <AuthScreen navigation={navigation as never} route={{ params: { role: 'leader' } } as never} />,
    );
    fireEvent.changeText(getByTestId('auth-name'), '   ');
    fireEvent.changeText(getByTestId('auth-group-name'), '   ');

    expect(getByTestId('auth-create-group').props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(getByTestId('auth-create-group'));
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('enables join-and-start after a six-character invite code', async () => {
    const { getByTestId } = render(
      <AuthScreen navigation={navigation as never} route={{ params: { role: 'follower' } } as never} />,
    );
    fireEvent.changeText(getByTestId('auth-name'), 'Alex');
    fireEvent.changeText(getByTestId('auth-code'), 'abc234');
    expect(getByTestId('auth-join-group').props.accessibilityState?.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(getByTestId('auth-join-group'));
    });

    expect(mockJoinGroup).toHaveBeenCalledWith('ABC234');
    expect(navigation.replace).toHaveBeenCalledWith('Map', { groupId: 'group-1' });
  });
});
