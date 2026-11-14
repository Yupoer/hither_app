import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable } from 'react-native';
import { D6MembersPane, type D6MembersPaneProps } from '../screens/MapScreen/components/D6MembersPane';
import type { CoordinationRequestView } from '../screens/MapScreen/hooks/useCoordinationRequests';
import type { Group, PendingInvite } from '../types';

jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: object) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { View: 'AnimatedView' }, useReducedMotion: () => true }));
jest.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (id: string, params: Record<string, string | number> = {}) => [id, ...Object.values(params)].join(' '),
  }),
}));
jest.mock('../native/menu', () => ({ NativeMenuHost: 'NativeMenuHost' }));
jest.mock('../utils/haptics', () => ({ lightTap: jest.fn(), selectionTick: jest.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const group: Group = {
  id: 'team',
  name: 'Weekend Trip',
  inviteCode: 'K8Q2ZP',
  createdBy: 'me',
  journeyStatus: 'paused',
  stragglerAlerts: false,
  stragglerThresholdM: 100,
};
const invite: PendingInvite = {
  id: 'incoming',
  groupId: group.id,
  subgroupId: 'coffee',
  inviterId: 'other',
  inviteeId: 'me',
  status: 'pending',
  subgroupName: 'Coffee',
  inviterName: 'Other',
};
const poll: CoordinationRequestView = {
  id: 'poll',
  groupId: group.id,
  createdBy: 'other',
  subject: 'Change our stop?',
  subjectKind: 'itinerary',
  options: [
    { id: 'keep', label: 'coordination.optionKeep', kind: 'keep_current' },
    { id: 'change', label: 'coordination.optionChange', kind: 'itinerary' },
  ],
  deadline: '2026-11-13T11:00:00Z',
  policy: 'majority',
  defaultOutcome: 'keep',
  status: 'open',
  createdAt: '2026-11-13T10:00:00Z',
  updatedAt: '2026-11-13T10:00:00Z',
  responses: [],
  responseCount: 0,
  myOptionId: 'keep',
};

function buildProps(overrides: Partial<D6MembersPaneProps> = {}): D6MembersPaneProps {
  return {
    group,
    accent: '#4C6FFF',
    onAccent: '#FFFFFF',
    myUserId: 'me',
    myStatusKind: 'follow',
    sharingEnabled: true,
    flock: [{ userId: 'me', name: 'Me', color: '#5FB36B', dist: '', arrived: false, isLeader: false }],
    statusMenuItems: [],
    applyPresenceMacroKind: jest.fn(async () => true),
    onEnableSharing: jest.fn(async () => true),
    onTemporarilyLeave: jest.fn(async () => true),
    mySubgroupId: undefined,
    subgroups: [],
    pendingInvites: [],
    sentInvites: [],
    coordination: {
      lifecycle: React.createElement(React.Fragment),
      requests: [],
      loading: false,
      refreshing: false,
      busyRequestId: null,
      error: null,
      refresh: jest.fn(async () => undefined),
      createRequest: jest.fn(async () => null),
      respond: jest.fn(async () => true),
      override: jest.fn(async () => true),
      cancel: jest.fn(async () => true),
    },
    onOpenTeamSettings: jest.fn(),
    onInviteTeam: jest.fn(),
    onAcceptInvite: jest.fn(async () => undefined),
    onDeclineInvite: jest.fn(async () => undefined),
    onInviteToSubgroup: jest.fn(),
    onLeaveSubgroup: jest.fn(async () => true),
    onStartSplit: jest.fn(),
    selectedMemberIds: null,
    onToggleMember: jest.fn(),
    onLocateMember: jest.fn(),
    memberInbox: new Map(),
    onOpenMemberInbox: jest.fn(),
    ...overrides,
  };
}

describe('D6 team panel', () => {
  let renderer: ReactTestRenderer;
  function render(props: D6MembersPaneProps) {
    act(() => { renderer = create(React.createElement(D6MembersPane, props)); });
  }
  function button(testID: string) {
    return renderer.root.findAllByType(Pressable).find(node => node.props.testID === testID);
  }
  afterEach(() => act(() => renderer.unmount()));

  it('shows the accepted self location time, remote sample age and a persistent recovery action', () => {
    const recovery = jest.fn();
    const props = buildProps({ selfSampleAtMs: Date.now(), locationWarning: '尚未開始定位', onLocationRecovery: recovery,
      flock: [
        { userId: 'me', name: 'Me', color: '#fff', dist: '', arrived: false, isLeader: false },
        { userId: 'other', name: 'Other', color: '#fff', dist: '100 m', arrived: false, isLeader: false, lastUpdated: new Date(Date.now() - 300_000).toISOString() },
      ],
    });
    render(props);
    const self = renderer.root.findAll(node => node.props.testID === 'd6-member-updated-me').at(-1)!;
    const remote = renderer.root.findAll(node => node.props.testID === 'd6-member-updated-other').at(-1)!;
    expect(self.props.children).toBe('locationUpdate.justNow');
    expect(remote.props.children).toBe('locationUpdate.minutes 5');
    act(() => button('d6-self-location-warning')?.props.onPress());
    expect(recovery).toHaveBeenCalledTimes(1);
  });

  it('shows a new one-person team its invitation code and routes both entry points to the same sheet', () => {
    const props = buildProps({ isNewTeam: true });
    render(props);
    act(() => {
      button('map-invite-members')?.props.onPress();
      button('d6-team-invite-code')?.props.onPress();
    });
    expect(props.onInviteTeam).toHaveBeenCalledTimes(2);
  });

  it('shows only active-team invitations and eligible votes, retains my selection and casts the real option', async () => {
    const props = buildProps({
      pendingInvites: [invite, { ...invite, id: 'other-team', groupId: 'other' }],
    });
    props.coordination.requests = [
      poll,
      { ...poll, id: 'outside', subgroupId: 'other-scope', options: [{ id: 'secret', label: 'Other vote', kind: 'itinerary' }] },
    ];
    render(props);
    expect(button('subgroup-invite-accept-other-team')).toBeUndefined();
    expect(button('coordination-response-secret')).toBeUndefined();
    expect(button('coordination-response-keep')?.props.accessibilityState.selected).toBe(true);
    await act(async () => {
      button('subgroup-invite-accept-incoming')?.props.onPress();
      button('coordination-response-keep')?.props.onPress();
    });
    expect(props.onAcceptInvite).toHaveBeenCalledWith('incoming');
    expect(props.coordination.respond).toHaveBeenCalledWith('poll', 'keep');
  });
});
