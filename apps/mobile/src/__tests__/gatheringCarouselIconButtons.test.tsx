import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { GatheringCarousel, type GatheringCarouselProps } from '../screens/MapScreen/components/GatheringCarousel';
import { makeStyles } from '../screens/MapScreen/styles';
import type { Destination } from '../types';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const ReactRuntime = jest.requireActual<typeof React>('react');
    const { View: NativeView } = jest.requireActual<typeof import('react-native')>('react-native');
    return ReactRuntime.createElement(NativeView, { testID: `icon-${name}` });
  },
}));
jest.mock('../components/MetalforgeStarfield', () => () => null);
jest.mock('../components/OverflowMarquee', () => () => null);
jest.mock('../components/SwiftUIGlassSurface', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => {
    const ReactRuntime = jest.requireActual<typeof React>('react');
    const { View: NativeView } = jest.requireActual<typeof import('react-native')>('react-native');
    return ReactRuntime.createElement(NativeView, null, children);
  },
}));
jest.mock('../screens/MapScreen/components/ArrivalCardExitShell', () => ({
  ArrivalCardExitShell: ({ children }: { children: React.ReactNode }) => {
    const ReactRuntime = jest.requireActual<typeof React>('react');
    const { View: NativeView } = jest.requireActual<typeof import('react-native')>('react-native');
    return ReactRuntime.createElement(NativeView, null, children);
  },
}));
jest.mock('../screens/MapScreen/components/MeetTimeChip', () => ({ MeetTimeChip: () => null }));

const destination: Destination = {
  id: 'meeting-point',
  title: '車站',
  order: 0,
  day: 1,
  coordinates: { latitude: 25.0478, longitude: 121.517 },
};

const labels: Record<string, string> = {
  'nav.leaderStart': '開始',
  'nav.endNavigation': '結束導航',
  'nav.completeJourney': '完成行程',
  'nav.memberRequestStart': '向隊長發送要求開始',
  'nav.memberNavigating': '前往中',
};

function props(overrides: Partial<GatheringCarouselProps> = {}) {
  return {
    accent: '#68d391',
    activeDestinationArrivals: [],
    activePoint: destination,
    appState: 'active',
    arrivalCelebrateDestId: null,
    arrivalExitRecords: new Map(),
    atFull: false,
    canEditItinerary: true,
    carouselMaxHeight: 320,
    carouselRef: React.createRef(),
    colors: { accentText: '#000' },
    destinationIds: [destination.id],
    destinations: [destination],
    fontBucket: 'regular',
    fromCoords: undefined,
    gatherCardMarqueeSpeed: 30,
    gatherCardRadius: 18,
    gatherCardTitleMarquee: false,
    handleMomentumEnd: jest.fn(),
    handleScrollBeginDrag: jest.fn(),
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    isCardExpanded: () => true,
    isLeader: true,
    journeyActive: false,
    journeyBusy: false,
    localActionError: null,
    mapFocused: true,
    meetRedMin: 5,
    members: [],
    myCompletedDestinationIds: new Set<string>(),
    myScopeId: undefined,
    narrowScreen: false,
    navTarget: undefined,
    navTargetId: null,
    openExternalNavigation: jest.fn(),
    openMeetTimePicker: jest.fn(),
    pendingLeaderTargetId: null,
    personalDistanceM: null,
    personalEtaSeconds: null,
    powerState: {},
    promptCompleteAfterArrival: jest.fn(),
    registerCardActivity: jest.fn(),
    requestingStartDestId: null,
    requestLeaderStart: jest.fn(),
    requestTeamEnd: jest.fn(async () => true),
    routeDepartureDate: undefined,
    selectedIndex: 0,
    selfRoute: null,
    sessionEligibleMembers: [],
    setArrivalDestination: jest.fn(),
    setCarouselHeight: jest.fn(),
    setOverlay: jest.fn(),
    setTourTargetRef: jest.fn(),
    setTravelMode: jest.fn(),
    sharedTargetId: null,
    navigationSessionId: null,
    showDenseChrome: true,
    startNavigation: jest.fn(async () => undefined),
    styles: makeStyles('#68d391', 1),
    t: (key: string) => labels[key] ?? key,
    toggleGatheringCard: jest.fn(),
    tourReduceMotion: true,
    travelMode: 'walk',
    uiVisible: true,
    user: null,
    windowWidth: 390,
    ...overrides,
  } as unknown as GatheringCarouselProps;
}

function expectIconOnly(button: Parameters<typeof within>[0], icon: string) {
  expect(within(button).getByTestId(`icon-${icon}`)).toBeTruthy();
  expect(button.findAllByType(Text)).toHaveLength(0);
}

describe('gathering card navigation commands', () => {
  it('shows a flexible Start button with icon and visible text, without Complete', () => {
    const startNavigation = jest.fn(async () => undefined);
    const screen = render(<GatheringCarousel {...props({ startNavigation })} />);
    const button = screen.getByTestId('gather-nav-meeting-point');
    expect(button.props.accessibilityLabel).toBe('開始');
    expect(within(button).getByTestId('icon-play')).toBeTruthy();
    expect(within(button).getByText('開始')).toBeTruthy();
    expect(StyleSheet.flatten(button.props.style).flexGrow).toBe(1);
    expect(screen.queryByTestId('gather-complete-meeting-point')).toBeNull();
    fireEvent.press(button);
    expect(startNavigation).toHaveBeenCalledWith(destination, 0);
  });

  it('still shows only Start after personal arrival when navigation has ended', () => {
    const promptCompleteAfterArrival = jest.fn();
    const screen = render(<GatheringCarousel {...props({
      myCompletedDestinationIds: new Set([destination.id]),
      navigationSessionId: 'stale-session',
      promptCompleteAfterArrival,
    })} />);
    const button = screen.getByTestId('gather-nav-meeting-point');
    expect(button.props.accessibilityLabel).toBe('開始');
    expect(within(button).getByText('開始')).toBeTruthy();
    expect(screen.queryByTestId('gather-complete-meeting-point')).toBeNull();
    fireEvent.press(button);
    expect(promptCompleteAfterArrival).not.toHaveBeenCalled();
  });

  it('gives End the remaining width and Complete equal width and height', () => {
    const promptCompleteAfterArrival = jest.fn();
    const requestTeamEnd = jest.fn(async () => true);
    const screen = render(<GatheringCarousel {...props({
      sharedTargetId: destination.id,
      navigationSessionId: 'session-1',
      promptCompleteAfterArrival,
      requestTeamEnd,
    })} />);
    const endButton = screen.getByTestId('gather-nav-meeting-point');
    const completeButton = screen.getByTestId('gather-complete-meeting-point');
    expect(endButton.props.accessibilityLabel).toBe('結束導航');
    expect(within(endButton).getByText('結束導航')).toBeTruthy();
    expect(StyleSheet.flatten(endButton.props.style).flexGrow).toBe(1);
    expect(completeButton.props.accessibilityLabel).toBe('完成行程');
    expectIconOnly(completeButton, 'checkmark-done');
    const completeStyle = StyleSheet.flatten(completeButton.props.style);
    expect(completeStyle.width).toBeGreaterThanOrEqual(44);
    expect(completeStyle.height).toBe(completeStyle.width);
    fireEvent.press(completeButton);
    expect(promptCompleteAfterArrival).toHaveBeenCalledWith(destination);
    fireEvent.press(endButton);
    expect(requestTeamEnd).toHaveBeenCalledWith(destination, 0);
    screen.rerender(<GatheringCarousel {...props({
      navigationSessionId: null,
      promptCompleteAfterArrival,
      requestTeamEnd,
    })} />);
    expect(screen.queryByTestId('gather-complete-meeting-point')).toBeNull();
    expect(within(screen.getByTestId('gather-nav-meeting-point')).getByText('開始')).toBeTruthy();
  });

  it('does not offer Complete before the active session exists', () => {
    const screen = render(<GatheringCarousel {...props({ sharedTargetId: destination.id })} />);
    expect(within(screen.getByTestId('gather-nav-meeting-point')).getByText('結束導航')).toBeTruthy();
    expect(screen.queryByTestId('gather-complete-meeting-point')).toBeNull();
  });

  it('uses the same Start and End controls for a subgroup leader', () => {
    const startNavigation = jest.fn(async () => undefined);
    const screen = render(<GatheringCarousel {...props({
      isLeader: false,
      canEditItinerary: true,
      myScopeId: 'subgroup-1',
      startNavigation,
    })} />);
    const start = screen.getByTestId('gather-nav-meeting-point');
    expect(within(start).getByTestId('icon-play')).toBeTruthy();
    expect(within(start).getByText('開始')).toBeTruthy();
    fireEvent.press(start);
    expect(startNavigation).toHaveBeenCalledWith(destination, 0);
    screen.rerender(<GatheringCarousel {...props({
      isLeader: false,
      canEditItinerary: true,
      myScopeId: 'subgroup-1',
      pendingLeaderTargetId: destination.id,
      journeyBusy: true,
    })} />);
    expect(within(screen.getByTestId('gather-nav-meeting-point')).getByText('結束導航')).toBeTruthy();
  });

  it('keeps ordinary members on request and waiting states without Complete', () => {
    const requestLeaderStart = jest.fn();
    const screen = render(<GatheringCarousel {...props({
      isLeader: false,
      canEditItinerary: false,
      requestLeaderStart,
    })} />);
    const request = screen.getByTestId('gather-nav-meeting-point');
    expect(within(request).getByText('向隊長發送要求開始')).toBeTruthy();
    fireEvent.press(request);
    expect(requestLeaderStart).toHaveBeenCalledWith(destination);
    screen.rerender(<GatheringCarousel {...props({
      isLeader: false,
      canEditItinerary: false,
      sharedTargetId: destination.id,
    })} />);
    const waiting = screen.getByTestId('gather-nav-meeting-point');
    expect(waiting.props.accessibilityState.disabled).toBe(true);
    expect(within(waiting).getByText('前往中')).toBeTruthy();
    expect(screen.queryByTestId('gather-complete-meeting-point')).toBeNull();
  });
});
