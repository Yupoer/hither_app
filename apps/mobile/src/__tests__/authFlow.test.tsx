import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import AuthScreen from '../screens/AuthScreen';

const mockSignIn = jest.fn();
const mockUpdateNickname = jest.fn();
const mockSetMembership = jest.fn();
const mockRefreshProfile = jest.fn();
const mockCreateGroup = jest.fn();
const mockJoinGroup = jest.fn();
const mockUpdateGroupAvatar = jest.fn();

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

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

jest.mock('../api/services/GroupService', () => ({
  getCachedMyJoinedGroups: jest.fn(() => []),
  updateGroupAvatar: (...args: unknown[]) => mockUpdateGroupAvatar(...args),
  createGroup: (...args: unknown[]) => mockCreateGroup(...args),
  joinGroup: (...args: unknown[]) => mockJoinGroup(...args),
}));

jest.mock('../utils/activityLog', () => ({
  logEvent: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../utils/haptics', () => ({
  mediumTap: jest.fn(),
  errorTap: jest.fn(),
  selectionTick: jest.fn(),
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

describe('AuthScreen form actions', () => {
  const navigation = { replace: jest.fn(), reset: jest.fn(), canGoBack: () => false, goBack: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignIn.mockResolvedValue({ id: 'anon-1' });
    mockUpdateNickname.mockResolvedValue(undefined);
    mockRefreshProfile.mockResolvedValue(undefined);
    const group = { id: 'group-1', name: 'Trip' };
    mockCreateGroup.mockResolvedValue(group);
    mockJoinGroup.mockResolvedValue(group);
    mockUpdateGroupAvatar.mockResolvedValue(group);
  });
  it('enables create-and-start after a team name and trims the payload', async () => {
    const screen = render(<AuthScreen navigation={navigation as never} route={{ params: { role: 'leader' } } as never} />);
    expect(screen.getByTestId('auth-create-group').props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('auth-group-name'), ' Trip ');
    await act(async () => { fireEvent.press(screen.getByTestId('auth-create-group')); });
    expect(mockSignIn).toHaveBeenCalledWith({ name: 'entry.guestName' });
    expect(mockCreateGroup).toHaveBeenCalledWith('Trip');
    expect(mockUpdateGroupAvatar).toHaveBeenCalledWith('group-1', expect.any(String), expect.any(String));
    expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Map', params: { groupId: 'group-1', showTeamInvite: true } }] });
  });
  it('keeps create-and-start disabled for a whitespace-only team name', () => {
    const screen = render(<AuthScreen navigation={navigation as never} route={{ params: { role: 'leader' } } as never} />);
    fireEvent.changeText(screen.getByTestId('auth-group-name'), '   ');
    expect(screen.getByTestId('auth-create-group').props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('auth-create-group'));
    expect(mockSignIn).not.toHaveBeenCalled();
  });
  it('joins the validated invite with the edited nickname', async () => {
    const screen = render(<AuthScreen navigation={navigation as never} route={{ params: { role: 'follower', code: 'ABC234' } } as never} />);
    fireEvent.changeText(screen.getByTestId('auth-name'), ' Alex ');
    await act(async () => { fireEvent.press(screen.getByTestId('auth-join-group')); });
    expect(mockSignIn).toHaveBeenCalledWith({ name: 'Alex' });
    expect(mockJoinGroup).toHaveBeenCalledWith('ABC234');
    expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Map', params: { groupId: 'group-1' } }] });
  });
});
