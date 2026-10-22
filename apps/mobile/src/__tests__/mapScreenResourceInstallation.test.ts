import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Coordinates, GroupState } from '../types';
import { useMountEffect } from '../hooks/useMountEffect';

const mockLifecycles = new Map<string, number>();
const mockLifecycleMounts = jest.fn();
function MockLifecycle({ name }: { name: string }) {
  useMountEffect(() => {
    mockLifecycleMounts(name);
    mockLifecycles.set(name, (mockLifecycles.get(name) ?? 0) + 1);
    return () => { const count = mockLifecycles.get(name)! - 1; if (count) mockLifecycles.set(name, count); else mockLifecycles.delete(name); };
  });
  return null;
}
function mockLifecycle(name: string) { return React.createElement(MockLifecycle, { name }); }



const mockEmpty: never[] = [];
const mockAsync = jest.fn(async () => true);
const mockStartFrame = jest.fn();
const mockOutboxListeners = new Set<() => void>();
const mockAppListeners = new Set<(state: string) => void>();
const mockNotificationListeners = new Set<unknown>();
const mockStops = jest.fn(async (_clear?: boolean) => undefined);
const mockWorkloadRelease = jest.fn();
const mockWorkload = jest.fn(() => mockWorkloadRelease);
const mockMapMount = jest.fn();
const mockMapUnmount = jest.fn();
const mockPrefs = { ready: false, passiveCompanionMode: false, highAccuracy: false, sharingEnabled: false,
  obliqueLocate: false, liveActivityEnabled: false, meetRedMin: 5, gatherCardDefaultExpanded: false,
  gatherCardTitleMarquee: false, gatherCardMarqueeSpeed: 1, arrivalRadiusM: 50,
  setSharingEnabled: jest.fn(), setMeetRedMin: jest.fn(), setHighAccuracy: jest.fn(), setLiveActivityEnabled: jest.fn(),
  setArrivalRadiusM: jest.fn(), setPassiveCompanionMode: jest.fn() };
const mockGroup = { lifecycle: mockLifecycle('group-state'), state: null as GroupState | null, loading: true, error: null, loadError: null, refreshing: false,
  refresh: mockAsync, refreshLocalSnapshot: mockAsync, applyOptimisticGathering: jest.fn(), openOperations: mockEmpty,
  serverTimeOffsetMs: 0, emptyLocalSnapshot: true, dataSource: 'none' };
const mockDevice = { lifecycle: mockLifecycle('device-location'), deviceCoords: null as Coordinates | null, deviceAccuracyM: null, deviceCoordsAcceptedAtMs: null,
  appState: 'active', refreshDeviceLocation: mockAsync, consumeForegroundSample: jest.fn(), latestLocationSampleRef: { current: null } };
const mockSession = { membership: null, user: null, isAnonymous: false, isPro: false, premiumProjection: { personalPremiumActive: false },
  updateProfile: mockAsync, leaveGroup: jest.fn(), signOut: mockAsync, refreshEntitlement: mockAsync, setMembership: jest.fn() };
const mockNavigationSession = { lifecycle: mockLifecycle('navigation'), session: null, loading: false, error: null, refresh: mockAsync, ack: mockAsync };
const mockPower = {};
const mockTour = { tourActive: false, step: null, targetRect: null, onNext: jest.fn(), onPrev: jest.fn(),
  canGoPrev: false, transitioning: false, completing: false, reevaluate: jest.fn() };
const mockT = (key: string) => key;
const mockuseGroupRole = { lifecycle: mockLifecycle('group-role'), role: null, isLeader: false, isMySubgroupLeader: false, canEditItinerary: false, roleContext: 'actor:group', markLeaderRevoked: jest.fn() };
jest.mock('../screens/MapScreen/hooks/useGroupRole', () => ({ useGroupRole: () => mockuseGroupRole }));
const mockuseRouteDraft = { lifecycle: mockLifecycle('route-draft'), editorDestinations: mockEmpty, destinations: mockEmpty, dailyAccommodations: mockEmpty, tripDays: 1, departureDate: undefined, setDestinations: jest.fn(), openEditor: jest.fn() };
jest.mock('../screens/MapScreen/hooks/useRouteDraft', () => ({ useRouteDraft: () => mockuseRouteDraft }));
const mockuseGatheringWorkflow = { lifecycle: mockLifecycle('gathering-workflow'), remoteArrivals: mockEmpty, gatherPointRequests: mockEmpty, setGatherPointRequests: jest.fn(), loadGatheringWorkflow: mockAsync, patchLocalArrival: jest.fn(), workflowContext: 'ctx', isWorkflowContextCurrent: () => true };
jest.mock('../screens/MapScreen/hooks/useGatheringWorkflow', () => ({ useGatheringWorkflow: () => mockuseGatheringWorkflow }));
const mockuseJourneyNavigation = { lifecycle: mockLifecycle('journey'), journeyActive: false, navigationStoppedLocally: false, navTarget: undefined, navTargetId: null, activePoint: null, journeyBusy: false, pendingLeaderTargetId: null, refreshStartFrame: mockStartFrame, stopNavigation: mockAsync, stopRemovedDestination: mockAsync };
jest.mock('../screens/MapScreen/hooks/useJourneyNavigation', () => ({ useJourneyNavigation: () => mockuseJourneyNavigation }));
const mockuseMapKitRoutes = { lifecycle: mockLifecycle('mapkit'), selfRoute: null, memberRoutes: {}, selfRouteGeneration: 0 };
jest.mock('../screens/MapScreen/hooks/useMapKitRoutes', () => ({ useMapKitRoutes: () => mockuseMapKitRoutes }));
const mockusePersonalProgressSurfaces = { personalProgress: { progress: null, distanceMeters: null, etaSeconds: null, arrived: false, freshness: 'unknown' }, gatheringCard: { distanceMeters: null, etaSeconds: null, progress: null }, liveActivityPayload: {} };
jest.mock('../screens/MapScreen/hooks/usePersonalProgressSurfaces', () => ({ usePersonalProgressSurfaces: () => mockusePersonalProgressSurfaces }));
const mockuseCarouselSelection = { lifecycle: mockLifecycle('carousel'), selectedIndex: 0, setSelectedIndex: jest.fn(), travelMode: 'walk', setTravelMode: jest.fn(), selectedDestination: undefined };
jest.mock('../screens/MapScreen/hooks/useCarouselSelection', () => ({ useCarouselSelection: () => mockuseCarouselSelection }));
const mockusePendingPlaceEntrance = { lifecycle: mockLifecycle('pending-place'), ready: false, progress: { value: 0 } };
jest.mock('../screens/MapScreen/hooks/usePendingPlaceEntrance', () => ({ usePendingPlaceEntrance: () => mockusePendingPlaceEntrance }));
const mockuseGatherCardExpansion = { lifecycle: mockLifecycle('gather-card'), isCardExpanded: () => false, toggleCard: jest.fn(), collapseCard: jest.fn(), registerCardActivity: jest.fn(), expandCard: jest.fn(), pauseAutoCollapse: jest.fn(), resumeAutoCollapse: jest.fn() };
jest.mock('../screens/MapScreen/hooks/useGatherCardExpansion', () => ({ useGatherCardExpansion: () => mockuseGatherCardExpansion }));
const mockuseMeetTimeEditor = { lifecycle: mockLifecycle('meet-time'), meetTimeEditor: null, setMeetTimeEditor: jest.fn(), persistMeetTime: mockAsync, openMeetTimePicker: jest.fn(), openAndroidMeetDate: jest.fn() };
jest.mock('../screens/MapScreen/hooks/useMeetTimeEditor', () => ({ useMeetTimeEditor: () => mockuseMeetTimeEditor }));
const mockuseVisitHistory = { lifecycle: mockLifecycle('history'), historyGroups: mockEmpty, loadHistory: mockAsync };
jest.mock('../screens/MapScreen/hooks/useVisitHistory', () => ({ useVisitHistory: () => mockuseVisitHistory }));
const mockuseStragglerReporting = { lifecycle: mockLifecycle('straggler'), stragglers: mockEmpty };
jest.mock('../screens/MapScreen/hooks/useStragglerReporting', () => ({ useStragglerReporting: () => mockuseStragglerReporting }));
const mockuseCoordinationRequests = { lifecycle: mockLifecycle('coordination'), requests: mockEmpty, openCount: 0 };
jest.mock('../screens/MapScreen/hooks/useCoordinationRequests', () => ({ useCoordinationRequests: () => mockuseCoordinationRequests }));
const mockuseGatheringCompletion = { lifecycle: mockLifecycle('completion'), promptCompleteAfterArrival: jest.fn() };
jest.mock('../screens/MapScreen/hooks/useGatheringCompletion', () => ({ useGatheringCompletion: () => mockuseGatheringCompletion }));
const mockuseGroupActions = { goHomeCreateOrJoin: jest.fn(), openProfile: jest.fn() };
jest.mock('../screens/MapScreen/hooks/useGroupActions', () => ({ useGroupActions: () => mockuseGroupActions }));
const mockuseSubgroupActions = { lifecycle: mockLifecycle('subgroup'), subgroups: mockEmpty, pendingInvites: mockEmpty, sentInvites: mockEmpty };
jest.mock('../screens/MapScreen/hooks/useSubgroupActions', () => ({ useSubgroupActions: () => mockuseSubgroupActions }));
const mockuseItineraryMutations = {};
jest.mock('../screens/MapScreen/hooks/useItineraryMutations', () => ({ useItineraryMutations: () => mockuseItineraryMutations }));
const mockuseAccountActions = {};
jest.mock('../screens/MapScreen/hooks/useAccountActions', () => ({ useAccountActions: () => mockuseAccountActions }));
const mockuseMemberPresence = { lifecycle: mockLifecycle('presence'), flock: mockEmpty, statusMenuItems: mockEmpty, myStatusKind: 'available' };
jest.mock('../screens/MapScreen/hooks/useMemberPresence', () => ({ useMemberPresence: () => mockuseMemberPresence }));
const mockuseStoreEntitlements = { lifecycle: mockLifecycle('store'),};
jest.mock('../screens/MapScreen/hooks/useStoreEntitlements', () => ({ useStoreEntitlements: () => mockuseStoreEntitlements }));
jest.mock('../components/WaveLoading', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('../components/DestinationSearch', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('../components/DestinationReorderList', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('../components/QuickCommandsCard', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('../components/CustomQuickCommandSheet', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('../components/OverlaySheet', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('../components/PaywallSheet', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('../components/KmlImportSheet', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('../components/CoordinateDestinationSheet', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('../components/FeedbackSheet', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('../components/AmicroButton', () => ({ __esModule: true, default: 'mock-view', AmicroButton: 'mock-view' }));
jest.mock('../components/HitherText', () => ({ __esModule: true, default: 'mock-view', HitherText: 'mock-view' }));
jest.mock('../components/MapRecenterControl', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('../components/SwiftUIGlassSurface', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('../screens/MapScreen/components/PassiveCompanionPanel', () => ({ __esModule: true, default: 'mock-view', PassiveCompanionPanel: 'mock-view' }));
jest.mock('../screens/MapScreen/components/FlockRow', () => ({ __esModule: true, default: 'mock-view', FlockRow: 'mock-view' }));
jest.mock('../screens/MapScreen/components/MeetTimeSheet', () => ({ __esModule: true, default: 'mock-view', MeetTimeSheet: 'mock-view' }));
jest.mock('../screens/MapScreen/components/InviteTeammateSheet', () => ({ __esModule: true, default: 'mock-view', InviteTeammateSheet: 'mock-view' }));
jest.mock('../screens/MapScreen/components/HistorySheet', () => ({ __esModule: true, default: 'mock-view', HistorySheet: 'mock-view' }));
jest.mock('../screens/MapScreen/components/ArrivalTimeSheet', () => ({ __esModule: true, default: 'mock-view', ArrivalTimeSheet: 'mock-view' }));
jest.mock('../screens/MapScreen/components/ArrivalManageSheet', () => ({ __esModule: true, default: 'mock-view', ArrivalManageSheet: 'mock-view' }));
jest.mock('../screens/MapScreen/components/OpsCenterSheet', () => ({ __esModule: true, default: 'mock-view', OpsCenterSheet: 'mock-view' }));
jest.mock('../screens/MapScreen/components/InviteMembersOverlay', () => ({ __esModule: true, default: 'mock-view', InviteMembersOverlay: 'mock-view' }));
jest.mock('../screens/MapScreen/components/RouteEditorSheet', () => ({ __esModule: true, default: 'mock-view', RouteEditorSheet: 'mock-view' }));
jest.mock('../screens/MapScreen/components/GatheringCarousel', () => ({ __esModule: true, default: 'mock-view', GatheringCarousel: 'mock-view' }));
jest.mock('../screens/MapScreen/components/AddPlaceConfirmCard', () => ({ __esModule: true, default: 'mock-view', AddPlaceConfirmCard: 'mock-view' }));
jest.mock('../screens/MapScreen/components/ToolsPane', () => ({ __esModule: true, default: 'mock-view', ToolsPane: 'mock-view' }));
jest.mock('../screens/MapScreen/components/RoutePane', () => ({ __esModule: true, default: 'mock-view', RoutePane: 'mock-view' }));
jest.mock('../screens/MapScreen/components/MembersPane', () => ({ __esModule: true, default: 'mock-view', MembersPane: 'mock-view' }));
jest.mock('../screens/MapScreen/components/SettingsOverlay', () => ({ __esModule: true, default: 'mock-view', SettingsOverlay: 'mock-view' }));
jest.mock('../screens/MapScreen/components/ProfileOverlay', () => ({ __esModule: true, default: 'mock-view', ProfileOverlay: 'mock-view' }));
jest.mock('../screens/MapScreen/components/SheetPaneTabs', () => ({ __esModule: true, default: 'mock-view', SheetPaneTabs: 'mock-view' }));
jest.mock('../screens/MapScreen/components/StorePane', () => ({ __esModule: true, default: 'mock-view', StorePane: 'mock-view' }));
jest.mock('../components/AccountSheet', () => ({ __esModule: true, default: 'mock-view' }));
jest.mock('react-native', () => ({
  View: 'view', Text: 'text', ScrollView: 'scroll-view', Pressable: 'pressable',
  Platform: { OS: 'ios' }, UIManager: {}, Alert: { alert: jest.fn() }, Linking: { openSettings: mockAsync },
  LayoutAnimation: { configureNext: jest.fn(), Presets: {} },
  Keyboard: { addListener: () => ({ remove: jest.fn() }) },
  AppState: { currentState: 'active', addEventListener: (_event: string, listener: (state: string) => void) => {
    mockAppListeners.add(listener); return { remove: () => mockAppListeners.delete(listener) };
  } },
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove: jest.fn() }) },
  StyleSheet: { create: (value: unknown) => value, absoluteFillObject: {}, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 1 }),
}));
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { View: 'animated-view' },
  useSharedValue: (value: number) => require('react').useRef({ value }).current,
  useAnimatedStyle: () => ({}), interpolate: jest.fn(), Extrapolation: {}, withSpring: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'icon' }));
jest.mock('expo-clipboard', () => ({}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: mockAsync }));
jest.mock('../components/BottomSheet', () => ({ __esModule: true, default: 'bottom-sheet', sheetBottomOffset: () => 0 }));
jest.mock('../components/GroupMap', () => {
  const React = require('react');
  const { useMountEffect } = require('../hooks/useMountEffect');
  return { __esModule: true, default: React.forwardRef(function MockNativeMap(props: Record<string, unknown>, _ref: unknown) {
    useMountEffect(() => { mockMapMount(); return () => mockMapUnmount(); });
    return React.createElement('native-map', { ...props, testID: 'map-native-owner' });
  }) };
});
jest.mock('../state/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../state/PreferencesContext', () => ({ usePreferences: () => mockPrefs,
  useTheme: () => ({ colors: { accent: '#123456' } }), ARRIVAL_RADIUS_MIN_M: 30, ARRIVAL_RADIUS_MAX_M: 300 }));
jest.mock('../state/useGroupState', () => ({ useGroupState: () => mockGroup }));
jest.mock('../state/useNavigationSession', () => ({ useNavigationSession: () => mockNavigationSession }));
jest.mock('../state/useOrganizerExceptions', () => ({ useOrganizerExceptions: () => ({ lifecycle: mockLifecycle('organizer'), exceptions: mockEmpty, openCount: 0, pendingKeys: new Set() }) }));
jest.mock('../state/useLiveActivity', () => ({ LiveActivityRuntime: () => mockLifecycle('live-activity') }));
jest.mock('../state/useForegroundReconcile', () => ({ useForegroundReconcile: () => mockLifecycle('location-refresh') }));
jest.mock('../screens/MapScreen/hooks/useDeviceLocation', () => ({ useDeviceLocation: () => mockDevice }));
jest.mock('../screens/MapScreen/styles', () => ({ makeStyles: () => ({}) }));
jest.mock('../state/runtimePowerState', () => ({ subscribeRuntimePowerState: () => () => undefined, getRuntimePowerState: () => mockPower }));
jest.mock('../state/foregroundUi', () => ({ useVisibleUi: () => true, isForegroundUi: () => true }));
jest.mock('../a11y/useFontScaleBucket', () => ({ useFontLayout: () => ({ bucket: 'normal', scale: 1, textScale: 1, boldText: false, s: (n: number) => n }) }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: mockT, language: 'en' }) }));
jest.mock('../featureTour', () => ({ useGroupFeatureTour: () => ({ ...mockTour, lifecycle: mockLifecycle('group-tour') }), useRouteReorderTour: () => ({ ...mockTour, lifecycle: mockLifecycle('route-tour') }),
  holeKindForTarget: jest.fn(), pickTourDestinationId: () => null, tourDestinationIndex: () => 0,
  ADD_PLACE_TOUR_STEPS: [], ROUTE_REORDER_TOUR_STEPS: [], expectedSheetChromeTop: () => 0,
  isSheetTourTarget: () => false, snapTourRectY: jest.fn(), routeTourScrollOffset: () => 0,
  readAddPlaceTourCompletedLocal: async () => true, retryPendingAddPlaceTourAccountSync: mockAsync,
  GroupFeatureTourOverlay: 'tour-overlay' }));
jest.mock('../state/coreDataSync', () => ({ getCoreOperationOutbox: () => ({ listByGroup: async () => [] }),
  subscribeCoreOutboxChanges: (listener: () => void) => { mockOutboxListeners.add(listener); return () => mockOutboxListeners.delete(listener); } }));
jest.mock('../state/arrivalSync', () => ({ projectArrivals: () => mockEmpty, projectPersonalArrivals: () => mockEmpty,
  personalArrivalEvent: () => undefined, enqueueArrival: mockAsync, syncArrival: mockAsync }));
jest.mock('../state/energyObservability', () => ({ energyObservability: { mountWorkload: () => mockWorkload(), setTrackingMode: jest.fn() } }));
jest.mock('../state/backgroundJourney', () => ({ stopBackgroundJourney: (...args: Parameters<typeof mockStops>) => mockStops(...args) }));
jest.mock('../native/backgroundLocation', () => ({ prepareNativeBackgroundLocation: async () => undefined }));
jest.mock('../state/backgroundLocationRefresh', () => ({ consumePendingLocationPermission: async () => false,
  recoverPendingLocationRefreshes: mockAsync, rememberPendingLocationPermission: mockAsync }));
jest.mock('../state/locationSharingSync', () => ({ hydrateLocationSharing: mockAsync, rememberLocationSharing: mockAsync, syncLocationSharing: mockAsync }));
jest.mock('../state/locationOutbox', () => ({ purgeLocationOutbox: mockAsync }));
jest.mock('../state/locationPrivacy', () => ({ captureLocationAccess: mockAsync }));
jest.mock('../state/journeyNotifications', () => ({ notifyJourneyOperator: mockAsync, notifyJourneyApproach: mockAsync }));
jest.mock('../state/diagnostics', () => ({ diagnostics: { write: mockAsync } }));
jest.mock('../native/location', () => ({ requestPermission: mockAsync }));
jest.mock('../native', () => ({ location: { getPermissionState: async () => ({ backgroundStatus: 'granted' }) },
  notifications: { addForegroundListener: (listener: unknown) => { mockNotificationListeners.add(listener); return () => mockNotificationListeners.delete(listener); } } }));
jest.mock('../api/client', () => ({}));
jest.mock('../api/demo', () => ({ isDemoGroup: () => false }));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn(), logError: jest.fn() }));
jest.mock('../utils/haptics', () => ({ lightTap: jest.fn(), mediumTap: jest.fn(), selectionTick: jest.fn(), alertBuzz: jest.fn() }));
jest.mock('../utils/confirm', () => ({ confirmAction: jest.fn() }));
jest.mock('../entitlements', () => ({ countOpenDestinations: () => 0, shouldBlockNewDestination: () => false }));

// Load after the mock snapshots are initialized; production resources mount unchanged.
const { default: MapScreen }: typeof import('../screens/MapScreen') = require('../screens/MapScreen');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('mounts real resources through every MapScreen return and preserves the native map and first camera center', async () => {
  const navigation = { dispatch: jest.fn(), navigate: jest.fn(), navigateDeprecated: jest.fn(), preload: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(), isFocused: jest.fn(),
    getId: jest.fn(), getParent: jest.fn(), getState: jest.fn(), reset: jest.fn(), setOptions: jest.fn(), setParams: jest.fn(), replaceParams: jest.fn(),
    addListener: jest.fn(), removeListener: jest.fn(), push: jest.fn(), replace: jest.fn(), pop: jest.fn(), popToTop: jest.fn(), popTo: jest.fn() };
  const props = { route: { key: 'map', name: 'Map' as const, params: { groupId: 'group' } }, navigation };
  const diagnostics = jest.spyOn(console, 'error');
  const expectedLifecycles = ["carousel","completion","coordination","device-location","gather-card","gathering-workflow","group-role","group-state","group-tour","history","journey","live-activity","location-refresh","mapkit","meet-time","navigation","organizer","pending-place","presence","route-draft","route-tour","store","straggler","subgroup"];
  function assertLifecycles() {
    expect([...mockLifecycles.entries()].sort()).toEqual(expectedLifecycles.map(name => [name, 1]));
    expect(mockLifecycleMounts).toHaveBeenCalledTimes(expectedLifecycles.length);
  }
  let tree: ReactTestRenderer | undefined;
  try {
    await act(async () => { tree = create(React.createElement(MapScreen, props)); });
    assertLifecycles();
    expect(mockOutboxListeners.size).toBe(1);
    expect(mockAppListeners.size).toBe(1);
    expect(mockNotificationListeners.size).toBe(1);
    expect(mockWorkload).toHaveBeenCalledTimes(1);
    mockGroup.loading = false;
    await act(async () => tree?.update(React.createElement(MapScreen, props)));
    assertLifecycles();
    expect(mockOutboxListeners.size).toBe(1);
    mockPrefs.ready = true; mockPrefs.passiveCompanionMode = true; mockGroup.loading = true;
    await act(async () => tree?.update(React.createElement(MapScreen, props)));
    assertLifecycles();
    expect(mockOutboxListeners.size).toBe(1);
    mockGroup.loading = false;
    await act(async () => tree?.update(React.createElement(MapScreen, props)));
    assertLifecycles();
    expect(mockNotificationListeners.size).toBe(1);
    mockPrefs.passiveCompanionMode = false;
    mockGroup.state = { group: { id: 'group', name: 'Group', inviteCode: 'ABCDEF', createdBy: 'actor', journeyStatus: 'paused',
      stragglerAlerts: false, stragglerThresholdM: 500 }, members: [], subgroups: [], destinations: [] };
    await act(async () => tree?.update(React.createElement(MapScreen, props)));
    assertLifecycles();
    expect(mockMapMount).toHaveBeenCalledTimes(1);
    const first = { latitude: 25, longitude: 121 };
    mockDevice.deviceCoords = first;
    await act(async () => tree?.update(React.createElement(MapScreen, props)));
    assertLifecycles();
    expect(tree?.root.findByProps({ testID: 'map-native-owner' }).props.initialCenter).toBe(first);
    mockDevice.deviceCoords = { latitude: 25.1, longitude: 121.1 };
    await act(async () => tree?.update(React.createElement(MapScreen, props)));
    assertLifecycles();
    expect(tree?.root.findByProps({ testID: 'map-native-owner' }).props.initialCenter).toBe(first);
    expect(mockMapMount).toHaveBeenCalledTimes(1);
    expect(mockMapUnmount).not.toHaveBeenCalled();
    const stops = mockStops.mock.calls.length;
    await act(async () => tree?.unmount()); tree = undefined;
    expect(mockLifecycles.size).toBe(0);
    expect(mockOutboxListeners.size).toBe(0);
    expect(mockAppListeners.size).toBe(0);
    expect(mockNotificationListeners.size).toBe(0);
    expect(mockMapUnmount).toHaveBeenCalledTimes(1);
    expect(mockStops).toHaveBeenCalledTimes(stops + 1);
    expect(diagnostics.mock.calls.flat().join(' ')).not.toMatch(/same key|unique.*key/i);
  } finally {
    act(() => tree?.unmount());
    diagnostics.mockRestore();
  }
});
