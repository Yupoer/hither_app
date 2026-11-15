import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Pressable, type AlertButton } from 'react-native';
import type { JoinedGroupInfo } from '../api/client';
import HomeTeamsPage from '../screens/MapScreen/components/HomeTeamsPage';

const mockTeams: JoinedGroupInfo[] = ['a', 'b', 'c'].map(id => ({
  group: { id, name: `Team ${id}`, inviteCode: id, createdBy: 'leader', journeyStatus: 'paused', stragglerAlerts: true, stragglerThresholdM: 100 },
  memberCount: 1, role: 'leader', memberProfiles: [],
}));
jest.mock('react-native', () => ({ Alert: { alert: jest.fn() }, Platform: { OS: 'ios' }, Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (styles: object) => styles } }));
jest.mock('react-native-gesture-handler', () => ({ Pressable: 'Pressable' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../components/TeamSwipeActions', () => ({ __esModule: true, default: 'TeamSwipeActions' }));
jest.mock('../components/HitherText', () => ({ HitherText: 'Text' }));
jest.mock('../components/GroupLoadError', () => ({ __esModule: true, default: 'GroupLoadError' }));
jest.mock('../components/WaveLoading', () => ({ __esModule: true, default: 'WaveLoading' }));
jest.mock('../api/client', () => ({ leaveGroups: jest.fn() }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (id: string) => id, language: 'en' }), getActiveLanguage: () => 'en', translate: (_language: string, id: string) => id }));
jest.mock('../state/SessionContext', () => ({ useSession: () => ({ user: { id: 'leader' } }) }));
jest.mock('../state/useJoinedGroups', () => ({ useJoinedGroups: () => ({ groups: mockTeams, loading: false, error: null, retry: jest.fn(), lifecycle: null, setGroups: jest.fn() }) }));
jest.mock('../state/useLiveActivity', () => ({ clearLiveActivities: jest.fn() }));
jest.mock('../utils/uiAction', () => ({ runUiAction: jest.fn() }));
jest.mock('../utils/haptics', () => ({ lightTap: jest.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('HomeTeamsPage confirmed selection', () => {
  let renderer: ReactTestRenderer;
  const onSwitch = jest.fn<void, [JoinedGroupInfo]>();
  function mount() { act(() => { renderer = create(React.createElement(HomeTeamsPage, { currentGroupId: 'a', onSwitch, onLeaveCurrent: jest.fn() })); }); }
  function button(id: string) {
    const node = renderer.root.findAllByType(Pressable).find(candidate => candidate.props.testID === id);
    if (!node) throw new Error(`Missing button ${id}`);
    return node.props;
  }
  function press(id: string) { const props = button(id); if (!props.disabled) act(() => props.onPress()); }
  function alertButtons(): AlertButton[] {
    const call = jest.mocked(Alert.alert).mock.calls.at(-1);
    if (!call?.[2]) throw new Error('Missing native switch confirmation');
    return call[2];
  }
  beforeEach(() => { jest.clearAllMocks(); mount(); });
  afterEach(() => { act(() => renderer.unmount()); });

  it('opens a native confirmation immediately and keeps the current selection until confirmed', () => {
    press('settings-team-card-b');
    expect(Alert.alert).toHaveBeenCalledWith('Switch teams', expect.stringContaining('Team b'), expect.any(Array));
    expect(onSwitch).not.toHaveBeenCalled();
    expect(button('settings-team-card-a').accessibilityState.selected).toBe(true);
    expect(button('settings-team-card-b').accessibilityState.selected).toBe(false);
    expect(renderer.root.findAll(node => node.props.testID === 'settings-team-confirm')).toHaveLength(0);
    act(() => alertButtons()[1].onPress?.());
    expect(onSwitch.mock.calls).toEqual([[mockTeams[1]]]);
  });
  it('cancel preserves the current team and permits a later selection', () => {
    press('settings-team-card-b');
    const staleConfirm = alertButtons()[1].onPress;
    act(() => alertButtons()[0].onPress?.());
    expect(onSwitch).not.toHaveBeenCalled();
    expect(button('settings-team-card-a').accessibilityState.selected).toBe(true);
    press('settings-team-card-c');
    act(() => staleConfirm?.());
    expect(onSwitch).not.toHaveBeenCalled();
    act(() => alertButtons()[1].onPress?.());
    expect(onSwitch.mock.calls).toEqual([[mockTeams[2]]]);
  });
  it('does not prompt or switch the current team', () => {
    press('settings-team-card-a');
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
  });
  it('opens one prompt and switches once even with repeated taps and callbacks', () => {
    press('settings-team-card-b'); press('settings-team-card-c');
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const confirm = alertButtons()[1].onPress;
    act(() => { confirm?.(); confirm?.(); confirm?.(); });
    expect(onSwitch.mock.calls).toEqual([[mockTeams[1]]]);
  });
  it('ignores a stale confirmation after the page closes', () => {
    press('settings-team-card-b');
    const confirm = alertButtons()[1].onPress;
    act(() => renderer.unmount());
    act(() => confirm?.());
    expect(onSwitch).not.toHaveBeenCalled();
    mount();
    expect(button('settings-team-card-a').accessibilityState.selected).toBe(true);
  });
});
