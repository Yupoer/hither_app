import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { GatheringCarousel, type GatheringCarouselProps } from '../screens/MapScreen/components/GatheringCarousel';
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
  'nav.leaderComplete': '完成',
  'nav.endNavigation': '結束導航',
  'nav.completeJourney': '完成行程',
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
    styles: new Proxy({}, { get: () => ({}) }),
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

describe('gathering card icon-only commands', () => {
  it('shows an accessible icon-only Start button that still starts navigation', () => {
    const startNavigation = jest.fn(async () => undefined);
    const screen = render(<GatheringCarousel {...props({ startNavigation })} />);
    const button = screen.getByTestId('gather-nav-meeting-point');
    expect(button.props.accessibilityLabel).toBe('開始');
    expectIconOnly(button, 'play');
    fireEvent.press(button);
    expect(startNavigation).toHaveBeenCalledWith(destination, 0);
  });

  it('shows an accessible icon-only Complete button after personal arrival', () => {
    const promptCompleteAfterArrival = jest.fn();
    const screen = render(<GatheringCarousel {...props({
      myCompletedDestinationIds: new Set([destination.id]),
      promptCompleteAfterArrival,
    })} />);
    const button = screen.getByTestId('gather-nav-meeting-point');
    expect(button.props.accessibilityLabel).toBe('完成');
    expectIconOnly(button, 'checkmark-done');
    fireEvent.press(button);
    expect(promptCompleteAfterArrival).toHaveBeenCalledWith(destination);
  });

  it('keeps End text while the separate Complete control shows only an icon', () => {
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
    expect(completeButton.props.accessibilityLabel).toBe('完成行程');
    expectIconOnly(completeButton, 'checkmark-done');
    fireEvent.press(endButton);
    expect(requestTeamEnd).toHaveBeenCalledWith(destination, 0);
    fireEvent.press(completeButton);
    expect(promptCompleteAfterArrival).toHaveBeenCalledWith(destination);
  });
});
