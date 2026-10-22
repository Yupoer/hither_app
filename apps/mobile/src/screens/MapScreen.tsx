import { useMemberPresence } from './MapScreen/hooks/useMemberPresence';
import { useGatheringCompletion } from './MapScreen/hooks/useGatheringCompletion';
import { reconcileRouteOnOpen } from '../utils/routeOpenSync';
import { foregroundLocationConfiguration, isForegroundLocationState } from '../utils/locationPolicy';
import WaveLoading from '../components/WaveLoading';
import { useForegroundReconcile } from '../state/useForegroundReconcile';
import { refreshTeamLocations } from '../utils/refreshTeamLocations';
import { showAppNotice } from '../state/appNotice';
import { captureLocationAccess } from '../state/locationPrivacy';
import { prepareNativeBackgroundLocation } from '../native/backgroundLocation';
import { hydrateLocationSharing, rememberLocationSharing, syncLocationSharing } from '../state/locationSharingSync';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AccessibilityInfo,
  Alert,
  AppState,
  Keyboard,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';

// New Architecture: setLayoutAnimationEnabledExperimental is a no-op and
// logs a WARN on Android. Only enable on the legacy paper UIManager.
if (
  Platform.OS === 'android'
  && UIManager.setLayoutAnimationEnabledExperimental
  && !(global as { nativeFabricUIManager?: unknown }).nativeFabricUIManager
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useVisibleUi, isForegroundUi } from '../state/foregroundUi';
import GroupMap, { type GroupMapHandle, type GroupMapCameraState } from '../components/GroupMap';
import { PLACE_ALTITUDE, PLACE_ZOOM } from '../components/mapCameraMath';
import {
  cameraAfterSuccessfulAdd,
  cameraOnLongPress,
  cameraOnSearchPick,
} from '../utils/mapCameraFlow';
import { notifyJourneyOperator, notifyJourneyApproach } from '../state/journeyNotifications';
import {
  gatherRequestPageIndex,
  recoverGatherRequestAfterFailedResolve,
  resolveGatherRequestSelection,
  sortGatherRequestsFifo,
} from '../utils/gatherRequestInbox';
import DestinationSearch from '../components/DestinationSearch';
import DestinationReorderList from '../components/DestinationReorderList';
import { getRuntimePowerState, subscribeRuntimePowerState } from '../state/runtimePowerState';
import QuickCommandsCard from '../components/QuickCommandsCard';
import CustomQuickCommandSheet from '../components/CustomQuickCommandSheet';
import BottomSheet, { sheetBottomOffset } from '../components/BottomSheet';
import OverlaySheet from '../components/OverlaySheet';
import PaywallSheet from '../components/PaywallSheet';
import KmlImportSheet from '../components/KmlImportSheet';
import CoordinateDestinationSheet from '../components/CoordinateDestinationSheet';
import type { CoordinateDestinationInput } from '../utils/coordinateDestination';
import FeedbackSheet from '../components/FeedbackSheet';
import { AmicroButton } from '../components/AmicroButton';
import { HitherText } from '../components/HitherText';
import MapRecenterControl from '../components/MapRecenterControl';
import SwiftUIGlassSurface from '../components/SwiftUIGlassSurface';
import { deriveCardNavFlags, resolveNavCommand } from '../utils/gatherCommand';
import {
  shouldFireApproachNotify,
} from '../utils/approachNotify';
import {
  ARRIVAL_CARD_EXIT_MS,
  ARRIVAL_EFFECT_HOLD_MS,
  PERSONAL_ARRIVAL_CELEBRATE_MS,
  armCelebrateClearTimer,
  beginArrivalCardExit,
  newlyCompletedVisibleCards,
  cancelCelebrateClearTimer,
  clearAllCelebrateClearTimers,
  mergeExitingDestinations,
  nextVisibleCarouselOrder,
  resolveExitIndexAtStart,
  type ArrivalCardExitRecord,
  type CelebrateClearStore,
} from '../utils/arrivalCardExit';
import {
  overlayPersonalOnTeamState,
  projectTeamGatheringState,
} from '../utils/teamGatheringState';
import { useFontLayout } from '../a11y/useFontScaleBucket';
import { useSession } from '../state/SessionContext';
import {
  usePreferences,
  useTheme,
  ARRIVAL_RADIUS_MIN_M,
  ARRIVAL_RADIUS_MAX_M,
} from '../state/PreferencesContext';
import { displayMemberAvatar } from '../constants/avatars';
import { canMarkDestinationArrival } from '../utils/arrivalMarking';
import { useIsFocused } from '@react-navigation/native';
import type { CoreOperation } from '../types/coreData';
import { getCoreOperationOutbox, subscribeCoreOutboxChanges } from '../state/coreDataSync';
import { enqueueArrival, syncArrival, projectArrivals, projectPersonalArrivals, personalArrivalEvent } from '../state/arrivalSync';
import { buildPassiveCompanionModel } from '../utils/passiveCompanion';
import { runUiAction } from '../utils/uiAction';
import { useTranslation, type TranslationKey } from '../i18n';
import { PassiveCompanionPanel } from './MapScreen/components/PassiveCompanionPanel';
import { useDeviceLocation } from './MapScreen/hooks/useDeviceLocation';
import { useCarouselSelection } from './MapScreen/hooks/useCarouselSelection';
import { useJourneyNavigation } from './MapScreen/hooks/useJourneyNavigation';
import { useMapKitRoutes } from './MapScreen/hooks/useMapKitRoutes';
import { usePersonalProgressSurfaces } from './MapScreen/hooks/usePersonalProgressSurfaces';
import { usePendingPlaceEntrance } from './MapScreen/hooks/usePendingPlaceEntrance';
import { energyObservability } from '../state/energyObservability';
import { useGatherCardExpansion } from './MapScreen/hooks/useGatherCardExpansion';
import { FlockRow } from './MapScreen/components/FlockRow';
import { arrivalErrorMessage } from '../utils/mapFormatters';
import { MeetTimeSheet } from './MapScreen/components/MeetTimeSheet';
import { useMeetTimeEditor } from './MapScreen/hooks/useMeetTimeEditor';
import { InviteTeammateSheet } from './MapScreen/components/InviteTeammateSheet';
import { HistorySheet } from './MapScreen/components/HistorySheet';
import { ArrivalTimeSheet } from './MapScreen/components/ArrivalTimeSheet';
import { ArrivalManageSheet } from './MapScreen/components/ArrivalManageSheet';
import { OpsCenterSheet } from './MapScreen/components/OpsCenterSheet';
import { InviteMembersOverlay } from './MapScreen/components/InviteMembersOverlay';
import { RouteEditorSheet } from './MapScreen/components/RouteEditorSheet';
import { GatheringCarousel } from './MapScreen/components/GatheringCarousel';
import { AddPlaceConfirmCard } from './MapScreen/components/AddPlaceConfirmCard';
import { ToolsPane } from './MapScreen/components/ToolsPane';
import { RoutePane } from './MapScreen/components/RoutePane';
import { MembersPane } from './MapScreen/components/MembersPane';
import { useItineraryMutations } from './MapScreen/hooks/useItineraryMutations';
import { useStoreEntitlements } from './MapScreen/hooks/useStoreEntitlements';
import { useAccountActions } from './MapScreen/hooks/useAccountActions';
import { useGroupActions } from './MapScreen/hooks/useGroupActions';
import { useStragglerReporting } from './MapScreen/hooks/useStragglerReporting';
import { useVisitHistory } from './MapScreen/hooks/useVisitHistory';
import { useGatheringWorkflow } from './MapScreen/hooks/useGatheringWorkflow';
import { useGroupRole } from './MapScreen/hooks/useGroupRole';
import { useSubgroupActions } from './MapScreen/hooks/useSubgroupActions';
import { makeStyles } from './MapScreen/styles';
import {
  useRouteDraft,
} from './MapScreen/hooks/useRouteDraft';
import {
  GroupFeatureTourOverlay,
  useGroupFeatureTour,
  holeKindForTarget,
  pickTourDestinationId,
  tourDestinationIndex,
  type TourTargetId,
  ADD_PLACE_TOUR_SETTLE_MS,
  ADD_PLACE_TOUR_STEPS,
  areAddPlaceTourTargetsReady,
  completeAddPlaceTour,
  expectedSheetChromeTop,
  isMeasuredTourRect,
  isSheetTourTarget,
  measureTargetWithRetry,
  readAddPlaceTourCompletedLocal,
  retryPendingAddPlaceTourAccountSync,
  shouldStartAddPlaceTour,
  snapTourRectY,
  useRouteReorderTour,
  routeTourScrollOffset,
  ROUTE_REORDER_TOUR_STEPS,
} from '../featureTour';
import { useCoordinationRequests } from './MapScreen/hooks/useCoordinationRequests';
import { SettingsOverlay } from './MapScreen/components/SettingsOverlay';
import { ProfileOverlay } from './MapScreen/components/ProfileOverlay';
import { SheetPaneTabs } from './MapScreen/components/SheetPaneTabs';
import type { SheetPaneTabOption } from './MapScreen/components/SheetPaneTabs';
import { StorePane } from './MapScreen/components/StorePane';
import type { SheetPaneKey } from '../store/types';
import AccountSheet from '../components/AccountSheet';
import { useGroupState } from '../state/useGroupState';
import { useNavigationSession } from '../state/useNavigationSession';
import { useOrganizerExceptions } from '../state/useOrganizerExceptions';
import { useLiveActivity } from '../state/useLiveActivity';
import {
  prepareBackgroundJourneyPermissions,
  loadBackgroundManualUndo,
  rememberBackgroundManualUndo,
  releaseBackgroundManualUndo,
  startBackgroundJourney,
  stopBackgroundJourney,
  type BackgroundManualUndoMarker,
} from '../state/backgroundJourney';
import { purgeLocationOutbox } from '../state/locationOutbox';
import { diagnostics } from '../state/diagnostics';
import { requestPermission as requestLocationPermission } from '../native/location';
import {
  consumePendingLocationPermission,
  recoverPendingLocationRefreshes,
  rememberPendingLocationPermission,
} from '../state/backgroundLocationRefresh';
import {
  gatedJourneyProgress,
  initialJourneyDistance,
  sameMetricDistance,
  shouldAnchorInitial,
  type DistanceSource,
} from '../utils/journeyProgress';
import {
  distanceMeters,
  etaSecondsFor,
  formatDistance,
  type TravelMode,
} from '../utils/geo';
import {
  dateForTripDay,
  filterActiveDestinations,
  localDayKey,
  nextOrderedDestination,
  openDestinationsForReorder,
  resolveAddDay,
} from '../utils/tripDay';
import { createArrivalState, reduceArrival, type ArrivalState } from '../utils/navigationArrival';
import { canEvaluateSynchronizedArrival, synchronizedArrivalTargetKey } from '../utils/synchronizedArrival';
import { getOperationErrorMessage } from '../utils/operationError';

import { location, notifications, type MapRegion, type PlaceResult } from '../native';
import { addDestination, addDestinationsBatch, deleteDestination, deleteVisitedWaypoint, recordVisitedWaypoint, kickGroupMember, requestGroupLocationRefresh, getGroupLocationRefreshAcknowledgements, resolveGatherPointRequestResilient, sendCommand, correctDestinationArrival, setDestinationArrivalAt, listFavoritePlaces, saveFavoritePlace, unsaveFavoriteByExactMatch, unsaveFavoritePlace, findFavoriteByExactMatch, type FavoritePlace, submitGatherPointRequest, updateGroupAvatar, getKmlImportQuota } from '../api/client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isDemoGroup } from '../api/demo';
import { confirmAction } from '../utils/confirm';
import {
  locationSharingConfirmCopy,
} from './MapScreen/memberStatusSharing';


import { logEvent, logError } from '../utils/activityLog';
import { lightTap, mediumTap, selectionTick, alertBuzz } from '../utils/haptics';
import type {
  Coordinates,
  Destination,
  GatherPointRequestItem,
  MemberLocation,
  VisitedWaypoint,
} from '../types';
import type { KmlPlacemark } from '../utils/kml';
import { normalizeImportBatch, KmlImportError } from '../utils/kmlBatch';
import {
  countOpenDestinations,
  shouldBlockNewDestination,
} from '../entitlements';
import { themes } from '../theme';
import { glass } from '../glass';
import { gatherCardHorizontalInset, mapKitChromeLayout } from '../utils/mapChromeLayout';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

const EMPTY_DESTINATIONS: Destination[] = [];

/**
 * The whole app: a live map with an Apple-Maps pull-up glass sheet. Peek shows a
 * search bar + the floating gathering-point carousel; drag up for the group,
 * flock, gathering points and quick commands. Search / route-reorder / settings
 * open as stacked overlays. The in-app Dynamic Island mirrors the Live Activity.
 */
export default function MapScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const {
    membership,
    user,
    updateProfile,
    leaveGroup,
    signOut,
    isAnonymous,
    isPro,
    premiumProjection,
    refreshEntitlement,
    setMembership,
  } = useSession();
  const {
    highAccuracy,
    sharingEnabled,
    ready: preferencesReady,
    obliqueLocate,
    liveActivityEnabled,
    meetRedMin,
    gatherCardDefaultExpanded,
    gatherCardTitleMarquee,
    gatherCardMarqueeSpeed,
    arrivalRadiusM,
    passiveCompanionMode,
    setMeetRedMin,
    setHighAccuracy,
    setSharingEnabled,
    setLiveActivityEnabled,
    setArrivalRadiusM,
    setPassiveCompanionMode,
  } = usePreferences();
  const {
    isCardExpanded,
    toggleCard,
    collapseCard,
    registerCardActivity,
    expandCard,
    pauseAutoCollapse,
    resumeAutoCollapse,
  } = useGatherCardExpansion(gatherCardDefaultExpanded);
  const { colors } = useTheme();
  const accent = colors.accent;
  const { t, language } = useTranslation();
  const tourTargetRefs = useRef<Partial<Record<TourTargetId, View | null>>>({});
  const setTourTargetRef = useCallback((id: TourTargetId, node: View | null) => {
    tourTargetRefs.current[id] = node;
  }, []);
  const measureTourTarget = useCallback(async (id: TourTargetId) => {
    const node = tourTargetRefs.current[id];
    if (!node || typeof (node as View).measureInWindow !== 'function') return null;
    return await new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
      try {
        (node as View).measureInWindow((x, y, width, height) => {
          if (!width || !height) resolve(null);
          else resolve({ x, y, width, height });
        });
      } catch {
        resolve(null);
      }
    });
  }, []);

  // Live Dynamic Type layout — rebuilds when system fontScale changes.
  // a11y-layout:commandRow — always ONE row; density (size/labels) tracks
  // font bucket + physical width, never multi-row stacking.
  // a11y-layout:narrowScreen — iPhone 15 / mini (~375) denser chrome.
  const fontLayout = useFontLayout();
  const fontBucket = fontLayout.bucket;
  // ≤390 ≈ iPhone 15 / mini / SE; slightly denser chrome so fixed command
  // controls don't clip past the card edge on small physical widths.
  const narrowScreen = windowWidth < 400;
  const gatherCardRadius = narrowScreen ? fontLayout.s(22, 16) : fontLayout.s(26, 20);
  const styles = useMemo(
    () =>
      makeStyles(
        accent,
        fontLayout.scale,
        narrowScreen,
        fontBucket,
        fontLayout.textScale,
        fontLayout.boldText,
      ),
    [
      accent,
      fontLayout.scale,
      fontLayout.textScale,
      fontLayout.boldText,
      narrowScreen,
      fontBucket,
    ],
  );
  // Embedded themed components (reorder list, notifications, commands) always
  // render on the dark glass overlay — force the night palette so they stay dark.
  const dark = themes.night;

  const groupId = route.params?.groupId ?? membership?.group.id ?? null;
  const powerState = useSyncExternalStore(subscribeRuntimePowerState, getRuntimePowerState, getRuntimePowerState);
  const [localActionError, setLocalActionError] = useState<{ title: string; message: string; destinationId?: string } | null>(null);
  const showOperationFailure = useCallback((title: string, message: string) => setLocalActionError({ title, message }), []);

  const {
    state,
    loading,
    error: groupStateError,
    loadError,
    refreshing,
    refresh,
    refreshLocalSnapshot,
    applyOptimisticGathering,
    openOperations,
    serverTimeOffsetMs,
    emptyLocalSnapshot,
    dataSource,
  } = useGroupState(groupId, {
    myUserId: user?.id ?? null,
    highAccuracy,
  });
  const group = state?.group ?? membership?.group ?? null;
  const serverDailyAccommodations = state?.dailyAccommodations ?? [];

  const mapRef = useRef<GroupMapHandle | null>(null);
  const mapCameraState = useRef<GroupMapCameraState>({});
  const carouselRef = useRef<ScrollView | null>(null);

  const members = useMemo(() => state?.members ?? [], [state?.members]);
  const membersRef = useRef(members);
  membersRef.current = members;
  // My current scope: undefined = main group's itinerary, a subgroup id =
  // that subgroup's own itinerary. Everything itinerary-related below reads
  // only from this scope's list (carousel, reorder, nav target, meet-time,
  // straggler nav target) — filtering once here means nothing downstream
  // needs its own leader/subgroup branching to stay scoped correctly.

  const me = useMemo(() => members.find((m) => m.userId === user?.id), [members, user?.id]);
  const [arrivalOperations, setArrivalOperations] = useState<CoreOperation[]>([]);
  useEffect(() => {
    let active = true;
    const reload = async () => {
      const rows = groupId ? await getCoreOperationOutbox().listByGroup(groupId) : [];
      if (active) setArrivalOperations(rows.filter(op =>
        op.operationType === 'record_arrival' || op.operationType === 'leader_correct_arrival'));
    };
    void reload().catch(() => undefined);
    const unsubscribe = subscribeCoreOutboxChanges(() => { void reload().catch(() => undefined); });
    return () => { active = false; unsubscribe(); };
  }, [groupId, user?.id]);
  const {
    role,
    isLeader,
    isMySubgroupLeader,
    canEditItinerary,
    roleContext,
    markLeaderRevoked,
  } = useGroupRole({
    groupId,
    userId: user?.id,
    me,
    membership,
    setMembership,
    group,
    subgroups: state?.subgroups ?? [],
    dataSource,
    openOperations,
    arrivalOperations,
    refresh,
  });
  useEffect(() => { setLocalActionError(null); }, [roleContext]);
  const myScopeId = me?.subgroupId;
  // Navigation sessions are one lane per subgroup (plus the main-team lane),
  // so a shared group id is not sufficient once parallel teams are active.
  const navigationSessionState = useNavigationSession(groupId, myScopeId ?? null, user?.id ?? null);
  const navigationSessionId = navigationSessionState.session?.id ?? null;
  /** Local durable Start id used as a session alias before the server row is visible. */
  const [localNavigationSessionId, setLocalNavigationSessionId] = useState<string | null>(null);
  const sessionEligibleMembers = useMemo(() => {
    const session = navigationSessionState.session;
    if (!session?.memberIds || (localNavigationSessionId && localNavigationSessionId !== session.id
      && localNavigationSessionId !== session.requestId)) return members;
    const eligible = new Set(session.memberIds);
    return members.filter(member => eligible.has(member.userId));
  }, [members, navigationSessionState.session, localNavigationSessionId]);
  const hasNavigationSession = navigationSessionId !== null;
  // Cold start / return from background: re-pull the scoped flock session so
  // members immediately enter nav mode without tapping「路徑」.
  useEffect(() => {
    const onAppState = (next: string) => {
      if (next !== 'active' || !groupId) return;
      void navigationSessionState.refresh().catch(() => undefined);
      void refresh().catch(() => undefined);
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [groupId, navigationSessionState.refresh, refresh]);

  // Kicked follower: recovery RPC raises not_member → clear session + RoleSelect.
  const kickedHandledRef = useRef(false);
  const voluntaryLeaveRef = useRef(false);
  useEffect(() => {
    if (!user?.id || !groupId || isDemoGroup(groupId)) return;
    if (membership?.group.id !== groupId) return;
    if (isLeader) return;
    const stillMember = members.some((m) => m.userId === user.id);
    const accessLost = groupStateError === 'not_member'
      || (!loading && !!state && state.group?.id === groupId && !stillMember && members.length > 0);
    if (!accessLost) {
      if (stillMember) kickedHandledRef.current = false;
      return;
    }
    if (kickedHandledRef.current) return;
    kickedHandledRef.current = true;
    leaveGroup();
    if (!voluntaryLeaveRef.current) Alert.alert(t('group.kickedTitle'), t('group.kickedMsg'));
    navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
  }, [
    user?.id,
    groupId,
    members,
    state,
    loading,
    groupStateError,
    membership?.group.id,
    isLeader,
    leaveGroup,
    navigation,
    t,
  ]);

  const [viewingScope, setViewingScope] = useState<'main' | 'sub'>('main');
  // Leave a subgroup → force main scope so we never filter against a stale id.
  useEffect(() => {
    if (!myScopeId && viewingScope === 'sub') setViewingScope('main');
  }, [myScopeId, viewingScope]);

  // Subgroup / 暫時離隊: only that subgroup's itinerary (usually empty → hide
  // main gathering-point cards). Main flock: only main-team destinations.
  // viewingScope still toggles member-list scope on the group pill; it must
  // not re-surface main gather cards while the user is away from the main team.
  const rawDestinations: Destination[] = useMemo(() => {
    const all = state?.destinations ?? [];
    if (myScopeId) {
      return all.filter((d) => d.subgroupId === myScopeId);
    }
    return all.filter((d) => d.subgroupId == null);
  }, [state?.destinations, myScopeId]);

  const mapFocused = useIsFocused();
  const foregroundUi = useVisibleUi();
  const uiVisible = foregroundUi && mapFocused;
  const routeDraft = useRouteDraft({
    scopeId: myScopeId,
    rawDestinations,
    serverDestinations: state?.destinations ?? EMPTY_DESTINATIONS,
    serverDaily: serverDailyAccommodations,
    group,
    openOperations,
  });
  const {
    editorScopeId: routeEditorScopeId,
    editorServerDestinations: routeEditorServerDestinations,
    dailyAccommodations,
    tripDays: routeTripDays,
    departureDate: routeDepartureDate,
  } = routeDraft;
  const allScopedDestinations = routeDraft.destinations ?? rawDestinations;
  const arrivalSessionScope = useMemo(
    // A newly queued Start is the authoritative local session immediately;
    // do not keep the previous server session in the active projection while
    // its replacement is still hydrating. The v3 bridge uses the local
    // operation id as the eventual server session id, so no alias is lost.
    () => localNavigationSessionId
      ? [localNavigationSessionId]
      : navigationSessionId
        ? [navigationSessionId]
        : [],
    [localNavigationSessionId, navigationSessionId],
  );
  const {
    remoteArrivals,
    gatherPointRequests,
    setGatherPointRequests,
    loadGatheringWorkflow,
    patchLocalArrival,
    workflowContext,
    isWorkflowContextCurrent,
  } = useGatheringWorkflow({
    groupId,
    userId: user?.id,
    myScopeId,
    isMainLeader: isLeader,
    isSubgroupLeader: isMySubgroupLeader,
    canEditItinerary,
    t,
    arrivalOperations,
    arrivalSessionScope,
    rawDestinations,
  });
  const destinationArrivals = useMemo(() => projectPersonalArrivals(remoteArrivals, arrivalOperations, user?.id ?? ''), [remoteArrivals, arrivalOperations, user?.id]);
  const activeDestinationArrivals = useMemo(
    () => arrivalSessionScope.length > 0
      ? projectArrivals(remoteArrivals, arrivalOperations, user?.id ?? '', arrivalSessionScope)
      : [],
    [arrivalOperations, arrivalSessionScope, remoteArrivals, user?.id],
  );
  const personalDestinationArrivals = useMemo(() => arrivalSessionScope.length > 0
    ? projectPersonalArrivals(remoteArrivals, arrivalOperations, user?.id ?? '', arrivalSessionScope) : [],
    [remoteArrivals, arrivalOperations, user?.id, arrivalSessionScope]);
  const [resolvingGatherRequestId, setResolvingGatherRequestId] = useState<string | null>(null);
  /** Selected request id for Route pane horizontal FIFO inbox (#173). */
  const [selectedGatherRequestId, setSelectedGatherRequestId] = useState<string | null>(null);
  const gatherRequestPagerRef = useRef<ScrollView | null>(null);
  const lastGatherRequestIdsRef = useRef<string[]>([]);
  const pendingRemovedGatherRequestIdRef = useRef<string | null>(null);
  const sortedGatherRequests = useMemo(
    () => sortGatherRequestsFifo(gatherPointRequests),
    [gatherPointRequests],
  );
  const sortedGatherRequestIds = useMemo(
    () => sortedGatherRequests.map((r) => r.id),
    [sortedGatherRequests],
  );
  useEffect(() => {
    setSelectedGatherRequestId((prev) => {
      const next = resolveGatherRequestSelection({
        sortedIds: sortedGatherRequestIds,
        previousSortedIds: lastGatherRequestIdsRef.current,
        previousId: prev,
        removedId: pendingRemovedGatherRequestIdRef.current,
      });
      lastGatherRequestIdsRef.current = sortedGatherRequestIds;
      pendingRemovedGatherRequestIdRef.current = null;
      return next;
    });
  }, [sortedGatherRequestIds]);
  const mapDailyAccommodations = useMemo(() => {
    const departure = routeDepartureDate;
    const tripDays = routeTripDays ?? 1;
    const dayForStayDate = (stayDate: string): number => {
      if (!departure) return 1;
      for (let d = 1; d <= Math.max(1, tripDays); d++) {
        const date = dateForTripDay(departure, d);
        if (date && localDayKey(date) === stayDate) return d;
      }
      return 1;
    };
    return dailyAccommodations.map((daily) => ({
      id: daily.id,
      title: daily.title,
      coordinates: daily.coordinates,
      sourceDestinationId: daily.sourceDestinationId,
      day: dayForStayDate(daily.stayDate),
    }));
  }, [dailyAccommodations, routeDepartureDate, routeTripDays]);
  /** Personal arrival rows (check-in) — not team stop completion. */
  const myCompletedDestinationIds = useMemo(
    () => new Set(
      personalDestinationArrivals
        .filter((arrival) => arrival.userId === user?.id)
        .map((arrival) => arrival.destinationId),
    ),
    [personalDestinationArrivals, user?.id],
  );
  /** Team-completed stops (closedAt) — distinct from personal arrival. */
  const teamCompletedDestinationIds = useMemo(
    () => new Set(
      allScopedDestinations
        .filter((d) => d.closedAt != null)
        .map((d) => d.id),
    ),
    [allScopedDestinations],
  );
  // Open stops on today + future trip days (local device date). Past days
  // leave the carousel / reorder list and surface in 歷史行程 instead.
  // #149: cards mid exit-hold/exit stay visible after closedAt filters them out.
  const [arrivalExitRecords, setArrivalExitRecords] = useState<
    Map<string, ArrivalCardExitRecord>
  >(() => new Map());
  const [arrivalExitSnapshots, setArrivalExitSnapshots] = useState<
    Map<string, Destination>
  >(() => new Map());
  const arrivalExitContext = JSON.stringify([groupId, user?.id, myScopeId ?? null]);
  const arrivalExitContextRef = useRef(arrivalExitContext);
  const arrivalExitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(
    new Map(),
  );
  /** Full visible carousel order, including cards in hold/exit. */
  const prevVisibleDestOrderRef = useRef<string[]>([]);
  /** Personal 1.6s / completion 3.2s share celebrate UI — one clear timer per dest. */
  const celebrateClearTimersRef = useRef<CelebrateClearStore>(new Map());
  const arrivalExitRecordsRef = useRef(arrivalExitRecords);
  arrivalExitRecordsRef.current = arrivalExitRecords;

  const openDestinations = useMemo(
    () =>
      filterActiveDestinations(
        allScopedDestinations,
        routeDepartureDate,
        routeTripDays,
        new Date(),
        [state?.group.journeyStatus === 'going' ? state.group.activeDestinationId : null,
          navigationSessionState.session?.status === 'active' ? navigationSessionState.session.destinationId : null]
          .filter((id): id is string => Boolean(id)),
      ),
    [
      allScopedDestinations,
      routeDepartureDate,
      routeTripDays,
      group?.departureDate,
      group?.tripDays,
      state?.group.activeDestinationId,
      state?.group.journeyStatus,
      navigationSessionState.session?.destinationId,
      navigationSessionState.session?.status,
    ],
  );
  const destinations = useMemo(
    () =>
      arrivalExitContextRef.current !== arrivalExitContext ? openDestinations : mergeExitingDestinations(
        openDestinations,
        arrivalExitSnapshots,
        arrivalExitRecords,
        prevVisibleDestOrderRef.current,
      ),
    [openDestinations, arrivalExitSnapshots, arrivalExitRecords, arrivalExitContext],
  );
  const mapDestinations = useMemo(
    () => [...allScopedDestinations.filter(d => d.day == null && !d.closedAt), ...destinations],
    [allScopedDestinations, destinations],
  );
  useEffect(() => energyObservability.mountWorkload({ mountedCardCount: uiVisible ? destinations.length : 0 }), [uiVisible, destinations.length]);
  const destinationIds = useMemo(() => destinations.map((dest) => dest.id), [destinations]);
  /**
   * Full open itinerary for the route editor (all open days + stay cards).
   * Must not use day-gated `destinations` — that under-counts past-day stops
   * and desyncs the「調整順序」label from the list body.
   */
  const openForRouteEditor = useMemo(
    () => openDestinationsForReorder(routeDraft.editorDestinations),
    [openDestinationsForReorder, routeDraft.editorDestinations],
  );

  /** Paint durable writes now; remote reconciliation never gates a saved action. */
  const syncFromDatabase = useCallback(async () => {
    await reconcileRouteOnOpen(refreshLocalSnapshot, refresh);
  }, [refreshLocalSnapshot, refresh]);

  useForegroundReconcile(Boolean(groupId), recoverPendingLocationRefreshes);
  const mapMountedRef = useRef(true);
  useEffect(() => {
    mapMountedRef.current = true;
    return () => { mapMountedRef.current = false; };
  }, []);

  // --- Sheet / overlay / island UI state -----------------------------------
  // Measured height of the sheet's pinned header (grabber + search row) —
  // peek shows exactly that block, floating high off the screen edges.
  const [sheetHeaderH, setSheetHeaderH] = useState(68);
  // Measured height of the gathering-point carousel card strip (for camera
  // centering into the visible band between carousel and sheet).
  const [carouselHeight, setCarouselHeight] = useState(0);
  const detents = useMemo(() => {
    // Full fills the screen flush, leaving only the status bar.
    const peek = sheetHeaderH;
    const full = windowHeight - insets.top - 6;
    const mid = Math.round(full * 0.55);
    return [peek, mid, full];
  }, [insets.top, windowHeight, sheetHeaderH]);
  const heightSV = useSharedValue(detents[0]);
  const [detent, setDetent] = useState(0);
  /** Mid/Full sheet body: 成員 · 路線 · 工具 · 商店. */
  const [selectedSection, setSelectedSection] = useState<SheetPaneKey>('members');
  /** Store deep-link product highlight (e.g. locked Live Activity → store). */
  const [storeHighlightProduct, setStoreHighlightProduct] = useState<string | null>(null);
  /** Server-effective Live Activity entitlement (personal OR team Premium). */
  const [liveActivityEffective, setLiveActivityEffective] = useState(false);
  /** Team extra gathering-point credits remaining (route UI when > 0). */
  const [extraPointCredits, setExtraPointCredits] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paywallPendingAfterSettings, setPaywallPendingAfterSettings] = useState(false);
  const [purchaseUnlocking, setPurchaseUnlocking] = useState(false);
  const [overlay, setOverlay] = useState<
    null
    | 'route'
    | 'settings'
    | 'profile'
    | 'feedback'
    | 'history'
    | 'account'
    | 'custom'
    | 'invite'
    | 'commands'
    | 'arrivalManage'
    | 'arrival'
    | 'ops'
  >(null);
  const [editButtonActive, setEditButtonActive] = useState(false);
  useEffect(() => {
    setEditButtonActive(false);
  }, [myScopeId]);
  const [arrivalDestination, setArrivalDestination] = useState<Destination | null>(null);
  /** Which custom quick-command slot the editor is targeting. */
  const [customSlot, setCustomSlot] = useState(0);
  const {
    historyGroups,
    loadHistory,
  } = useVisitHistory({
    allScopedDestinations,
    arrivalOperations,
    destinationArrivals,
    group,
    groupId,
    isLeader,
    members,
    overlay,
    routeDepartureDate,
    routeTripDays,
    user,
  });
  // "Invite a teammate" picker, opened from my own subgroup card.
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  /** Resolves Amicro search Promise when OverlaySheet open animation completes. */
  const searchOpenCompleteResolveRef = useRef<(() => void) | null>(null);
  // A place picked in search, awaiting the bottom "add / cancel" confirm card.
  const [pendingPlace, setPendingPlace] = useState<PlaceResult | null>(null);
  const [favoritePlaces, setFavoritePlaces] = useState<FavoritePlace[]>([]);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [confirmPlaceBusy, setConfirmPlaceBusy] = useState(false);
  const confirmPlaceBusyRef = useRef(false);
  const [addPlaceTourStep, setAddPlaceTourStep] = useState<number | null>(null);
  const [addPlaceTourLocalDone, setAddPlaceTourLocalDone] = useState(true);
  const [addPlaceTourTargetRect, setAddPlaceTourTargetRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [addPlaceTourTransitioning, setAddPlaceTourTransitioning] = useState(false);
  const addPlaceTourGenerationRef = useRef(0);
  /** Distinguishes long-press vs search for post-add camera (ticket 06). */
  const pendingPlaceSourceRef = useRef<'search' | 'longpress' | null>(null);
  // Editable only during this add confirmation. There is no later rename
  // action, so the persisted itinerary title stays stable after creation.
  // Single draft owned by pending place flow (inline TextInput — no Modal).
  const [pendingPlaceTitle, setPendingPlaceTitle] = useState('');
  // Two-phase flow: pendingPlace is set immediately when a place is picked
  // (so the search sheet can close and the bottom sheet collapses to peek).
  // confirmCardReady flips true instantly — then the bounce-up
  // card appears and the search bar / recenter capsule hide.
  /** Keyboard height while confirm card is up — lifts card with 12pt gap. */
  const [confirmKeyboardHeight, setConfirmKeyboardHeight] = useState(0);
  const [kmlVisible, setKmlVisible] = useState(false);
  const [kmlScopeId, setKmlScopeId] = useState<string | undefined>(myScopeId);
  useEffect(() => {
    setKmlScopeId(myScopeId);
  }, [myScopeId]);
  const [kmlRemainingQuota, setKmlRemainingQuota] = useState<number | undefined>();
  const kmlScopedDestinations = useMemo(
    () => (state?.destinations ?? []).filter((destination) => (
      kmlScopeId ? destination.subgroupId === kmlScopeId : destination.subgroupId == null
    )),
    [kmlScopeId, state?.destinations],
  );
  const [coordSheetVisible, setCoordSheetVisible] = useState(false);
  const [coordSheetInitial, setCoordSheetInitial] = useState<
    { latitude: number; longitude: number } | undefined
  >(undefined);
  // Bounce-up entrance animation for the add-gather-point confirm card.
  const { ready: confirmCardReady, progress: confirmCardAnim } = usePendingPlaceEntrance(pendingPlace, uiVisible, heightSV);
  const confirmCardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(confirmCardAnim.value, [0, 1], [120, 0], Extrapolation.CLAMP) },
      { scale: interpolate(confirmCardAnim.value, [0, 1], [0.96, 1], Extrapolation.CLAMP) },
    ],
  }));

  const refreshKmlQuota = useCallback(async () => {
    if (!user?.id || isPro) {
      setKmlRemainingQuota(undefined);
      return;
    }
    try {
      setKmlRemainingQuota(await getKmlImportQuota());
    } catch {
      // The server remains authoritative; leave the preview fallback visible.
      setKmlRemainingQuota(undefined);
    }
  }, [isPro, user?.id]);

  useEffect(() => {
    void refreshKmlQuota();
  }, [refreshKmlQuota]);

  // Keyboard inset for absolute confirm card (12pt gap; restore on dismiss).
  useEffect(() => {
    if (!confirmCardReady) {
      setConfirmKeyboardHeight(0);
      return;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setConfirmKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setConfirmKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [confirmCardReady]);

  // Load account favorites once per signed-in session (cross-team reuse).
  useEffect(() => {
    if (!user?.id) {
      setFavoritePlaces([]);
      return;
    }
    let cancelled = false;
    void listFavoritePlaces()
      .then((rows) => {
        if (!cancelled) setFavoritePlaces(rows);
      })
      .catch(() => {
        if (!cancelled) setFavoritePlaces([]);
      });
    void readAddPlaceTourCompletedLocal(user?.id).then((done) => {
      if (!cancelled) setAddPlaceTourLocalDone(done);
    });
    // Retry account completion sync left pending after a prior profile write failure.
    void retryPendingAddPlaceTourAccountSync({
      accountId: user.id,
      existingPreferences: user.preferences ?? null,
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Start only after BOTH star and center targets measure non-zero rects.
  useEffect(() => {
    const generation = ++addPlaceTourGenerationRef.current;
    if (!confirmCardReady || !pendingPlace) {
      setAddPlaceTourStep(null);
      setAddPlaceTourTargetRect(null);
      setAddPlaceTourTransitioning(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setAddPlaceTourTransitioning(true);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, ADD_PLACE_TOUR_SETTLE_MS);
      });
      if (cancelled) return;
      const starRect = await measureTargetWithRetry({
        measure: measureTourTarget,
        target: 'addPlaceFavoriteStar',
      });
      if (cancelled || generation !== addPlaceTourGenerationRef.current) return;
      const centerRect = await measureTargetWithRetry({
        measure: measureTourTarget,
        target: 'addPlaceCenter',
      });
      if (cancelled || generation !== addPlaceTourGenerationRef.current) return;
      const targetsReady = areAddPlaceTourTargetsReady({ starRect, centerRect });
      if (
        shouldStartAddPlaceTour({
          pendingPlaceVisible: true,
          targetsReady,
          localCompleted: addPlaceTourLocalDone,
          accountPreferences: user?.preferences ?? null,
        })
      ) {
        setAddPlaceTourStep(0);
        setAddPlaceTourTargetRect(starRect);
      }
      if (generation === addPlaceTourGenerationRef.current) {
        setAddPlaceTourTransitioning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    confirmCardReady,
    pendingPlace,
    addPlaceTourLocalDone,
    user?.preferences,
    measureTourTarget,
  ]);

  // Remeasure highlight when the Add Place tour step advances or keyboard
  // moves the confirm card. Never clobber a good hole with null — only accept
  // non-zero rects. Step 0 always measures star (never Add/center fallback).
  useEffect(() => {
    if (addPlaceTourStep == null) {
      setAddPlaceTourTargetRect(null);
      return;
    }
    const step = ADD_PLACE_TOUR_STEPS[addPlaceTourStep];
    if (!step) return;
    let cancelled = false;
    const generation = ++addPlaceTourGenerationRef.current;
    setAddPlaceTourTransitioning(true);
    void (async () => {
      const rect = await measureTargetWithRetry({
        measure: measureTourTarget,
        target: step.target,
      });
      if (cancelled || generation !== addPlaceTourGenerationRef.current) return;
      if (isMeasuredTourRect(rect)) {
        setAddPlaceTourTargetRect(rect);
      }
      setAddPlaceTourTransitioning(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [addPlaceTourStep, measureTourTarget, confirmKeyboardHeight]);

  const pendingIsFavorite = useMemo(() => {
    if (!pendingPlace) return false;
    return Boolean(
      findFavoriteByExactMatch(
        favoritePlaces,
        pendingPlaceTitle || pendingPlace.name,
        pendingPlace.coordinates,
      ),
    );
  }, [pendingPlace, pendingPlaceTitle, favoritePlaces]);

  const togglePendingFavorite = useCallback(async () => {
    if (!pendingPlace || !user?.id || favoriteBusy) return;
    const title = pendingPlaceTitle.trim() || pendingPlace.name;
    const wasFavorite = pendingIsFavorite;
    const coords = pendingPlace.coordinates;
    const address = pendingPlace.address;
    // Optimistic UI: flip star immediately, network in background.
    selectionTick();
    const snapshot = favoritePlaces;
    if (wasFavorite) {
      setFavoritePlaces((prev) =>
        prev.filter(
          (f) =>
            !(
              f.title === title
              && Math.abs(f.coordinates.latitude - coords.latitude) < 1e-5
              && Math.abs(f.coordinates.longitude - coords.longitude) < 1e-5
            ),
        ),
      );
    } else {
      const optimistic: FavoritePlace = {
        id: `draft-fav-${Date.now()}`,
        userId: user.id,
        title,
        address,
        coordinates: coords,
      };
      setFavoritePlaces((prev) => [...prev, optimistic]);
    }
    setFavoriteBusy(true);
    try {
      if (wasFavorite) {
        await unsaveFavoriteByExactMatch(title, coords);
      } else {
        await saveFavoritePlace({
          title,
          address,
          coordinates: coords,
        });
      }
      // Reconcile with server ids when available.
      setFavoritePlaces(await listFavoritePlaces());
    } catch {
      // Rollback optimistic flip.
      setFavoritePlaces(snapshot);
    } finally {
      setFavoriteBusy(false);
    }
  }, [
    pendingPlace,
    pendingPlaceTitle,
    user?.id,
    favoriteBusy,
    pendingIsFavorite,
    favoritePlaces,
  ]);

  /** Dismiss the confirm card (used by both Cancel and Add buttons). */
  function dismissConfirmCard() {
    setPendingPlace(null);
    setPendingPlaceTitle('');
    setConfirmKeyboardHeight(0);
    pendingPlaceSourceRef.current = null;
  }

  const [paywallTrigger, setPaywallTrigger] = useState<TranslationKey | undefined>(undefined);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallShowRestore, setPaywallShowRestore] = useState(true);
  const openPaywall = useCallback((trigger?: TranslationKey, opts?: { showRestore?: boolean }) => {
    setPaywallTrigger(trigger);
    setPaywallShowRestore(opts?.showRestore ?? true);
    setPaywallVisible(true);
  }, []);

  // --- Meet-time countdown + editor (date + time; red threshold shared via DB)
  const {
    meetTimeEditor,
    setMeetTimeEditor,
    persistMeetTime,
    openMeetTimePicker,
    openAndroidMeetDate,
  } = useMeetTimeEditor({
    destinations,
    departureDate: group?.departureDate,
    canEditItinerary,
    meetRedMin,
    setMeetRedMin,
    refresh,
    showOperationFailure,
    t,
  });
  // Freeze the route overlay's scroll while a stop is being drag-reordered so
  // the two vertical gestures never fight. Auto-scroll still works via ref.
  const [routeDragPreview, setRouteDragPreview] = useState<React.ReactNode>(null);
  const [routeScrollEnabled, setRouteScrollEnabled] = useState(true);
  const [routeOverlayOpenComplete, setRouteOverlayOpenComplete] = useState(false);
  const routeScrollRef = useRef<ScrollView>(null);
  const routeScrollYRef = useRef(0);
  const routeScrollViewportHeightRef = useRef(0);
  const handleRouteDragAutoScroll = useCallback((deltaY: number) => {
    const nextY = Math.max(0, routeScrollYRef.current + deltaY);
    routeScrollYRef.current = nextY;
    routeScrollRef.current?.scrollTo({ y: nextY, animated: false });
  }, []);

  const routeGatheringPointCount = useMemo(
    () => openForRouteEditor.filter((destination) => destination.kind !== 'accommodation').length,
    [openForRouteEditor],
  );
  const scrollRouteTourTarget = useCallback(async (target: string): Promise<void> => {
    const settleRouteScroll = () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    // The route sheet owns the scroll container.  A zero scroll exposes the
    // header/top actions; accommodation is measured against the route viewport.
    if (target === 'routeMode' || target === 'routeDate' || target === 'routeTripDetails'
      || target === 'routeFavorites' || target === 'routeImport') {
      routeScrollYRef.current = 0;
      routeScrollRef.current?.scrollTo({ y: 0, animated: false });
      await settleRouteScroll();
      return;
    }
    if (target === 'routeAccommodation') {
      const targetNode = tourTargetRefs.current.routeAccommodation;
      const scrollNode = routeScrollRef.current;
      if (!targetNode || !scrollNode) return;
      const measureInWindow = (node: unknown) => new Promise<{
        y: number;
        height: number;
      } | null>((resolve) => {
        const measurable = node as {
          measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
        };
        if (typeof measurable.measureInWindow !== 'function') {
          resolve(null);
          return;
        }
        measurable.measureInWindow((_x, y, _width, height) => resolve({ y, height }));
      });
      const [targetRect, containerRect] = await Promise.all([
        measureInWindow(targetNode),
        measureInWindow(scrollNode),
      ]);
      if (!targetRect || !containerRect) return;
      const nextY = routeTourScrollOffset({
        currentOffset: routeScrollYRef.current,
        targetPageY: targetRect.y,
        targetHeight: targetRect.height,
        containerPageY: containerRect.y,
        viewportHeight: routeScrollViewportHeightRef.current || containerRect.height,
      });
      routeScrollYRef.current = nextY;
      scrollNode.scrollTo({ y: nextY, animated: false });
      await settleRouteScroll();
    }
  }, []);
  const {
    tourActive: routeTourActive,
    step: routeTourStep,
    targetRect: routeTourTargetRect,
    onNext: onRouteTourNext,
    onPrev: onRouteTourPrev,
    canGoPrev: routeTourCanGoPrev,
    transitioning: routeTourTransitioning,
    completing: routeTourCompleting,
    reevaluate: reevaluateRouteTour,
  } = useRouteReorderTour({
    routeOverlayOpenComplete,
    isLeader: !!isLeader,
    canEditItinerary,
    gatheringPointCount: routeGatheringPointCount,
    accountId: user?.id ?? null,
    accountPreferences: user?.preferences ?? null,
    measureTarget: measureTourTarget,
    scrollToTarget: scrollRouteTourTarget,
  });

  // #154: each route-sheet open silently syncs once (ref survives Strict Mode remount).
  // Generation invalidates in-flight completions after close/reopen (#151 Sol P1).
  const routeOpenSyncSessionRef = useRef<'idle' | 'started' | 'done'>('idle');
  const routeOpenSyncGenerationRef = useRef(0);
  /** Route list interaction: drag handles / multi-select / hidden (default drag). */
  const [routeInteractionMode, setRouteInteractionMode] = useState<
    'drag' | 'select' | 'none'
  >('drag');
  const [routeSelectedIds, setRouteSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    if (overlay !== 'route') {
      routeOpenSyncGenerationRef.current += 1;
      routeOpenSyncSessionRef.current = 'idle';
      // Reset list chrome when leaving the sheet.
      setRouteInteractionMode('drag');
      setRouteSelectedIds([]);
      return;
    }
    if (routeOpenSyncSessionRef.current !== 'idle') return;
    routeOpenSyncSessionRef.current = 'started';
    const generation = routeOpenSyncGenerationRef.current;
    void syncFromDatabase().finally(() => {
      if (generation === routeOpenSyncGenerationRef.current) routeOpenSyncSessionRef.current = 'done';
    });
  }, [overlay, syncFromDatabase]);

  const incomingArrivalHandlerRef = useRef<() => void>(() => undefined);
  // --- Carousel selection ---------------------------------------------------
  const {
    selectedIndex,
    setSelectedIndex,
    travelMode,
    setTravelMode,
    selectedDestination,
    handleScrollBeginDrag,
    handleMomentumEnd,
  } = useCarouselSelection({
    destinations,
    windowWidth,
    carouselRef,
    mapRef,
    obliqueLocate,
  });

  // --- Journey navigation + Live Activity ----------------------------------
  // Device location depends on navigation's power policy and is declared below.
  // Commands read this bridge at tap time, after the current render has settled.
  const navigationOriginRef = useRef<Coordinates | undefined>(undefined);
  const getNavigationOrigin = useCallback(() => navigationOriginRef.current, []);
  const {
    navigationStoppedLocally,
    journeyActive,
    navTarget,
    navTargetId,
    sharedTargetId,
    pendingLeaderTargetId,
    activePoint,
    journeyBusy,
    openExternalNavigation,
    startNavigation,
    requestTeamEnd,
    stopNavigation,
    stopRemovedDestination,
    refreshStartFrame,
  } = useJourneyNavigation({
    state,
    actorId: user?.id,
    groupId,
    // The command lane is scoped: a subgroup leader may start/end only their
    // subgroup session, using the scoped destination list below.
    isLeader: canEditItinerary,
    destinations,
    navigationDestinations: destinations,
    reorderDestinations: allScopedDestinations,
    selectedDestination,
    fromCoords: undefined,
    getFromCoords: getNavigationOrigin,
    refresh,
    t,
    mapRef,
    carouselRef,
    setSelectedIndex,
    onOperatorStartConfirm: (dest, eventId) => {
      const fix = latestLocationSampleRef.current;
      if (fix && canEvaluateSynchronizedArrival({ sampledAt: fix.timestamp,
        now: Date.now(), accuracyM: fix.accuracy, radiusM: localArrivalRadiusM })
        && distanceMeters(fix.coordinates, dest.coordinates) <= localArrivalRadiusM) return;
      void notifyJourneyOperator('start', dest.id, eventId, t).catch(() => undefined);
    },
    onOperatorPauseConfirm: (dest, eventId) => {
      void notifyJourneyOperator('pause', dest.id, eventId, t).catch(() => undefined);
    },
    onLocalSessionIdChange: setLocalNavigationSessionId,
    // Prefer live session. Only fall back to legacy journey_status while the
    // first fetch is still in flight (undefined), so a cold-start member still
    // enters flock nav as soon as the active session row is available.
    navigationSession: navigationSessionState.loading
      && !navigationSessionState.session
      ? undefined
      : navigationSessionState.session,
    startSession: navigationSessionState.start,
    cancelSession: navigationSessionState.cancel,
    refreshNavigationSession: navigationSessionState.refresh,
    travelMode,
    onOptimisticGathering: applyOptimisticGathering,
    hasPendingTeamOperation: openOperations.some(op => op.entityType === 'active_gathering'
      && (op.actorId ?? op.payload.actorId) === user?.id && op.status !== 'conflict'),
  });

  const effectiveNavigationActive = Boolean(journeyActive && navTarget && !navigationStoppedLocally);
  const foregroundLocation = foregroundLocationConfiguration({
    navigationActive: effectiveNavigationActive, nativeMapAvailable: Platform.OS === 'ios' && mapFocused,
    highAccuracy, sharingEnabled: preferencesReady && sharingEnabled,
    hasMembership: members.some(member => member.userId === user?.id), appState: AppState.currentState,
  });
  const {
    deviceCoords,
    deviceAccuracyM,
    deviceCoordsAcceptedAtMs,
    appState,
    refreshDeviceLocation,
    consumeForegroundSample,
    latestLocationSampleRef,
  } = useDeviceLocation({
    groupId: mapFocused || effectiveNavigationActive ? groupId : null,
    highAccuracy: foregroundLocation.highAccuracy,
    powerMode: foregroundLocation.powerMode,
    teamNavigationActive: effectiveNavigationActive,
    nativeMapLocationEnabled: foregroundLocation.owner === 'mapkit',
    sharingEnabled: preferencesReady && sharingEnabled,
    hasMembership: (mapFocused || effectiveNavigationActive) && members.some(m => m.userId === user?.id),
    onIncomingSample: () => incomingArrivalHandlerRef.current(),
  });
  navigationOriginRef.current = deviceCoords ?? undefined;
  useEffect(() => {
    if (deviceCoords) refreshStartFrame();
  }, [deviceCoords, refreshStartFrame]);

  const reference = useMemo<MemberLocation | undefined>(
    () =>
      members.find((m) => m.userId === user?.id) ??
      members.find((m) => m.role === 'leader') ??
      members[0],
    [members, user?.id],
  );
  const fromCoords = deviceCoords ?? reference?.coordinates ?? undefined;
  const numericDistance = fromCoords && navTarget ? distanceMeters(fromCoords, navTarget.coordinates) : undefined;

  // Lock MapView initialRegion to the first available center so GPS churn
  // does not rewrite GroupMap prop identity on every sample.
  const [mapInitialCenter, setMapInitialCenter] = useState<Coordinates | null>(
    fromCoords ?? null,
  );
  useEffect(() => {
    if (!fromCoords) return;
    setMapInitialCenter((current) => current ?? fromCoords);
  }, [fromCoords]);

  // OTA-01: single authoritative team gathering projection for map / broadcast /
  // notification / passive surfaces. Personal ETA/mode/progress never write here.
  // Prefer live session; do not invent a synthetic active session from sharedTargetId
  // alone when session status is already terminal (avoids false en_route after End).
  const teamGatheringState = useMemo(
    () =>
      projectTeamGatheringState({
        journeyStatus: state?.group.journeyStatus,
        activeDestinationId: state?.group.activeDestinationId,
        journeyStartedAt: state?.group.journeyStartedAt,
        navigationSession: navigationSessionState.session
          ? {
              destinationId: navigationSessionState.session.destinationId,
              status: navigationSessionState.session.status,
              version: navigationSessionState.session.version,
              startedAt: navigationSessionState.session.startedAt,
            }
          : navigationSessionState.loading && sharedTargetId
            ? {
                // Optimistic path only while first session fetch is in flight.
                destinationId: sharedTargetId,
                status: 'active',
                version: 0,
                startedAt: state?.group.journeyStartedAt,
              }
            : null,
        destinations: destinations.map((d) => ({
          id: d.id,
          order: d.order,
          closedAt: d.closedAt,
        })),
      }),
    [
      destinations,
      navigationSessionState.loading,
      navigationSessionState.session,
      sharedTargetId,
      state?.group.activeDestinationId,
      state?.group.journeyStartedAt,
      state?.group.journeyStatus,
    ],
  );

  const navigationAckRef = useRef<string | null>(null);
  const privacyHydratedUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!preferencesReady || !user?.id || privacyHydratedUserRef.current === user.id) {
      return;
    }
    privacyHydratedUserRef.current = user.id;
    let cancelled = false;
    void hydrateLocationSharing(user.id)
      .then((enabled) => { if (!cancelled && enabled != null) setSharingEnabled(enabled); })
      .catch(() => {
        privacyHydratedUserRef.current = null;
      });
    return () => { cancelled = true; };
  }, [preferencesReady, setSharingEnabled, user?.id]);

  const [sharingApplying, setSharingApplying] = useState(false);
  const handleSharingEnabledChange = useCallback(async (enabled: boolean) => {
    if (!user?.id) return false;
    if (enabled) {
      await AsyncStorage.removeItem('pref.journeyBackgroundExplained');
      const granted = await requestLocationPermission();
      if (!granted) return false;
    }
    setSharingEnabled(enabled);
    const pendingWrite = rememberLocationSharing(user.id, enabled).then(() => null, error => error);
    if (!enabled) {
      await stopBackgroundJourney(true).catch(() => undefined);
      await purgeLocationOutbox().catch(() => undefined);
      if (navigationSessionState.session) {
        await navigationSessionState.ack('sharing_disabled', {
          source: 'settings_privacy_switch',
        }).catch(() => undefined);
      }
    }
    try {
      const writeError = await pendingWrite;
      if (writeError) throw writeError;
      await syncLocationSharing(user.id);
      return true;
    } catch {
      await diagnostics.write({
        event: 'diagnostic_error',
        errorCode: 'privacy_sync_failed',
        success: false,
      }).catch(() => undefined);
      // Local consent wins while offline; recovery retries the durable intent.
      Alert.alert(t('settings.locationSharingSyncFailed'));
      return false;
    }
  }, [setSharingEnabled, navigationSessionState, user?.id, t]);
  const handleSharingEnabledChangeAnimated = useCallback(() => {
    if (sharingApplying) return;
    const nextEnabled = !sharingEnabled;
    const copy = locationSharingConfirmCopy(nextEnabled);
    confirmAction({
      title: t(copy.titleKey),
      message: t(copy.bodyKey),
      destructive: copy.destructive,
    }, () => {
      void (async () => {
        setSharingApplying(true);
        try {
          await handleSharingEnabledChange(nextEnabled);
        } finally {
          setSharingApplying(false);
        }
      })();
    });
  }, [handleSharingEnabledChange, sharingApplying, sharingEnabled, t]);

  useEffect(() => {
    if (isLeader || !navigationSessionState.session) {
      navigationAckRef.current = null;
      return;
    }
    const key = `${navigationSessionState.session.id}:${sharingEnabled ? 'tracking' : 'disabled'}`;
    if (navigationAckRef.current === key) return;
    navigationAckRef.current = key;
    void navigationSessionState.ack(
      sharingEnabled ? 'tracking_active' : 'sharing_disabled',
      { source: 'foreground_session_effect' },
    ).catch(() => {
      navigationAckRef.current = null;
    });
  }, [isLeader, navigationSessionState, sharingEnabled]);

  // Prefer local prefs (available before inPassiveMode is derived below) so
  // passive mode can skip MapKit work without a temporal dead zone.
  const mapRoutesEnabled = effectiveNavigationActive && !(preferencesReady && passiveCompanionMode);
  const { selfRoute, memberRoutes, selfRouteGeneration } = useMapKitRoutes({
    selfCoordinates: fromCoords,
    members: [], // Member routes are already disabled by this hook; no peer-coordinate cloning.
    gathering: mapRoutesEnabled ? activePoint : null,
    travelMode,
    highAccuracy: mapRoutesEnabled ? highAccuracy : false,
  });

  // Foreground arrival: tools slider is the product geofence (30/50/100/300).
  // Session rows default to 50 m and must not shrink a user-chosen 300 m.
  const localArrivalRadiusM = Math.max(
    ARRIVAL_RADIUS_MIN_M,
    Math.min(ARRIVAL_RADIUS_MAX_M, arrivalRadiusM),
  );
  const foregroundArrivalRef = useRef<{ key: string; state: ArrivalState; sampledAtMs: number | null } | null>(null);
  const foregroundAckRef = useRef<string | null>(null);
  const autoArrivalMarkedRef = useRef<string | null>(null);
  const arrivalFeedbackShownRef = useRef<string | null>(null);
  /** In-flight complete-stop dest ids — ignore re-entry until settled (SUG-2). */
  const completingDestIdsRef = useRef<Set<string>>(new Set());
  /**
   * Dest ids we already auto-completed (or started) from remote all-arrived —
   * prevents effect re-fire storms. Cleared on failure so retry is possible.
   */
  const remoteAutoCompleteDestIdsRef = useRef<Set<string>>(new Set());
  const arrivalSplitSeenRef = useRef<Set<string>>(new Set());
  const [arrivalCelebrateDestId, setArrivalCelebrateDestId] = useState<string | null>(null);
  const [requestingStartDestId, setRequestingStartDestId] = useState<string | null>(null);

  /** #149: after stop completes (closedAt), hold effect 3.2s then 440ms card exit. */
  const startArrivalCardExit = useCallback((
    destination: Destination,
    indexAtStart = 0,
  ) => {
    if (!isForegroundUi()) return;
    const started = beginArrivalCardExit(
      arrivalExitRecordsRef.current,
      destination.id,
      Date.now(),
      indexAtStart,
    );
    if (!started) return; // idempotent — no double exit / ghost
    setArrivalExitRecords((prev) => {
      const next = new Map(prev);
      next.set(destination.id, started);
      return next;
    });
    setArrivalExitSnapshots((prev) => {
      const next = new Map(prev);
      next.set(destination.id, destination);
      return next;
    });
    // Cancel personal-arrival 1.6s clear so it cannot truncate the 3.2s hold (#149).
    cancelCelebrateClearTimer(celebrateClearTimersRef.current, destination.id);
    setArrivalCelebrateDestId(destination.id);
    armCelebrateClearTimer(
      celebrateClearTimersRef.current,
      destination.id,
      ARRIVAL_EFFECT_HOLD_MS,
      () => {
        setArrivalCelebrateDestId((cur) => (cur === destination.id ? null : cur));
      },
    );

    const clearTimers = () => {
      const list = arrivalExitTimersRef.current.get(destination.id);
      if (list) {
        for (const t of list) clearTimeout(t);
        arrivalExitTimersRef.current.delete(destination.id);
      }
    };
    clearTimers();
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(
      setTimeout(() => {
        setArrivalExitRecords((prev) => {
          const cur = prev.get(destination.id);
          if (!cur) return prev;
          const next = new Map(prev);
          next.set(destination.id, { ...cur, phase: 'exit' });
          return next;
        });
      }, ARRIVAL_EFFECT_HOLD_MS),
    );
    timers.push(
      setTimeout(() => {
        setArrivalExitRecords((prev) => {
          const next = new Map(prev);
          next.delete(destination.id);
          return next;
        });
        setArrivalExitSnapshots((prev) => {
          const next = new Map(prev);
          next.delete(destination.id);
          return next;
        });
        arrivalExitTimersRef.current.delete(destination.id);
      }, ARRIVAL_EFFECT_HOLD_MS + ARRIVAL_CARD_EXIT_MS),
    );
    arrivalExitTimersRef.current.set(destination.id, timers);
  }, []);

  // Detect newly completed stops → start hold/exit (not historical closed on mount).
  const knownClosedDestIdsRef = useRef<Set<string> | null>(null);
  /**
   * Full visible carousel order (open + hold/exit). Open-only ranks collide when
   * a second card closes while the first is still exiting (#149 Sol r3).
   */
  useEffect(() => {
    const closedNow = allScopedDestinations.filter((d) => d.closedAt != null);
    if (arrivalExitContextRef.current !== arrivalExitContext) {
      arrivalExitContextRef.current = arrivalExitContext;
      for (const timers of arrivalExitTimersRef.current.values()) for (const timer of timers) clearTimeout(timer);
      arrivalExitTimersRef.current.clear();
      clearAllCelebrateClearTimers(celebrateClearTimersRef.current);
      setArrivalExitRecords(new Map());
      setArrivalExitSnapshots(new Map());
      setArrivalCelebrateDestId(null);
      knownClosedDestIdsRef.current = null;
      remoteAutoCompleteDestIdsRef.current.clear();
    }
    if (!state || state.group.id !== groupId || loading) {
      knownClosedDestIdsRef.current = null;
      prevVisibleDestOrderRef.current = [];
      return;
    }
    if (!uiVisible) {
      knownClosedDestIdsRef.current = new Set(closedNow.map(d => d.id));
      prevVisibleDestOrderRef.current = openDestinations.map(d => d.id);
      return;
    }
    if (knownClosedDestIdsRef.current == null) {
      // First paint: seed known closed so past history does not animate out.
      knownClosedDestIdsRef.current = new Set(closedNow.map((d) => d.id));
      prevVisibleDestOrderRef.current = openDestinations.map((d) => d.id);
      return;
    }
    for (const id of knownClosedDestIdsRef.current) {
      if (closedNow.some(d => d.id === id)) continue;
      knownClosedDestIdsRef.current.delete(id);
      for (const timer of arrivalExitTimersRef.current.get(id) ?? []) clearTimeout(timer);
      arrivalExitTimersRef.current.delete(id);
      cancelCelebrateClearTimer(celebrateClearTimersRef.current, id);
      setArrivalCelebrateDestId(cur => cur === id ? null : cur);
      setArrivalExitRecords(prev => { const next = new Map(prev); next.delete(id); return next; });
      setArrivalExitSnapshots(prev => { const next = new Map(prev); next.delete(id); return next; });
    }
    const newlyStarted: string[] = [];
    for (const dest of newlyCompletedVisibleCards(closedNow, knownClosedDestIdsRef.current,
      prevVisibleDestOrderRef.current, true)) {
      knownClosedDestIdsRef.current.add(dest.id);
      const priorIdx = resolveExitIndexAtStart(
        prevVisibleDestOrderRef.current,
        dest.id,
        prevVisibleDestOrderRef.current.length,
      );
      startArrivalCardExit(dest, priorIdx);
      newlyStarted.push(dest.id);
    }
    knownClosedDestIdsRef.current = new Set(closedNow.map(destination => destination.id));
    const exitingIds = new Set<string>([
      ...arrivalExitRecords.keys(),
      ...newlyStarted,
    ]);
    // Keep exiting cards ranked until their record is removed (exit complete).
    prevVisibleDestOrderRef.current = nextVisibleCarouselOrder(
      prevVisibleDestOrderRef.current,
      openDestinations.map((d) => d.id),
      [...exitingIds],
    );
  }, [
    uiVisible,
    allScopedDestinations,
    openDestinations,
    startArrivalCardExit,
    arrivalExitRecords,
    arrivalExitContext,
    groupId,
    loading,
    state,
  ]);

  useEffect(() => {
    if (!uiVisible) {
      setArrivalExitRecords(new Map());
      setArrivalExitSnapshots(new Map());
      setArrivalCelebrateDestId(null);
    }
    return () => {
      for (const timers of arrivalExitTimersRef.current.values()) {
        for (const t of timers) clearTimeout(t);
      }
      arrivalExitTimersRef.current.clear();
      clearAllCelebrateClearTimers(celebrateClearTimersRef.current);
    };
  }, [uiVisible]);

  // Wired after promptCompleteAfterArrival is defined (see below).
  const afterPersonalArrivalRef = useRef<
    (destination: Destination, opts?: { promptComplete?: boolean }) => void
  >(() => undefined);


  const arrivalSubmitInFlight = useRef(new Set<string>());
  /** Manual undo suppresses auto-arrival until the member leaves and re-enters. */
  const manualUndoSuppressedRef = useRef(new Map<string, BackgroundManualUndoMarker>());
  const automaticArrivalRetryAt = useRef(0);
  /**
   * Resolve the session for the current destination/scope once, and reuse it
   * for arrivals, undo, completion, and any terminal command.  A local Start
   * alias is intentionally preferred while it is present: the server may
   * still expose the previous session for the same destination during an
   * offline restart.  useJourneyNavigation clears that alias after the Start
   * is acknowledged or settled, allowing a later remote session to win.
   */
  const resolveCurrentNavigationSessionId = useCallback((destination: Destination): string | null => {
    // A Start tap is visible before its local receipt/session alias commits.
    // Do not bind arrivals to the previous local/server session in that gap.
    if (journeyBusy && pendingLeaderTargetId === destination.id) return null;
    if (localNavigationSessionId && navTarget?.id === destination.id) {
      return localNavigationSessionId;
    }
    const session = navigationSessionState.session;
    if (session?.status === 'active'
      && session.destinationId === destination.id
      && (session.scopeSubgroupId ?? null) === (destination.subgroupId ?? null)) {
      return session.id;
    }
    return null;
  }, [localNavigationSessionId, navTarget?.id, journeyBusy, pendingLeaderTargetId, navigationSessionState.session]);
  // Prefer the local Start operation as the stable identity while its server
  // session alias is hydrating; adding the server id must not reset an undo
  // suppression inside the same trip.
  const arrivalSessionKey = navTarget
    ? resolveCurrentNavigationSessionId(navTarget) ?? 'local'
    : localNavigationSessionId ?? navigationSessionId ?? 'local';
  const arrivalContext = `${groupId ?? ''}:${user?.id ?? ''}:${myScopeId ?? 'main'}:${arrivalSessionKey}`;
  const arrivalContextRef = useRef(arrivalContext);
  arrivalContextRef.current = arrivalContext;
  const foregroundUndoHydrationRef = useRef<{ key: string; pending: boolean }>({ key: '', pending: false });
  const foregroundUndoHydrationSequenceRef = useRef(0);
  const foregroundUndoMutationSequenceRef = useRef(0);
  const currentArrivalNavigationSessionId = navTarget
    ? resolveCurrentNavigationSessionId(navTarget)
    : null;
  // Include the destination separately from arrivalContext: a local route
  // can change cards before a server session id exists.
  const foregroundUndoHydrationKey = `${arrivalContext}:${navTarget?.id ?? ''}:${currentArrivalNavigationSessionId ?? ''}`;
  useEffect(() => {
    foregroundArrivalRef.current = null;
    foregroundAckRef.current = null;
    autoArrivalMarkedRef.current = null;
    automaticArrivalRetryAt.current = 0;
    arrivalFeedbackShownRef.current = null;
    manualUndoSuppressedRef.current.clear();
    foregroundUndoHydrationRef.current = {
      key: foregroundUndoHydrationKey,
      pending: Boolean(groupId && user?.id && navTarget?.id && currentArrivalNavigationSessionId),
    };
    setArrivalCelebrateDestId(null);
  }, [arrivalContext, currentArrivalNavigationSessionId, foregroundUndoHydrationKey, groupId, navTarget?.id, user?.id]);
  useEffect(() => {
    const actorId = user?.id;
    const destinationId = navTarget?.id;
    const sessionId = currentArrivalNavigationSessionId;
    const hydrationKey = foregroundUndoHydrationKey;
    const suppressionKey = `${arrivalSessionKey}:${destinationId ?? ''}:${actorId ?? ''}`;
    const generation = ++foregroundUndoHydrationSequenceRef.current;
    const mutationAtStart = foregroundUndoMutationSequenceRef.current;
    if (!groupId || !actorId || !destinationId || !sessionId) {
      foregroundUndoHydrationRef.current = { key: hydrationKey, pending: false };
      return;
    }
    foregroundUndoHydrationRef.current = { key: hydrationKey, pending: true };
    let cancelled = false;
    const finishHydration = (marker: BackgroundManualUndoMarker | null) => {
      if (cancelled
        || generation !== foregroundUndoHydrationSequenceRef.current
        || foregroundUndoHydrationRef.current.key !== hydrationKey) return;
      // A tap can create or release an undo while the AsyncStorage read is
      // in flight. Never let that older read overwrite the newer in-memory
      // intent; the next outbox/store update will hydrate it again.
      const hasNewerForegroundMutation = foregroundUndoMutationSequenceRef.current !== mutationAtStart;
      if (hasNewerForegroundMutation) {
        foregroundUndoHydrationRef.current = { key: hydrationKey, pending: false };
        incomingArrivalHandlerRef.current();
        return;
      }
      if (marker) {
        // Keep released markers too: they are the shared session state, but
        // only a suppressed marker gates the next in-radius fix.
        manualUndoSuppressedRef.current.set(suppressionKey, marker);
      } else {
        // Storage can be unavailable while the durable undo operation is
        // already in the outbox. Retain that active tombstone as a fallback.
        const fallback = arrivalOperations
          .filter(op => op.operationType === 'record_arrival'
            && op.entityId === destinationId
            && (op.actorId ?? op.payload.actorId) === actorId
            && op.payload.actorId === actorId
            && op.payload.userId === actorId
            && String(op.payload.navigationSessionId ?? op.payload.sessionId ?? '') === sessionId
            && op.payload.arrived === false)
          .sort((a, b) => {
            const aTime = typeof a.payload.occurredAt === 'string' ? Date.parse(a.payload.occurredAt) : Number.NaN;
            const bTime = typeof b.payload.occurredAt === 'string' ? Date.parse(b.payload.occurredAt) : Number.NaN;
            return (Number.isFinite(aTime) ? aTime : a.createdAt)
              - (Number.isFinite(bTime) ? bTime : b.createdAt);
          })
          .at(-1);
        if (fallback) {
          manualUndoSuppressedRef.current.set(suppressionKey, {
            actorId,
            groupId,
            destinationId,
            navigationSessionId: sessionId,
            operationId: fallback.id,
            occurredAt: typeof fallback.payload.occurredAt === 'string'
              ? fallback.payload.occurredAt
              : new Date(fallback.createdAt).toISOString(),
            suppressed: true,
          });
        }
      }
      foregroundUndoHydrationRef.current = { key: hydrationKey, pending: false };
      // A fix may have arrived while hydration was pending. Re-evaluate it
      // now that suppression (including a released marker) is known.
      incomingArrivalHandlerRef.current();
    };
    void loadBackgroundManualUndo(actorId, groupId, destinationId, sessionId)
      .then(finishHydration)
      .catch(() => finishHydration(null));
    return () => { cancelled = true; };
  }, [arrivalOperations, arrivalSessionKey, currentArrivalNavigationSessionId, foregroundUndoHydrationKey, groupId, navTarget?.id, user?.id]);
  const commitPersonalArrival = useCallback(async (destination: Destination, targetUserId: string, arrivedAt: string, automatic = false) => {
    if (!groupId || !user?.id) return;
    // The route can paint the tap before SQLite saves its Start. Wait for the
    // bound session instead of emitting a sessionless arrival into that gap.
    if (pendingLeaderTargetId === destination.id && !resolveCurrentNavigationSessionId(destination)) return;
    const context = arrivalContext;
    const stillCurrent = () => mapMountedRef.current && arrivalContextRef.current === context;
    const key = `${context}:${destination.id}:${targetUserId}`;
    if (arrivalSubmitInFlight.current.has(key)) return;
    arrivalSubmitInFlight.current.add(key);
    try {
      if (automatic && !await captureLocationAccess(groupId, true)) {
        if (!stillCurrent()) return;
        if (autoArrivalMarkedRef.current === destination.id) autoArrivalMarkedRef.current = null;
        automaticArrivalRetryAt.current = Date.now() + 60_000;
        return;
      }
      if (stillCurrent()) setLocalActionError(null);
      const operation = await enqueueArrival({ groupId, actorId: user.id, userId: targetUserId, destination, arrivedAt,
        occurredAt: arrivedAt,
        navigationSessionId: resolveCurrentNavigationSessionId(destination),
        // Arrival never completes a gathering stop.  Completion is an
        // explicit leader action, including a one-person subgroup.
        completeSolo: false });
      if (stillCurrent() && targetUserId === user.id) afterPersonalArrivalRef.current(destination, { promptComplete: false });
      // The receipt is durable now. Transport failure must not undo the local
      // arrival or keep the button busy while offline; outbox state owns errors.
      void syncArrival(operation)
        .then(async status => {
          if (status !== 'acked') return;
          if (!stillCurrent()) return;
          await loadGatheringWorkflow().catch(() => undefined);
          await refresh().catch(() => undefined);
        })
        .catch(() => undefined);
    } catch (error) {
      if (!stillCurrent()) return;
      if (automatic && autoArrivalMarkedRef.current === destination.id) {
        autoArrivalMarkedRef.current = null;
        // A persistent disk/privacy-store error must not alert on every GPS fix.
        automaticArrivalRetryAt.current = Date.now() + 60_000;
      }
      setArrivalCelebrateDestId(cur => cur === destination.id ? null : cur);
      if (arrivalFeedbackShownRef.current === destination.id) arrivalFeedbackShownRef.current = null;
      if (!(error instanceof Error && error.name === 'ArrivalSyncConflict')) {
        setLocalActionError({ title: t('arrival.failedTitle'), message: arrivalErrorMessage(error, t), destinationId: destination.id });
      }
    } finally {
      arrivalSubmitInFlight.current.delete(key);
    }
  }, [arrivalContext, groupId, user?.id, pendingLeaderTargetId, loadGatheringWorkflow, refresh, t, resolveCurrentNavigationSessionId]);

  const evaluateForegroundArrival = useCallback(() => {
    // Raw fixes stay current while stationary without forcing a map rerender.
    // The same reducer runs immediately when a new target is synchronized.
    const fix = latestLocationSampleRef.current;
    const deviceCoords = fix?.coordinates;
    const deviceAccuracyM = fix?.accuracy;
    const deviceCoordsAcceptedAtMs = fix?.timestamp ?? null;
    if (!mapFocused || !sharingEnabled || !isForegroundLocationState(appState)
      || !canEvaluateSynchronizedArrival({ sampledAt: deviceCoordsAcceptedAtMs,
        now: Date.now(), accuracyM: deviceAccuracyM, radiusM: localArrivalRadiusM })) return;
    // Auto-arrive while navigating (shared flock session or local path plan).
    // tools slider radius is authoritative (e.g. 300 m).
    if (!journeyActive || !navTarget || !deviceCoords) {
      foregroundArrivalRef.current = null;
      return;
    }
    if (pendingLeaderTargetId === navTarget.id && !currentArrivalNavigationSessionId) return;
    if (foregroundUndoHydrationRef.current.pending
      && foregroundUndoHydrationRef.current.key === foregroundUndoHydrationKey) return;
    if (myCompletedDestinationIds.has(navTarget.id)) {
      return;
    }
    const serverSession = navigationSessionState.session;
    const session = serverSession?.destinationId === navTarget.id
      && (serverSession.scopeSubgroupId ?? null) === (navTarget.subgroupId ?? null)
      && (serverSession.id === currentArrivalNavigationSessionId
        || serverSession.requestId === currentArrivalNavigationSessionId) ? serverSession : null;
    const memberStatus = navigationSessionState.memberState?.localStatus;
    if (session && !isLeader && !['activity_started', 'tracking_active', 'arriving', 'arrived'].includes(memberStatus ?? '')) return;
    const key = synchronizedArrivalTargetKey(session?.id, navTarget, localArrivalRadiusM);
    if (session?.id && foregroundAckRef.current && !foregroundAckRef.current.startsWith(`${session.id}:`)) {
      foregroundAckRef.current = null;
    }
    if (!session) {
      foregroundAckRef.current = null;
    }
    const straightM = distanceMeters(deviceCoords, navTarget.coordinates);
    const suppressionKey = `${arrivalSessionKey}:${navTarget.id}:${user?.id ?? ''}`;
    const fallbackUndo = arrivalOperations
      .filter(op => op.operationType === 'record_arrival'
        && op.entityId === navTarget.id
        && (op.actorId ?? op.payload.actorId) === user?.id
        && op.payload.actorId === user?.id
        && op.payload.userId === user?.id
        && String(op.payload.navigationSessionId ?? op.payload.sessionId ?? '') === (currentArrivalNavigationSessionId ?? '')
        && op.payload.arrived === false)
      .sort((a, b) => {
        const aTime = typeof a.payload.occurredAt === 'string' ? Date.parse(a.payload.occurredAt) : Number.NaN;
        const bTime = typeof b.payload.occurredAt === 'string' ? Date.parse(b.payload.occurredAt) : Number.NaN;
        return (Number.isFinite(aTime) ? aTime : a.createdAt)
          - (Number.isFinite(bTime) ? bTime : b.createdAt);
      })
      .at(-1);
    const manualUndo = manualUndoSuppressedRef.current.get(suppressionKey)
      ?? (fallbackUndo ? {
        actorId: user?.id ?? '',
        groupId: groupId ?? '',
        destinationId: navTarget.id,
        navigationSessionId: currentArrivalNavigationSessionId ?? '',
        operationId: fallbackUndo.id,
        occurredAt: typeof fallbackUndo.payload.occurredAt === 'string'
          ? fallbackUndo.payload.occurredAt
          : new Date(fallbackUndo.createdAt).toISOString(),
        suppressed: true,
      } satisfies BackgroundManualUndoMarker : null);
    if (manualUndo?.suppressed) {
      const leftRadius = straightM > localArrivalRadiusM;
      if (!leftRadius) return;
      foregroundUndoMutationSequenceRef.current += 1;
      const releasedUndo = { ...manualUndo, suppressed: false };
      manualUndoSuppressedRef.current.set(suppressionKey, releasedUndo);
      void releaseBackgroundManualUndo(releasedUndo);
      foregroundArrivalRef.current = null;
    } else if (manualUndo) {
      // A released marker is intentionally hydrated so it wins over an old
      // outbox row, but it must not block a legitimate re-entry. Keep it in
      // memory so the fallback outbox scan cannot resurrect that old undo.
    }
    if (foregroundArrivalRef.current?.key === key
      && foregroundArrivalRef.current.sampledAtMs === deviceCoordsAcceptedAtMs) return;
    const previous = foregroundArrivalRef.current?.key === key
      ? foregroundArrivalRef.current.state
      : createArrivalState(straightM);
    // Accuracy-aware reducer is authoritative — do not OR a bare distance
    // check (low-accuracy samples inside radius must not auto-arrive alone).
    const next = reduceArrival(
      previous,
      {
        distanceM: straightM,
        accuracyM: deviceAccuracyM,
      },
      { radiusM: localArrivalRadiusM },
    );
    const arrivedNow = next.status === 'arrived';
    foregroundArrivalRef.current = {
      key,
      state: next,
      sampledAtMs: deviceCoordsAcceptedAtMs!,
    };
    // The arrival RPC updates navigation_member_states transactionally.
    // A separate arrived ACK could commit before the durable arrival operation.
    const ackStatus = next.status === 'arriving' ? 'arriving' : null;
    const ackKey = session && ackStatus ? `${session.id}:${ackStatus}` : null;
    if (session && ackStatus && ackKey && foregroundAckRef.current !== ackKey) {
      foregroundAckRef.current = ackKey;
      void navigationSessionState.ack(ackStatus, {
        source: 'foreground_arrival_reducer',
        distanceM: straightM,
        accuracyM: deviceAccuracyM,
        consecutiveFixes: next.consecutiveFixes,
      }).catch(() => {
        if (foregroundAckRef.current === ackKey) foregroundAckRef.current = null;
      });
    }
    if (arrivedNow && user?.id && autoArrivalMarkedRef.current !== navTarget.id
      && Date.now() >= automaticArrivalRetryAt.current) {
      // One automatic attempt per destination; manual retry remains available after rejection.
      autoArrivalMarkedRef.current = navTarget.id;
      void commitPersonalArrival(navTarget, user.id, new Date().toISOString(), true);
    }
    if (!arrivedNow) autoArrivalMarkedRef.current = null;
  }, [
    mapFocused,
    sharingEnabled,
    appState,
    deviceCoordsAcceptedAtMs,
    commitPersonalArrival,
    deviceAccuracyM,
    deviceCoords,
    journeyActive,
    pendingLeaderTargetId,
    loadGatheringWorkflow,
    localArrivalRadiusM,
    myCompletedDestinationIds,
    arrivalSessionKey,
    navTarget,
    navigationSessionState.ack,
    navigationSessionState.session,
    navigationSessionState.memberState?.localStatus,
    isLeader,
    patchLocalArrival,
    arrivalOperations,
    currentArrivalNavigationSessionId,
    foregroundUndoHydrationKey,
    user?.id,
  ]);
  incomingArrivalHandlerRef.current = evaluateForegroundArrival;
  useEffect(evaluateForegroundArrival, [evaluateForegroundArrival]);
  const initialJourneyRef = useRef<{
    key: string;
    distanceM: number;
    source: DistanceSource;
    startCoords: NonNullable<typeof deviceCoords>;
  } | null>(null);
  const lastRouteDistanceRef = useRef<number | undefined>(undefined);
  const departedStartRef = useRef(false);
  /** GPS at last route sample — local estimate between throttled route results (#145). */
  /** Sticky presentation across GPS/route gaps + monotonic progress max (#145). */
  const presentationStickyRef = useRef<{
    key: string | null;
    progressMax: number | null;
    distanceM: number | null;
    etaSeconds: number | null;
    progress: number | null;
  }>({
    key: null,
    progressMax: null,
    distanceM: null,
    etaSeconds: null,
    progress: null,
  });
  const [progressMaxSticky, setProgressMaxSticky] = useState<number | null>(null);
  const [lastValidPresentation, setLastValidPresentation] = useState<{
    distanceM: number | null;
    etaSeconds: number | null;
    progress: number | null;
    travelMode: TravelMode;
  }>({ distanceM: null, etaSeconds: null, progress: null, travelMode });
  const [initialDistanceM, setInitialDistanceM] = useState<number | undefined>();
  const [distanceSource, setDistanceSource] = useState<DistanceSource | undefined>();
  const [progressDepartedStart, setProgressDepartedStart] = useState(false);
  const backgroundPermissionDeniedRef = useRef<string | null>(null);
  const backgroundStartedKeyRef = useRef<string | null>(null);
  const showLocationPermissionAlert = useCallback(
    (
      title = t('location.permissionTitle'),
      body = t('location.permissionBody'),
    ) => {
      Alert.alert(
        title,
        body,
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('location.openSettings'),
            onPress: () => void Linking.openSettings().catch(() => undefined),
          },
        ],
      );
    },
    [t],
  );

  // State mirrors of journey refs so personal-progress memo recomputes cleanly.
  const [journeyStartCoords, setJourneyStartCoords] = useState<
    NonNullable<typeof deviceCoords> | null
  >(null);
  const [lastRouteDistanceM, setLastRouteDistanceM] = useState<number | undefined>();
  const [backgroundPermissionsPreparedFor, setBackgroundPermissionsPreparedFor] =
    useState<string | null>(null);
  const backgroundPermissionPrepareInFlightRef = useRef<string | null>(null);
  const backgroundPermissionAttemptedRef = useRef<string | null>(null);

  // Journey progress baseline (foreground only) — separate from GPS ownership.
  useEffect(() => {
    if (!journeyActive || !groupId || !navTarget) {
      initialJourneyRef.current = null;
      lastRouteDistanceRef.current = undefined;
      departedStartRef.current = false;
      presentationStickyRef.current = {
        key: null,
        progressMax: null,
        distanceM: null,
        etaSeconds: null,
        progress: null,
      };
      setInitialDistanceM(undefined);
      setDistanceSource(undefined);
      setProgressDepartedStart(false);
      setJourneyStartCoords(null);
      setLastRouteDistanceM(undefined);
      setProgressMaxSticky(null);
      setLastValidPresentation({ distanceM: null, etaSeconds: null, progress: null, travelMode });
      return;
    }

    const key = `${groupId}:${navTarget.id}:${navigationSessionState.session?.id ?? state?.group.journeyStartedAt ?? ''}`;
    // New destination / journey → reset monotonic progress + last-valid.
    if (presentationStickyRef.current.key !== key) {
      presentationStickyRef.current = {
        key,
        progressMax: null,
        distanceM: null,
        etaSeconds: null,
        progress: null,
      };
      setProgressMaxSticky(null);
      setLastValidPresentation({ distanceM: null, etaSeconds: null, progress: null, travelMode });
    }
    // Never baseline progress from peer/stale pins — only real device GPS.
    if (!deviceCoords) return;

    const routeDistanceM = selfRoute?.distanceMeters;
    if (routeDistanceM != null && Number.isFinite(routeDistanceM)) {
      lastRouteDistanceRef.current = routeDistanceM;
      setLastRouteDistanceM(routeDistanceM);
    }
    const deviceStraightM = distanceMeters(deviceCoords, navTarget.coordinates);
    const distanceM = initialJourneyDistance(routeDistanceM, deviceStraightM);
    if (distanceM == null) return;

    const source: DistanceSource = routeDistanceM != null ? 'route' : 'fallback';
    const canLockProgress = shouldAnchorInitial({
      hasDeviceGps: true,
      accuracyM: deviceAccuracyM,
    });
    const current = initialJourneyRef.current;
    if (
      canLockProgress &&
      (!current || current.key !== key || (current.source === 'fallback' && source === 'route'))
    ) {
      initialJourneyRef.current = {
        key,
        distanceM,
        source,
        startCoords: deviceCoords,
      };
      departedStartRef.current = false;
      presentationStickyRef.current.progressMax = null;
      setProgressMaxSticky(null);
      setInitialDistanceM(distanceM);
      setDistanceSource(source);
      setProgressDepartedStart(false);
      setJourneyStartCoords(deviceCoords);
    }
  }, [
    deviceAccuracyM,
    deviceCoords,
    groupId,
    journeyActive,
    navTarget,
    selfRoute?.distanceMeters,
    selfRouteGeneration,
    state?.group.journeyStartedAt,
    navigationSessionState.session?.id,
  ]);

  const backgroundEtaRef = useRef<{ etaToPinSeconds?: number; etaTargetAtMs?: number; etaSampledAtMs?: number; lastEtaDistanceM?: number; personalArrivalAtMs?: number; personalArrivalSequence?: number }>({});
  const backgroundJourneyWantedRef = useRef<string | null>(null);
  const backgroundSharingScope = preferencesReady && sharingEnabled && groupId && user?.id
    && members.some(member => member.userId === user.id) ? `${user.id}:${groupId}` : null;
  backgroundJourneyWantedRef.current = backgroundSharingScope;
  const backgroundPermissionProfileKey = `${groupId}:${effectiveNavigationActive ? 'journey' : 'presence'}`;
  const backgroundPermissionProfileRef = useRef(backgroundPermissionProfileKey);
  backgroundPermissionProfileRef.current = backgroundPermissionProfileKey;

  // Creating CLBackgroundActivitySession alone displays the iOS blue indicator.
  // Retain it only for a live journey to a target; passive sharing never owns it.
  useEffect(() => {
    if (!backgroundSharingScope || !effectiveNavigationActive) {
      void prepareNativeBackgroundLocation(false).catch(() => undefined);
      return;
    }
    if (appState === 'active') {
      void prepareNativeBackgroundLocation(true).catch(() => undefined);
    }
  }, [appState, backgroundSharingScope, effectiveNavigationActive, backgroundPermissionsPreparedFor]);


  /**
   * Single foreground/background GPS owner:
   * - App active → foreground watch (useDeviceLocation); background task STOPPED.
   * - App background → allDay group presence, or denser journey profile.
   * Avoid overlapping GPS consumers; device measurements determine actual energy savings.
   */
  useEffect(() => {
    if (!backgroundSharingScope || !groupId) {
      backgroundStartedKeyRef.current = null;
      backgroundPermissionAttemptedRef.current = null;
      setBackgroundPermissionsPreparedFor(null);
      void stopBackgroundJourney(true);
      return;
    }

    // A system cover keeps the existing foreground GPS owner and permissions.
    if (appState === 'inactive') {
      backgroundStartedKeyRef.current = null;
      void stopBackgroundJourney();
      return;
    }

    // Foreground owns GPS.
    if (appState === 'active') {
      backgroundStartedKeyRef.current = null;
      backgroundPermissionDeniedRef.current = null;
      if (sharingEnabled && backgroundPermissionsPreparedFor !== backgroundPermissionProfileKey
        && backgroundPermissionPrepareInFlightRef.current !== backgroundPermissionProfileKey
        && backgroundPermissionAttemptedRef.current !== backgroundPermissionProfileKey) {
        backgroundPermissionPrepareInFlightRef.current = backgroundPermissionProfileKey;
        backgroundPermissionAttemptedRef.current = backgroundPermissionProfileKey;
        void (async () => {
          const granted = await prepareBackgroundJourneyPermissions(false, effectiveNavigationActive);
          if (granted === 'ready') return granted;
          const key = 'pref.journeyBackgroundExplained';
          const saved = await AsyncStorage.getItem(key);
          if (!saved) {
            const accepted = await new Promise<boolean>(resolve => Alert.alert(
              language === 'en' ? 'Share location in the background' : '背景位置分享',
              language === 'en'
                ? 'While location sharing is on, Hither shares your location with this team in the background, including when your screen is locked. Turn off location sharing to stop.'
                : '開啟位置分享時，Hither 會在背景向團隊分享位置，鎖定畫面後也會繼續。關閉位置分享即可停止。',
              [{ text: language === 'en' ? 'Not now' : '暫時不要', style: 'cancel', onPress: () => resolve(false) },
               { text: language === 'en' ? 'Continue' : '繼續', onPress: () => resolve(true) }],
            ));
            await AsyncStorage.setItem(key, accepted ? 'accepted' : 'declined');
            if (!accepted) return 'permission_denied' as const;
          }
          if (saved === 'declined') return 'permission_denied' as const;
          return prepareBackgroundJourneyPermissions(true, effectiveNavigationActive);
        })()
          .then((result) => {
            if (backgroundJourneyWantedRef.current !== backgroundSharingScope
              || backgroundPermissionProfileRef.current !== backgroundPermissionProfileKey) return;
            if (result === 'ready') {
              backgroundPermissionDeniedRef.current = null;
              setBackgroundPermissionsPreparedFor(backgroundPermissionProfileKey);
            } else {
              setBackgroundPermissionsPreparedFor(null);
              void rememberPendingLocationPermission();
            }
          })
          .catch(() => {
            if (backgroundJourneyWantedRef.current === backgroundSharingScope
              && backgroundPermissionProfileRef.current === backgroundPermissionProfileKey) setBackgroundPermissionsPreparedFor(null);
          })
          .finally(() => {
            if (backgroundPermissionPrepareInFlightRef.current === backgroundPermissionProfileKey) {
              backgroundPermissionPrepareInFlightRef.current = null;
            }
          });
      } else if (!sharingEnabled && backgroundPermissionsPreparedFor != null) {
        setBackgroundPermissionsPreparedFor(null);
      }
      void stopBackgroundJourney();
      return;
    }

    backgroundPermissionAttemptedRef.current = null;
    const powerMode = effectiveNavigationActive ? 'journey' : 'allDay';
    const backgroundScopeSubgroupId = powerMode === 'journey'
      ? navTarget?.subgroupId ?? null : myScopeId ?? null;
    const dest =
      navTarget?.coordinates ??
      deviceCoords ??
      { latitude: 0, longitude: 0 };
    const backgroundNavigationSessionId = navTarget
      ? resolveCurrentNavigationSessionId(navTarget)
      : null;
    if (pendingLeaderTargetId === navTarget?.id && !backgroundNavigationSessionId) return;
    const sessionKey = backgroundNavigationSessionId ?? 'none';
    const key = JSON.stringify([backgroundSharingScope, backgroundScopeSubgroupId, powerMode,
      navTarget?.id ?? 'presence', sessionKey, highAccuracy, travelMode, localArrivalRadiusM,
      navTarget?.coordinates.latitude, navTarget?.coordinates.longitude, canEditItinerary,
      members.map(member => `${member.userId}:${member.subgroupId ?? ''}`).sort(),
      sessionEligibleMembers.filter(member => !member.solo).map(member => member.userId).sort()]);
    if (backgroundPermissionDeniedRef.current === key || backgroundStartedKeyRef.current === key) return;
    backgroundStartedKeyRef.current = key;

    const backgroundInitialM =
      initialJourneyRef.current?.distanceM ??
      (deviceCoords && navTarget
        ? distanceMeters(deviceCoords, navTarget.coordinates)
        : 0);

    void startBackgroundJourney({
      actorId: user?.id,
      scopeSubgroupId: backgroundScopeSubgroupId,
      memberIds: members.filter(m => (m.subgroupId ?? null) === (navTarget?.subgroupId ?? null)).map(m => m.userId),
      navigationMemberIds: sessionEligibleMembers.filter(m => !m.solo && (m.subgroupId ?? null)
        === (navTarget?.subgroupId ?? null)).map(m => m.userId),
      arrivedMemberIds: activeDestinationArrivals.filter(a => a.destinationId === navTarget?.id).map(a => a.userId),
      leaderId: navTarget?.subgroupId
        ? state?.subgroups.find(subgroup => subgroup.id === navTarget.subgroupId)?.leaderId
        : members.find(member => member.role === 'leader')?.userId,
      target: navTarget ?? undefined,
      // The shared completion helper handles all-member completion separately from arrival.
      completeSolo: false,
      groupId,
      navigationSessionId: backgroundNavigationSessionId,
      destinationId: navTarget?.id ?? 'group-presence',
      destination: dest,
      arrivalRadiusMeters: localArrivalRadiusM,
      initialDistanceM: backgroundInitialM,
      distanceSource: initialJourneyRef.current?.source,
      routeAnchorGps: deviceCoords ?? undefined,
      routeAnchorRemainingM: lastValidPresentation.distanceM ?? lastRouteDistanceM ?? backgroundInitialM,
      accentHex: colors.accent,
      sequence: 0,
      travelMode,
      // Pause retains the preference while acquiring only passive fixes.
      highAccuracy: effectiveNavigationActive && highAccuracy,
      powerMode,
      sharingEnabled,
      hasMembership: members.some(m => m.userId === user?.id),
      gatheringTitle: navTarget?.title ?? membership?.group.name,
      groupName: membership?.group.name ?? '',
      memberEmojis: members.filter(m => (m.subgroupId ?? null) === (navTarget?.subgroupId ?? null)).map(m => m.avatar ?? ''),
      memberArrived: members.filter(m => (m.subgroupId ?? null) === (navTarget?.subgroupId ?? null)).map(m => activeDestinationArrivals.some(a => a.destinationId === navTarget?.id && a.userId === m.userId)),
      startCoords: journeyStartCoords ?? undefined,
      hasDepartedStart: progressDepartedStart,
      previousProgressMax: progressMaxSticky ?? undefined,
      ...backgroundEtaRef.current,
      etaToPinSeconds: backgroundEtaRef.current.etaToPinSeconds ?? selfRoute?.expectedTravelTimeSeconds,
      etaSeconds: (lastValidPresentation.travelMode === travelMode ? lastValidPresentation.etaSeconds : null)
        ?? selfRoute?.expectedTravelTimeSeconds,
      teamNavigationActive: effectiveNavigationActive,
      appState: appState === 'background' ? 'background' : 'inactive',
      permissionsPrepared: backgroundPermissionsPreparedFor === backgroundPermissionProfileKey,
    }).then((result) => {
      if (result !== 'started' && backgroundStartedKeyRef.current === key) backgroundStartedKeyRef.current = null;
      if (result === 'hidden') {
        void purgeLocationOutbox();
      }
      if (result === 'permission_denied') {
        backgroundPermissionDeniedRef.current = key;
        void rememberPendingLocationPermission();
      }
    }).catch(() => {
      if (backgroundStartedKeyRef.current === key) backgroundStartedKeyRef.current = null;
    });
  }, [
    appState,
    mapFocused,
    backgroundSharingScope,
    effectiveNavigationActive,
    backgroundPermissionsPreparedFor,
    backgroundPermissionProfileKey,
    preferencesReady,
    language,
    localArrivalRadiusM,
    localNavigationSessionId,
    pendingLeaderTargetId,
    myScopeId,
    activeDestinationArrivals,
    resolveCurrentNavigationSessionId,
    sessionEligibleMembers,
    user?.id,
    canEditItinerary,
    deviceCoords,
    groupId,
    highAccuracy,
    journeyActive,
    navTarget,
    navigationSessionId,
    hasNavigationSession,
    navigationStoppedLocally,
    sharingEnabled,
    showLocationPermissionAlert,
    travelMode,
    members,
    membership?.group.name,
    journeyStartCoords,
    progressDepartedStart,
    progressMaxSticky,
    selfRoute?.expectedTravelTimeSeconds,
    colors.accent,
    lastValidPresentation.distanceM,
    lastValidPresentation.etaSeconds,
    lastValidPresentation.travelMode,
    lastRouteDistanceM,
  ]);

  useEffect(() => () => void stopBackgroundJourney(), []);

  useEffect(() => {
    energyObservability.setTrackingMode(!sharingEnabled ? 'hidden'
      : appState === 'background' ? effectiveNavigationActive ? highAccuracy ? 'navigationMax' : 'teamNavigation' : 'passiveBackground'
      : effectiveNavigationActive ? highAccuracy ? 'navigationMax' : 'teamNavigation' : 'foreground');
  }, [appState, highAccuracy, effectiveNavigationActive, sharingEnabled]);

  const lastFittedRouteRef = useRef<string | null>(null);
  useEffect(() => {
    const key = activePoint ? `${activePoint.id}:${travelMode}` : null;
    if (activePoint && key && key !== lastFittedRouteRef.current && selfRoute?.points.length) {
      lastFittedRouteRef.current = key;
      mapRef.current?.fitRoute([
        ...selfRoute.points,
        ...(deviceCoords ? [deviceCoords] : []),
        activePoint.coordinates,
      ]);
    }
    if (!key) lastFittedRouteRef.current = null;
  }, [activePoint, selfRoute, travelMode, deviceCoords]);
  const {
    stragglers,
  } = useStragglerReporting({
    fromCoords,
    group,
    groupId,
    isLeader,
    state,
    user,
  });

  // Organizer exception center — leader-only derived list (no second source of truth).
  const exceptionArrivedUserIds = useMemo(() => {
    const ids = new Set<string>();
    const pointId =
      navigationSessionState.session?.destinationId
      ?? activePoint?.id
      ?? null;
    if (pointId) {
      for (const entry of activeDestinationArrivals) {
        if (entry.destinationId === pointId) ids.add(entry.userId);
      }
    }
    return ids;
  }, [
    members,
    activeDestinationArrivals,
    navigationSessionState.session?.destinationId,
    activePoint?.id,
  ]);
  const {
    exceptions: organizerExceptions,
    openCount: exceptionOpenCount,
    pendingKeys: exceptionPendingKeys,
    markHandled: markExceptionHandled,
  } = useOrganizerExceptions({
    enabled: !!isLeader,
    groupId,
    groupState: state,
    gatheringPoint: activePoint ?? null,
    navigationSessionId: navigationSessionState.session?.id ?? null,
    stragglers,
    arrivedUserIds: exceptionArrivedUserIds,
    leaderUserId: user?.id,
  });

  // OTA-09: coordination request lifecycle — independent of navigation start.
  const coordination = useCoordinationRequests({
    groupId,
    userId: user?.id,
    enabled: !!groupId && !isDemoGroup(groupId),
  });

  // Same metric as locked initial (route stays route; never silent straight fallback).
  const liveDistance =
    distanceSource != null
      ? sameMetricDistance(
          distanceSource,
          selfRoute?.distanceMeters,
          deviceCoords && navTarget
            ? distanceMeters(deviceCoords, navTarget.coordinates)
            : numericDistance,
          lastRouteDistanceRef.current,
        )
      : selfRoute?.distanceMeters ?? numericDistance;

  const movedFromStartM =
    deviceCoords && initialJourneyRef.current
      ? distanceMeters(initialJourneyRef.current.startCoords, deviceCoords)
      : 0;

  const gatedProgress =
    liveDistance != null && initialDistanceM != null
      ? gatedJourneyProgress({
          initialM: initialDistanceM,
          currentM: liveDistance,
          arrivalRadiusM: localArrivalRadiusM,
          movedFromStartM,
          hasDepartedStart: departedStartRef.current || progressDepartedStart,
        })
      : undefined;

  // Sticky "left start" so stepping back toward the pin does not snap to 0%.
  useEffect(() => {
    if (!gatedProgress?.departed) return;
    departedStartRef.current = true;
    if (!progressDepartedStart) setProgressDepartedStart(true);
  }, [gatedProgress?.departed, progressDepartedStart]);
  const liveMembers = members.filter(m => (m.subgroupId ?? null) === (navTarget?.subgroupId ?? null));
  const liveMemberArrived = liveMembers.map(m => activeDestinationArrivals.some(a => a.destinationId === navTarget?.id && a.userId === m.userId));
  const liveGathered = navTarget ? liveMemberArrived.filter(Boolean).length : undefined;
  const localNavigationArrived = Boolean(navTarget && myCompletedDestinationIds.has(navTarget.id));
  const personalArrivalEventSnapshot = navTarget && user?.id
    ? personalArrivalEvent(remoteArrivals, arrivalOperations, user.id, navTarget.id, arrivalSessionScope)
    : undefined;
  const personalArrivalAtMs = personalArrivalEventSnapshot?.atMs;
  const personalArrivalSequence = personalArrivalEventSnapshot?.sequence;
  // Near the pin, force 100% even if MapKit route distance still lags.
  const liveProgress =
    localNavigationArrived
      ? 1
      : gatedProgress?.progress;

  /**
   * Freshness clock: single timeout to the stale threshold while navigation is
   * active — not a permanent 5s polling loop on MapScreen (spec: no extra poll).
   */
  const [progressClockMs, setProgressClockMs] = useState(() => Date.now());
  const PERSONAL_PROGRESS_STALE_MS = 30_000;
  useEffect(() => {
    if (!journeyActive || !navTarget || deviceCoordsAcceptedAtMs == null) {
      return;
    }
    const now = Date.now();
    setProgressClockMs(now);
    const age = Math.max(0, now - deviceCoordsAcceptedAtMs);
    if (age >= PERSONAL_PROGRESS_STALE_MS) {
      return;
    }
    const timer = setTimeout(() => {
      setProgressClockMs(Date.now());
    }, PERSONAL_PROGRESS_STALE_MS - age + 50);
    return () => clearTimeout(timer);
  }, [journeyActive, navTarget?.id, deviceCoordsAcceptedAtMs]);

  /**
   * Shared local personal progress — single derivation for gathering card,
   * My Progress (passive), and Live Activity. Backend upload cadence is
   * independent and must not block these surfaces.
   */
  const progressSurfaces = usePersonalProgressSurfaces({
    resetKey: journeyActive && groupId && navTarget
      ? `${groupId}:${navTarget.id}:${navigationSessionState.session?.id ?? state?.group.journeyStartedAt ?? ''}`
      : null,
    deviceCoords,
    sampledAtMs: deviceCoordsAcceptedAtMs ?? undefined,
    targetCoords: navTarget?.coordinates,
    initialDistanceM,
    startCoords: journeyStartCoords,
    // Same-render sticky: gatedProgress.departed may flip before state commits.
    hasDepartedStart: progressDepartedStart || Boolean(gatedProgress?.departed),
    travelMode,
    routeEtaSeconds: selfRoute?.expectedTravelTimeSeconds,
    routeDistanceM: selfRoute?.distanceMeters,
    distanceSource: distanceSource ?? null,
    lastRouteDistanceM,
    previousProgressMax: progressMaxSticky,
    lastValidDistanceM: lastValidPresentation.distanceM,
    lastValidEtaSeconds: lastValidPresentation.etaSeconds,
    lastValidEtaTravelMode: lastValidPresentation.travelMode,
    lastValidProgress: lastValidPresentation.progress,
    routeResultGeneration: selfRouteGeneration,
    // Personal check-in / auto-arrive — not team stop completion.
    arrived: localNavigationArrived,
    // Team terminal: stop closed by leader (closedAt), not personal arrival.
    completed: Boolean(
      navTarget && teamCompletedDestinationIds.has(navTarget.id),
    ),
    arrivalRadiusM: localArrivalRadiusM,
    // Age from single stale-threshold clock while journey is active.
    sampleAgeMs:
      deviceCoordsAcceptedAtMs != null
        ? Math.max(0, progressClockMs - deviceCoordsAcceptedAtMs)
        : null,
    staleAfterMs: PERSONAL_PROGRESS_STALE_MS,
    fallbackDistanceM: liveDistance,
    fallbackEtaSeconds:
      selfRoute?.expectedTravelTimeSeconds
      ?? (liveDistance != null ? etaSecondsFor(liveDistance, travelMode) : null),
    fallbackProgress: liveProgress ?? null,
  });
  const { personalProgress } = progressSurfaces;

  useEffect(() => {
    if (!journeyActive || !navTarget || personalProgress.arrived) return;
    const remaining = personalProgress.distanceMeters;
    const total = initialDistanceM;
    if (remaining == null || total == null) return;
    if (!shouldFireApproachNotify({
      remainingM: remaining,
      totalM: total,
      arrivalRadiusM: localArrivalRadiusM,
      arrived: personalProgress.arrived || localNavigationArrived,
      alreadyFired: false,
    })) return;
    void notifyJourneyApproach(navigationSessionState.session?.id, navTarget.id, navTarget.title, {
      remainingM: remaining, totalM: total, arrivalRadiusM: localArrivalRadiusM,
      arrived: personalProgress.arrived || localNavigationArrived, alreadyFired: false,
    }).catch(() => undefined);
  }, [
    journeyActive,
    navTarget,
    personalProgress.arrived,
    personalProgress.distanceMeters,
    initialDistanceM,
    localArrivalRadiusM,
    localNavigationArrived,
    navigationSessionState.session?.id,
  ]);

  // Stick presentation: monotonic progress max + last-valid distance/ETA (#145).
  useEffect(() => {
    if (!journeyActive || !navTarget || !groupId) return;
    const key = `${groupId}:${navTarget.id}:${navigationSessionState.session?.id ?? state?.group.journeyStartedAt ?? ''}`;
    const sticky = presentationStickyRef.current;
    if (sticky.key !== key) {
      // Key was just set in baseline effect; align ref so subsequent samples stick.
      sticky.key = key;
    }
    const nextProgress = personalProgress.progress;
    if (nextProgress != null && Number.isFinite(nextProgress)) {
      const max =
        sticky.progressMax == null
          ? nextProgress
          : Math.max(sticky.progressMax, nextProgress);
      if (sticky.progressMax == null || max > sticky.progressMax + 1e-9) {
        sticky.progressMax = max;
        setProgressMaxSticky(max);
      }
    }
    if (
      personalProgress.distanceMeters != null
      && Number.isFinite(personalProgress.distanceMeters)
    ) {
      const d = personalProgress.distanceMeters;
      const e = personalProgress.etaSeconds;
      const p = personalProgress.progress;
      if (
        sticky.distanceM !== d
        || sticky.etaSeconds !== e
        || sticky.progress !== p
        || lastValidPresentation.travelMode !== travelMode
      ) {
        sticky.distanceM = d;
        sticky.etaSeconds = e;
        sticky.progress = p;
        setLastValidPresentation({ distanceM: d, etaSeconds: e, progress: p, travelMode });
      }
    }
  }, [
    journeyActive,
    navTarget,
    groupId,
    state?.group.journeyStartedAt,
    navigationSessionState.session?.id,
    personalProgress.progress,
    personalProgress.distanceMeters,
    personalProgress.etaSeconds,
    travelMode,
  ]);

  // Both presentation surfaces consume the same orchestration output.
  const personalDistanceM = progressSurfaces.gatheringCard.distanceMeters;
  backgroundEtaRef.current = { etaToPinSeconds: personalProgress.etaToPinSeconds ?? undefined,
    etaTargetAtMs: progressSurfaces.liveActivityPayload.etaTargetAtMs ?? undefined,
    etaSampledAtMs: progressSurfaces.liveActivityPayload.etaSampledAtMs ?? undefined,
    lastEtaDistanceM: personalDistanceM ?? undefined, personalArrivalAtMs, personalArrivalSequence };
  const personalEtaSeconds = progressSurfaces.gatheringCard.etaSeconds;
  const personalProgressRatio = progressSurfaces.gatheringCard.progress;

  // OTA-01 ticket 02: team surface + personal overlay (personal never rewrites team).
  const teamSurfaceView = useMemo(() => {
    return overlayPersonalOnTeamState(teamGatheringState, {
      userId: user?.id ?? '',
      travelMode,
      etaSeconds: personalEtaSeconds ?? null,
      location: deviceCoords
        ? { latitude: deviceCoords.latitude, longitude: deviceCoords.longitude }
        : null,
      arrived: personalProgress.arrived || localNavigationArrived,
      progress: personalProgressRatio ?? null,
      distanceMeters: personalDistanceM ?? null,
    });
  }, [
    teamGatheringState,
    user?.id,
    travelMode,
    personalEtaSeconds,
    deviceCoords,
    personalProgress.arrived,
    localNavigationArrived,
    personalProgressRatio,
    personalDistanceM,
  ]);

  // OTA-07: wait for prefs hydrate so returning passive users do not flash full chrome.
  const inPassiveMode = preferencesReady && passiveCompanionMode;
  // Dense MapScreen chrome only after prefs ready and not in passive presentation.
  const showDenseChrome = preferencesReady && !passiveCompanionMode;

  // OTA-07: same team phase + user progress as full UI; presentation only.
  // journeyGoing follows team projection, not personal ETA/progress.
  const passiveModel = useMemo(
    () =>
      buildPassiveCompanionModel({
        mode: inPassiveMode ? 'passive' : 'full',
        loading: loading && !state,
        errorMessage: groupStateError,
        destinations: destinations.map((d) => ({ id: d.id, title: d.title })),
        currentPointId:
          teamSurfaceView.team.activePointId
          ?? teamSurfaceView.team.nextPendingPointId
          ?? (navTarget ?? activePoint ?? selectedDestination)?.id
          ?? null,
        currentPointTitle: (navTarget ?? activePoint ?? selectedDestination)?.title ?? null,
        journeyGoing: teamSurfaceView.team.journeyPhase === 'en_route',
        personalProgress:
          teamSurfaceView.personal?.progress
          ?? personalProgressRatio
          ?? liveProgress
          ?? null,
        personallyArrived:
          teamSurfaceView.personal?.arrived
          ?? personalProgress.arrived
          ?? localNavigationArrived,
        personalFreshness: personalProgress.freshness,
      }),
    [
      inPassiveMode,
      loading,
      state,
      groupStateError,
      destinations,
      teamSurfaceView,
      navTarget,
      activePoint,
      selectedDestination,
      personalProgressRatio,
      personalProgress.arrived,
      personalProgress.freshness,
      liveProgress,
      localNavigationArrived,
    ],
  );

  const exitPassiveCompanionMode = useCallback(() => {
    // Display preference only — no consent/payment/vote/safety side effects.
    setPassiveCompanionMode(false);
  }, [setPassiveCompanionMode]);

  // Start the lock-screen Live Update as soon as navigation is active. GPS
  // baseline hydration can lag behind the session start; a route/straight-line
  // distance is sufficient for the initial Android notification and is
  // replaced by the locked baseline on the next render.
  const liveActivityBaselineM = initialDistanceM ?? liveDistance ?? numericDistance;
  // Preference (liveActivityEnabled) ≠ entitlement (store + Premium session).
  const liveActivityAllowed = liveActivityEnabled && (liveActivityEffective || isPro);
  useLiveActivity(
    navigationStoppedLocally ? false : !preferencesReady ? undefined : !liveActivityAllowed ? false
      : effectiveNavigationActive ? true
      : navigationSessionState.loading || navigationSessionState.error || loading || groupStateError ? undefined : false,
    {
    groupName: membership?.group.name ?? '',
    destinationId: navTarget?.id,
    personalArrived: localNavigationArrived,
    personalArrivalAtMs,
    personalArrivalSequence,
    navigationSessionId: currentArrivalNavigationSessionId ?? undefined,
    status: navigationSessionState.session ? 'active' : undefined,
    // Gathering point title when a target exists; team name is fallback only.
    gatheringTitle: navTarget?.title ?? membership?.group.name,
    distanceMeters: progressSurfaces.liveActivityPayload.distanceMeters ?? undefined,
    sampledAtMs: progressSurfaces.liveActivityPayload.etaSampledAtMs ?? undefined,
    etaTargetAtMs: progressSurfaces.liveActivityPayload.etaTargetAtMs ?? undefined,
    etaSeconds: progressSurfaces.liveActivityPayload.etaSeconds ?? undefined,
    gatheringCoordinates: navTarget?.coordinates,
    progress: progressSurfaces.liveActivityPayload.progress ?? undefined,
    gatheredCount: liveGathered,
    memberCount: liveMembers.length,
    accentHex: accent,
    travelMode,
    memberEmojis: members.filter(m => (m.subgroupId ?? null) === (navTarget?.subgroupId ?? null)).map(m => m.avatar ?? ''),
    memberArrived: members.filter(m => (m.subgroupId ?? null) === (navTarget?.subgroupId ?? null)).map(m => activeDestinationArrivals.some(a => a.destinationId === navTarget?.id && a.userId === m.userId)),
    // Ticket 07: destination emoji when set (native may no-op without a glyph slot).
    // Flag color is day-scoped in map/list chrome; LA keeps theme accent.
    destinationEmoji: navTarget?.emoji ?? undefined,
    language,
  }, groupId && navTarget && liveActivityBaselineM != null ? {
    groupId,
    navigationSessionId: currentArrivalNavigationSessionId ?? undefined,
    destinationId: navTarget.id,
    initialDistanceM: Math.max(1, liveActivityBaselineM),
    travelMode,
  } : undefined, liveActivityAllowed);



  const locateMe = useCallback(() => {
    void runUiAction(
      'map.locate_me',
      async (token) => {
        lightTap();
        const go = (coords: NonNullable<typeof deviceCoords>) => {
          // Settings toggle: flat top-down vs 30° oblique (Apple-Maps-style).
          if (obliqueLocate) mapRef.current?.focusOblique(coords);
          else mapRef.current?.centerOn(coords);
        };
        // Instant feedback from last known fix — don't wait on GPS / network.
        if (deviceCoords) go(deviceCoords);
        const fresh = await refreshDeviceLocation().catch(() => null);
        if (!token.isCurrent()) return;
        if (fresh) go(fresh);
        else if (!deviceCoords) return;
        void refresh();
      },
      { screen: 'Map' },
    );
  }, [refresh, refreshDeviceLocation, deviceCoords, obliqueLocate]);

  const [refreshingLocations, setRefreshingLocations] = useState(false);
  const [refreshCooldownUntil, setRefreshCooldownUntil] = useState(0);

  useEffect(() => {
    const remove = notifications.addForegroundListener((data) => {
      if (data.category !== 'location_refresh') return;
      // The server ledger is the source of truth. Recover all pending groups
      // with one foreground GPS fix, then ACK each exact requested_at version.
      void recoverPendingLocationRefreshes();
    });
    return remove;
  }, []);

  useEffect(() => {
    if (appState !== 'active') return;
    void Promise.all([
      location.getPermissionState().catch(() => null),
      consumePendingLocationPermission(),
    ]).then(([permission, pending]) => {
      if (permission?.backgroundStatus === 'granted') {
        backgroundPermissionDeniedRef.current = null;
      }
      if (pending && permission?.backgroundStatus !== 'granted') {
        showLocationPermissionAlert(
          t('map.bgLocationTitle'),
          t('map.bgLocationBody'),
        );
      }
    });
    void recoverPendingLocationRefreshes();
  }, [
    appState,
    groupId,
    showLocationPermissionAlert,
    t,
  ]);

  const refreshAllLocations = useCallback(async () => {
    if (!groupId || refreshingLocations) return;
    setRefreshingLocations(true);
    try {
      const result = await refreshTeamLocations({
        pull: () => refresh('poll_manual_refresh'),
        uploadSelf: () => refreshDeviceLocation({ requireUpload: true }),
        requestPeers: () => requestGroupLocationRefresh(groupId),
        getAcknowledgedRecipientIds: requestedAt => getGroupLocationRefreshAcknowledgements(groupId, requestedAt),
        getMembers: () => membersRef.current,
        serverTimeOffsetMs,
        cooling: refreshCooldownUntil > Date.now() || isDemoGroup(groupId),
      });
      if (result.cooldownUntil != null) setRefreshCooldownUntil(result.cooldownUntil);
      Alert.alert(t('map.refreshLocationsResultTitle'), [
        t(result.pulled ? 'map.refreshReadSuccess' : 'map.refreshReadFailed'),
        t(result.selfUploaded ? 'map.refreshSelfSuccess' : 'map.refreshSelfFailed'),
        result.request?.accepted
          ? result.acknowledgementsAvailable
            ? t('map.refreshLocationsResultPartial', { responded: result.respondedUserIds.length, expected: result.expectedUserIds.length })
            : t('map.refreshReceiptsUnavailable')
          : t(result.requestUnavailable ? 'map.refreshPeersRequestFailed' : 'map.refreshPeersCooling'),
      ].join('\n'));
    } finally {
      setRefreshingLocations(false);
    }
  }, [groupId, refreshingLocations, refresh, refreshDeviceLocation, refreshCooldownUntil, serverTimeOffsetMs, t]);

  const fitAllMembers = useCallback(() => {
    void runUiAction(
      'map.fit_all_members',
      () => {
        lightTap();
        mapRef.current?.fitToMembers();
      },
      { screen: 'Map' },
    );
  }, []);

  const biasCenter = deviceCoords ?? selectedDestination?.coordinates;
  const biasRegion = useMemo<MapRegion | undefined>(() => {
    return biasCenter ? {
        latitude: biasCenter.latitude,
        longitude: biasCenter.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      } : undefined;
  }, [biasCenter?.latitude, biasCenter?.longitude]);

  const closeSearch = useCallback(() => {
    setSearchVisible(false);
    // If the sheet closes before open-complete, still release the Amicro busy state.
    searchOpenCompleteResolveRef.current?.();
    searchOpenCompleteResolveRef.current = null;
  }, []);

  const handleSearchOpenComplete = useCallback(() => {
    searchOpenCompleteResolveRef.current?.();
    searchOpenCompleteResolveRef.current = null;
  }, []);

  // Followers submit durable, actionable requests instead of plain-text commands.
  const notifyLeaderPlace = useCallback(
    async (
      items: GatherPointRequestItem[],
      source: 'search' | 'kml',
      scopeId: string | undefined = myScopeId,
    ): Promise<boolean> => {
      if (!groupId) return false;
      const label = items.length === 1
        ? items[0].title
        : t('map.placesCount', { count: items.length });
      const result = await runUiAction(
        'map.destination_suggest',
        async (token) => {
          try {
            const requestId = await submitGatherPointRequest(groupId, scopeId, items);
            if (!token.isCurrent()) return false;
            logEvent('destination_suggest', { source, label });
            const queued = (await getCoreOperationOutbox().listByGroup(groupId)).find(op =>
              op.operationType === 'submit_gather_point_request' && op.entityId === requestId);
            if (queued && queued.status !== 'acked') {
              showAppNotice({ id: `suggestion-saved:${requestId}`, title: t('gatherRequest.savedTitle'), message: t('coreData.requestSaved') });
            } else {
              Alert.alert(t('gatherRequest.sentTitle'), t('gatherRequest.sentBody'));
            }
            return true;
          } catch (e) {
            logError('destination_suggest_failed', e, { source });
            if (token.isCurrent()) {
              showOperationFailure(t('map.setFailedTitle'), getOperationErrorMessage(e));
            }
            throw e;
          }
        },
        {
          screen: 'Map',
          suppressBanner: true,
          onError: (kind) => {
            if (kind === 'timeout') {
              showOperationFailure(t('map.setFailedTitle'), t('interaction.timeout'));
            }
          },
        },
      );
      return result === true;
    },
    [groupId, myScopeId, t],
  );

  const tripDayForAdd = useCallback(
    () =>
      resolveAddDay(
        routeDepartureDate,
        routeTripDays,
      ),
    [
      routeDepartureDate,
      routeTripDays,
      group?.departureDate,
      group?.tripDays,
    ],
  );

  const handleSearchPick = useCallback(
    async (place: PlaceResult) => {
      if (!canEditItinerary) {
        await notifyLeaderPlace([{
          title: place.name,
          address: place.address,
          coordinates: place.coordinates,
          day: null,
        }], 'search');
        return;
      }
      pendingPlaceSourceRef.current = 'search';
      setPendingPlace(place);
      setPendingPlaceTitle(place.name);
      // Search-pick camera: neighborhood zoom (must not regress with long-press fix).
      cameraOnSearchPick(mapRef.current, place.coordinates, obliqueLocate);
    },
    [canEditItinerary, notifyLeaderPlace, tripDayForAdd, obliqueLocate],
  );

  const handlePickDestination = useCallback(async (place: PlaceResult, placement?: 'firstStop'): Promise<boolean> => {
    if (!groupId) return false;
    const addDay = placement ? tripDayForAdd() : null;
    const placeSource = pendingPlaceSourceRef.current ?? 'search';
    if (!canEditItinerary) {
      return notifyLeaderPlace([{
        title: place.name,
        address: place.address,
        coordinates: place.coordinates,
        day: addDay,
      }], 'search');
    }
    {
      const openCount = countOpenDestinations(allScopedDestinations);
      if (shouldBlockNewDestination({
        isPro,
        openCount,
        extraCredits: extraPointCredits,
      })) {
        openPaywall('paywall.triggerDestinations');
        return false;
      }
    }
    const result = await runUiAction(
      'map.destination_add',
      async (token) => {
        try {
          await addDestination(
            groupId,
            {
              title: place.name,
              address: place.address,
              coordinates: place.coordinates,
              day: addDay,
              providerPlaceId: place.providerPlaceId,
              ...(placement ? { placement } : {}),
            },
            myScopeId,
          );
          if (!token.isCurrent()) return false;
          logEvent('destination_add', { source: placeSource, day: addDay });
          // Long-press success: fit self + dest (or single-point fallback).
          // Search success: keep neighborhood center on the new pin (no regression).
          if (placeSource === 'longpress') {
            cameraAfterSuccessfulAdd(
              mapRef.current,
              place.coordinates,
              deviceCoords ?? null,
              obliqueLocate,
            );
          } else {
            if (obliqueLocate) {
              mapRef.current?.focusOblique(place.coordinates, {
                zoom: PLACE_ZOOM,
                altitude: PLACE_ALTITUDE,
              });
            } else {
              mapRef.current?.centerOn(place.coordinates, {
                zoom: PLACE_ZOOM,
                altitude: PLACE_ALTITUDE,
              });
            }
          }
          // addDestination resolves only after durable local persistence. A
          // disconnected refresh must not leave Add enabled for a second insert.
          void refresh().catch(() => undefined);
          return true;
        } catch (e) {
          logError('destination_add_failed', e, { source: placeSource });
          if (token.isCurrent()) {
            showOperationFailure(t('map.setFailedTitle'), getOperationErrorMessage(e));
          }
          throw e;
        }
      },
      {
        screen: 'Map',
        suppressBanner: true,
        onError: (kind) => {
          if (kind === 'timeout') {
            showOperationFailure(t('map.setFailedTitle'), t('interaction.timeout'));
          }
        },
      },
    );
    return result === true;
  }, [
    groupId,
    canEditItinerary,
    notifyLeaderPlace,
    isPro,
    destinations.length,
    obliqueLocate,
    allScopedDestinations,
    extraPointCredits,
    myScopeId,
    refresh,
    openPaywall,
    t,
    tripDayForAdd,
    deviceCoords,
  ]);

  const handleKmlImport = useCallback(async (items: KmlPlacemark[], onProgress: (done: number) => void) => {
    if (!groupId) return;
    const addDay = null;
    const importScopeId = kmlScopeId;
    const canEditImportScope = importScopeId ? isMySubgroupLeader : isLeader;
    // BUG-15: non-editors notify captain with place names instead of writing itinerary.
    if (!canEditImportScope) {
      await notifyLeaderPlace(items.map((item) => ({
        title: item.name,
        coordinates: { latitude: item.latitude, longitude: item.longitude },
        day: addDay,
      })), 'kml', importScopeId);
      onProgress(items.length);
      return;
    }
    // Validate full batch before any DB I/O; single atomic mutation (#152).
    const normalized = normalizeImportBatch(items);
    onProgress(0);
    try {
      await addDestinationsBatch(groupId, normalized, {
        day: addDay,
        subgroupId: importScopeId,
      });
      onProgress(normalized.length);
    } catch (e) {
      if (e instanceof KmlImportError) throw e;
      throw new KmlImportError('persistence', 'persistence', e instanceof Error ? e.message : String(e));
    }
    logEvent('kml_import', { count: normalized.length, day: addDay });
    // Clear any open route draft and pull the committed scope so the current
    // sheet and the next open both render the same server projection.
    await syncFromDatabase();
    await refreshKmlQuota();
  }, [
    groupId,
    canEditItinerary,
    notifyLeaderPlace,
    myScopeId,
    kmlScopeId,
    isMySubgroupLeader,
    isLeader,
    syncFromDatabase,
    refreshKmlQuota,
    tripDayForAdd,
  ]);

  const handleLongPressCoordinate = useCallback(
    (coordinates: { latitude: number; longitude: number }) => {
      mediumTap();
      // Same confirm card for leaders and members: editable name, then Add.
      // Members only notify the leader when they tap Add (handlePickDestination).
      // One neighborhood zoom (same scale as search pick) so the pin is confirmable.
      cameraOnLongPress(mapRef.current, coordinates, obliqueLocate);
      const defaultName = t('map.droppedPin');
      const place: PlaceResult = {
        id: `drop-${coordinates.latitude.toFixed(5)}-${coordinates.longitude.toFixed(5)}-${Date.now()}`,
        name: defaultName,
        coordinates,
      };
      pendingPlaceSourceRef.current = 'longpress';
      setPendingPlace(place);
      setPendingPlaceTitle(defaultName);
    },
    [t, obliqueLocate],
  );

  const handleCoordinateDestination = useCallback(
    async (input: CoordinateDestinationInput) => {
      if (!groupId) return;
      const addDay = null;
      if (!canEditItinerary) {
        const ok = await notifyLeaderPlace([{
          title: input.title,
          coordinates: input.coordinates,
          day: addDay,
        }], 'search');
        // Keep coordinate sheet open on failure so the user can retry.
        if (!ok) throw new Error(t('map.setFailedMsg'));
        return;
      }
      {
        const openCount = countOpenDestinations(allScopedDestinations);
        if (shouldBlockNewDestination({
          isPro,
          openCount,
          extraCredits: extraPointCredits,
        })) {
          openPaywall('paywall.triggerDestinations');
          return;
        }
      }
      const result = await runUiAction(
        'map.destination_add_coords',
        async (token) => {
          try {
            await addDestination(
              groupId,
              {
                title: input.title,
                coordinates: input.coordinates,
                day: addDay,
              },
              myScopeId,
            );
            if (!token.isCurrent()) return false;
            logEvent('destination_add', { source: 'coordinates', day: addDay });
            if (obliqueLocate) {
              mapRef.current?.focusOblique(input.coordinates, {
                zoom: PLACE_ZOOM,
                altitude: PLACE_ALTITUDE,
              });
            } else {
              mapRef.current?.centerOn(input.coordinates, {
                zoom: PLACE_ZOOM,
                altitude: PLACE_ALTITUDE,
              });
            }
            void refresh().catch(() => undefined);
            return true;
          } catch (e) {
            logError('destination_add_failed', e, { source: 'coordinates' });
            if (token.isCurrent()) {
              showOperationFailure(t('map.setFailedTitle'), getOperationErrorMessage(e));
            }
            throw e;
          }
        },
        {
          screen: 'Map',
          suppressBanner: true,
          onError: (kind) => {
            if (kind === 'timeout') {
              showOperationFailure(t('map.setFailedTitle'), t('interaction.timeout'));
            }
          },
        },
      );
      // Only close CoordinateDestinationSheet when the task returns true.
      if (result !== true) {
        throw new Error(t('map.setFailedMsg'));
      }
    },
    [
      groupId,
      canEditItinerary,
      notifyLeaderPlace,
      isPro,
      allScopedDestinations,
      extraPointCredits,
      destinations.length,
      obliqueLocate,
      myScopeId,
      refresh,
      openPaywall,
      t,
      tripDayForAdd,
    ],
  );

  const handleGatherPointRequest = useCallback(async (requestId: string, approve: boolean) => {
    if (resolvingGatherRequestId) return;
    setResolvingGatherRequestId(requestId);
    pendingRemovedGatherRequestIdRef.current = requestId;
    // Snapshot before optimistic remove so offline resolve+reload can restore the card.
    const removedSnapshot =
      gatherPointRequests.find((row) => row.id === requestId) ?? null;
    const remainingIds = sortedGatherRequestIds.filter((id) => id !== requestId);
    const nextSelectedId = resolveGatherRequestSelection({
      sortedIds: remainingIds,
      previousSortedIds: sortedGatherRequestIds,
      previousId: selectedGatherRequestId,
      removedId: requestId,
    });
    setSelectedGatherRequestId(nextSelectedId);
    // Optimistic remove so double-taps cannot re-fire the same pending card.
    setGatherPointRequests((prev) => prev.filter((row) => row.id !== requestId));
    try {
      await resolveGatherPointRequestResilient(requestId, approve, {
        groupId: groupId ?? undefined,
      });
      logEvent('gather_request_resolve', { approve, requestId });
      // Refresh is best-effort: approval already committed if we got here.
      try {
        await Promise.all([loadGatheringWorkflow(), refresh()]);
      } catch (refreshError) {
        logError('gather_request_refresh_failed', refreshError, { requestId, approve });
      }
    } catch (error) {
      logError('gather_request_resolve_failed', error, { requestId, approve });
      pendingRemovedGatherRequestIdRef.current = null;
      // Local restore first: reload may also fail offline (#173).
      if (removedSnapshot) {
        const recovered = recoverGatherRequestAfterFailedResolve({
          currentRequests: gatherPointRequests.filter((row) => row.id !== requestId),
          removedSnapshot,
          failedId: requestId,
          fallbackSelectedId: nextSelectedId,
        });
        setGatherPointRequests(recovered.requests);
        setSelectedGatherRequestId(recovered.selectedId);
      } else {
        setSelectedGatherRequestId(nextSelectedId);
      }
      void loadGatheringWorkflow().catch(() => undefined);
      Alert.alert(
        t('map.setFailedTitle'),
        getOperationErrorMessage(error),
      );
    } finally {
      setResolvingGatherRequestId(null);
    }
  }, [
    gatherPointRequests,
    groupId,
    loadGatheringWorkflow,
    refresh,
    resolvingGatherRequestId,
    selectedGatherRequestId,
    sortedGatherRequestIds,
    t,
  ]);

  const { promptCompleteAfterArrival } = useGatheringCompletion({
    groupId,
    user,
    canEditItinerary,
    pendingLeaderTargetId,
    resolveCurrentNavigationSessionId,
    arrivalContext,
    mapMountedRef,
    arrivalContextRef,
    allScopedDestinations,
    completingDestIdsRef,
    remoteAutoCompleteDestIdsRef,
    sessionEligibleMembers,
    activeDestinationArrivals,
    refreshLocalSnapshot,
    t,
    routeDraft,
    prevVisibleDestOrderRef,
    startArrivalCardExit,
    stopRemovedDestination,
    navigationSessionState,
    refresh,
    loadGatheringWorkflow,
    loadHistory,
    members,
    navTargetId,
  });

  // Shared arrive feedback: center check animation (1.6s) + haptic.
  // Complete-stop is scheduled only when opts.promptComplete is true — callers
  // must wait for the arrival write to succeed before setting that flag.
  // Leader skips the plain 「已抵達」Alert.
  afterPersonalArrivalRef.current = (destination, opts) => {
    const alreadyShown = arrivalFeedbackShownRef.current === destination.id;
    if (!alreadyShown) {
      arrivalFeedbackShownRef.current = destination.id;
      setArrivalCelebrateDestId(destination.id);
      alertBuzz();
      // Tracked so startArrivalCardExit can cancel this before the 3.2s hold.
      armCelebrateClearTimer(
        celebrateClearTimersRef.current,
        destination.id,
        PERSONAL_ARRIVAL_CELEBRATE_MS,
        () => {
          setArrivalCelebrateDestId((cur) => (cur === destination.id ? null : cur));
        },
      );
    }
    const COMPLETE_PROMPT_DELAY_MS = 1_600 + 1_000;
    const feedbackContext = arrivalContext;
    if (opts?.promptComplete) {
      // includeSelf only on this post-write path (arrival RPC already succeeded).
      armCelebrateClearTimer(celebrateClearTimersRef.current, `completion:${destination.id}`,
        alreadyShown ? 0 : COMPLETE_PROMPT_DELAY_MS, () => {
          if (mapMountedRef.current && arrivalContextRef.current === feedbackContext) {
            promptCompleteAfterArrival(destination, { includeSelf: true });
          }
        });
      return;
    }

    // The immediate check/haptic confirms the durable local arrival. The
    // committed event owns the shared app notice; an additional Alert here
    // would overlap that same arrival's Realtime/push presentation.
  };

  const requestLeaderStart = useCallback((destination: Destination) => {
    if (!groupId || requestingStartDestId) return;
    setRequestingStartDestId(destination.id);
    void sendCommand(
      groupId,
      'request_start',
      t('gathering.requestStartMessage', { title: destination.title }),
    )
      .then(() => {
        Alert.alert(
          t('gathering.requestStartSentTitle'),
          t('gathering.requestStartSentBody'),
        );
      })
      .catch(() => {
        showOperationFailure(t('map.setFailedTitle'), t('command.sendFailed'));
      })
      .finally(() => setRequestingStartDestId(null));
  }, [groupId, requestingStartDestId, t]);

  const handleArrival = useCallback((destination: Destination, targetUserId: string, arrived: boolean) => {
    // Correction is intentionally narrower than the active-session self
    // arrival path: only the main-team leader may correct a completed main
    // stop, and correction carries a null arrivedAt (it is not an invented
    // personal arrival timestamp).
    const isCompletedMainHistory = isLeader && destination.subgroupId == null && destination.closedAt != null;
    const isActiveSelfUndo = !arrived
      && targetUserId === user?.id
      && journeyActive
      && navTarget?.id === destination.id;
    if (!isCompletedMainHistory && !isActiveSelfUndo) return;
    const memberName = members.find((m) => m.userId === targetUserId)?.name;
    confirmAction({
      title: t(arrived ? 'arrival.markTitle' : 'arrival.undoTitle'),
      message: memberName ? `${memberName} · ${destination.title}` : destination.title,
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
      destructive: !arrived,
    }, () => {
      void (async () => {
        try {
          const sessionId = isCompletedMainHistory
            ? destination.closedBySessionId
              ?? destinationArrivals.find((row) =>
                row.destinationId === destination.id && row.userId === targetUserId
                  && typeof row.navigationSessionId === 'string')?.navigationSessionId
              ?? resolveCurrentNavigationSessionId(destination)
            : resolveCurrentNavigationSessionId(destination);
          if (!sessionId) throw new Error('arrival_correction_session_missing');
          const undoOccurredAt = new Date().toISOString();
          let operation: CoreOperation | void;
          if (isCompletedMainHistory) {
            operation = await correctDestinationArrival({
              destinationId: destination.id,
              targetUserId,
              arrived,
              sessionId,
            });
          } else {
            operation = await setDestinationArrivalAt(destination.id, targetUserId, false, null, sessionId);
          }
          // The correction is another ordered durable intent. Deleting earlier
          // receipts here could remove prerequisites while they are in flight.
          patchLocalArrival(destination.id, targetUserId, arrived, null, sessionId);
          if (isActiveSelfUndo && !arrived && targetUserId === user?.id) {
            const marker: BackgroundManualUndoMarker = {
              actorId: user.id,
              groupId: groupId ?? '',
              destinationId: destination.id,
              navigationSessionId: sessionId,
              operationId: operation?.id ?? null,
              occurredAt: typeof operation?.payload.occurredAt === 'string'
                ? operation.payload.occurredAt
                : undoOccurredAt,
              suppressed: true,
            };
            foregroundUndoMutationSequenceRef.current += 1;
            manualUndoSuppressedRef.current.set(`${arrivalSessionKey}:${destination.id}:${targetUserId}`, marker);
            // The ordered outbox undo is the durable authority if marker storage fails.
            await rememberBackgroundManualUndo(marker).catch(() => undefined);
            if (autoArrivalMarkedRef.current === destination.id) {
              autoArrivalMarkedRef.current = null;
            }
            if (arrivalFeedbackShownRef.current === destination.id) {
              arrivalFeedbackShownRef.current = null;
            }
          }
          await loadGatheringWorkflow().catch(() => undefined);
        } catch (error) {
          setLocalActionError({ title: t('arrival.failedTitle'), message: arrivalErrorMessage(error, t), destinationId: destination.id });
        }
      })();
    });
  }, [arrivalSessionKey, correctDestinationArrival, destinationArrivals, groupId, isLeader, journeyActive, loadGatheringWorkflow, members, navTarget?.id, patchLocalArrival, resolveCurrentNavigationSessionId, setDestinationArrivalAt, t, user?.id]);

  const submitArrivalWithTimestamp = useCallback((destination: Destination, targetUserId: string, arrivedAt: string | null) => {
    void commitPersonalArrival(destination, targetUserId, arrivedAt ?? new Date().toISOString());
  }, [commitPersonalArrival]);

  /** Self Arrive: always write device-now — no multi-option time picker. */
  const handleSelfArrival = useCallback((destination: Destination, targetUserId: string) => {
    submitArrivalWithTimestamp(destination, targetUserId, new Date().toISOString());
  }, [submitArrivalWithTimestamp]);

  const handleDeleteHistory = useCallback((item: VisitedWaypoint) => {
    confirmAction({
      title: t('history.deleteTitle'),
      message: item.name,
      confirmLabel: t('common.delete'),
      destructive: true,
    }, () => {
      void deleteVisitedWaypoint(item.id)
        .then(loadHistory)
        .catch((error) => Alert.alert(
          t('map.setFailedTitle'),
          getOperationErrorMessage(error),
        ));
    });
  }, [loadHistory, t]);
  const {
    codeCopied,
    copyCode,
    goHomeCreateOrJoin,
    inviteBlockedForAnonymousLeader,
    openProfile,
    promptAnonymousLeaderRegistration,
    shareCode,
  } = useGroupActions({
    group,
    isAnonymous,
    members,
    navigation,
    role,
    setOverlay,
    t,
  });

  // --- Subgroups (小隊：邀請制；依 leader_id 判斷小隊隊長) --------------------
  const setRouteDraftDestinations = routeDraft.setDestinations;
  const handleMergedBack = useCallback(() => {
    // Leave wipes subgroup-scoped UI: itinerary draft list, team pill scope.
    setRouteDraftDestinations(null);
    setViewingScope('main');
  }, [setRouteDraftDestinations]);
  const {
    subgroups,
    pendingInvites,
    sentInvites,
    handleAcceptInvite,
    handleDeclineInvite,
    handleInvite,
    doSelfSplit,
    doSelfMerge,
  } = useSubgroupActions({
    groupId,
    userName: user?.name,
    members,
    allSubgroups: state?.subgroups,
    mySubgroupId: myScopeId,
    refresh,
    t,
    onMergedBack: handleMergedBack,
  });

  // ponytail: TEMPORARY test helper — archives every current gathering point to
  // 歷史行程 (record + delete, like a real arrival) and ends navigation, so the
  // history screen can be exercised without physically walking to each stop.
  // Remove once history testing is done.
  const archiveAllForTest = useCallback(async () => {
    if (!groupId) return;
    mediumTap();
    try {
      for (const dest of destinations) {
        // Best-effort archive (mirrors the real arrival flow) — if the
        // visited_waypoints table isn't migrated yet, still drop the stop so
        // the itinerary clears; history just won't populate until it exists.
        try {
          await recordVisitedWaypoint(groupId, dest.title, dest.coordinates);
        } catch (recordErr) {
          logError('history_record_failed', recordErr, { groupId, dest: dest.id });
        }
        await deleteDestination(groupId, dest.id, resolveCurrentNavigationSessionId(dest));
      }
      await stopNavigation();
      refresh();
    } catch (e) {
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [groupId, destinations, stopNavigation, refresh, t, resolveCurrentNavigationSessionId]);

  // Report-a-problem: swap the settings overlay
  // for the feedback form. Uses the SAME `overlay` state so the two are
  // mutually exclusive — opening feedback closes settings, so the translucent
  // panels can never stack and interleave their text.
  const openFeedback = useCallback(() => {
    void runUiAction(
      'map.open_feedback',
      async (token) => {
        lightTap();
        if (!token.isCurrent()) return;
        setOverlay('feedback');
      },
      { screen: 'Map' },
    );
  }, []);
  const {
    flushRouteDraft,
    handleDelete,
    handleDeleteMany,
    handleReorder,
    handleUpdateEmojiColor,
    handleUpdateTripDetails,
    openKmlImportForScope,
  } = useItineraryMutations({
    allScopedDestinations,
    canEditItinerary,
    destinations,
    group,
    groupId,
    isWorkflowContextCurrent,
    markLeaderRevoked,
    navTargetId,
    rawDestinations,
    refresh,
    refreshKmlQuota,
    refreshLocalSnapshot,
    resolveCurrentNavigationSessionId,
    routeDepartureDate,
    routeDraft,
    routeEditorServerDestinations,
    routeTripDays,
    serverDailyAccommodations,
    setKmlScopeId,
    setKmlVisible,
    setRouteSelectedIds,
    showOperationFailure,
    stopRemovedDestination,
    t,
    workflowContext,
  });
  const {
    confirmLeave,
    confirmResetPrefs,
    confirmSignOut,
  } = useAccountActions({
    groupId,
    isLeader,
    leaveGroup,
    navigation,
    reevaluateRouteTour,
    setAddPlaceTourLocalDone,
    signOut,
    t,
    updateProfile,
    user,
    voluntaryLeaveRef,
  });

  const { flock, mySoloActive, myStatusKind, statusMenuItems, applyPresenceMacroKind, openAndroidStatusSheet, mySubgroupId } = useMemberPresence({
    groupId,
    t,
    uiVisible,
    members,
    user,
    activePoint,
    memberRoutes,
    travelMode,
    navTarget,
    activeDestinationArrivals,
    deviceCoordsAcceptedAtMs,
    myScopeId,
    sharingEnabled,
    handleSharingEnabledChange,
  });

  // ⋯ next to avatar: open Settings directly (home / leave live in Settings personal).
  const openSettingsFromSheet = useCallback(() => {
    void runUiAction(
      'map.open_settings',
      () => {
        setSettingsOpen(true);
      },
      { screen: 'Map' },
    );
  }, []);

  // Co-members I could still pull into my team — anyone not me and not already
  // in my subgroup.
  const invitable = useMemo(
    () => flock.filter((f) => f.userId !== user?.id && f.subgroupId !== mySubgroupId),
    [flock, user?.id, mySubgroupId],
  );

  const topFlockMemo = useMemo(
    () => flock.filter((f) => !f.subgroupId),
    [flock],
  );

  const confirmKickMember = useCallback(
    (target: { userId: string; name: string }) => {
      if (!groupId || !isLeader || target.userId === user?.id) return;
      confirmAction(
        {
          title: t('group.kickTitle'),
          message: t('group.kickMsg', { name: target.name }),
          confirmLabel: t('group.kickConfirm'),
          cancelLabel: t('common.cancel'),
          destructive: true,
        },
        () => {
          void runUiAction(
            'map.kick_member',
            async (token) => {
              try {
                await kickGroupMember(groupId, target.userId);
                if (!token.isCurrent()) return;
                await refresh();
              } catch (e) {
                logError('kick_member_failed', e, { groupId, userId: target.userId });
                if (!token.isCurrent()) return;
                Alert.alert(t('group.kickFailed'));
              }
            },
            { screen: 'Map' },
          );
        },
      );
    },
    [groupId, isLeader, user?.id, t, refresh],
  );

  // One flock row, shared by the main list and the subgroup cards.
  // Display: name + "角色 · 距離/狀態 · 最後更新". Solo is NOT on the card.
  const renderFlockRow = useCallback((f: (typeof flock)[number], last: boolean, index?: number) => {
    const isMe = f.userId === user?.id;
    return (
      <FlockRow
        key={`flock-${f.userId}-${index ?? 0}`}
        userId={f.userId}
        name={f.name}
        avatar={f.avatar}
        color={f.color}
        isLeader={f.isLeader}
        solo={f.solo}
        subgroupId={f.subgroupId}
        dist={f.dist}
        arrived={f.arrived}
        lastUpdated={f.lastUpdated ?? undefined}
        sharingEnabled={f.sharingEnabled}
        locationTrackingMode={f.locationTrackingMode}
        locationSource={f.locationSource}
        locationNavigationSessionId={f.locationNavigationSessionId}
        serverTimeOffsetMs={serverTimeOffsetMs}
        syncFailed={Boolean(groupStateError)}
        isMe={isMe}
        canKick={isLeader && !isMe && !f.isLeader}
        last={last}
        styles={styles}
        t={t}
        accent={accent}
        onSelfMerge={doSelfMerge}
        onSelfSplit={doSelfSplit}
        onKick={() => confirmKickMember({ userId: f.userId, name: f.name })}
      />
    );
  }, [user?.id, t, doSelfMerge, doSelfSplit, styles, accent, isLeader, confirmKickMember, serverTimeOffsetMs, groupStateError]);

  // Floating chrome rides just above the sheet's live top edge; its baseline
  // follows the sheet's animated gap to the screen bottom. At full the map
  // chrome is omitted so no Liquid Glass surface sits in an animated opacity
  // ancestor; leaving full mounts it again.
  const recenterStyle = useAnimatedStyle(() => ({
    bottom: heightSV.value + sheetBottomOffset(heightSV.value, detents, insets.bottom) + 12,
  }));
  const atFull = detent === detents.length - 1;
  // Camera insets stay peek-only. Live detent must not move the map.
  const peekSheetH = detents[0];
  const bottomPad = peekSheetH + sheetBottomOffset(peekSheetH, detents, insets.bottom);
  const chromeStage = atFull ? 'full' : detent === 0 ? 'peek' : 'stage1';
  const chromeBottomOffset = atFull
    ? 0
      : (detent === 0
        ? bottomPad
        : detents[1] + sheetBottomOffset(detents[1], detents, insets.bottom)) + 12;
  // MapKit's compass lives below RN siblings, so reserve its band explicitly
  // in the carousel geometry. This keeps the card from painting over the
  // compass while the sheet moves between Peek and Stage 1.
  const compassTop = mapKitChromeLayout({
    safeArea: insets,
    topChrome: 0,
    horizontalInset: gatherCardHorizontalInset(windowWidth),
    windowHeight,
    bottomChrome: chromeBottomOffset,
    stage: chromeStage,
  }).compassOffset.y;
  const CAPSULE_CLEARANCE = 8;
  // The 8pt card reserve is equivalent to compassTop - (insets.top + 8) - 8.
  const carouselMaxHeight = Math.max(
    1,
    compassTop - (insets.top + 8) - CAPSULE_CLEARANCE,
  );
  const carouselFallback = fontLayout.s(160, 140);
  const topPad =
    destinations.length > 0
      ? insets.top + 8 + (carouselHeight > 0 ? carouselHeight : carouselFallback)
      : insets.top + 8;



  // Sheet "下一站" is the first ordered active stop — not the carousel card
  // or current navigation target the user may be viewing.
  const nextStop = useMemo(
    () => nextOrderedDestination(destinations),
    [destinations],
  );
  const nextStopTitle = nextStop?.title;
  const nextStopDistLabel = useMemo(() => {
    if (!uiVisible || !nextStop || !fromCoords) return null;
    return formatDistance(distanceMeters(fromCoords, nextStop.coordinates));
  }, [uiVisible, nextStop, fromCoords]);

  const sheetHeader = useMemo(() => {
    /* Fixed button roles (never swap meanings across screens):
       - Group name → switch group
       - ⋯ → open Settings directly
       - Avatar → personal account only
       - Search → place search only
    */
    const actions = (
      <>
        {!pendingPlace ? (
          <View
            ref={(n) => setTourTargetRef('search', n)}
            collapsable={false}
          >
          <AmicroButton
            icon="search"
            activeIcon="close"
            color="#fff"
            size={46}
            style={styles.headerIconBtn}
            accessibilityLabel={t('map.searchA11y')}
            onPress={lightTap}
            onAnimationComplete={async () => {
              // Ticket 05: animation complete → sheet open complete → reset.
              // Resolve from DestinationSearch / OverlaySheet onOpenComplete
              // (320 ms open), not a two-frame approximation.
              setSearchVisible(true);
              await new Promise<void>((resolve) => {
                searchOpenCompleteResolveRef.current = resolve;
              });
            }}
          />
          </View>
        ) : (
          <View style={styles.headerIconSlot} />
        )}
        <View
          ref={(n) => setTourTargetRef('settings', n)}
          collapsable={false}
        >
        <AmicroButton
          icon="settings-outline"
          mode="rotate"
          color="#fff"
          size={46}
          style={styles.headerIconBtn}
          accessibilityLabel={t('map.overlaySettings')}
          onPress={lightTap}
          onAnimationComplete={openSettingsFromSheet}
        />
        </View>
        <Pressable
          ref={(n) => setTourTargetRef('avatar', n)}
          collapsable={false}
          style={[styles.headerAvatar, {
            backgroundColor: user
              ? (displayMemberAvatar(user.avatar, user.id, user.avatarColor).color ?? accent)
              : accent,
          }]}
          onPress={openProfile}
          accessibilityRole="button"
          accessibilityLabel={t('profile.title')}
        >
          {user ? (
            <HitherText typeRole="emoji" style={styles.headerAvatarEmoji}>
              {displayMemberAvatar(user.avatar, user.id, user.avatarColor).emoji}
            </HitherText>
          ) : (
            <Text style={styles.headerAvatarText}>
              {'?'}
            </Text>
          )}
        </Pressable>
      </>
    );

    // Header is stable across detents (same tree / height) so peek↔mid spring
    // never remeasures detents mid-flight (avoids hitch + reverse settle).
    // Peek: others' avatars only. Solo: no「成員」label — spacer keeps actions right.
    const others = flock.filter((f) => f.userId !== user?.id);

    return (
      <View style={styles.sheetHeaderBlock}>
        <View style={styles.sheetTitleRow}>
          <View
            style={styles.peekAvatarStack}
            accessibilityLabel={others.length > 0 ? t('map.tabMembers') : undefined}
          >
            {others.slice(0, 6).map((f, i) => (
              <View
                key={`peek-av-${f.userId}`}
                style={[
                  styles.peekStackAv,
                  {
                    backgroundColor: f.color,
                    borderColor: 'rgba(255,255,255,0.9)',
                    marginLeft: i === 0 ? 0 : -14,
                    zIndex: 10 - i,
                  },
                ]}
              >
                <HitherText typeRole="emoji" style={styles.peekStackEmoji}>
                  {displayMemberAvatar(f.avatar, f.userId).emoji}
                </HitherText>
              </View>
            ))}
            {others.length > 6 ? (
              <View style={[styles.peekStackAv, styles.peekStackMore, { marginLeft: -14, zIndex: 0 }]}>
                <Text style={styles.peekStackInitial}>+{others.length - 6}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.peekActions}>{actions}</View>
        </View>
      </View>
    );
  }, [
    styles, t, pendingPlace, user, accent, openProfile, openSettingsFromSheet, flock,
  ]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);
  const openHistoryOverlay = useCallback(() => setOverlay('history'), []);
  const openCustomQuickCommand = useCallback((slot = 0) => {
    setCustomSlot(typeof slot === 'number' ? slot : 0);
    setOverlay('custom');
  }, []);
  const openPaywallCb = useCallback(() => {
    // SwiftUI's sheet must finish dismissing before RN presents its Modal.
    setPaywallPendingAfterSettings(true);
    setSettingsOpen(false);
  }, []);
  const handleSettingsDismissComplete = useCallback(() => {
    if (!paywallPendingAfterSettings) return;
    setPaywallPendingAfterSettings(false);
    openPaywall();
  }, [openPaywall, paywallPendingAfterSettings]);

  const selectSheetPane = useCallback((key: SheetPaneKey) => {
    if (key === selectedSection) return;
    setSelectedSection(key);
  }, [selectedSection]);

  // Reanimated sheet height never enters Yoga. measureInWindow on tab nodes
  // still reports peek layout (Y near the bottom). Snap Stage Two targets to
  // the live mid chrome so the hole sits on 成員/路線/工具/商店, not 精準定位.
  const measureSheetTourTarget = useCallback(
    async (id: TourTargetId) => {
      const rect = await measureTourTarget(id);
      if (!rect || !isSheetTourTarget(id)) return rect;
      const mid = detents.length > 1 ? detents[1] : detents[0];
      return snapTourRectY(
        rect,
        expectedSheetChromeTop({
          windowHeight,
          sheetHeight: mid,
          headerHeight: sheetHeaderH,
        }),
      );
    },
    [measureTourTarget, detents, windowHeight, sheetHeaderH],
  );

  const collapseActiveCardForExpandedSheet = useCallback(() => {
    const activeDestination = destinations[selectedIndex];
    if (activeDestination) collapseCard(activeDestination.id);
  }, [collapseCard, destinations, selectedIndex]);

  const setSheetMid = useCallback(() => {
    // Stage Two = mid detent (index 1 when available).
    const midIndex = detents.length > 1 ? 1 : 0;
    if (midIndex > 0) collapseActiveCardForExpandedSheet();
    setDetent(midIndex);
    heightSV.value = detents[midIndex] ?? detents[0];
  }, [collapseActiveCardForExpandedSheet, detents, heightSV]);

  // Expanded cards must never render underneath an expanded sheet. Collapse
  // to Peek and reveal the larger card in the same event.
  const toggleGatheringCard = useCallback((id: string) => {
    const expanded = isCardExpanded(id);
    if (expanded) {
      toggleCard(id);
      return;
    }
    if (detent === 0) {
      expandCard(id);
      return;
    }
    setDetent(0);
    expandCard(id);
    heightSV.value = withSpring(
      detents[0],
      { stiffness: 320, damping: 29, mass: 1 },
    );
  }, [detent, detents, expandCard, heightSV, isCardExpanded]);

  const handleSheetIndexChange = useCallback((nextIndex: number) => {
    if (nextIndex > 0) collapseActiveCardForExpandedSheet();
    setDetent(nextIndex);
  }, [collapseActiveCardForExpandedSheet]);

  // Single tour destination: plan, expand, availability, and measured refs must match.
  // Prefer shared navigation target when it is on the carousel; else selected card.
  const tourDestinationId = useMemo(() => {
    const ids = destinations.map((d) => d.id);
    return pickTourDestinationId({
      destinationIds: ids,
      selectedIndex,
      preferredId: sharedTargetId ?? null,
    });
  }, [destinations, selectedIndex, sharedTargetId]);

  const tourDestination = useMemo(
    () => destinations.find((d) => d.id === tourDestinationId) ?? destinations[0] ?? null,
    [destinations, tourDestinationId],
  );

  // Mirror the *tour* card's control visibility so steps never describe missing chrome.
  const tourControlAvailability = useMemo(() => {
    const dest = tourDestination;
    if (!dest) {
      return { navCommandVisible: false, personalArriveVisible: false };
    }
    const { flockNavigatingThis } = deriveCardNavFlags({
      destId: dest.id,
      isLeader,
      sharedTargetId,
      pendingLeaderTargetId,
      journeyBusy,
    });
    const canMarkArrival = canMarkDestinationArrival({
      destId: dest.id,
      destOrder: dest.order,
      destSubgroupId: dest.subgroupId,
      scopedDestinations: destinations,
      myArrivedDestinationIds: myCompletedDestinationIds,
      activeDestinationId: navigationSessionState.session?.destinationId,
    });
    // Product: 「已抵達」only while team nav is active on this card
    // (Start splits it out; End swallows it back into Start width).
    const showArrivalControl =
      Boolean(user?.id)
      && canMarkArrival
      && !dest.closedAt
      && flockNavigatingThis;
    const navCmd = resolveNavCommand({
      isLeader,
      personallyArrived: myCompletedDestinationIds.has(dest.id),
      flockNavigatingThis,
      isNextTeamPending: true,
      teamStartBlocked: false,
    });
    return {
      navCommandVisible: navCmd.kind !== 'hidden',
      personalArriveVisible: showArrivalControl,
    };
  }, [
    tourDestination,
    navigationSessionState.session?.destinationId,
    destinations,
    isLeader,
    sharedTargetId,
    pendingLeaderTargetId,
    journeyBusy,
    myCompletedDestinationIds,
    user?.id,
  ]);

  const [tourReduceMotion, setTourReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled?.().then((enabled) => {
      if (mounted) setTourReduceMotion(Boolean(enabled));
    });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setTourReduceMotion,
    );
    return () => {
      mounted = false;
      // RN returns { remove } on modern; older returns remove function.
      if (sub && typeof (sub as { remove?: () => void }).remove === 'function') {
        (sub as { remove: () => void }).remove();
      }
    };
  }, []);

  const onTourActiveChange = useCallback(
    (active: boolean, destinationId: string | null) => {
      if (!active || !destinationId) return;
      const ids = destinations.map((d) => d.id);
      const idx = tourDestinationIndex(ids, destinationId);
      if (idx !== selectedIndex) {
        setSelectedIndex(idx);
        // Snap carousel so measured refs attach to the same card as the plan.
        requestAnimationFrame(() => {
          carouselRef.current?.scrollTo?.({ x: idx * windowWidth, animated: false });
        });
      }
    },
    [destinations, selectedIndex, setSelectedIndex, windowWidth],
  );

  const {
    tourActive,
    step: tourStep,
    targetRect: tourTargetRect,
    onNext: onTourNext,
    onPrev: onTourPrev,
    canGoPrev: tourCanGoPrev,
    transitioning: tourTransitioning,
    completing: tourCompleting,
    placementRect: tourPlacementRect,
  } = useGroupFeatureTour({
    groupId,
    destinationCount: destinations.length,
    passiveMode: inPassiveMode,
    denseChrome: showDenseChrome,
    isLeader: !!isLeader,
    accountPreferences: user?.preferences ?? null,
    accountId: user?.id ?? null,
    expandCard,
    pauseAutoCollapse,
    resumeAutoCollapse,
    tourDestinationId,
    selectedDestinationId: selectedDestination?.id ?? null,
    setSheetMid,
    selectSheetPane,
    measureTarget: measureSheetTourTarget,
    navCommandVisible: tourControlAvailability.navCommandVisible,
    personalArriveVisible: tourControlAvailability.personalArriveVisible,
    onTourActiveChange,
  });
  const {
    handleEntitlementActivated,
    openPaywallForLiveActivity,
    refreshStoreEntitlements,
  } = useStoreEntitlements({
    groupId,
    isAnonymous,
    isPro,
    openPaywall,
    refreshEntitlement,
    setExtraPointCredits,
    setLiveActivityEffective,
    syncFromDatabase,
  });

  // ─── 成員：位置、狀態、個別操作、小隊（無「成員」標題） ────────────────
  const membersPaneBody = useMemo(() => (
    <MembersPane
      accent={accent}
      applyPresenceMacroKind={applyPresenceMacroKind}
      flock={flock}
      fontBucket={fontBucket}
      handleAcceptInvite={handleAcceptInvite}
      handleDeclineInvite={handleDeclineInvite}
      handleSharingEnabledChangeAnimated={handleSharingEnabledChangeAnimated}
      highAccuracy={highAccuracy}
      myStatusKind={myStatusKind}
      mySubgroupId={mySubgroupId}
      openAndroidStatusSheet={openAndroidStatusSheet}
      pendingInvites={pendingInvites}
      refreshAllLocations={refreshAllLocations}
      refreshCooldownUntil={refreshCooldownUntil}
      refreshingLocations={refreshingLocations}
      renderFlockRow={renderFlockRow}
      sentInvites={sentInvites}
      setHighAccuracy={setHighAccuracy}
      setInviteSheetOpen={setInviteSheetOpen}
      setOverlay={setOverlay}
      sharingApplying={sharingApplying}
      sharingEnabled={sharingEnabled}
      statusMenuItems={statusMenuItems}
      styles={styles}
      subgroups={subgroups}
      t={t}
      topFlockMemo={topFlockMemo}
    />
  ), [
    t, styles, refreshingLocations, refreshAllLocations, refreshCooldownUntil, accent, highAccuracy,
    setHighAccuracy, pendingInvites, fontBucket, handleAcceptInvite, handleDeclineInvite,
    subgroups, topFlockMemo, renderFlockRow, flock, mySubgroupId, sentInvites,
    applyPresenceMacroKind, openAndroidStatusSheet, myStatusKind, statusMenuItems,
    sharingEnabled, handleSharingEnabledChangeAnimated, sharingApplying,
  ]);

  // ─── 路線：集合點、排序、Google Maps 匯入、歷史 ───────────────────────
  const opsOpenCount = exceptionOpenCount + coordination.openCount;
  const gatherRequestPageW = Math.max(200, windowWidth - 32);
  const routeMainDestinations = useMemo(
    () => (state?.destinations ?? []).filter((destination) => destination.subgroupId == null),
    [state?.destinations],
  );
  const routeSubgroupDestinations = useMemo(
    () => myScopeId
      ? (state?.destinations ?? []).filter((destination) => destination.subgroupId === myScopeId)
      : [],
    [myScopeId, state?.destinations],
  );
  const routeScopeStorageKey = user?.id && groupId
    ? `hither.routeScopeCollapse.v1:${user.id}:${groupId}`
    : null;
  const [routeScopeExpanded, setRouteScopeExpanded] = useState<Record<string, boolean>>(
    (): Record<string, boolean> => (myScopeId ? { main: false, subgroup: true } : { main: true }),
  );
  useEffect(() => {
    let cancelled = false;
    const defaults: Record<string, boolean> = myScopeId
      ? { main: false, subgroup: true }
      : { main: true };
    if (!routeScopeStorageKey) {
      setRouteScopeExpanded(defaults);
      return () => { cancelled = true; };
    }
    void AsyncStorage.getItem(routeScopeStorageKey).then((stored) => {
      if (cancelled) return;
      try {
        const parsed = stored ? JSON.parse(stored) as Record<string, boolean> : null;
        setRouteScopeExpanded(parsed && typeof parsed === 'object' ? { ...defaults, ...parsed } : defaults);
      } catch {
        setRouteScopeExpanded(defaults);
      }
    }).catch(() => {
      if (!cancelled) setRouteScopeExpanded(defaults);
    });
    return () => { cancelled = true; };
  }, [myScopeId, routeScopeStorageKey]);
  const toggleRouteScope = useCallback((scopeKey: string) => {
    setRouteScopeExpanded((current) => {
      const next = { ...current, [scopeKey]: !current[scopeKey] };
      if (routeScopeStorageKey) void AsyncStorage.setItem(routeScopeStorageKey, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, [routeScopeStorageKey]);
  const routeDailyByDate = useMemo(
    () => Object.fromEntries(
      dailyAccommodations.map((d) => [
        d.stayDate,
        { id: d.id, stayDate: d.stayDate, title: d.title, coordinates: d.coordinates },
      ]),
    ),
    [dailyAccommodations],
  );
  const renderRouteScope = useCallback(({
    scopeKey,
    title,
    destinations: scopeDestinations,
    canEdit,
    scopeId,
  }: {
    scopeKey: 'main' | 'subgroup';
    title: string;
    destinations: Destination[];
    canEdit: boolean;
    scopeId?: string;
  }) => {
    const expanded = canEdit
      || (routeScopeExpanded[scopeKey] ?? (scopeKey === 'subgroup' || !myScopeId));
    const count = countOpenDestinations(scopeDestinations);
    return (
      <View
        key={scopeKey}
        testID={scopeKey === 'main' ? 'map-reorder-action-card' : `route-scope-${scopeKey}`}
        style={styles.routeScopeBlock}
      >
        <Pressable
          style={styles.routeScopeHeader}
          onPress={canEdit ? undefined : () => toggleRouteScope(scopeKey)}
          disabled={canEdit}
          accessibilityRole={canEdit ? undefined : 'button'}
          accessibilityState={{ expanded, disabled: canEdit }}
        >
          <Text style={styles.routeScopeTitle}>{title}</Text>
          <Text style={styles.routeScopeCount}>{count}</Text>
          {!canEdit ? (
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={glass.textTertiary}
            />
          ) : null}
        </Pressable>
        {expanded ? (canEdit ? (
          <View style={styles.reorderActionCard}>
            <AmicroButton
              icon="pencil-outline"
              activeIcon="checkmark"
              active={editButtonActive}
              activeOnPress
              resetAfterComplete={false}
              color={accent}
              activeColor={accent}
              size={48}
              label={t('map.stopsReorder', { count })}
              labelColor="#fff"
              accessibilityLabel={t('map.stopsReorder', { count })}
              testID={scopeKey === 'main' ? 'map-edit-itinerary' : 'map-edit-itinerary-subgroup'}
              style={styles.reorderActionPressable}
              onPress={() => {
                lightTap();
                if (!routeDraft.openEditor(scopeId, scopeDestinations)) return;
                setEditButtonActive(true);
              }}
              onAnimationComplete={() => setOverlay('route')}
            />
          </View>
        ) : (
          <View style={styles.routeScopeContent}>
            <DestinationReorderList
              groupId={groupId ?? undefined}
              destinations={openDestinationsForReorder(scopeDestinations)}
              canReorder={false}
              showTripDetails={false}
              tripDays={routeTripDays}
              departureDate={routeDepartureDate}
              onImport={() => { void openKmlImportForScope(scopeId); }}
              favoritePlaces={favoritePlaces}
              onPickFavorite={(favorite, day) => {
                void notifyLeaderPlace([{
                  title: favorite.title,
                  address: favorite.address,
                  coordinates: favorite.coordinates,
                  day,
                }], 'search', scopeId);
              }}
              onDeleteFavorite={user?.id ? (favorite) => {
                const snapshot = favoritePlaces;
                setFavoritePlaces((prev) => prev.filter((item) => item.id !== favorite.id));
                void unsaveFavoritePlace(favorite.id).catch(() => setFavoritePlaces(snapshot));
              } : undefined}
              colors={dark}
              emptyLabel={t('settings.noDestinations')}
              dailyByDate={routeDailyByDate}
              accountId={user?.id}
            />
          </View>
        )) : null}
      </View>
    );
  }, [
    accent,
    dark,
    editButtonActive,
    favoritePlaces,
    groupId,
    myScopeId,
    notifyLeaderPlace,
    openDestinationsForReorder,
    openKmlImportForScope,
    routeDepartureDate,
    routeTripDays,
    group?.departureDate,
    group?.tripDays,
    routeDailyByDate,
    routeScopeExpanded,
    styles,
    t,
    toggleRouteScope,
    user?.id,
  ]);
  useEffect(() => {
    const page = gatherRequestPageIndex(
      sortedGatherRequestIds,
      selectedGatherRequestId,
    );
    gatherRequestPagerRef.current?.scrollTo({
      x: page * gatherRequestPageW,
      animated: true,
    });
  }, [gatherRequestPageW, selectedGatherRequestId, sortedGatherRequestIds]);
  const routePaneBody = useMemo(() => (
    <RoutePane
      accent={accent}
      canEditItinerary={canEditItinerary}
      destinations={destinations}
      extraPointCredits={extraPointCredits}
      gatherRequestPageW={gatherRequestPageW}
      gatherRequestPagerRef={gatherRequestPagerRef}
      handleGatherPointRequest={handleGatherPointRequest}
      isLeader={isLeader}
      isMySubgroupLeader={isMySubgroupLeader}
      members={members}
      myScopeId={myScopeId}
      nextStopDistLabel={nextStopDistLabel}
      nextStopTitle={nextStopTitle}
      openHistoryOverlay={openHistoryOverlay}
      opsOpenCount={opsOpenCount}
      renderRouteScope={renderRouteScope}
      resolvingGatherRequestId={resolvingGatherRequestId}
      routeMainDestinations={routeMainDestinations}
      routeSubgroupDestinations={routeSubgroupDestinations}
      selectedGatherRequestId={selectedGatherRequestId}
      setOverlay={setOverlay}
      setSelectedGatherRequestId={setSelectedGatherRequestId}
      sortedGatherRequestIds={sortedGatherRequestIds}
      sortedGatherRequests={sortedGatherRequests}
      styles={styles}
      subgroups={subgroups}
      t={t}
    />
  ), [
    t, styles, nextStopTitle, nextStopDistLabel, destinations.length,
    openHistoryOverlay, isLeader, canEditItinerary, openForRouteEditor,
    groupId, routeTripDays, routeDepartureDate, group, dailyAccommodations,
    opsOpenCount, editButtonActive, extraPointCredits, accent,
    sortedGatherRequests, sortedGatherRequestIds, selectedGatherRequestId,
    gatherRequestPageW, resolvingGatherRequestId, members, subgroups,
    handleGatherPointRequest, renderRouteScope, routeMainDestinations,
    routeSubgroupDestinations, myScopeId, isMySubgroupLeader,
  ]);

  // ─── 工具：同行者模式入口 → 定位分享 → 抵達距離 → 快捷指令 ─────────
  // Premium (isPro) or store LA entitlement both hide the locked deep-link.
  const liveActivityUnlocked = liveActivityEffective || isPro;
  const handleToolsLiveActivityChange = useCallback((next: boolean) => {
    if (!next) {
      void setLiveActivityEnabled(false);
      return;
    }
    if (!liveActivityUnlocked) {
      void setLiveActivityEnabled(false);
      openPaywallForLiveActivity();
      return;
    }
    void setLiveActivityEnabled(true);
  }, [liveActivityUnlocked, openPaywallForLiveActivity, setLiveActivityEnabled]);
  const toolsPaneBody = useMemo(() => (
    <ToolsPane
      accent={accent}
      arrivalRadiusM={arrivalRadiusM}
      dark={dark}
      groupId={groupId}
      handleToolsLiveActivityChange={handleToolsLiveActivityChange}
      isLeader={isLeader}
      liveActivityEnabled={liveActivityEnabled}
      liveActivityUnlocked={liveActivityUnlocked}
      openCustomQuickCommand={openCustomQuickCommand}
      setArrivalRadiusM={setArrivalRadiusM}
      setOverlay={setOverlay}
      setPassiveCompanionMode={setPassiveCompanionMode}
      styles={styles}
      t={t}
    />
  ), [
    styles, t, groupId, isLeader, dark, openCustomQuickCommand, accent,
    arrivalRadiusM, setArrivalRadiusM, setPassiveCompanionMode,
    liveActivityEnabled, liveActivityUnlocked, handleToolsLiveActivityChange,
  ]);

  const storePaneBody = useMemo(() => (
    <StorePane
      groupId={groupId}
      groupName={membership?.group.name ?? null}
      isAnonymous={!!isAnonymous}
      personalPremiumActive={premiumProjection.personalPremiumActive}
      accent={accent}
      t={t}
      highlightProductCode={storeHighlightProduct}
      onHighlightConsumed={() => setStoreHighlightProduct(null)}
      onRequireRegistration={() => {
        lightTap();
        setOverlay('account');
      }}
      onEntitlementChanged={() => {
        void refreshStoreEntitlements();
      }}
      onOpenSubscribe={() => openPaywall(undefined, { showRestore: false })}
    />
  ), [
    groupId, membership?.group.name, isAnonymous, premiumProjection.personalPremiumActive, accent, t,
    storeHighlightProduct, refreshStoreEntitlements, openPaywall,
  ]);

  const sheetPaneOptions = useMemo<SheetPaneTabOption[]>(
    () => [
      { key: 'members', label: t('map.tabMembers') },
      { key: 'route', label: t('map.tabRoute') },
      { key: 'tools', label: t('map.tabTools') },
      { key: 'store', label: t('map.tabStore') },
    ],
    [t],
  );

  const sheetChildren = useMemo(() => (
    <>
      {/* Native iOS Liquid Glass selector; Android keeps its system fallback. */}
      <View
        style={styles.sheetPaneToggleWrap}
        ref={(n) => setTourTargetRef('stageTwoPlacement', n)}
        collapsable={false}
        testID="tour-stage-two-placement"
      >
        <SheetPaneTabs
          options={sheetPaneOptions}
          selectedSection={selectedSection}
          onChange={selectSheetPane}
          onTabNode={(key, node) => {
            const targetId =
              key === 'members'
                ? 'paneMembers'
                : key === 'route'
                  ? 'paneRoute'
                  : key === 'tools'
                    ? 'paneTools'
                    : 'paneStore';
            setTourTargetRef(targetId, node);
          }}
        />
      </View>

      <View testID="sheet-pane-content-area">
        <View
          style={selectedSection === 'members' ? undefined : styles.sheetPaneHidden}
          pointerEvents={selectedSection === 'members' ? 'auto' : 'none'}
          collapsable={false}
        >
          {membersPaneBody}
        </View>
        <View
          style={selectedSection === 'route' ? undefined : styles.sheetPaneHidden}
          pointerEvents={selectedSection === 'route' ? 'auto' : 'none'}
          collapsable={false}
        >
          {routePaneBody}
        </View>
        <View
          style={selectedSection === 'tools' ? undefined : styles.sheetPaneHidden}
          pointerEvents={selectedSection === 'tools' ? 'auto' : 'none'}
          collapsable={false}
        >
          {toolsPaneBody}
        </View>
        <View
          style={selectedSection === 'store' ? undefined : styles.sheetPaneHidden}
          pointerEvents={selectedSection === 'store' ? 'auto' : 'none'}
          collapsable={false}
        >
          {storePaneBody}
        </View>
      </View>
    </>
  ), [
    styles, accent, selectedSection, sheetPaneOptions, selectSheetPane,
    membersPaneBody, routePaneBody, toolsPaneBody, storePaneBody,
  ]);

  if (loading && !state) {
    // Passive mode must still offer switch-back during first load.
    if (inPassiveMode) {
      return (
        <View style={styles.flex}>
          <View style={styles.loading}>
            <WaveLoading color={accent} size="large" />
            <Text style={styles.loadingText}>{t('map.loading')}</Text>
          </View>
          <PassiveCompanionPanel
            model={passiveModel}
            accent={accent}
            groupId={groupId}
            isLeader={!!isLeader}
            navigationDestination={null}
            onSwitchBack={exitPassiveCompanionMode}
            onOpenExternalNavigation={openExternalNavigation}
            onConfigureCustom={openCustomQuickCommand}
          />
        </View>
      );
    }
    return (
      <View style={styles.loading}>
        <WaveLoading color={accent} size="large" />
        <Text style={styles.loadingText}>{t('map.loading')}</Text>
      </View>
    );
  }

  // OTA-04: offline cold start with no prior snapshot — clear empty outcome.
  // OTA-07: passive still mounts switch-back so users are never trapped.
  if (!state && (emptyLocalSnapshot || loadError)) {
    if (inPassiveMode) {
      return (
        <View style={styles.flex}>
          <View style={styles.loading}>
            <Text style={styles.loadingText}>{loadError?.kind === 'offline_transport' ? t('coreData.emptySnapshot') : loadError?.kind === 'unknown' ? t('coreData.loadFailed') : groupStateError ?? t('coreData.loadFailed')}</Text>
            {refreshing ? <WaveLoading color={accent} /> : null}
            <Pressable
              disabled={refreshing}
              accessibilityState={{ disabled: refreshing, busy: refreshing }}
              onPress={() => { void refresh(); }}
              accessibilityRole="button"
              accessibilityLabel={t('interaction.retry')}
              style={{ marginTop: 16, paddingHorizontal: 16, paddingVertical: 10 }}
            >
              <Text style={[styles.loadingText, { color: accent }]}>
                {t('interaction.retry')}
              </Text>
            </Pressable>
          </View>
          <PassiveCompanionPanel
            model={passiveModel}
            accent={accent}
            groupId={groupId}
            isLeader={!!isLeader}
            navigationDestination={null}
            onSwitchBack={exitPassiveCompanionMode}
            onOpenExternalNavigation={openExternalNavigation}
            onConfigureCustom={openCustomQuickCommand}
          />
        </View>
      );
    }
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>{loadError?.kind === 'offline_transport' ? t('coreData.emptySnapshot') : loadError?.kind === 'unknown' ? t('coreData.loadFailed') : groupStateError ?? t('coreData.loadFailed')}</Text>
        {refreshing ? <WaveLoading color={accent} /> : null}
        <Pressable
          disabled={refreshing}
          accessibilityState={{ disabled: refreshing, busy: refreshing }}
          onPress={() => { void refresh(); }}
          accessibilityRole="button"
          accessibilityLabel={t('interaction.retry')}
          style={{ marginTop: 16, paddingHorizontal: 16, paddingVertical: 10 }}
        >
          <Text style={[styles.loadingText, { color: accent }]}>
            {t('interaction.retry')}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      {/* Passive mode unmounts the map to free GPU/native tiles; switch-back remounts. */}
      {!inPassiveMode ? (
        <GroupMap
          active={uiVisible}
          ref={mapRef}
          cameraState={mapCameraState}
          members={members}
          showsUserLocation={foregroundLocation.owner === 'mapkit'}
          gathering={activePoint}
          destinations={mapDestinations}
          dailyAccommodations={mapDailyAccommodations}
          stayCalloutLabel={t('stay.defaultTitle')}
          pendingPlace={pendingPlace}
          currentUserId={user?.id}
          initialCenter={mapInitialCenter ?? undefined}
          // Pulse only while journey is active with a nav target (not paused
          // selection). Spec: stop when navigation ends.
          activeDestinationId={
            journeyActive && navTarget?.id ? navTarget.id : null
          }
          completedDestinationIds={teamCompletedDestinationIds}
          // Show the planned path for everyone while journey is live (leader
          // broadcast or local follower plan). When paused, keep a light path
          // to the selected card so ETA still makes sense.
          routePoints={selfRoute?.points}
          selfCoordinates={fromCoords}
          routeColor={accent}
          // Settled detent only (not heightSV) so we don't re-render the map
          // mid-drag; top tracks measured carousel card height.
          topOverlap={topPad}
          bottomOverlap={bottomPad}
          chromeStage={chromeStage}
          chromeBottomOffset={chromeBottomOffset}
          onUserLocationSample={
            Platform.OS === 'ios' ? consumeForegroundSample : undefined
          }
          onLongPressCoordinate={handleLongPressCoordinate}
          onRequestGoHome={goHomeCreateOrJoin}
        />
      ) : (
        <View style={[styles.flex, { backgroundColor: '#0c0e12' }]} />
      )}
      {/* #175: navigation response banner removed entirely (not moved to Tools). */}

      {/* OTA-07: reduced presentation — covers dense chrome; same state tree. */}
      {inPassiveMode ? (
        <PassiveCompanionPanel
          model={passiveModel}
          accent={accent}
          groupId={groupId}
          isLeader={!!isLeader}
          navigationDestination={navTarget ?? activePoint ?? selectedDestination ?? null}
          onSwitchBack={exitPassiveCompanionMode}
          onOpenExternalNavigation={openExternalNavigation}
          onConfigureCustom={openCustomQuickCommand}
        />
      ) : null}

      {/* Group pill — moved to bottom left, tracking sheet like recenter capsule. */}
      {uiVisible && showDenseChrome && !confirmCardReady && !atFull && (
      <Animated.View
        style={[styles.teamCapsuleWrap, recenterStyle]}
        pointerEvents={atFull ? 'none' : 'box-none'}
      >
        <View style={{ alignItems: 'flex-start' }}>
          <Pressable
            style={({ pressed }) => [styles.groupPill, pressed && styles.groupPillPressed]}
            accessibilityLabel={`${group?.name ?? 'Hither'} · ${members.length}`}
            onPress={() => {
              if (myScopeId) {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
                setViewingScope(prev => prev === 'sub' ? 'main' : 'sub');
              }
            }}
          >
            <SwiftUIGlassSurface
              shape="capsule"
              style={StyleSheet.absoluteFill}
              fallbackTintColor={Platform.OS === 'android' ? glass.pill : undefined}
            />
            <Text style={styles.groupPillText} numberOfLines={1}>
              {`${group?.avatar ?? '👥'} ${group?.name ?? 'Hither'} · ${members.length}`}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
      )}


      {/* Recenter capsule — fit-all (top) + locate-me (bottom), always both. */}
      {uiVisible && showDenseChrome && !confirmCardReady && !atFull && (
      <Animated.View
        style={[styles.recenter, recenterStyle]}
        pointerEvents={atFull ? 'none' : 'auto'}
      >
        <MapRecenterControl
          onFitAll={fitAllMembers}
          onLocate={locateMe}
          fitAllLabel={t('map.fitAllA11y')}
          locateLabel={t('map.locateA11y')}
          style={styles.recenterCapsule}
        />
      </Animated.View>
      )}

      {/* Add-gather-point confirm card — a bottom sheet-style card shown after
          picking a search result. Cancel sits above the title and place controls. */}
      <AddPlaceConfirmCard
        accent={accent}
        addPlaceTourStep={addPlaceTourStep}
        confirmCardReady={confirmCardReady}
        confirmCardStyle={confirmCardStyle}
        confirmKeyboardHeight={confirmKeyboardHeight}
        confirmPlaceBusy={confirmPlaceBusy}
        confirmPlaceBusyRef={confirmPlaceBusyRef}
        dismissConfirmCard={dismissConfirmCard}
        favoriteBusy={favoriteBusy}
        fromCoords={fromCoords}
        handlePickDestination={handlePickDestination}
        insets={insets}
        mapRef={mapRef}
        obliqueLocate={obliqueLocate}
        pendingIsFavorite={pendingIsFavorite}
        pendingPlace={pendingPlace}
        pendingPlaceTitle={pendingPlaceTitle}
        setConfirmPlaceBusy={setConfirmPlaceBusy}
        setPendingPlaceTitle={setPendingPlaceTitle}
        setTourTargetRef={setTourTargetRef}
        styles={styles}
        t={t}
        togglePendingFavorite={togglePendingFavorite}
        user={user}
      />

      {/* Add Place contextual tour — measured targets + full-screen blocker. */}
      <GroupFeatureTourOverlay
        visible={
          addPlaceTourStep != null
          && pendingPlace != null
          && ADD_PLACE_TOUR_STEPS[addPlaceTourStep] != null
        }
        title={
          addPlaceTourStep != null && ADD_PLACE_TOUR_STEPS[addPlaceTourStep]
            ? t(ADD_PLACE_TOUR_STEPS[addPlaceTourStep].titleKey as TranslationKey)
            : ''
        }
        body={
          addPlaceTourStep != null && ADD_PLACE_TOUR_STEPS[addPlaceTourStep]
            ? t(ADD_PLACE_TOUR_STEPS[addPlaceTourStep].bodyKey as TranslationKey)
            : ''
        }
        ctaLabel={
          addPlaceTourStep != null
          && addPlaceTourStep >= ADD_PLACE_TOUR_STEPS.length - 1
            ? t('tour.getStarted')
            : t('tour.next')
        }
        targetRect={addPlaceTourTargetRect}
        ctaDisabled={addPlaceTourTransitioning}
        onNext={() => {
          if (addPlaceTourStep == null || addPlaceTourTransitioning) return;
          const next = addPlaceTourStep + 1;
          if (next >= ADD_PLACE_TOUR_STEPS.length) {
            setAddPlaceTourStep(null);
            setAddPlaceTourTargetRect(null);
            setAddPlaceTourTransitioning(false);
            setAddPlaceTourLocalDone(true);
            // Final-step-only persistence (pending retry if account write fails).
            void completeAddPlaceTour({
              accountId: user?.id,
              existingPreferences: user?.preferences ?? null,
            });
            return;
          }
          setAddPlaceTourTargetRect(null);
          setAddPlaceTourStep(next);
        }}
        canGoPrev={addPlaceTourStep != null && addPlaceTourStep > 0}
        onPrev={() => {
          if (addPlaceTourStep == null || addPlaceTourStep <= 0 || addPlaceTourTransitioning) return;
          setAddPlaceTourTargetRect(null);
          setAddPlaceTourStep(addPlaceTourStep - 1);
        }}
        reduceMotion={tourReduceMotion}
      />

      {/* Gathering-point carousel — above locate/group capsules; sheet wrapper
          zIndex is higher so the sheet covers cards on overlap. */}
      <GatheringCarousel
        accent={accent}
        activeDestinationArrivals={activeDestinationArrivals}
        activePoint={activePoint}
        appState={appState}
        arrivalCelebrateDestId={arrivalCelebrateDestId}
        arrivalExitRecords={arrivalExitRecords}
        arrivalSplitSeenRef={arrivalSplitSeenRef}
        atFull={atFull}
        canEditItinerary={canEditItinerary}
        carouselMaxHeight={carouselMaxHeight}
        carouselRef={carouselRef}
        colors={colors}
        destinationIds={destinationIds}
        destinations={destinations}
        fontBucket={fontBucket}
        fromCoords={fromCoords}
        gatherCardMarqueeSpeed={gatherCardMarqueeSpeed}
        gatherCardRadius={gatherCardRadius}
        gatherCardTitleMarquee={gatherCardTitleMarquee}
        handleArrival={handleArrival}
        handleMomentumEnd={handleMomentumEnd}
        handleScrollBeginDrag={handleScrollBeginDrag}
        handleSelfArrival={handleSelfArrival}
        insets={insets}
        isCardExpanded={isCardExpanded}
        isLeader={isLeader}
        journeyActive={journeyActive}
        journeyBusy={journeyBusy}
        localActionError={localActionError}
        mapFocused={mapFocused}
        meetRedMin={meetRedMin}
        members={members}
        myCompletedDestinationIds={myCompletedDestinationIds}
        myScopeId={myScopeId}
        narrowScreen={narrowScreen}
        navTarget={navTarget}
        navTargetId={navTargetId}
        openExternalNavigation={openExternalNavigation}
        openMeetTimePicker={openMeetTimePicker}
        pendingLeaderTargetId={pendingLeaderTargetId}
        personalDistanceM={personalDistanceM}
        personalEtaSeconds={personalEtaSeconds}
        powerState={powerState}
        promptCompleteAfterArrival={promptCompleteAfterArrival}
        registerCardActivity={registerCardActivity}
        requestLeaderStart={requestLeaderStart}
        requestTeamEnd={requestTeamEnd}
        requestingStartDestId={requestingStartDestId}
        routeDepartureDate={routeDepartureDate}
        selectedIndex={selectedIndex}
        selfRoute={selfRoute}
        sessionEligibleMembers={sessionEligibleMembers}
        setArrivalDestination={setArrivalDestination}
        setCarouselHeight={setCarouselHeight}
        setOverlay={setOverlay}
        setTourTargetRef={setTourTargetRef}
        setTravelMode={setTravelMode}
        sharedTargetId={sharedTargetId}
        showDenseChrome={showDenseChrome}
        startNavigation={startNavigation}
        styles={styles}
        t={t}
        toggleGatheringCard={toggleGatheringCard}
        tourReduceMotion={tourReduceMotion}
        travelMode={travelMode}
        uiVisible={uiVisible}
        user={user}
        windowWidth={windowWidth}
      />

      {/* Straggler alerts fire as a native OS notification (see the effect
          above) — no in-app banner, so they don't cover the map. */}
      {/* The pull-up sheet — hidden while the add-gather-point confirm card
          owns the screen (search bar + recenter capsule disappear).
          Wrapper zIndex must beat carousel (58): child BottomSheet zIndex alone
          cannot win against a sibling with higher zIndex.
          OTA-07: also hidden in passive companion presentation. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.sheetLayer,
          (confirmCardReady || !showDenseChrome) && styles.sheetHidden,
        ]}
        pointerEvents={confirmCardReady || !showDenseChrome ? 'none' : 'box-none'}
      >
      <BottomSheet
        height={heightSV}
        detents={detents}
        index={detent}
        onIndexChange={handleSheetIndexChange}
        bottomInset={insets.bottom}
        useSwiftUIGlassSurface
        compactGrabberSpacing
        hideHeaderOnScroll
        onHeaderHeight={(h) => {
          // Ignore 1–2px jitter so detents don't thrash and reverse mid-spring.
          setSheetHeaderH((prev) => (Math.abs(prev - h) > 2 ? h : prev));
        }}
        header={sheetHeader}
      >
        <Animated.View
          style={detent === 0 ? styles.sheetBodyHidden : undefined}
          pointerEvents={detent === 0 ? 'none' : 'auto'}
          accessibilityElementsHidden={detent === 0}
          importantForAccessibility={detent === 0 ? 'no-hide-descendants' : 'auto'}
        >
          {sheetChildren}
        </Animated.View>
      </BottomSheet>
      </Animated.View>

      {/* Route overlay: reorder gathering points (local draft until dismiss). */}
      <RouteEditorSheet
        accent={accent}
        canEditItinerary={canEditItinerary}
        dailyAccommodations={dailyAccommodations}
        dark={dark}
        destinations={destinations}
        favoritePlaces={favoritePlaces}
        flushRouteDraft={flushRouteDraft}
        groupId={groupId}
        handleDelete={handleDelete}
        handleDeleteMany={handleDeleteMany}
        handleReorder={handleReorder}
        handleRouteDragAutoScroll={handleRouteDragAutoScroll}
        handleUpdateEmojiColor={handleUpdateEmojiColor}
        handleUpdateTripDetails={handleUpdateTripDetails}
        localActionError={localActionError}
        navTargetId={navTargetId}
        openForRouteEditor={openForRouteEditor}
        openKmlImportForScope={openKmlImportForScope}
        overlay={overlay}
        routeDepartureDate={routeDepartureDate}
        routeDraft={routeDraft}
        routeDragPreview={routeDragPreview}
        routeEditorScopeId={routeEditorScopeId}
        routeEditorServerDestinations={routeEditorServerDestinations}
        routeInteractionMode={routeInteractionMode}
        routeScrollEnabled={routeScrollEnabled}
        routeScrollRef={routeScrollRef}
        routeScrollViewportHeightRef={routeScrollViewportHeightRef}
        routeScrollYRef={routeScrollYRef}
        routeSelectedIds={routeSelectedIds}
        routeTripDays={routeTripDays}
        setEditButtonActive={setEditButtonActive}
        setFavoritePlaces={setFavoritePlaces}
        setOverlay={setOverlay}
        setRouteDragPreview={setRouteDragPreview}
        setRouteInteractionMode={setRouteInteractionMode}
        setRouteOverlayOpenComplete={setRouteOverlayOpenComplete}
        setRouteScrollEnabled={setRouteScrollEnabled}
        setRouteSelectedIds={setRouteSelectedIds}
        setTourTargetRef={setTourTargetRef}
        styles={styles}
        t={t}
        user={user}
      />

      <SettingsOverlay
        visible={settingsOpen}
        onClose={closeSettings}
        onArchiveAllForTest={archiveAllForTest}
        onOpenFeedback={openFeedback}
        onConfirmResetPrefs={confirmResetPrefs}
        onConfirmLeave={confirmLeave}
        onConfirmSignOut={confirmSignOut}
        onOpenPaywall={openPaywallCb}
        onDismissComplete={handleSettingsDismissComplete}
        onAccountDeleted={() => {
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        }}
        group={group}
        isLeader={isLeader}
        onUpdateGroupAvatar={async (avatar, avatarColor) => {
          if (!groupId) return;
          await updateGroupAvatar(groupId, avatar, avatarColor);
          await refresh();
        }}
        onGoHome={() => {
          setSettingsOpen(false);
          goHomeCreateOrJoin();
        }}
        styles={styles}
      />

      {/* 邀請成員 — independent share sheet (code / share / copy). */}
      <InviteMembersOverlay
        accent={accent}
        codeCopied={codeCopied}
        copyCode={copyCode}
        group={group}
        inviteBlockedForAnonymousLeader={inviteBlockedForAnonymousLeader}
        overlay={overlay}
        promptAnonymousLeaderRegistration={promptAnonymousLeaderRegistration}
        setOverlay={setOverlay}
        shareCode={shareCode}
        styles={styles}
        t={t}
      />

      {/* Exceptions + coordination — single full-bleed ops center. */}
      <OpsCenterSheet
        accent={accent}
        coordination={coordination}
        exceptionPendingKeys={exceptionPendingKeys}
        isLeader={isLeader}
        markExceptionHandled={markExceptionHandled}
        organizerExceptions={organizerExceptions}
        overlay={overlay}
        setOverlay={setOverlay}
        styles={styles}
        t={t}
      />

      {/* 全部快捷指令 */}
      <OverlaySheet
        visible={overlay === 'commands'}
        onClose={() => setOverlay(null)}
        title={t('map.cmdTitle')}
        accent={accent}
        doneLabel={t('map.done')}
        edgeToEdge
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          {groupId ? (
            <QuickCommandsCard
              groupId={groupId}
              isLeader={!!isLeader}
              colors={dark}
              onConfigureCustom={openCustomQuickCommand}
              variant="full"
            />
          ) : null}
        </ScrollView>
      </OverlaySheet>

      <View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, styles.settingsChildLayer]}
      >
      <AccountSheet
        visible={overlay === 'account'}
        onClose={() => setOverlay(null)}
        accent={accent}
        onAccountDeleted={() => {
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        }}
      />
      </View>

      <ProfileOverlay
        visible={overlay === 'profile'}
        onClose={() => setOverlay(null)}
        refresh={refresh}
        styles={styles}
      />

      {/* Arrival management — one page: every stop + member mark/undo on the right. */}
      <ArrivalManageSheet
        accent={accent}
        allScopedDestinations={allScopedDestinations}
        destinationArrivals={destinationArrivals}
        handleArrival={handleArrival}
        isLeader={isLeader}
        members={members}
        overlay={overlay}
        setOverlay={setOverlay}
        styles={styles}
        t={t}
      />

      {/* Single-destination arrival (gathering-card shortcut only). */}
      <ArrivalTimeSheet
        accent={accent}
        activeDestinationArrivals={activeDestinationArrivals}
        arrivalDestination={arrivalDestination}
        handleArrival={handleArrival}
        isLeader={isLeader}
        members={members}
        overlay={overlay}
        setArrivalDestination={setArrivalDestination}
        setOverlay={setOverlay}
        styles={styles}
        t={t}
      />

      {/* History overlay: gathering points actually reached, grouped by day. */}
      <HistorySheet
        accent={accent}
        handleDeleteHistory={handleDeleteHistory}
        historyGroups={historyGroups}
        isLeader={isLeader}
        overlay={overlay}
        setOverlay={setOverlay}
        styles={styles}
        t={t}
        user={user}
      />

      {/* Report-a-problem stacks over settings; dismissing it reveals settings. */}
      <View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, styles.settingsChildLayer]}
      >
      <FeedbackSheet
        visible={overlay === 'feedback'}
        onClose={() => setOverlay(null)}
      />
      </View>

      <CustomQuickCommandSheet
        visible={overlay === 'custom'}
        slot={customSlot}
        onClose={() => setOverlay(null)}
      />

      {/* Invite-a-teammate picker, opened from my own subgroup card. */}
      <InviteTeammateSheet
        accent={accent}
        handleInvite={handleInvite}
        invitable={invitable}
        inviteSheetOpen={inviteSheetOpen}
        mySubgroupId={mySubgroupId}
        setInviteSheetOpen={setInviteSheetOpen}
        styles={styles}
        t={t}
      />

      <DestinationSearch
        visible={searchVisible}
        onClose={closeSearch}
        onOpenComplete={handleSearchOpenComplete}
        biasRegion={biasRegion}
        // Don't persist on pick — stage the place for the bottom confirm card
        // (Add / Cancel). Resolves immediately so the search sheet closes.
        onPick={handleSearchPick}
      />

      <View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, styles.settingsChildLayer]}
      >
      <PaywallSheet
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        trigger={paywallTrigger}
        showRestore={paywallShowRestore}
        onUnlockingChange={setPurchaseUnlocking}
        onEntitlementActivated={handleEntitlementActivated}
      />
      </View>
      {purchaseUnlocking ? (
        <View
          style={[styles.loading, StyleSheet.absoluteFill, { zIndex: 200 }]}
          pointerEvents="auto"
          testID="purchase-unlock-loading"
        >
          <WaveLoading color={accent} size="large" />
          <Text style={styles.loadingText}>{t('map.loading')}</Text>
        </View>
      ) : null}

      <KmlImportSheet
        visible={kmlVisible}
        onClose={() => setKmlVisible(false)}
        currentCount={countOpenDestinations(kmlScopedDestinations)}
        remainingQuota={kmlRemainingQuota}
        canWrite={kmlScopeId ? isMySubgroupLeader : isLeader}
        extraCredits={extraPointCredits}
        isPro={isPro}
        onImport={handleKmlImport}
        onUpgrade={() => {
          setKmlVisible(false);
          openPaywall('paywall.triggerDestinations');
        }}
      />

      <CoordinateDestinationSheet
        visible={coordSheetVisible}
        initialCoordinates={coordSheetInitial}
        onClose={() => {
          setCoordSheetVisible(false);
          setCoordSheetInitial(undefined);
        }}
        onSubmit={handleCoordinateDestination}
      />

      {/* Meet-time editor: date + time + red-threshold warning + Set/Clear */}
      <MeetTimeSheet
        accent={accent}
        meetTimeEditor={meetTimeEditor}
        openAndroidMeetDate={openAndroidMeetDate}
        persistMeetTime={persistMeetTime}
        setMeetTimeEditor={setMeetTimeEditor}
        styles={styles}
        t={t}
      />

      <GroupFeatureTourOverlay
        visible={routeTourActive && overlay === 'route'}
        title={routeTourStep ? t(routeTourStep.titleKey as TranslationKey) : ''}
        body={routeTourStep ? t(routeTourStep.bodyKey as TranslationKey) : ''}
        ctaLabel={
          routeTourStep
            && routeTourStep === ROUTE_REORDER_TOUR_STEPS[ROUTE_REORDER_TOUR_STEPS.length - 1]
            ? t('tour.getStarted')
            : t('tour.next')
        }
        targetRect={routeTourTargetRect}
        onNext={onRouteTourNext}
        onPrev={onRouteTourPrev}
        canGoPrev={routeTourCanGoPrev}
        reduceMotion={tourReduceMotion}
        ctaDisabled={routeTourTransitioning || routeTourCompleting}
      />

      <GroupFeatureTourOverlay
        visible={tourActive}
        title={
          tourStep && !tourStep.final
            ? t(tourStep.titleKey as TranslationKey)
            : ''
        }
        body={
          tourStep
            ? tourStep.roleBody
              ? t(
                  (isLeader
                    ? `${tourStep.bodyKey}.leader`
                    : `${tourStep.bodyKey}.member`) as TranslationKey,
                )
              : t(tourStep.bodyKey as TranslationKey)
            : ''
        }
        ctaLabel={
          tourStep?.final ? t('tour.getStarted') : t('tour.next')
        }
        targetRect={tourTargetRect}
        placementRect={tourPlacementRect}
        targetKind={holeKindForTarget(tourStep?.target)}
        onNext={onTourNext}
        onPrev={onTourPrev}
        canGoPrev={tourCanGoPrev}
        reduceMotion={tourReduceMotion}
        ctaDisabled={tourTransitioning || tourCompleting}
      />
    </View>
  );
}
