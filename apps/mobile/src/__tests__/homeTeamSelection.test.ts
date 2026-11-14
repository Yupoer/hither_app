import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable } from 'react-native';
import type { JoinedGroupInfo } from '../api/client';
import HomeTeamsPage from '../screens/MapScreen/components/HomeTeamsPage';

const mockTeams: JoinedGroupInfo[] = ['a', 'b', 'c'].map(id => ({
  group: { id, name: `Team ${id}`, inviteCode: id, createdBy: 'leader', journeyStatus: 'paused', stragglerAlerts: true, stragglerThresholdM: 100 },
  memberCount: 1, role: 'leader', memberProfiles: [],
}));
jest.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (styles: object) => styles } }));
jest.mock('react-native-gesture-handler', () => ({ Pressable: 'Pressable' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../components/TeamSwipeActions', () => ({ __esModule: true, default: 'TeamSwipeActions' }));
jest.mock('../components/HitherText', () => ({ HitherText: 'Text' }));
jest.mock('../components/GroupLoadError', () => ({ __esModule: true, default: 'GroupLoadError' }));
jest.mock('../components/WaveLoading', () => ({ __esModule: true, default: 'WaveLoading' }));
jest.mock('../api/client', () => ({ leaveGroups: jest.fn() }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (id: string) => id, language: 'en' }) }));
jest.mock('../state/SessionContext', () => ({ useSession: () => ({ user: { id: 'leader' } }) }));
jest.mock('../state/useJoinedGroups', () => ({ useJoinedGroups: () => ({ groups: mockTeams, loading: false, error: null, retry: jest.fn(), lifecycle: null, setGroups: jest.fn() }) }));
jest.mock('../state/useLiveActivity', () => ({ clearLiveActivities: jest.fn() }));
jest.mock('../utils/confirm', () => ({ confirmAction: jest.fn() }));
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
  beforeEach(() => { onSwitch.mockClear(); mount(); });
  afterEach(() => { act(() => renderer.unmount()); });

  it('selects without switching and confirms only the last selected team', () => {
    press('settings-team-card-b');
    expect(onSwitch).not.toHaveBeenCalled();
    expect(button('settings-team-card-b').accessibilityState.selected).toBe(true);
    press('settings-team-card-c');
    expect(onSwitch).not.toHaveBeenCalled();
    expect(button('settings-team-card-b').accessibilityState.selected).toBe(false);
    expect(button('settings-team-card-c').accessibilityState.selected).toBe(true);
    expect(button('settings-team-confirm').disabled).toBe(false);
    press('settings-team-confirm');
    expect(onSwitch.mock.calls).toEqual([[mockTeams[2]]]);
  });
  it('discards an unconfirmed selection when the page closes', () => {
    press('settings-team-card-b');
    act(() => renderer.unmount());
    expect(onSwitch).not.toHaveBeenCalled();
    mount();
    expect(button('settings-team-card-a').accessibilityState.selected).toBe(true);
    expect(button('settings-team-card-b').accessibilityState.selected).toBe(false);
    expect(button('settings-team-confirm').disabled).toBe(true);
  });
  it('disables confirmation for the current team, including selection back', () => {
    expect(button('settings-team-confirm').disabled).toBe(true);
    press('settings-team-confirm'); press('settings-team-card-b'); press('settings-team-card-a');
    expect(button('settings-team-confirm').accessibilityState.disabled).toBe(true);
    press('settings-team-confirm');
    expect(onSwitch).not.toHaveBeenCalled();
  });
  it('switches once when the confirmation callback receives rapid presses', () => {
    press('settings-team-card-b');
    const confirm = button('settings-team-confirm').onPress;
    act(() => { confirm(); confirm(); confirm(); });
    expect(onSwitch.mock.calls).toEqual([[mockTeams[1]]]);
  });
});
