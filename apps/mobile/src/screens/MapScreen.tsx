import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  LayoutAnimation,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
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
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  withSpring,
  withTiming,
  Easing,
  FadeIn,
  FadeInRight,
  FadeOut,
  FadeOutRight,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import GroupMap, { type GroupMapHandle } from '../components/GroupMap';
import { PLACE_ALTITUDE, PLACE_ZOOM } from '../components/mapCameraMath';
import {
  cameraAfterSuccessfulAdd,
  cameraOnLongPress,
  cameraOnSearchPick,
} from '../utils/mapCameraFlow';
import { resolveNotificationRecipients } from '../utils/notificationDeliveryPolicy';
import {
  assessLocationRefreshResponses,
  waitForLocationRefreshResponses,
} from '../utils/locationRefreshResponse';
import { keyboardAvoidBottomOffset } from '../utils/keyboardSurface';
import {
  gatherRequestPageIndex,
  recoverGatherRequestAfterFailedResolve,
  resolveGatherRequestSelection,
  sortGatherRequestsFifo,
} from '../utils/gatherRequestInbox';
import DestinationSearch from '../components/DestinationSearch';
import MeetCountdown from '../components/MeetCountdown';
import DestinationReorderList from '../components/DestinationReorderList';
import NotificationPreferencesCard from '../components/NotificationPreferencesCard';
import QuickCommandsCard from '../components/QuickCommandsCard';
import CustomQuickCommandSheet from '../components/CustomQuickCommandSheet';
import BottomSheet, { sheetBottomOffset } from '../components/BottomSheet';
import OverlaySheet from '../components/OverlaySheet';
import PaywallSheet from '../components/PaywallSheet';
import KmlImportSheet from '../components/KmlImportSheet';
import CoordinateDestinationSheet from '../components/CoordinateDestinationSheet';
import type { CoordinateDestinationInput } from '../utils/coordinateDestination';
import FeedbackSheet from '../components/FeedbackSheet';
import CrookIcon from '../components/CrookIcon';
import { AmicroButton } from '../components/AmicroButton';
import { HitherText } from '../components/HitherText';
import OverflowMarquee from '../components/OverflowMarquee';
import MapRecenterControl from '../components/MapRecenterControl';
import SwiftUIGlassSurface from '../components/SwiftUIGlassSurface';
import {
  applyLocalClosedAt,
  arrivalControlJustSplit,
  deriveCardNavFlags,
  deriveScopedArrivalCounts,
  planCompleteGatheringApply,
  projectHistoryForViewer,
  resolveCompletePrompt,
  resolveNavCommand,
} from '../utils/gatherCommand';
import {
  APPROACH_FIRED_STORAGE_KEY,
  approachNotifyCopy,
  approachNotifyKey,
  shouldFireApproachNotify,
} from '../utils/approachNotify';
import {
  ARRIVED_FADE_MS,
  ARRIVED_SPLIT_MS,
  COUNTDOWN_WIDTH_FACTOR,
  GATHER_CMD_MIN_HIT_PT,
} from '../utils/gatherCommandLayout';
import {
  ARRIVAL_CARD_EXIT_MS,
  ARRIVAL_EFFECT_HOLD_MS,
  PERSONAL_ARRIVAL_CELEBRATE_MS,
  armCelebrateClearTimer,
  beginArrivalCardExit,
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
  MEET_RED_OPTIONS,
  DEFAULT_MEET_RED_MIN,
  ARRIVAL_RADIUS_OPTIONS,
  ARRIVAL_RADIUS_MIN_M,
  ARRIVAL_RADIUS_MAX_M,
  type Language,
} from '../state/PreferencesContext';
import PrefSlider from '../components/PrefSlider';
import SystemToggle from '../components/SystemToggle';
import { avatarColorForGroup, avatarForGroup, displayMemberAvatar } from '../constants/avatars';
import { canMarkDestinationArrival } from '../utils/arrivalMarking';
import { hasArrived } from '../utils/journeyProgress';
import { buildPassiveCompanionModel } from '../utils/passiveCompanion';
import { uploadLocalLogs } from '../utils/uploadLocalLogs';
import { runUiAction } from '../utils/uiAction';
import { useTranslation, type TranslationKey } from '../i18n';
import { PassiveCompanionPanel } from './MapScreen/components/PassiveCompanionPanel';
import { useDeviceLocation } from './MapScreen/hooks/useDeviceLocation';
import { useCarouselSelection } from './MapScreen/hooks/useCarouselSelection';
import { useJourneyNavigation } from './MapScreen/hooks/useJourneyNavigation';
import { useMapKitRoutes } from './MapScreen/hooks/useMapKitRoutes';
import { usePersonalProgressSurfaces } from './MapScreen/hooks/usePersonalProgressSurfaces';
import { energyObservability } from '../state/energyObservability';
import { useGatherCardExpansion } from './MapScreen/hooks/useGatherCardExpansion';
import {
  GroupFeatureTourOverlay,
  useGroupFeatureTour,
  clearGroupFeatureTour,
  clearAddPlaceTour,
  clearRouteReorderTour,
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
import InviteMembersSheet from './MapScreen/components/InviteMembersSheet';
import { SubgroupSection } from './MapScreen/components/SubgroupSection';
import { Segmented } from './MapScreen/components/Segmented';
import { SheetPaneTabs } from './MapScreen/components/SheetPaneTabs';
import type { SheetPaneTabOption } from './MapScreen/components/SheetPaneTabs';
import { StorePane } from './MapScreen/components/StorePane';
import { CoordinationRequestsPanel } from './MapScreen/components/CoordinationRequestsPanel';
import type { SheetPaneKey } from '../store/types';
import { getStoreSnapshot } from '../api/services/StoreService';
import AccountSheet from '../components/AccountSheet';
import { useGroupState } from '../state/useGroupState';
import { useNavigationSession } from '../state/useNavigationSession';
import { useStragglerAlerts } from '../state/useStragglerAlerts';
import { useOrganizerExceptions } from '../state/useOrganizerExceptions';
import { useSubgroupInvites } from '../state/useSubgroupInvites';
import { clearLiveActivities, useLiveActivity } from '../state/useLiveActivity';
import {
  prepareBackgroundJourneyPermissions,
  startBackgroundJourney,
  stopBackgroundJourney,
} from '../state/backgroundJourney';
import { purgeLocationOutbox } from '../state/locationOutbox';
import { diagnostics } from '../state/diagnostics';
import {
  getLocationSharingEnabled,
  setLocationSharingEnabled,
} from '../api/services/NavigationService';
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
  walkingEtaSeconds,
  type TravelMode,
} from '../utils/geo';
import { indicatorRowGeometry } from '../utils/pagination';
import {
  alignMeetTimeToTripDay,
  addMinutesToPickerValue,
  clampDateNotBeforeToday,
  minutesUntil,
  startOfTodayLocal,
} from '../utils/meetTime';
import {
  buildOpenReorderPayload,
  mapOpenReorderToPersistedPositions,
  openPositionSlotsFromOpenDestinations,
} from '../utils/openReorderSlots';
import {
  locationFreshness,
  resolveSelfAwareLastUpdated,
} from '../utils/locationFreshness';
import {
  groupHistoryByDay,
  historyFromDestinationArrivals,
  mergeHistoryWithPastStops,
  type HistoryDayGroup,
} from '../utils/history';
import {
  dateForTripDay,
  filterActiveDestinations,
  localDayKey,
  nextOrderedDestination,
  openDestinationsForReorder,
  resolveAddDay,
} from '../utils/tripDay';
import { createArrivalState, reduceArrival, type ArrivalState } from '../utils/navigationArrival';
import {
  applyDestinationMutationOverlay,
  destinationMarkerValues,
  enqueueDestinationMutation,
  reconcileDestinationMutations,
  removeDestinationMutation,
  type PendingDestinationMutation,
} from '../utils/destinationMutationOverlay';
import { liquidGlass, location, notifications, type MapRegion, type PlaceResult } from '../native';
import {
  addDestination,
  addDestinationsBatch,
  completeGatheringStop,
  deleteDestination,
  fetchSentInvites,
  fetchVisitedWaypoints,
  deleteVisitedWaypoint,
  fetchDestinationArrivals,
  fetchPendingGatherPointRequests,
  inviteToSubgroup,
  recordVisitedWaypoint,
  reorderDestinations,
  saveOnboardingProfile,
  selfMerge,
  selfSplit,
  setDestinationMeetTime,
  setJourneyStatus,
  setSolo,
  reportStraggler,
  leaveGroups,
  kickGroupMember,
  requestGroupLocationRefresh,
  resolveGatherPointRequestResilient,
  sendCommand,
  isNetworkRequestError,
  setDestinationArrival,
  setDestinationArrivalAt,
  setDailyAccommodation,
  clearDailyAccommodation,
  listFavoritePlaces,
  saveFavoritePlace,
  unsaveFavoriteByExactMatch,
  unsaveFavoritePlace,
  findFavoriteByExactMatch,
  type FavoritePlace,
  submitGatherPointRequest,
  updateGroupTripDetails,
  updateGroupAvatar,
  updateDestinationEmojiColor,
  getNotificationPreferences,
  setNotificationPreferences,
} from '../api/client';
import { supabase } from '../api/supabase';
import { captureScreen } from 'react-native-view-shot';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { markOnboardingReplayForHome } from '../onboarding/sync';
import { isDemoGroup } from '../api/demo';
import { confirmAction } from '../utils/confirm';
import {
  locationSharingConfirmCopy,
  STATUS_SHARE_CLUSTER_GAP,
  statusIconForKind,
} from './MapScreen/memberStatusSharing';
import { NativeMenuHost } from '../native/menu';
import {
  applyPresenceMacroWrites,
  derivePresenceMacro,
  presenceMacroWrites,
  type PresenceMacroKind,
} from '../utils/presenceMacros';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '../types';
import { logEvent, logError } from '../utils/activityLog';
import { lightTap, mediumTap, rigidTap, selectionTick, alertBuzz } from '../utils/haptics';
import { AVATAR_EMOJI, AVATAR_COLORS } from '../constants/avatars';
import type {
  Coordinates,
  DailyAccommodation,
  Destination,
  DestinationArrival,
  GatherPointRequest,
  GatherPointRequestItem,
  MemberLocation,
  VisitedWaypoint,
} from '../types';
import type { KmlPlacemark } from '../utils/kml';
import { normalizeImportBatch, KmlImportError } from '../utils/kmlBatch';
import {
  FREE_LIMITS,
  anonymousLeaderRequiresRegistration,
  countOpenDestinations,
  shouldBlockNewDestination,
} from '../entitlements';
import { radius, themes, THEME_ORDER, type ThemeName } from '../theme';
import { glass, accentMix, memberColor } from '../glass';
import { gatherCardHorizontalInset, mapKitChromeLayout } from '../utils/mapChromeLayout';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

// Auto-advance to the next gathering point once the leader is this close —
// separate from the server's 30 m arrival boundary.
const AUTO_ADVANCE_RADIUS_M = 50;
// Cap on gathering-point pagination dots shown at once (see utils/pagination.ts).
const DOTS_MAX_VISIBLE = 5;
const PASSIVE_ENTER_HEIGHT = 65; // round(162 * 0.4)

/** The design's display face — Fredoka (loaded in App.tsx). Used for
 * gathering-point titles, ETA numerals and the set-gather-time. */
const DISPLAY_FONT = 'Fredoka_600SemiBold';

/** Persisted "don't warn me again" flag for the leave-the-main-group notice. */
const LEAVE_GROUP_WARN_KEY = 'hither.subgroupLeaveWarnDismissed';

/** Map known Postgres / RPC exception text to i18n keys (server keeps EN contract). */
const ARRIVAL_RPC_ERRORS: Array<{ needle: string; key: TranslationKey }> = [
  { needle: 'future destination cannot be completed', key: 'arrival.errFuture' },
  { needle: 'cannot mark this member', key: 'arrival.errCannotMark' },
  { needle: 'destination outside member scope', key: 'arrival.errOutsideScope' },
  { needle: 'paused destination requires an existing arrival', key: 'arrival.errPausedUndo' },
];

function arrivalErrorMessage(
  error: unknown,
  t: (key: TranslationKey) => string,
): string {
  const raw = error instanceof Error ? error.message : '';
  for (const { needle, key } of ARRIVAL_RPC_ERRORS) {
    if (raw.includes(needle)) return t(key);
  }
  return raw || t('arrival.failedMsg');
}

/** Short ETA like the design's "4 min" / "now" / "2 hr". */
function shortEta(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr`;
}

/** Expanded metrics: big number + small unit (e.g. 334.7 + km). */
function splitDistanceParts(distanceM: number | null): { value: string; unit: string } {
  if (distanceM == null) return { value: '—', unit: '' };
  if (distanceM < 1000) return { value: String(Math.round(distanceM)), unit: 'm' };
  return { value: (distanceM / 1000).toFixed(1), unit: 'km' };
}

/** Expanded metrics: big number + small unit (e.g. 66 + hr). */
function splitEtaParts(seconds: number | null): { value: string; unit: string } {
  if (seconds == null) return { value: '—', unit: '' };
  const m = Math.round(seconds / 60);
  if (m < 1) return { value: 'now', unit: '' };
  if (m < 60) return { value: String(m), unit: 'min' };
  return { value: String(Math.floor(m / 60)), unit: 'hr' };
}

/**
 * Expanded gathering-card line: "第 N 天 · M月D號" when a trip departure date
 * exists (aligned with DestinationReorderList day headers).
 * Date-only ISO is parsed at local noon to avoid TZ day-shift.
 */
function formatTripDayLine(
  dayNum: number,
  departureDate: string | null | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const day = Math.max(1, dayNum || 1);
  const dayPart = t('map.tripDay', { day });
  if (!departureDate) return dayPart;
  const raw = departureDate.trim();
  const base = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(base.getTime())) return dayPart;
  base.setDate(base.getDate() + (day - 1));
  const datePart = t('map.tripDayDate', {
    month: base.getMonth() + 1,
    day: base.getDate(),
  });
  return `${dayPart} · ${datePart}`;
}

/** Localized nav command label from kind (tests keep zh on resolveNavCommand.label). */
function navCommandDisplayLabel(
  kind: import('../utils/gatherCommand').NavCommandKind,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  switch (kind) {
    case 'leader_start':
      return t('nav.leaderStart');
    case 'leader_stop':
      return t('nav.leaderStop');
    case 'leader_mark_complete':
      return t('nav.leaderComplete');
    case 'member_navigating':
      return t('nav.memberNavigating');
    case 'member_waiting_complete':
      return t('nav.memberWaitingComplete');
    case 'member_request_start':
      return t('nav.memberRequestStart');
    default:
      return '';
  }
}

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
    upgradeToEmailAccount,
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
  // The demo flock has no membership row; the tester drives it as leader.
  const isLeader = membership?.role === 'leader' || isDemoGroup(groupId);

  const {
    state,
    loading,
    error: groupStateError,
    refresh,
    applyOptimisticGathering,
    emptyLocalSnapshot,
  } = useGroupState(groupId, {
    myUserId: user?.id ?? null,
    highAccuracy,
  });
  const navigationSessionState = useNavigationSession(groupId);
  const navigationSessionId = navigationSessionState.session?.id ?? null;
  const hasNavigationSession = navigationSessionId !== null;
  // Cold start / return from background: re-pull active flock session so
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
  const group = state?.group ?? membership?.group ?? null;
  const serverDailyAccommodations = state?.dailyAccommodations ?? [];

  const mapRef = useRef<GroupMapHandle | null>(null);
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
  const myScopeId = me?.subgroupId;

  // Kicked follower: recovery RPC raises not_member → clear session + RoleSelect.
  const kickedHandledRef = useRef(false);
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
    Alert.alert(t('group.kickedTitle'), t('group.kickedMsg'));
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

  const [optimisticDestinations, setOptimisticDestinations] = useState<Destination[] | null>(null);
  /**
   * Route-sheet draft for daily stays. null = use server snapshot.
   * All stay set/clear while the route overlay is open lands here until flush.
   */
  const [draftDailyAccommodations, setDraftDailyAccommodations] = useState<
    DailyAccommodation[] | null
  >(null);
  const dailyAccommodations = draftDailyAccommodations ?? serverDailyAccommodations;
  const [pendingDestinationMutations, setPendingDestinationMutations] = useState<
    PendingDestinationMutation[]
  >([]);
  const destinationMutationSequenceRef = useRef(0);
  const baseScopedDestinations = optimisticDestinations ?? rawDestinations;
  const allScopedDestinations = useMemo(
    () => applyDestinationMutationOverlay(baseScopedDestinations, pendingDestinationMutations),
    [baseScopedDestinations, pendingDestinationMutations],
  );
  useEffect(() => {
    setPendingDestinationMutations((pending) => {
      const next = reconcileDestinationMutations(pending, rawDestinations);
      return next.length === pending.length ? pending : next;
    });
  }, [rawDestinations]);
  const [destinationArrivals, setDestinationArrivals] = useState<DestinationArrival[]>([]);
  const [gatherPointRequests, setGatherPointRequests] = useState<GatherPointRequest[]>([]);
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
  /** Route overlay draft dirtiness — flushed only on sheet dismiss (完成 / swipe). */
  const routeDraftDirtyRef = useRef({
    destinations: false,
    daily: false,
    trip: false,
    deletedIds: [] as string[],
  });
  const routeFlushInFlightRef = useRef(false);
  const draftDailyRef = useRef(draftDailyAccommodations);
  draftDailyRef.current = draftDailyAccommodations;
  const optimisticDestinationsRef = useRef(optimisticDestinations);
  optimisticDestinationsRef.current = optimisticDestinations;
  const workflowReloadRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [optimisticTripDays, setOptimisticTripDays] = useState<number | null>(null);
  const [optimisticDepartureDate, setOptimisticDepartureDate] = useState<string | null>(null);
  const mapDailyAccommodations = useMemo(() => {
    const departure = optimisticDepartureDate ?? group?.departureDate;
    const tripDays = optimisticTripDays ?? group?.tripDays ?? 1;
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
  }, [dailyAccommodations, group?.departureDate, group?.tripDays, optimisticDepartureDate, optimisticTripDays]);
  /** Personal arrival rows (check-in) — not team stop completion. */
  const myCompletedDestinationIds = useMemo(
    () => new Set(
      destinationArrivals
        .filter((arrival) => arrival.userId === user?.id)
        .map((arrival) => arrival.destinationId),
    ),
    [destinationArrivals, user?.id],
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
        optimisticDepartureDate ?? group?.departureDate,
        optimisticTripDays ?? group?.tripDays,
      ),
    [
      allScopedDestinations,
      optimisticDepartureDate,
      optimisticTripDays,
      group?.departureDate,
      group?.tripDays,
    ],
  );
  const destinations = useMemo(
    () =>
      mergeExitingDestinations(
        openDestinations,
        arrivalExitSnapshots,
        arrivalExitRecords,
        prevVisibleDestOrderRef.current,
      ),
    [openDestinations, arrivalExitSnapshots, arrivalExitRecords],
  );
  const destinationIds = useMemo(() => destinations.map((dest) => dest.id), [destinations]);
  /**
   * Full open itinerary for the route editor (all open days + stay cards).
   * Must not use day-gated `destinations` — that under-counts past-day stops
   * and desyncs the「調整順序」label from the list body.
   */
  const openForRouteEditor = useMemo(
    () => openDestinationsForReorder(optimisticDestinations ?? allScopedDestinations),
    [optimisticDestinations, allScopedDestinations],
  );
  const canEditItinerary = !!isLeader;

  /** Pull destinations/group state only — used before arrival writes too. */
  const syncFromDatabase = useCallback(async () => {
    setOptimisticDestinations(null);
    setDraftDailyAccommodations(null);
    setOptimisticTripDays(null);
    setOptimisticDepartureDate(null);
    routeDraftDirtyRef.current = {
      destinations: false,
      daily: false,
      trip: false,
      deletedIds: [],
    };
    if (!(await refresh())) {
      throw new Error(t('map.syncDbFailedMsg'));
    }
  }, [refresh, t]);

  /**
   * Reorder-list "同步資料庫": refresh itinerary only (business data).
   * Opt-in diagnostic Log batch is owned by logBatchScheduler, not this control.
   */
  const syncFromDatabaseAndUploadLogs = useCallback(async () => {
    const result = await runUiAction(
      'map.sync_db_and_logs',
      async (token) => {
        await syncFromDatabase();
        if (!token.isCurrent()) return;
        let logResult: Awaited<ReturnType<typeof uploadLocalLogs>> | null = null;
        try {
          // No-op when consent is off; never multi-round drain.
          logResult = await uploadLocalLogs({ source: 'destination_reorder_sync' });
        } catch {
          logResult = null;
        }
        if (!token.isCurrent()) return;
        if (!logResult) {
          Alert.alert(t('map.syncDbOkTitle'), t('map.syncDbOkLogsFailed'));
          return true;
        }
        const logsFailed =
          logResult.diagnosticRemaining < 0 || logResult.performanceRemaining < 0;
        if (logsFailed) {
          Alert.alert(t('map.syncDbOkTitle'), t('map.syncDbOkLogsFailed'));
          return true;
        }
        const totalSent = logResult.diagnosticSent + logResult.performanceSent;
        const totalRemaining =
          logResult.diagnosticRemaining + logResult.performanceRemaining;
        if (totalSent === 0 && totalRemaining === 0) {
          Alert.alert(t('map.syncDbOkTitle'), t('map.syncDbOkNoLogs'));
          return true;
        }
        // Complete only when both queues report remaining === 0.
        if (totalRemaining > 0) {
          Alert.alert(
            t('map.syncDbOkTitle'),
            t('map.syncDbOkPartial', {
              sent: String(totalSent),
              remaining: String(totalRemaining),
            }),
          );
          return true;
        }
        Alert.alert(
          t('map.syncDbOkTitle'),
          t('map.syncDbOkFull', { sent: String(totalSent) }),
        );
        return true;
      },
      { screen: 'Map' },
    );
    return result === true;
  }, [syncFromDatabase, t]);

  // Keep translator out of effect deps — unstable `t` historically re-subscribed
  // gathering Realtime and hammered destination_arrivals (~5–6 SELECT/s).
  const tRef = useRef(t);
  tRef.current = t;
  const isLeaderRef = useRef(isLeader);
  isLeaderRef.current = isLeader;
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;
  const workflowInFlightRef = useRef<Promise<void> | null>(null);
  /** Set while a load is in flight so a concurrent request re-runs after. */
  const workflowPendingRef = useRef(false);
  const workflowLastLoadAtRef = useRef(0);
  const workflowChannelSeqRef = useRef(0);
  const WORKFLOW_MIN_INTERVAL_MS = 2_500;

  const loadGatheringWorkflow = useCallback(async () => {
    if (!groupId || isDemoGroup(groupId)) return;
    // Single-flight with pending re-run: a second caller during an in-flight
    // fetch must not return stale arrivals (e.g. mark then realtime overlap).
    if (workflowInFlightRef.current) {
      workflowPendingRef.current = true;
      await workflowInFlightRef.current;
      if (!workflowPendingRef.current) return;
    }
    do {
      workflowPendingRef.current = false;
      const run = (async () => {
        const [arrivals, requests] = await Promise.all([
          fetchDestinationArrivals(groupId),
          isLeaderRef.current
            ? fetchPendingGatherPointRequests(groupId)
            : Promise.resolve([]),
        ]);
        setDestinationArrivals(arrivals);
        setGatherPointRequests(requests);
        workflowLastLoadAtRef.current = Date.now();
      })();
      workflowInFlightRef.current = run.finally(() => {
        workflowInFlightRef.current = null;
      });
      await workflowInFlightRef.current;
    } while (workflowPendingRef.current);
  }, [groupId]);

  /** Optimistic arrival row so N/M progress updates before reload finishes. */
  const patchLocalArrival = useCallback((
    destinationId: string,
    targetUserId: string,
    arrived: boolean,
    arrivedAt?: string | null,
  ) => {
    setDestinationArrivals((prev) => {
      const without = prev.filter(
        (row) => !(row.destinationId === destinationId && row.userId === targetUserId),
      );
      if (!arrived) return without;
      if (prev.some((row) => row.destinationId === destinationId && row.userId === targetUserId)) {
        return prev;
      }
      return [
        ...without,
        {
          id: `local-${destinationId}-${targetUserId}`,
          groupId: groupId ?? '',
          destinationId,
          userId: targetUserId,
          arrivedAt: arrivedAt ?? new Date().toISOString(),
          source: 'manual' as const,
          markedBy: targetUserId,
        },
      ];
    });
  }, [groupId]);

  const scheduleWorkflowReload = useCallback(() => {
    if (workflowReloadRef.current) return;
    workflowReloadRef.current = setTimeout(() => {
      workflowReloadRef.current = null;
      // Realtime-driven only: skip if we just loaded (stops SELECT storms).
      if (Date.now() - workflowLastLoadAtRef.current < WORKFLOW_MIN_INTERVAL_MS) return;
      void loadGatheringWorkflow().catch(() => undefined);
    }, 300);
  }, [loadGatheringWorkflow]);

  useEffect(() => {
    if (!groupId || isDemoGroup(groupId)) return;
    // Mount / group change only — not on every render or translator identity.
    workflowLastLoadAtRef.current = 0;
    void loadGatheringWorkflow().catch(() => undefined);
    const channel = supabase
      .channel(`gathering-workflow:${groupId}:${++workflowChannelSeqRef.current}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'destination_arrivals', filter: `group_id=eq.${groupId}`,
      }, scheduleWorkflowReload)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'gather_point_requests', filter: `group_id=eq.${groupId}`,
      }, (payload) => {
        scheduleWorkflowReload();
        if (
          isLeaderRef.current
          && payload.eventType === 'INSERT'
          && (payload.new as { requester_id?: string } | null)?.requester_id !== userIdRef.current
        ) {
          Alert.alert(
            tRef.current('gatherRequest.newTitle'),
            tRef.current('gatherRequest.newBody'),
          );
        }
      })
      .subscribe();
    return () => {
      if (workflowReloadRef.current) clearTimeout(workflowReloadRef.current);
      workflowReloadRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [groupId, loadGatheringWorkflow, scheduleWorkflowReload]);

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
  const [arrivalDestination, setArrivalDestination] = useState<Destination | null>(null);
  const [statusApplying, setStatusApplying] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [appliedMacro, setAppliedMacro] = useState<PresenceMacroKind | null>(null);
  /** Which custom quick-command slot the editor is targeting. */
  const [customSlot, setCustomSlot] = useState(0);
  // Screenshot captured the instant the feedback entry is tapped (before the
  // form opens over the screen), handed to the sheet as evidence.
  const [feedbackShot, setFeedbackShot] = useState<string | null>(null);
  // Visited-waypoint history — fetched fresh each time the overlay opens.
  // Past trip-day stops the viewer never reached are merged in as 未抵達/未完成.
  const [historyGroups, setHistoryGroups] = useState<HistoryDayGroup[]>([]);
  const loadHistory = useCallback(async () => {
    const items = await fetchVisitedWaypoints(groupId ?? undefined);
    const arrivalHistory = historyFromDestinationArrivals(destinationArrivals, allScopedDestinations, {
      viewerId: user?.id,
      isGroupLeader: !!isLeader,
    });
    const existingKeys = new Set(items.map((item) => item.destinationId + ":" + (item.userId ?? "")));
    const projected = projectHistoryForViewer([...items, ...arrivalHistory.filter((item) => !existingKeys.has(item.destinationId + ":" + (item.userId ?? "")))], {
      viewerId: user?.id,
      isGroupLeader: !!isLeader,
    });
    const named = projected.map((item) => ({
      ...item,
      userName: members.find((member) => member.userId === item.userId)?.name,
      status: item.status ?? ('arrived' as const),
    }));
    const merged = mergeHistoryWithPastStops(named, allScopedDestinations, {
      departureDate: optimisticDepartureDate ?? group?.departureDate,
      tripDays: optimisticTripDays ?? group?.tripDays,
      userId: user?.id,
    });
    setHistoryGroups(groupHistoryByDay(merged));
  }, [
    groupId,
    members,
    allScopedDestinations,
    optimisticDepartureDate,
    optimisticTripDays,
    group?.departureDate,
    group?.tripDays,
    user?.id,
    isLeader,
  ]);
  useEffect(() => {
    if (overlay !== 'history') return;
    void loadHistory().catch(() => undefined);
  }, [overlay, loadHistory]);
  // "Invite a teammate" picker, opened from my own subgroup card.
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  // Invites I've sent for my subgroup that are still pending — shown on the
  // card so "I invited someone" doesn't just look like nothing happened while
  // they haven't accepted yet.
  const [sentInvites, setSentInvites] = useState<{ id: string; inviteeName: string }[]>([]);
  const refreshSentInvites = useCallback(async (subgroupId: string | undefined) => {
    if (!subgroupId) {
      setSentInvites([]);
      return;
    }
    try {
      setSentInvites(await fetchSentInvites(subgroupId));
    } catch {
      // best-effort
    }
  }, []);
  const [searchVisible, setSearchVisible] = useState(false);
  /** Resolves Amicro search Promise when OverlaySheet open animation completes. */
  const searchOpenCompleteResolveRef = useRef<(() => void) | null>(null);
  // A place picked in search, awaiting the bottom "add / cancel" confirm card.
  const [pendingPlace, setPendingPlace] = useState<PlaceResult | null>(null);
  const [favoritePlaces, setFavoritePlaces] = useState<FavoritePlace[]>([]);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
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
  const [confirmCardReady, setConfirmCardReady] = useState(false);
  /** Keyboard height while confirm card is up — lifts card with 12pt gap. */
  const [confirmKeyboardHeight, setConfirmKeyboardHeight] = useState(0);
  const [kmlVisible, setKmlVisible] = useState(false);
  const [coordSheetVisible, setCoordSheetVisible] = useState(false);
  const [coordSheetInitial, setCoordSheetInitial] = useState<
    { latitude: number; longitude: number } | undefined
  >(undefined);
  // Bounce-up entrance animation for the add-gather-point confirm card.
  const confirmCardAnim = useSharedValue(0);
  useEffect(() => {
    if (pendingPlace) {
      const id = setTimeout(() => {
        setConfirmCardReady(true);
        confirmCardAnim.value = 0;
        confirmCardAnim.value = withSpring(1, { damping: 16, stiffness: 100, mass: 1 });
      }, 0);
      return () => clearTimeout(id);
    } else {
      setConfirmCardReady(false);
      confirmCardAnim.value = 0;
    }
  }, [pendingPlace, confirmCardAnim]);
  const confirmCardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(confirmCardAnim.value, [0, 1], [120, 0], Extrapolation.CLAMP) },
      { scale: interpolate(confirmCardAnim.value, [0, 1], [0.96, 1], Extrapolation.CLAMP) },
    ],
  }));

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
    setConfirmCardReady(false);
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
  const [meetTimeEditor, setMeetTimeEditor] = useState<{
    id: string;
    value: Date;
    redMin: number;
    quickMinutes: number | null;
  } | null>(null);
  // Meet labels / location freshness tick inside small memo children
  // (MeetCountdown, LocationFreshnessText) so MapScreen is not re-rendered on a timer.

  // The soonest gathering point whose meet time is still ahead — schedule local
  // due + red-threshold warning as a device-side backup to server APNs.
  const nextMeet = useMemo(() => {
    const now = Date.now();
    return (
      destinations
        .filter((d) => d.meetAt && new Date(d.meetAt as string).getTime() > now)
        .sort(
          (a, b) =>
            new Date(a.meetAt as string).getTime() -
            new Date(b.meetAt as string).getTime(),
        )[0] ?? null
    );
  }, [destinations]);

  useEffect(() => {
    if (!nextMeet?.meetAt) return;
    const meetAt = new Date(nextMeet.meetAt as string);
    const redMin = nextMeet.meetRedMinutes ?? meetRedMin ?? DEFAULT_MEET_RED_MIN;
    const warnAt = new Date(meetAt.getTime() - redMin * 60_000);
    const ids: string[] = [];
    let cancelled = false;

    const track = (nid: string | null) => {
      if (!nid) return;
      if (cancelled) void notifications.cancelScheduledNotification(nid);
      else ids.push(nid);
    };

    // Red-zone warning (e.g. enter 9:59 when threshold is 10 min).
    if (warnAt.getTime() > Date.now()) {
      void notifications
        .scheduleLocalNotificationAt(
          {
            title: t('meetTime.warnTitle'),
            body: t('meetTime.warnBody', { title: nextMeet.title, minutes: redMin }),
            data: { kind: 'meetTimeWarn', destinationId: nextMeet.id },
          },
          warnAt,
        )
        .then(track);
    }

    void notifications
      .scheduleLocalNotificationAt(
        {
          title: t('meetTime.notifyTitle'),
          body: t('meetTime.notifyBody', { title: nextMeet.title }),
          data: { kind: 'meetTime', destinationId: nextMeet.id },
        },
        meetAt,
      )
      .then(track);

    const off = notifications.addForegroundListener((data) => {
      if (data.kind === 'meetTime' || data.kind === 'meetTimeWarn') alertBuzz();
    });
    return () => {
      cancelled = true;
      for (const id of ids) void notifications.cancelScheduledNotification(id);
      off();
    };
  }, [nextMeet?.id, nextMeet?.meetAt, nextMeet?.meetRedMinutes, nextMeet?.title, meetRedMin, t]);

  const persistMeetTime = useCallback(
    (destinationId: string, value: Date | null, redMin?: number) => {
      const clamped = value ? clampDateNotBeforeToday(value) : null;
      setDestinationMeetTime(
        destinationId,
        clamped ? clamped.toISOString() : null,
        clamped ? (redMin ?? meetRedMin ?? DEFAULT_MEET_RED_MIN) : null,
      )
        .then(() => {
          if (typeof redMin === 'number') setMeetRedMin(redMin);
          return refresh();
        })
        .catch(() => Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg')));
    },
    [refresh, t, meetRedMin, setMeetRedMin],
  );

  const openMeetTimePicker = useCallback(
    (dest: Destination) => {
      if (!canEditItinerary) return;
      const initial = clampDateNotBeforeToday(
        alignMeetTimeToTripDay(
          dest.meetAt ? new Date(dest.meetAt) : new Date(),
          group?.departureDate,
          dest.day || 1,
        ),
      );
      const red =
        dest.meetRedMinutes ??
        ((MEET_RED_OPTIONS as readonly number[]).includes(meetRedMin)
          ? meetRedMin
          : DEFAULT_MEET_RED_MIN);
      setMeetTimeEditor({
        id: dest.id,
        value: initial,
        redMin: red,
        quickMinutes: null,
      });
    },
    [canEditItinerary, group?.departureDate, meetRedMin],
  );

  const openAndroidMeetDate = useCallback(() => {
    if (!meetTimeEditor) return;
    const minDate = startOfTodayLocal();
    DateTimePickerAndroid.open({
      value: meetTimeEditor.value,
      mode: 'date',
      minimumDate: minDate,
      onChange: (event, selected) => {
        if (event.type !== 'set' || !selected) return;
        const next = new Date(meetTimeEditor.value);
        next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
        const clamped = clampDateNotBeforeToday(next);
        setMeetTimeEditor((s) =>
          s ? { ...s, value: clamped, quickMinutes: null } : s,
        );
        // Chain into time picker so date+time is one flow on Android.
        DateTimePickerAndroid.open({
          value: clamped,
          mode: 'time',
          is24Hour: true,
          onChange: (timeEvent, timeSelected) => {
            if (timeEvent.type !== 'set' || !timeSelected) return;
            setMeetTimeEditor((s) => {
              if (!s) return s;
              const merged = new Date(s.value);
              merged.setHours(timeSelected.getHours(), timeSelected.getMinutes(), 0, 0);
              return {
                ...s,
                value: clampDateNotBeforeToday(merged),
                quickMinutes: null,
              };
            });
          },
        });
      },
    });
  }, [meetTimeEditor]);
  // Freeze the route overlay's scroll while a stop is being drag-reordered so
  // the two vertical gestures never fight. Auto-scroll still works via ref.
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
  const [routeSyncFailed, setRouteSyncFailed] = useState(false);
  /** Route list interaction: drag handles / multi-select / hidden (default drag). */
  const [routeInteractionMode, setRouteInteractionMode] = useState<
    'drag' | 'select' | 'none'
  >('drag');
  const [routeSelectedIds, setRouteSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    if (overlay !== 'route') {
      routeOpenSyncGenerationRef.current += 1;
      routeOpenSyncSessionRef.current = 'idle';
      setRouteSyncFailed(false);
      // Reset list chrome when leaving the sheet.
      setRouteInteractionMode('drag');
      setRouteSelectedIds([]);
      return;
    }
    if (routeOpenSyncSessionRef.current !== 'idle') return;
    routeOpenSyncSessionRef.current = 'started';
    const generation = routeOpenSyncGenerationRef.current;
    void (async () => {
      try {
        // Never wipe an in-progress / failed-retry draft. Soft refresh only.
        const dirty = routeDraftDirtyRef.current;
        const hasDirty =
          dirty.destinations
          || dirty.daily
          || dirty.trip
          || dirty.deletedIds.length > 0;
        if (hasDirty) {
          if (!(await refresh())) throw new Error(t('map.syncDbFailedMsg'));
        } else {
          await syncFromDatabase();
        }
        if (generation !== routeOpenSyncGenerationRef.current) return;
        routeOpenSyncSessionRef.current = 'done';
        setRouteSyncFailed(false);
      } catch {
        if (generation !== routeOpenSyncGenerationRef.current) return;
        routeOpenSyncSessionRef.current = 'done';
        setRouteSyncFailed(true);
      }
    })();
  }, [overlay, syncFromDatabase, refresh, t]);

  const retryRouteSync = useCallback(async () => {
    if (await syncFromDatabaseAndUploadLogs()) setRouteSyncFailed(false);
  }, [syncFromDatabaseAndUploadLogs]);

  // --- Device GPS ----------------------------------------------------------
  const {
    deviceCoords,
    deviceAccuracyM,
    deviceCoordsAcceptedAtMs,
    appState,
    refreshDeviceLocation,
    consumeForegroundSample,
  } = useDeviceLocation({
    groupId,
    highAccuracy,
    nativeMapLocationEnabled: Platform.OS === 'ios',
    sharingEnabled,
    hasMembership: members.length > 0,
  });

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

  const reference = useMemo<MemberLocation | undefined>(
    () =>
      members.find((m) => m.userId === user?.id) ??
      members.find((m) => m.role === 'leader') ??
      members[0],
    [members, user?.id],
  );
  const fromCoords = deviceCoords ?? reference?.coordinates;

  // Lock MapView initialRegion to the first available center so GPS churn
  // does not rewrite GroupMap prop identity on every sample.
  const [mapInitialCenter, setMapInitialCenter] = useState<Coordinates | null>(
    fromCoords ?? null,
  );
  useEffect(() => {
    if (!fromCoords) return;
    setMapInitialCenter((current) => current ?? fromCoords);
  }, [fromCoords]);

  // Bridge: handleReorder is declared later; navigation promote needs it first.
  const reorderForNavigationRef = useRef<
    (updates: { id: string; position: number; day: number }[]) => Promise<boolean>
  >(async () => false);

  // --- Journey navigation + Live Activity ----------------------------------
  const {
    journeyStatus,
    journeyGoing,
    journeyActive,
    navTarget,
    navTargetId,
    sharedTargetId,
    pendingLeaderTargetId,
    activePoint,
    numericDistance,
    journeyBusy,
    openExternalNavigation,
    startNavigation,
    requestTeamEnd,
    stopNavigation,
  } = useJourneyNavigation({
    state,
    groupId,
    isLeader,
    destinations,
    navigationDestinations: destinations,
    selectedDestination,
    fromCoords,
    refresh,
    t,
    mapRef,
    carouselRef,
    setSelectedIndex,
    onOperatorStartConfirm: (dest) => {
      // Policy: operator_local_confirm for start_journey (sender once).
      const policy = resolveNotificationRecipients({
        event: 'start_journey',
        senderId: user?.id ?? 'self',
        members: [{
          userId: user?.id ?? 'self',
          role: isLeader ? 'leader' : 'follower',
          subgroupId: myScopeId ?? null,
          solo: false,
        }],
        eventId: groupId
          ? `start_journey:${groupId}:${dest.id}`
          : undefined,
      });
      if (policy.deliveryKind !== 'operator_local_confirm') return;
      void notifications.scheduleLocalNotification({
        title: t('notif.operatorStartTitle'),
        body: t('notif.operatorStartBody'),
        data: {
          kind: 'operatorStartConfirm',
          destinationId: dest.id,
          eventId: policy.eventIdentity,
        },
      });
    },
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
    // handleReorder is defined later; keep a stable bridge via ref.
    reorderForNavigation: (updates) => reorderForNavigationRef.current(updates),
    travelMode,
    onOptimisticGathering: applyOptimisticGathering,
  });

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
    void getLocationSharingEnabled()
      .then(async (remoteValue) => {
        if (remoteValue == null) {
          await setLocationSharingEnabled(sharingEnabled);
        } else {
          setSharingEnabled(remoteValue);
        }
      })
      .catch(() => {
        privacyHydratedUserRef.current = null;
      });
  }, [preferencesReady, setSharingEnabled, sharingEnabled, user?.id]);

  const [sharingApplying, setSharingApplying] = useState(false);
  const handleSharingEnabledChange = useCallback(async (enabled: boolean) => {
    const previous = sharingEnabled;
    if (enabled) {
      const granted = await requestLocationPermission();
      if (!granted) return false;
    }
    setSharingEnabled(enabled);
    if (!enabled) {
      await stopBackgroundJourney().catch(() => undefined);
      await purgeLocationOutbox().catch(() => undefined);
      if (navigationSessionState.session) {
        await navigationSessionState.ack('sharing_disabled', {
          source: 'settings_privacy_switch',
        }).catch(() => undefined);
      }
    }
    try {
      await setLocationSharingEnabled(enabled);
      return true;
    } catch {
      await diagnostics.write({
        event: 'diagnostic_error',
        errorCode: 'privacy_sync_failed',
        success: false,
      }).catch(() => undefined);
      // Keep the local preference aligned with the server when the sync fails.
      setSharingEnabled(previous);
      Alert.alert(t('settings.locationSharingSyncFailed'));
      return false;
    }
  }, [setSharingEnabled, navigationSessionState, sharingEnabled, t]);
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
  const mapRoutesEnabled = !(preferencesReady && passiveCompanionMode);
  const { selfRoute, memberRoutes, selfRouteGeneration } = useMapKitRoutes({
    selfCoordinates: fromCoords,
    members,
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
  const foregroundArrivalRef = useRef<{ key: string; state: ArrivalState } | null>(null);
  const foregroundAckRef = useRef<string | null>(null);
  const autoArrivalMarkedRef = useRef<string | null>(null);
  const arrivalFeedbackShownRef = useRef<string | null>(null);
  const arrivalNotificationDestIdsRef = useRef<Set<string>>(new Set());
  /** In-flight complete-stop dest ids — ignore re-entry until settled (SUG-2). */
  const completingDestIdsRef = useRef<Set<string>>(new Set());
  /**
   * Dest ids we already auto-completed (or started) from remote all-arrived —
   * prevents effect re-fire storms. Cleared on failure so retry is possible.
   */
  const remoteAutoCompleteDestIdsRef = useRef<Set<string>>(new Set());
  const arrivalSplitSeenRef = useRef<Set<string>>(new Set());
  const approachFiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    void AsyncStorage.getItem(APPROACH_FIRED_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const keys = JSON.parse(raw) as string[];
        if (Array.isArray(keys)) {
          for (const key of keys) approachFiredRef.current.add(key);
        }
      })
      .catch(() => undefined);
  }, []);
  const [autoArrivedDestId, setAutoArrivedDestId] = useState<string | null>(null);
  const [arrivalCelebrateDestId, setArrivalCelebrateDestId] = useState<string | null>(null);
  const [requestingStartDestId, setRequestingStartDestId] = useState<string | null>(null);

  /** #149: after stop completes (closedAt), hold effect 3.2s then 440ms card exit. */
  const startArrivalCardExit = useCallback((
    destination: Destination,
    indexAtStart = 0,
  ) => {
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
    if (knownClosedDestIdsRef.current == null) {
      // First paint: seed known closed so past history does not animate out.
      knownClosedDestIdsRef.current = new Set(closedNow.map((d) => d.id));
      prevVisibleDestOrderRef.current = openDestinations.map((d) => d.id);
      return;
    }
    const newlyStarted: string[] = [];
    for (const dest of closedNow) {
      if (knownClosedDestIdsRef.current.has(dest.id)) continue;
      knownClosedDestIdsRef.current.add(dest.id);
      const priorIdx = resolveExitIndexAtStart(
        prevVisibleDestOrderRef.current,
        dest.id,
        prevVisibleDestOrderRef.current.length,
      );
      startArrivalCardExit(dest, priorIdx);
      newlyStarted.push(dest.id);
    }
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
    allScopedDestinations,
    openDestinations,
    startArrivalCardExit,
    arrivalExitRecords,
  ]);

  useEffect(() => {
    return () => {
      for (const timers of arrivalExitTimersRef.current.values()) {
        for (const t of timers) clearTimeout(t);
      }
      arrivalExitTimersRef.current.clear();
      clearAllCelebrateClearTimers(celebrateClearTimersRef.current);
    };
  }, []);

  // Wired after promptCompleteAfterArrival is defined (see below).
  const afterPersonalArrivalRef = useRef<
    (destination: Destination, opts?: { stopNav?: boolean; promptComplete?: boolean }) => void
  >(() => undefined);

  useEffect(() => {
    // Auto-arrive while navigating (shared flock session or local path plan).
    // tools slider radius is authoritative (e.g. 300 m).
    if (!journeyActive || !navTarget || !deviceCoords) {
      foregroundArrivalRef.current = null;
      return;
    }
    if (myCompletedDestinationIds.has(navTarget.id)) {
      return;
    }
    const session = navigationSessionState.session;
    const key = `${session?.id ?? 'local'}:${navTarget.id}`;
    if (session?.id && foregroundAckRef.current && !foregroundAckRef.current.startsWith(`${session.id}:`)) {
      foregroundAckRef.current = null;
    }
    if (!session) {
      foregroundAckRef.current = null;
    }
    const straightM = distanceMeters(deviceCoords, navTarget.coordinates);
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
    };
    const ackStatus: 'arrived' | 'arriving' | null = arrivedNow
      ? 'arrived'
      : next.status === 'arriving'
        ? 'arriving'
        : null;
    const ackKey = session && ackStatus ? `${session.id}:${ackStatus}` : null;
    if (session && ackStatus && ackKey && foregroundAckRef.current !== ackKey) {
      foregroundAckRef.current = ackKey;
      void navigationSessionState.ack(ackStatus, {
        source: 'foreground_arrival_reducer',
        distanceM: straightM,
        accuracyM: deviceAccuracyM,
        consecutiveFixes: next.consecutiveFixes,
      }).catch(() => undefined);
    }
    if (arrivedNow && user?.id) {
      setAutoArrivedDestId(navTarget.id);
      // Persist personal arrival so the checkmark does not depend only on ACK.
      if (autoArrivalMarkedRef.current !== navTarget.id) {
        autoArrivalMarkedRef.current = navTarget.id;
        // Celebrate + stop nav immediately; complete-stop only after write
        // succeeds (Codex P1: do not schedule auto-complete before arrival RPC).
        afterPersonalArrivalRef.current(navTarget, {
          stopNav: true,
          promptComplete: false,
        });
        void setDestinationArrival(navTarget.id, user.id, true)
          .then(() => {
            patchLocalArrival(navTarget.id, user.id, true);
            return loadGatheringWorkflow().catch(() => undefined);
          })
          .then(() => {
            afterPersonalArrivalRef.current(navTarget, { promptComplete: true });
          })
          .catch(() => {
            // Arrival was not committed: clear optimistic personally-arrived so
            // manual Complete cannot auto-complete by force-including self.
            autoArrivalMarkedRef.current = null;
            setAutoArrivedDestId((cur) => (cur === navTarget.id ? null : cur));
            patchLocalArrival(navTarget.id, user.id, false);
            if (arrivalFeedbackShownRef.current === navTarget.id) {
              arrivalFeedbackShownRef.current = null;
            }
            arrivalNotificationDestIdsRef.current.delete(navTarget.id);
            setArrivalCelebrateDestId((cur) => (cur === navTarget.id ? null : cur));
          });
      }
    }
  }, [
    deviceAccuracyM,
    deviceCoords,
    journeyActive,
    loadGatheringWorkflow,
    localArrivalRadiusM,
    myCompletedDestinationIds,
    navTarget,
    navigationSessionState.ack,
    navigationSessionState.session,
    patchLocalArrival,
    user?.id,
  ]);
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
  }>({ distanceM: null, etaSeconds: null, progress: null });
  const [initialDistanceM, setInitialDistanceM] = useState<number | undefined>();
  const [distanceSource, setDistanceSource] = useState<DistanceSource | undefined>();
  const [progressDepartedStart, setProgressDepartedStart] = useState(false);
  const backgroundPermissionDeniedRef = useRef<string | null>(null);
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
      setLastValidPresentation({ distanceM: null, etaSeconds: null, progress: null });
      return;
    }

    const key = `${groupId}:${navTarget.id}:${state?.group.journeyStartedAt ?? ''}`;
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
      setLastValidPresentation({ distanceM: null, etaSeconds: null, progress: null });
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
  ]);

  /**
   * Single GPS owner for the 8h≈20% budget:
   * - App active → foreground watch (useDeviceLocation); background task STOPPED.
   * - App background → allDay group presence, or denser journey profile.
   * Dual-tracking (watch + task) is the main heat source when navigating.
   */
  useEffect(() => {
    if (!groupId) {
      setBackgroundPermissionsPreparedFor(null);
      void stopBackgroundJourney();
      return;
    }

    // Foreground owns GPS.
    if (appState === 'active') {
      backgroundPermissionDeniedRef.current = null;
      if (sharingEnabled && backgroundPermissionsPreparedFor !== groupId
        && backgroundPermissionPrepareInFlightRef.current !== groupId) {
        backgroundPermissionPrepareInFlightRef.current = groupId;
        void prepareBackgroundJourneyPermissions()
          .then((result) => {
            if (result === 'ready') {
              setBackgroundPermissionsPreparedFor(groupId);
            } else {
              setBackgroundPermissionsPreparedFor(null);
              void rememberPendingLocationPermission();
            }
          })
          .finally(() => {
            if (backgroundPermissionPrepareInFlightRef.current === groupId) {
              backgroundPermissionPrepareInFlightRef.current = null;
            }
          });
      } else if (!sharingEnabled && backgroundPermissionsPreparedFor != null) {
        setBackgroundPermissionsPreparedFor(null);
      }
      void stopBackgroundJourney();
      return;
    }

    const powerMode = journeyActive && navTarget ? 'journey' : 'allDay';
    const dest =
      navTarget?.coordinates ??
      deviceCoords ??
      { latitude: 0, longitude: 0 };
    const key = `${groupId}:${powerMode}:${navTarget?.id ?? 'presence'}`;
    if (backgroundPermissionDeniedRef.current === key) return;

    const backgroundInitialM =
      initialJourneyRef.current?.distanceM ??
      (deviceCoords && navTarget
        ? distanceMeters(deviceCoords, navTarget.coordinates)
        : 0);

    void startBackgroundJourney({
      groupId,
      navigationSessionId,
      destinationId: navTarget?.id ?? 'group-presence',
      destination: dest,
      arrivalRadiusMeters: localArrivalRadiusM,
      initialDistanceM: backgroundInitialM,
      sequence: 0,
      travelMode,
      // Explicit high accuracy is a user opt-in even without team navigation.
      highAccuracy,
      powerMode,
      sharingEnabled,
      hasMembership: members.length > 0,
      gatheringTitle: navTarget?.title ?? membership?.group.name,
      groupName: membership?.group.name ?? '',
      memberEmojis: members.map((m) => m.avatar ?? ''),
      memberArrived: members.map((m) => m.status === 'arrived'),
      startCoords: journeyStartCoords ?? undefined,
      hasDepartedStart: progressDepartedStart,
      previousProgressMax: progressMaxSticky ?? undefined,
      etaSeconds: selfRoute?.expectedTravelTimeSeconds,
      teamNavigationActive: hasNavigationSession || Boolean(journeyActive && navTarget),
      appState: appState === 'background' ? 'background' : 'inactive',
      permissionsPrepared: backgroundPermissionsPreparedFor === groupId,
    }).then((result) => {
      if (result === 'hidden') {
        void purgeLocationOutbox();
      }
      if (result === 'permission_denied') {
        backgroundPermissionDeniedRef.current = key;
        void rememberPendingLocationPermission();
      }
    });
  }, [
    appState,
    backgroundPermissionsPreparedFor,
    deviceCoords,
    groupId,
    highAccuracy,
    journeyActive,
    navTarget,
    navigationSessionId,
    hasNavigationSession,
    sharingEnabled,
    showLocationPermissionAlert,
    travelMode,
    members,
    membership?.group.name,
    journeyStartCoords,
    progressDepartedStart,
    progressMaxSticky,
    selfRoute?.expectedTravelTimeSeconds,
  ]);

  useEffect(() => () => void stopBackgroundJourney(), []);

  // The single Ticket 1 sampler owns the timer. Navigation only updates its
  // allow-listed context; the deprecated startNavigationEnergyMonitor seam is
  // intentionally not called from production.
  useEffect(() => {
    const trackingMode = hasNavigationSession
      ? highAccuracy
        ? 'navigationMax'
        : 'teamNavigation'
      : highAccuracy
        ? 'manualHighAccuracy'
        : 'foreground';
    energyObservability.setTrackingMode(
      journeyActive && appState === 'active' ? trackingMode : 'passiveBackground',
    );
  }, [
    appState,
    highAccuracy,
    journeyActive,
    hasNavigationSession,
  ]);

  const lastFittedRouteRef = useRef<string | null>(null);
  useEffect(() => {
    const key = activePoint ? `${activePoint.id}:${travelMode}` : null;
    if (key && key !== lastFittedRouteRef.current && selfRoute?.points.length) {
      lastFittedRouteRef.current = key;
      mapRef.current?.fitRoute(selfRoute.points);
    }
    if (!key) lastFittedRouteRef.current = null;
  }, [activePoint, selfRoute, travelMode]);

  // --- Straggler alerts (leader-only, 1:N vs leader GPS) ----------------------
  // Followers never run distance logic; they only receive APNs from the leader.
  // Configuration UI was removed; detection still reads group fields from DB.
  const { stragglers } = useStragglerAlerts(state, fromCoords ?? undefined, {
    enabled: !!isLeader,
    leaderUserId: user?.id,
    alertsEnabled: group?.stragglerAlerts ?? true,
    thresholdM: group?.stragglerThresholdM ?? 500,
  });
  // On newly flagged members (hysteresis in the hook), leader fans out APNs
  // via RPC — no local notification (would double-fire for the leader).
  const lastStragglerIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isLeader || !groupId) {
      lastStragglerIdsRef.current = new Set();
      return;
    }
    const ids = new Set(stragglers.map((s) => s.userId));
    const newOnes = stragglers.filter((s) => !lastStragglerIdsRef.current.has(s.userId));
    lastStragglerIdsRef.current = ids;
    for (const s of newOnes) {
      void reportStraggler(groupId, s.userId, s.distanceM).catch(() => {
        // Soft-fail: leader-role mismatch / network blip must not escalate to
        // root render fallback. No blind retry.
        // Canonical error event is owned by instrumented Supabase `traceApi`
        // (api.rpc.report_straggler + leader_role_required classification) —
        // do not logError again or the outbox doubles every soft-fail.
      });
    }
  }, [stragglers, isLeader, groupId]);

  // Organizer exception center — leader-only derived list (no second source of truth).
  const exceptionArrivedUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of members) {
      if (m.status === 'arrived') ids.add(m.userId);
    }
    const pointId =
      navigationSessionState.session?.destinationId
      ?? activePoint?.id
      ?? null;
    if (pointId) {
      for (const entry of destinationArrivals) {
        if (entry.destinationId === pointId) ids.add(entry.userId);
      }
    }
    return ids;
  }, [
    members,
    destinationArrivals,
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
  const liveGathered = navTarget
    ? members.filter((m) => m.status === 'arrived').length
    : undefined;
  const straightToTargetM =
    deviceCoords && navTarget
      ? distanceMeters(deviceCoords, navTarget.coordinates)
      : undefined;
  const localNavigationArrived = Boolean(
    navTarget && (
      myCompletedDestinationIds.has(navTarget.id) ||
      autoArrivedDestId === navTarget.id ||
      navigationSessionState.memberState?.localStatus === 'arrived' ||
      (straightToTargetM != null && hasArrived(straightToTargetM, localArrivalRadiusM))
    ),
  );
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
      ? `${groupId}:${navTarget.id}:${state?.group.journeyStartedAt ?? ''}`
      : null,
    deviceCoords,
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
    const key = approachNotifyKey(navigationSessionState.session?.id, navTarget.id);
    if (approachFiredRef.current.has(key)) return;
    if (!shouldFireApproachNotify({
      remainingM: remaining,
      totalM: total,
      arrivalRadiusM: localArrivalRadiusM,
      arrived: personalProgress.arrived || localNavigationArrived,
      alreadyFired: false,
    })) return;
    approachFiredRef.current.add(key);
    const copy = approachNotifyCopy(navTarget.title);
    void notifications.scheduleLocalNotification({
      title: copy.title,
      body: copy.body,
      data: { kind: 'approach', destinationId: navTarget.id },
    }).catch(() => undefined);
    void AsyncStorage.getItem(APPROACH_FIRED_STORAGE_KEY)
      .then((raw) => {
        const prev = raw ? (JSON.parse(raw) as string[]) : [];
        const next = Array.from(new Set([...prev, key]));
        return AsyncStorage.setItem(APPROACH_FIRED_STORAGE_KEY, JSON.stringify(next));
      })
      .catch(() => undefined);
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
    const key = `${groupId}:${navTarget.id}:${state?.group.journeyStartedAt ?? ''}`;
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
      ) {
        sticky.distanceM = d;
        sticky.etaSeconds = e;
        sticky.progress = p;
        setLastValidPresentation({ distanceM: d, etaSeconds: e, progress: p });
      }
    }
  }, [
    journeyActive,
    navTarget,
    groupId,
    state?.group.journeyStartedAt,
    personalProgress.progress,
    personalProgress.distanceMeters,
    personalProgress.etaSeconds,
  ]);

  // Both presentation surfaces consume the same orchestration output.
  const personalDistanceM = progressSurfaces.gatheringCard.distanceMeters;
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
    journeyActive
      && !personalProgress.arrived
      && !localNavigationArrived
      && liveActivityAllowed
      && !(preferencesReady && passiveCompanionMode),
    {
    groupName: membership?.group.name ?? '',
    navigationSessionId: navigationSessionState.session?.id,
    status: navigationSessionState.session ? 'active' : undefined,
    // Gathering point title when a target exists; team name is fallback only.
    gatheringTitle: navTarget?.title ?? membership?.group.name,
    distanceMeters: progressSurfaces.liveActivityPayload.distanceMeters ?? undefined,
    etaSeconds: progressSurfaces.liveActivityPayload.etaSeconds ?? undefined,
    gatheringCoordinates: navTarget?.coordinates,
    progress: progressSurfaces.liveActivityPayload.progress ?? undefined,
    gatheredCount: liveGathered,
    memberCount: members.length,
    accentHex: accent,
    travelMode,
    memberEmojis: members.map((m) => m.avatar ?? ''),
    memberArrived: members.map((m) => m.status === 'arrived'),
    // Ticket 07: destination emoji when set (native may no-op without a glyph slot).
    // Flag color is day-scoped in map/list chrome; LA keeps theme accent.
    destinationEmoji: navTarget?.emoji ?? undefined,
    language,
  }, groupId && navTarget && liveActivityBaselineM != null ? {
    groupId,
    navigationSessionId: navigationSessionState.session?.id,
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
    // Client-side cooldown: do not re-hit fan-out while cooling.
    const remainingMs = refreshCooldownUntil - Date.now();
    if (remainingMs > 0) {
      Alert.alert(
        t('map.refreshLocationsCooldown', {
          seconds: Math.max(1, Math.ceil(remainingMs / 1000)),
        }),
      );
      return;
    }
    setRefreshingLocations(true);
    try {
      if (isDemoGroup(groupId)) {
        // Demo: self one-shot only (no peer fan-out).
        await refreshDeviceLocation();
        return;
      }

      // 1) Self first: one-shot GPS + immediate upload + local marker/timestamp.
      //    requireUpload: upload failure must stop fan-out and alert (spec 101–103).
      const selfFix = await refreshDeviceLocation({ requireUpload: true });
      if (!selfFix) {
        // Permission / no-fix — surface actionable feedback; skip peer fan-out.
        const permission = await location.getPermissionState().catch(() => null);
        if (!permission || permission.foregroundStatus !== 'granted') {
          showLocationPermissionAlert();
        } else {
          Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
        }
        return;
      }

      // 2) Then ask the server to fan out refresh requests to peers.
      //    Realtime is the fast path; the bounded wait makes the result honest
      //    before the final pull, without synthesizing peer timestamps.
      const refreshStartedAtMs = Date.now();
      const baselineLastUpdated = new Map(
        membersRef.current.map((member) => [member.userId, member.lastUpdated]),
      );
      const result = await requestGroupLocationRefresh(groupId);
      const retryAfter = Math.max(0, result.retryAfterSeconds);
      setRefreshCooldownUntil(Date.now() + retryAfter * 1000);
      if (result.accepted) {
        const expectedUserIds = result.recipientIds;
        const responseResult = await waitForLocationRefreshResponses({
          getMembers: () => membersRef.current,
          expectedUserIds,
          baselineLastUpdated,
          requestedAtMs: refreshStartedAtMs,
        });
        // The final pull reconciles missed Realtime events. useGroupState.refresh
        // returns false on remote failure even if a local cache is still shown.
        const pulled = await refresh();
        if (!pulled) {
          Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
        } else {
          const finalResponseResult = assessLocationRefreshResponses({
            members: membersRef.current,
            expectedUserIds,
            baselineLastUpdated,
            requestedAtMs: refreshStartedAtMs,
          });
          const visibleResult = finalResponseResult.respondedUserIds.length
            >= responseResult.respondedUserIds.length
            ? finalResponseResult
            : responseResult;
          if (visibleResult.status === 'all') {
            Alert.alert(
              t('map.refreshLocationsResultTitle'),
              t('map.refreshLocationsResultAll'),
            );
          } else if (visibleResult.status === 'partial') {
            Alert.alert(
              t('map.refreshLocationsResultTitle'),
              t('map.refreshLocationsResultPartial', {
                responded: visibleResult.respondedUserIds.length,
                expected: visibleResult.expectedUserIds.length,
              }),
            );
          } else {
            Alert.alert(
              t('map.refreshLocationsResultTitle'),
              t('map.refreshLocationsResultNone'),
            );
          }
        }
      } else {
        Alert.alert(
          t('map.refreshLocationsCooldown', { seconds: retryAfter }),
        );
      }
    } catch {
      Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
    } finally {
      setRefreshingLocations(false);
    }
  }, [
    groupId,
    refresh,
    refreshCooldownUntil,
    refreshDeviceLocation,
    refreshingLocations,
    showLocationPermissionAlert,
    t,
    user?.id,
  ]);

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
    async (items: GatherPointRequestItem[], source: 'search' | 'kml'): Promise<boolean> => {
      if (!groupId) return false;
      const label = items.length === 1
        ? items[0].title
        : t('map.placesCount', { count: items.length });
      const result = await runUiAction(
        'map.destination_suggest',
        async (token) => {
          try {
            await submitGatherPointRequest(groupId, myScopeId, items);
            if (!token.isCurrent()) return false;
            logEvent('destination_suggest', { source, label });
            Alert.alert(t('gatherRequest.sentTitle'), t('gatherRequest.sentBody'));
            return true;
          } catch (e) {
            logError('destination_suggest_failed', e, { source });
            if (token.isCurrent()) {
              Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
            }
            throw e;
          }
        },
        {
          screen: 'Map',
          suppressBanner: true,
          onError: (kind) => {
            if (kind === 'timeout') {
              Alert.alert(t('map.setFailedTitle'), t('interaction.timeout'));
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
        optimisticDepartureDate ?? group?.departureDate,
        optimisticTripDays ?? group?.tripDays,
      ),
    [
      optimisticDepartureDate,
      optimisticTripDays,
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
          day: tripDayForAdd(),
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

  const handlePickDestination = useCallback(async (place: PlaceResult): Promise<boolean> => {
    if (!groupId) return false;
    const addDay = tripDayForAdd();
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
            },
            myScopeId,
          );
          if (!token.isCurrent()) return false;
          logEvent('destination_add', { source: placeSource, day: addDay });
          setSelectedIndex(destinations.length);
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
          // Only treat as complete success when refresh confirms projection.
          // refresh() false keeps the confirm card / temp flag (Ticket 05).
          const projected = await refresh();
          return projected === true;
        } catch (e) {
          logError('destination_add_failed', e, { source: placeSource });
          if (token.isCurrent()) {
            Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
          }
          throw e;
        }
      },
      {
        screen: 'Map',
        suppressBanner: true,
        onError: (kind) => {
          if (kind === 'timeout') {
            Alert.alert(t('map.setFailedTitle'), t('interaction.timeout'));
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
    const addDay = tripDayForAdd();
    // BUG-15: non-editors notify captain with place names instead of writing itinerary.
    if (!canEditItinerary) {
      await notifyLeaderPlace(items.map((item) => ({
        title: item.name,
        coordinates: { latitude: item.latitude, longitude: item.longitude },
        day: addDay,
      })), 'kml');
      onProgress(items.length);
      return;
    }
    // Validate full batch before any DB I/O; single atomic mutation (#152).
    const normalized = normalizeImportBatch(items);
    onProgress(0);
    try {
      await addDestinationsBatch(groupId, normalized, {
        day: addDay,
        subgroupId: myScopeId,
      });
      onProgress(normalized.length);
    } catch (e) {
      if (e instanceof KmlImportError) throw e;
      throw new KmlImportError('persistence', 'persistence', e instanceof Error ? e.message : String(e));
    }
    logEvent('kml_import', { count: normalized.length, day: addDay });
    await refresh();
  }, [groupId, canEditItinerary, notifyLeaderPlace, myScopeId, refresh, tripDayForAdd]);

  const openCoordinateSheet = useCallback((coords?: { latitude: number; longitude: number }) => {
    setCoordSheetInitial(coords);
    setCoordSheetVisible(true);
  }, []);

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
      const addDay = tripDayForAdd();
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
            setSelectedIndex(destinations.length);
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
            await refresh();
            return true;
          } catch (e) {
            logError('destination_add_failed', e, { source: 'coordinates' });
            if (token.isCurrent()) {
              Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
            }
            throw e;
          }
        },
        {
          screen: 'Map',
          suppressBanner: true,
          onError: (kind) => {
            if (kind === 'timeout') {
              Alert.alert(t('map.setFailedTitle'), t('interaction.timeout'));
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
        isNetworkRequestError(error)
          ? t('gatherRequest.networkFailed')
          : error instanceof Error
            ? error.message
            : t('map.setFailedMsg'),
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

  /** @returns true when complete RPC + refresh succeeded (for auto-complete notify). */
  const runCompleteGatheringStop = useCallback(async (destination: Destination): Promise<boolean> => {
    // Complete is separate from End navigation: only this path closes the stop
    // (closed_at → leaves carousel → history). End only pauses flock travel.
    // Server complete_gathering_stop also cancels any active nav for this stop.
    if (!groupId) return false;
    const alreadyClosed = !!destination.closedAt
      || allScopedDestinations.find((d) => d.id === destination.id)?.closedAt != null;
    const plan = planCompleteGatheringApply({
      alreadyClosed,
      rpcInFlight: completingDestIdsRef.current.has(destination.id),
      remoteAutoCompleted: remoteAutoCompleteDestIdsRef.current.has(destination.id),
    });
    const closedAt = destination.closedAt ?? new Date().toISOString();
    if (plan.applyLocalClosedAt) {
      setOptimisticDestinations((prev) =>
        applyLocalClosedAt(prev ?? allScopedDestinations, destination.id, closedAt),
      );
    }
    if (plan.startCardExit) {
      const priorIdx = resolveExitIndexAtStart(
        prevVisibleDestOrderRef.current,
        destination.id,
        prevVisibleDestOrderRef.current.length,
      );
      startArrivalCardExit({ ...destination, closedAt }, priorIdx);
    }
    if (plan.callRpc) {
      completingDestIdsRef.current.add(destination.id);
      try {
        await completeGatheringStop(groupId, destination.id);
      } catch (error) {
        logError('complete_gathering_failed', error, { groupId, destId: destination.id });
        Alert.alert(
          t('map.setFailedTitle'),
          error instanceof Error ? error.message : t('map.setFailedMsg'),
        );
        completingDestIdsRef.current.delete(destination.id);
        return false;
      }
      completingDestIdsRef.current.delete(destination.id);
    }
    if (plan.refreshHistory) {
      await navigationSessionState.refresh().catch(() => undefined);
      await refresh().catch(() => undefined);
      await loadGatheringWorkflow().catch(() => undefined);
      await loadHistory().catch(() => undefined);
    }
    return true;
  }, [
    allScopedDestinations,
    groupId,
    loadGatheringWorkflow,
    loadHistory,
    navigationSessionState,
    refresh,
    startArrivalCardExit,
    t,
  ]);


  /** Shared auto-complete: guard + complete RPC + this-device notify (native boundary). */
  const executeAutoCompleteStop = useCallback(async (destination: Destination) => {
    const alreadyTracked = remoteAutoCompleteDestIdsRef.current.has(destination.id);
    remoteAutoCompleteDestIdsRef.current.add(destination.id);
    const ok = await runCompleteGatheringStop(destination);
    if (!ok) {
      remoteAutoCompleteDestIdsRef.current.delete(destination.id);
      return;
    }
    if (alreadyTracked) return;
    // Platform path lives in native/notifications (not MapScreen Platform.OS).
    void notifications.notifyThisDeviceAutoComplete({
      title: t('gathering.autoCompleteTitle'),
      body: t('gathering.autoCompleteBody', { title: destination.title }),
      data: { kind: 'gathering_auto_complete', destinationId: destination.id },
    }).catch(() => undefined);
  }, [runCompleteGatheringStop, t]);

  const promptCompleteAfterArrival = useCallback((destination: Destination, opts?: {
    /**
     * Only true after a successful local arrival write.
     * Manual Complete / remote path must not invent a self arrival (P1).
     */
    includeSelf?: boolean;
  }) => {
    const arrivedIds = new Set(
      destinationArrivals
        .filter((a) => a.destinationId === destination.id)
        .map((a) => a.userId),
    );
    const counts = deriveScopedArrivalCounts({
      members,
      destinationSubgroupId: destination.subgroupId,
      arrivedUserIds: arrivedIds,
      // Opt-in only — default false so failed write cannot force auto-complete.
      includeUserId: opts?.includeSelf ? user?.id : null,
      travelerFallback: t('group.travelerFallback'),
    });
    const stopAlreadyComplete = !!destination.closedAt
      || allScopedDestinations.find((d) => d.id === destination.id)?.closedAt != null;
    const prompt = resolveCompletePrompt({
      isLeader,
      missingMemberNames: counts.missingMemberNames,
      allArrived: counts.allArrived,
      stopAlreadyComplete: !!stopAlreadyComplete,
      arrivedCount: counts.arrivedCount,
      totalCount: counts.totalCount,
    });
    if (prompt.kind === 'none') return;

    // All arrived → auto-complete + this-device notification. No confirm dialog.
    // Already-closed is the same apply path (never a silent no-op).
    if (prompt.kind === 'auto_complete' || prompt.kind === 'already_complete') {
      void executeAutoCompleteStop(destination);
      return;
    }

    // Manual complete (someone missing) or member notice — i18n only (helper kind/counts).
    const isMissing = prompt.kind === 'leader_missing_members';
    const isMemberDone = prompt.kind === 'member_leader_already_done';
    const title = isMissing
      ? t('gathering.completeMissingTitle')
      : isMemberDone
        ? t('gathering.memberLeaderDoneTitle')
        : prompt.title;
    const message = isMissing
      ? t('gathering.completeMissingMessage', {
          arrived: String(prompt.arrivedCount ?? 0),
          total: String(prompt.totalCount ?? 0),
        })
      : isMemberDone
        ? t('gathering.memberLeaderDoneMessage')
        : prompt.message;
    const confirmLabel = isMissing
      ? t('gathering.completeConfirm')
      : isMemberDone
        ? t('common.confirm')
        : prompt.confirmLabel;
    const cancelLabel = isMissing
      ? t('common.cancel')
      : prompt.cancelLabel;

    const buttons: Array<{ text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }> = [];
    if (cancelLabel) {
      buttons.push({
        text: cancelLabel,
        style: 'cancel',
      });
    }
    buttons.push({
      text: confirmLabel,
      style: isMissing ? 'destructive' : undefined,
      onPress: () => {
        // Leader RPC only — members already have arrival/history; just refresh.
        if (isMemberDone) {
          void refresh();
          void loadGatheringWorkflow();
          return;
        }
        void runCompleteGatheringStop(destination);
      },
    });
    Alert.alert(title, message, buttons);
  }, [
    allScopedDestinations,
    destinationArrivals,
    executeAutoCompleteStop,
    isLeader,
    loadGatheringWorkflow,
    members,
    refresh,
    runCompleteGatheringStop,
    t,
    user?.id,
  ]);

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
    if (opts?.stopNav) void stopNavigation();
    if (
      opts?.promptComplete
      && !arrivalNotificationDestIdsRef.current.has(destination.id)
    ) {
      arrivalNotificationDestIdsRef.current.add(destination.id);
      void notifications.scheduleLocalNotification({
        title: t('map.arriveTitle'),
        body: t('map.arriveBody', { title: destination.title }),
        data: { kind: 'destinationArrival', destinationId: destination.id },
      });
    }

    const COMPLETE_PROMPT_DELAY_MS = 1_600 + 1_000;
    if (opts?.promptComplete) {
      // includeSelf only on this post-write path (arrival RPC already succeeded).
      setTimeout(() => {
        promptCompleteAfterArrival(destination, { includeSelf: true });
      }, alreadyShown ? 0 : COMPLETE_PROMPT_DELAY_MS);
      return;
    }

    // Celebrate-only path (write still in flight): plain arrive alert for members only.
    if (!alreadyShown && !isLeader) {
      const fallback =
        language === 'en'
          ? `You have arrived at "${destination.title}"`
          : `你已經抵達集合點「${destination.title}」`;
      const raw = t('map.arriveBody', { title: destination.title });
      const body = !raw || raw === 'map.arriveBody' || raw.includes('map.arriveBody')
        ? fallback
        : raw;
      setTimeout(() => {
        Alert.alert(t('map.arriveTitle'), body);
      }, 1_600);
    }
  };

  // Remote final arrival (Realtime / workflow reload): leader auto-completes when
  // every *scoped* member has an arrival row — no personal-arrive path required.
  useEffect(() => {
    if (!isLeader || !groupId) return;
    for (const destination of allScopedDestinations) {
      if (destination.closedAt) {
        remoteAutoCompleteDestIdsRef.current.delete(destination.id);
        continue;
      }
      if (remoteAutoCompleteDestIdsRef.current.has(destination.id)) continue;
      if (completingDestIdsRef.current.has(destination.id)) continue;

      const arrivedIds = new Set(
        destinationArrivals
          .filter((a) => a.destinationId === destination.id)
          .map((a) => a.userId),
      );
      const counts = deriveScopedArrivalCounts({
        members,
        destinationSubgroupId: destination.subgroupId,
        arrivedUserIds: arrivedIds,
        // Remote path: only committed arrivals, never invent self.
        includeUserId: null,
        travelerFallback: t('group.travelerFallback'),
      });
      if (!counts.allArrived) continue;
      void executeAutoCompleteStop(destination);
    }
  }, [
    allScopedDestinations,
    destinationArrivals,
    executeAutoCompleteStop,
    groupId,
    isLeader,
    members,
    t,
  ]);

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
        Alert.alert(t('map.setFailedTitle'), t('command.sendFailed'));
      })
      .finally(() => setRequestingStartDestId(null));
  }, [groupId, requestingStartDestId, t]);

  const handleArrival = useCallback((destination: Destination, targetUserId: string, arrived: boolean) => {
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
          await syncFromDatabase();
          await setDestinationArrival(destination.id, targetUserId, arrived);
          patchLocalArrival(destination.id, targetUserId, arrived);
          if (!arrived && targetUserId === user?.id) {
            setAutoArrivedDestId((cur) => (cur === destination.id ? null : cur));
            if (autoArrivalMarkedRef.current === destination.id) {
              autoArrivalMarkedRef.current = null;
            }
            if (arrivalFeedbackShownRef.current === destination.id) {
              arrivalFeedbackShownRef.current = null;
            }
            arrivalNotificationDestIdsRef.current.delete(destination.id);
          }
          await loadGatheringWorkflow().catch(() => undefined);
        } catch (error) {
          Alert.alert(
            t('arrival.failedTitle'),
            arrivalErrorMessage(error, t),
          );
        }
      })();
    });
  }, [loadGatheringWorkflow, members, patchLocalArrival, syncFromDatabase, t, user?.id]);

  const submitArrivalWithTimestamp = useCallback((
    destination: Destination,
    targetUserId: string,
    arrivedAt: string | null,
  ) => {
    void (async () => {
      // Optimistic celebrate only — complete-stop waits for arrival write success.
      if (targetUserId === user?.id) setAutoArrivedDestId(destination.id);
      patchLocalArrival(destination.id, targetUserId, true, arrivedAt);
      afterPersonalArrivalRef.current(destination, {
        stopNav: navTarget?.id === destination.id,
        promptComplete: false,
      });
      try {
        await setDestinationArrivalAt(destination.id, targetUserId, true, arrivedAt);
      } catch (error) {
        // Roll back local mark if the shared write fails — never complete-stop.
        if (targetUserId === user?.id) {
          setAutoArrivedDestId((cur) => (cur === destination.id ? null : cur));
          arrivalNotificationDestIdsRef.current.delete(destination.id);
        }
        patchLocalArrival(destination.id, targetUserId, false);
        if (arrivalFeedbackShownRef.current === destination.id) {
          arrivalFeedbackShownRef.current = null;
        }
        setArrivalCelebrateDestId((cur) => (cur === destination.id ? null : cur));
        Alert.alert(
          t('arrival.failedTitle'),
          arrivalErrorMessage(error, t),
        );
        return;
      }
      await loadGatheringWorkflow().catch(() => undefined);
      // Arrival committed → complete rules (auto if all scoped arrived).
      afterPersonalArrivalRef.current(destination, { promptComplete: true });
    })();
  }, [
    loadGatheringWorkflow,
    navTarget?.id,
    patchLocalArrival,
    t,
    user?.id,
  ]);

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
          error instanceof Error ? error.message : t('map.setFailedMsg'),
        ));
    });
  }, [loadHistory, t]);



  // --- Group actions --------------------------------------------------------
  const [codeCopied, setCodeCopied] = useState(false);
  /** Anonymous Leader at 5 members must register before inviting a 6th. */
  const inviteBlockedForAnonymousLeader = anonymousLeaderRequiresRegistration(
    isAnonymous && membership?.role === 'leader',
    members.length,
  );
  const promptAnonymousLeaderRegistration = useCallback(() => {
    Alert.alert(
      t('anon.registrationRequiredTitle'),
      t('anon.registrationRequiredBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('anon.registrationRequiredCta'),
          onPress: () => {
            setOverlay('account');
          },
        },
      ],
    );
  }, [t]);
  const copyCode = useCallback(async () => {
    if (!group) return;
    if (inviteBlockedForAnonymousLeader) {
      promptAnonymousLeaderRegistration();
      return;
    }
    logEvent('code_copy');
    await Clipboard.setStringAsync(group.inviteCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }, [group, inviteBlockedForAnonymousLeader, promptAnonymousLeaderRegistration]);
  const shareCode = useCallback(async () => {
    if (!group) return;
    if (inviteBlockedForAnonymousLeader) {
      promptAnonymousLeaderRegistration();
      return;
    }
    logEvent('code_share');
    await Share.share({ message: t('map.shareMsg', { code: group.inviteCode }) });
  }, [group, t, inviteBlockedForAnonymousLeader, promptAnonymousLeaderRegistration]);

  // --- Profile (nickname + emoji avatar) — avatar button only --------------
  const openProfile = useCallback(() => {
    lightTap();
    setOverlay('profile');
  }, []);

  /** RoleSelect create/join home — workflow boundary: reset stack, keep membership. */
  const goHomeCreateOrJoin = useCallback(() => {
    void runUiAction(
      'map.go_home_create_or_join',
      () => {
        lightTap();
        logEvent('settings_go_home_create_or_join');
        // Close overlay/sheet local state in the same transaction as the reset so the
        // departing Map instance does not leave modal state hanging, and so re-entry
        // cannot stack another Map on top of the old one.
        setOverlay(null);
        logEvent('navigation_reset', { target: 'RoleSelect', reason: 'go_home_create_or_join' });
        navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
      },
      { screen: 'Map' },
    );
  }, [navigation]);

  // --- Solo mode (global user status — not on member cards) -----------------
  // Returns false if the RPC failed (caller should not close the status sheet).
  const toggleSolo = useCallback(async (next: boolean): Promise<boolean> => {
    if (!groupId) return false;
    selectionTick();
    logEvent('solo_toggle', { groupId, next });
    setSoloOverride(next);
    try {
      await setSolo(groupId, next);
      // memberships is realtime-subscribed (useGroupState); its debounced
      // reload refreshes `members` and clears the override above once it
      // matches — no need to force an extra fetch here.
      return true;
    } catch (e) {
      logError('solo_toggle_failed', e, { groupId, next });
      setSoloOverride(null);
      Alert.alert(t('solo.failed'), e instanceof Error ? e.message : undefined);
      return false;
    }
  }, [groupId, t]);


  // --- Subgroups (小隊：邀請制、無隊長) ---------------------------------------
  // Drop empty leftovers so the members list never shows "X 的小隊 · 0" after
  // leave; server also deletes empty rows, this is the client-side safety net.
  const subgroups = useMemo(() => {
    const all = state?.subgroups ?? [];
    return all.filter((sg) => members.some((m) => m.subgroupId === sg.id));
  }, [state?.subgroups, members]);
  const {
    invites: pendingInvites,
    accept: acceptInvite,
    decline: declineInvite,
    refresh: refreshInvites,
  } = useSubgroupInvites();

  // Leaving the main "組隊伍" (by creating or joining a subteam) hides the
  // shared gathering-point cards. Warn once per action unless the user has
  // ticked "don't show again". Resolves true = proceed (both buttons proceed;
  // only the dismiss button silences future warnings). Never blocks if already
  // dismissed.
  const confirmLeaveMainGroup = useCallback(async (): Promise<boolean> => {
    const dismissed = await AsyncStorage.getItem(LEAVE_GROUP_WARN_KEY);
    if (dismissed === '1') return true;
    return new Promise((resolve) => {
      Alert.alert(
        t('subgroup.leaveWarnTitle'),
        t('subgroup.leaveWarnBody'),
        [
          {
            text: t('subgroup.leaveWarnDontShow'),
            onPress: () => {
              void AsyncStorage.setItem(LEAVE_GROUP_WARN_KEY, '1');
              resolve(true);
            },
          },
          { text: t('subgroup.leaveWarnConfirm'), onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });
  }, [t]);

  const handleAcceptInvite = useCallback(async (inviteId: string) => {
    if (!(await confirmLeaveMainGroup())) return;
    mediumTap();
    logEvent('invite_accept', { inviteId });
    try {
      await acceptInvite(inviteId);
      logEvent('invite_accept_ok', { inviteId });
      refresh();
    } catch (e) {
      logError('invite_accept_failed', e, { inviteId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [confirmLeaveMainGroup, acceptInvite, refresh, t]);
  const handleDeclineInvite = useCallback(async (inviteId: string) => {
    selectionTick();
    logEvent('invite_decline', { inviteId });
    try {
      await declineInvite(inviteId);
    } catch (e) {
      logError('invite_decline_failed', e, { inviteId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [declineInvite, t]);

  const handleInvite = useCallback(async (subgroupId: string, inviteeId: string) => {
    mediumTap();
    logEvent('invite_send', { subgroupId, inviteeId });
    try {
      await inviteToSubgroup(subgroupId, inviteeId);
      logEvent('invite_send_ok', { subgroupId, inviteeId });
      // Demo has no realtime channel to nudge the invite list, and simulates
      // the invitee replying with a join-request — pull it in so the pending
      // approve/decline card shows immediately.
      if (isDemoGroup(groupId)) refreshInvites();
      void refreshSentInvites(subgroupId);
      Alert.alert(t('subgroup.inviteSent'));
    } catch (e) {
      logError('invite_send_failed', e, { subgroupId, inviteeId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [t, groupId, refreshInvites, refreshSentInvites]);

  // Any member can split themselves into their own new (collab, no-leader)
  // subgroup, or merge themselves back up a level — no leader say-so needed.
  // Returns false if the user cancelled the leave warning or the RPC failed.
  const doSelfSplit = useCallback(async (): Promise<boolean> => {
    if (!groupId) return false;
    if (!(await confirmLeaveMainGroup())) return false;
    mediumTap();
    logEvent('team_create', { groupId });
    try {
      await selfSplit(
        groupId,
        t('subgroup.selfSplitName', { name: user?.name ?? t('group.travelerFallback') }),
      );
      logEvent('team_create_ok', { groupId });
      refresh();
      return true;
    } catch (e) {
      logError('team_create_failed', e, { groupId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
      return false;
    }
  }, [groupId, confirmLeaveMainGroup, user?.name, t, refresh]);
  const doSelfMerge = useCallback(async (): Promise<boolean> => {
    if (!groupId) return false;
    selectionTick();
    logEvent('team_leave', { groupId });
    try {
      await selfMerge(groupId);
      logEvent('team_leave_ok', { groupId });
      // Leave wipes subgroup-scoped UI: itinerary optimistic list, team pill scope.
      setOptimisticDestinations(null);
      setViewingScope('main');
      await refresh();
      return true;
    } catch (e) {
      logError('team_leave_failed', e, { groupId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
      return false;
    }
  }, [groupId, refresh, t]);

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
        await deleteDestination(groupId, dest.id);
      }
      await stopNavigation();
      refresh();
    } catch (e) {
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [groupId, destinations, stopNavigation, refresh, t]);

  // Report-a-problem: grab the current screen, then swap the settings overlay
  // for the feedback form. Uses the SAME `overlay` state so the two are
  // mutually exclusive — opening feedback closes settings, so the translucent
  // panels can never stack and interleave their text.
  const openFeedback = useCallback(() => {
    void runUiAction(
      'map.open_feedback',
      async (token) => {
        lightTap();
        let uri: string | null = null;
        try {
          uri = await captureScreen({ format: 'jpg', quality: 0.6, result: 'tmpfile' });
        } catch {
          uri = null;
        }
        if (!token.isCurrent()) return;
        setFeedbackShot(uri);
        setOverlay('feedback');
      },
      { screen: 'Map' },
    );
  }, []);

  /**
   * Apply reorder updates onto a destination list (open-scope slot remap).
   * Shared by route draft and navigation promote.
   */
  const applyReorderToDestinations = useCallback(
    (
      base: Destination[],
      updates: { id: string; position: number; day: number; stayAnchor?: boolean }[],
    ): Destination[] => {
      // Full open list (all trip days) — never day-gate the write slots.
      const openForSlots = openDestinationsForReorder(base);
      const openPositionSlots = openPositionSlotsFromOpenDestinations(openForSlots);
      const withSlots = mapOpenReorderToPersistedPositions(updates, openPositionSlots);
      const departureDate = optimisticDepartureDate ?? group?.departureDate;
      const newDests = base.map((d) => ({ ...d }));
      for (const update of withSlots) {
        const dest = newDests.find((d) => d.id === update.id);
        if (!dest) continue;
        dest.order = update.position;
        dest.day = update.day;
        if (update.stayAnchor !== undefined) dest.stayAnchor = update.stayAnchor;
        const original = base.find((d) => d.id === update.id);
        if (
          departureDate
          && original?.meetAt
          && (original.day || 1) !== update.day
        ) {
          dest.meetAt = alignMeetTimeToTripDay(
            new Date(original.meetAt),
            departureDate,
            update.day,
          ).toISOString();
        }
      }
      newDests.sort((a, b) => {
        if ((a.day || 1) !== (b.day || 1)) return (a.day || 1) - (b.day || 1);
        return a.order - b.order;
      });
      return newDests;
    },
    [group?.departureDate, optimisticDepartureDate],
  );

  /**
   * Route-editor reorder is local-only (Optimistic UI).
   * Network write happens in flushRouteDraft when the sheet is dismissed.
   */
  const handleReorder = useCallback(
    async (
      updates: { id: string; position: number; day: number; stayAnchor?: boolean }[],
    ): Promise<boolean> => {
      if (!groupId) return false;
      logEvent('destination_reorder_local', { count: updates.length });
      const base = optimisticDestinationsRef.current ?? rawDestinations;
      setOptimisticDestinations(applyReorderToDestinations(base, updates));
      routeDraftDirtyRef.current.destinations = true;
      return true;
    },
    [groupId, rawDestinations, applyReorderToDestinations],
  );

  /**
   * Navigation promote must hit the server immediately (not the route draft).
   */
  const persistReorderNow = useCallback(
    async (
      updates: { id: string; position: number; day: number; stayAnchor?: boolean }[],
    ): Promise<boolean> => {
      if (!groupId) return false;
      const result = await runUiAction(
        'map.destination_reorder',
        async (token) => {
          logEvent('destination_reorder', { count: updates.length });
          const base = optimisticDestinationsRef.current ?? rawDestinations;
          const newDests = applyReorderToDestinations(base, updates);
          setOptimisticDestinations(newDests);

          // Full open itinerary slots (all days) for immediate nav promote.
          const openForSlots = openDestinationsForReorder(base);
          const openPositionSlots = openPositionSlotsFromOpenDestinations(openForSlots);
          const withSlots = mapOpenReorderToPersistedPositions(updates, openPositionSlots);
          const departureDate = optimisticDepartureDate ?? group?.departureDate;
          const persistedUpdates = withSlots.map((update) => {
            const original = base.find((dest) => dest.id === update.id);
            if (!departureDate || !original?.meetAt || (original.day || 1) === update.day) {
              return { ...update };
            }
            return {
              ...update,
              meetAt: alignMeetTimeToTripDay(
                new Date(original.meetAt),
                departureDate,
                update.day,
              ).toISOString(),
            };
          });

          try {
            await reorderDestinations(groupId, persistedUpdates);
            if (!token.isCurrent()) return false;
            refresh();
            return true;
          } catch (e) {
            logError('destination_reorder_failed', e);
            if (token.isCurrent()) {
              Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
              setOptimisticDestinations(null);
              refresh();
            }
            throw e;
          }
        },
        {
          screen: 'Map',
          suppressBanner: true,
          onError: (kind) => {
            setOptimisticDestinations(null);
            void refresh();
            if (kind === 'timeout') {
              Alert.alert(t('map.setFailedTitle'), t('interaction.timeout'));
            }
          },
        },
      );
      return result === true;
    },
    [
      groupId,
      t,
      refresh,
      rawDestinations,
      applyReorderToDestinations,
      group?.departureDate,
      group?.tripDays,
      optimisticDepartureDate,
      optimisticTripDays,
    ],
  );
  reorderForNavigationRef.current = persistReorderNow;

  /**
   * Upload route-sheet draft after 完成 / swipe-dismiss.
   * UI already reflects draft; this only syncs the backend once.
   */
  const flushRouteDraft = useCallback(async () => {
    if (!groupId || routeFlushInFlightRef.current) return;
    // Snapshot so mid-flight mutations to the ref cannot scramble steps.
    const dirty = {
      destinations: routeDraftDirtyRef.current.destinations,
      daily: routeDraftDirtyRef.current.daily,
      trip: routeDraftDirtyRef.current.trip,
      deletedIds: [...routeDraftDirtyRef.current.deletedIds],
    };
    const hasWork =
      dirty.destinations
      || dirty.daily
      || dirty.trip
      || dirty.deletedIds.length > 0;
    if (!hasWork) {
      setOptimisticDestinations(null);
      setDraftDailyAccommodations(null);
      return;
    }
    routeFlushInFlightRef.current = true;
    try {
      await runUiAction(
        'map.route_draft_flush',
        async (token) => {
          logEvent('route_draft_flush', {
            destinations: dirty.destinations,
            daily: dirty.daily,
            trip: dirty.trip,
            deleted: dirty.deletedIds.length,
          });

          // 1) Trip meta first (day count / departure) so day alignment is stable.
          if (dirty.trip) {
            const days = optimisticTripDays ?? group?.tripDays;
            const date = optimisticDepartureDate ?? group?.departureDate;
            if (typeof days === 'number' && date) {
              await updateGroupTripDetails(groupId, days, date);
            }
          }
          if (!token.isCurrent()) return;

          // 2) Deletes before reorder so slots free up.
          for (const id of dirty.deletedIds) {
            if (id.startsWith('draft-')) continue;
            await deleteDestination(groupId, id);
          }
          if (!token.isCurrent()) return;

          // 3) Materialize draft-only rows; map temp → real ids.
          let draftDests = optimisticDestinationsRef.current;
          if (draftDests) {
            const idMap = new Map<string, string>();
            const nextDests: Destination[] = [];
            for (const dest of draftDests) {
              if (!dest.id.startsWith('draft-')) {
                nextDests.push(dest);
                continue;
              }
              const newId = await addDestination(
                groupId,
                {
                  title: dest.title,
                  address: dest.address,
                  coordinates: dest.coordinates,
                  day: dest.day || 1,
                  kind: dest.kind === 'accommodation' ? 'accommodation' : 'stop',
                },
                myScopeId,
              );
              if (!newId) {
                throw new Error('draft_materialize_empty');
              }
              idMap.set(dest.id, newId);
              nextDests.push({ ...dest, id: newId });
            }
            draftDests = nextDests;
            if (idMap.size > 0) {
              setOptimisticDestinations(nextDests);
              dirty.destinations = true;
              routeDraftDirtyRef.current.destinations = true;
            }
          }
          if (!token.isCurrent()) return;

          // 4) Daily stay set/clear from draft snapshot.
          if (dirty.daily && draftDailyRef.current) {
            const serverByDate = new Map(
              serverDailyAccommodations.map((d) => [d.stayDate, d]),
            );
            const draftByDate = new Map(
              draftDailyRef.current.map((d) => [d.stayDate, d]),
            );
            for (const [stayDate, serverRow] of serverByDate) {
              if (!draftByDate.has(stayDate)) {
                const day = (() => {
                  const dep = optimisticDepartureDate ?? group?.departureDate;
                  if (!dep) return undefined;
                  // Best-effort: match by stayDate via open dests day.
                  const match = (draftDests ?? rawDestinations).find((d) => {
                    const date = dateForTripDay(dep, d.day || 1);
                    return date ? localDayKey(date) === stayDate : false;
                  });
                  return match?.day;
                })();
                await clearDailyAccommodation(groupId, stayDate, day);
              }
              void serverRow;
            }
            for (const [stayDate, draftRow] of draftByDate) {
              const serverRow = serverByDate.get(stayDate);
              if (
                serverRow
                && serverRow.title === draftRow.title
                && serverRow.sourceDestinationId === draftRow.sourceDestinationId
              ) {
                continue;
              }
              const day = (() => {
                const dep = optimisticDepartureDate ?? group?.departureDate;
                if (!dep) return draftRow.sourceDestinationId ? undefined : undefined;
                const match = (draftDests ?? rawDestinations).find((d) => {
                  if (draftRow.sourceDestinationId && d.id === draftRow.sourceDestinationId) {
                    return true;
                  }
                  const date = dateForTripDay(dep, d.day || 1);
                  return date ? localDayKey(date) === stayDate : false;
                });
                return match?.day;
              })();
              // Never pass draft-* as FK-ish source id after materialize map.
              const sourceId = draftRow.sourceDestinationId;
              const resolvedSource =
                sourceId && sourceId.startsWith('draft-')
                  ? undefined
                  : sourceId ?? undefined;
              await setDailyAccommodation(groupId, stayDate, {
                title: draftRow.title,
                address: draftRow.address,
                coordinates: draftRow.coordinates,
                sourceDestinationId: resolvedSource,
                day,
              });
            }
          }
          if (!token.isCurrent()) return;

          // 5) Final open-list reorder against absolute slots (ALL open days).
          // Must not use filterActiveDestinations — day-gating drops past-day
          // rows from the write and makes Day1 appear to become Day2 after 完成.
          if (dirty.destinations && draftDests) {
            const openDraft = openDestinationsForReorder(draftDests);
            if (openDraft.some((d) => d.id.startsWith('draft-'))) {
              throw new Error('draft_ids_in_reorder');
            }
            const withSlots = buildOpenReorderPayload(openDraft);
            await reorderDestinations(groupId, withSlots);
          }
          if (!token.isCurrent()) return;

          await refresh();
          if (!token.isCurrent()) return;
          setOptimisticDestinations(null);
          setDraftDailyAccommodations(null);
          setOptimisticTripDays(null);
          setOptimisticDepartureDate(null);
          routeDraftDirtyRef.current = {
            destinations: false,
            daily: false,
            trip: false,
            deletedIds: [],
          };
        },
        {
          screen: 'Map',
          suppressBanner: true,
          // Multi-step batch (trip + deletes + adds + stays + reorder + refresh).
          timeoutMs: 60_000,
          onError: (kind) => {
            logError('route_draft_flush_failed', new Error(kind));
            // Leader is already required to open the editor — never blame role.
            if (kind === 'timeout') {
              Alert.alert(t('map.routeSaveFailedTitle'), t('interaction.timeout'));
            } else {
              Alert.alert(t('map.routeSaveFailedTitle'), t('map.routeSaveFailed'));
            }
            // Keep draft visible so the user can reopen and retry.
          },
        },
      );
    } finally {
      routeFlushInFlightRef.current = false;
    }
  }, [
    groupId,
    group?.departureDate,
    group?.tripDays,
    optimisticTripDays,
    optimisticDepartureDate,
    serverDailyAccommodations,
    rawDestinations,
    myScopeId,
    refresh,
    t,
  ]);
  const handleDelete = useCallback(
    (id: string) => {
      if (!groupId || !canEditItinerary) return;
      const target =
        (optimisticDestinationsRef.current ?? destinations).find((d) => d.id === id);
      confirmAction(
        {
          title: t('settings.deleteTitle'),
          message: t('settings.deleteMsg', { title: target?.title ?? '' }),
          confirmLabel: t('settings.deleteConfirm'),
          destructive: true,
        },
        () => {
          // Route editor: local draft only. Network on sheet flush.
          logEvent('destination_delete_local', { id });
          const base = optimisticDestinationsRef.current ?? rawDestinations;
          setOptimisticDestinations(base.filter((d) => d.id !== id));
          if (!id.startsWith('draft-')) {
            routeDraftDirtyRef.current.deletedIds = [
              ...routeDraftDirtyRef.current.deletedIds.filter((x) => x !== id),
              id,
            ];
          }
          routeDraftDirtyRef.current.destinations = true;
          setRouteSelectedIds((prev) => prev.filter((x) => x !== id));
        },
      );
    },
    [canEditItinerary, groupId, destinations, rawDestinations, t],
  );

  /** Multi-select delete from route sheet — one confirm, local draft only. */
  const handleDeleteMany = useCallback(
    (ids: string[]) => {
      if (!groupId || !canEditItinerary || ids.length === 0) return;
      confirmAction(
        {
          title: t('settings.deleteTitle'),
          message: t('route.deleteManyMsg', { count: ids.length }),
          confirmLabel: t('settings.deleteConfirm'),
          destructive: true,
        },
        () => {
          logEvent('destination_delete_many_local', { count: ids.length });
          const idSet = new Set(ids);
          const base = optimisticDestinationsRef.current ?? rawDestinations;
          setOptimisticDestinations(base.filter((d) => !idSet.has(d.id)));
          const serverIds = ids.filter((id) => !id.startsWith('draft-'));
          routeDraftDirtyRef.current.deletedIds = [
            ...routeDraftDirtyRef.current.deletedIds.filter((x) => !idSet.has(x)),
            ...serverIds,
          ];
          routeDraftDirtyRef.current.destinations = true;
          setRouteSelectedIds([]);
        },
      );
    },
    [canEditItinerary, groupId, rawDestinations, t],
  );

  const handleUpdateEmojiColor = useCallback(
    async (
      id: string,
      next: { emoji: string | null; markerColor?: string | null },
    ) => {
      if (!groupId || !canEditItinerary) {
        logError('destination_emoji_color_not_allowed', new Error('emoji_color_not_allowed'), { id });
        return;
      }
      const current = allScopedDestinations.find((destination) => destination.id === id);
      if (!current) {
        logError('destination_emoji_color_missing', new Error('destination_not_found'), { id });
        return;
      }
      const previous = destinationMarkerValues(current);
      const mutation: PendingDestinationMutation = {
        mutationId: `destination-marker-${Date.now()}-${destinationMutationSequenceRef.current++}`,
        destinationId: id,
        previous,
        optimistic: {
          emoji: next.emoji ?? null,
          markerColor: next.markerColor ?? previous.markerColor,
        },
      };
      setPendingDestinationMutations((pending) => enqueueDestinationMutation(pending, mutation));
      try {
        // Emoji only — flag color is day-scoped via day header picker.
        await updateDestinationEmojiColor(groupId, id, mutation.optimistic);
      } catch (e) {
        logError('destination_emoji_color_failed', e, { id });
        setPendingDestinationMutations((pending) =>
          removeDestinationMutation(pending, mutation.mutationId),
        );
        Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
        // Keep persisted rows visible; do not clear on pre-write failure.
        return;
      }
      // Write succeeded — patch local UI even if a subsequent refresh fails.
      // Keep the mutation overlay until the refreshed/realtime row matches it;
      // otherwise a stale response could briefly flash the old marker.
      try {
        await refresh();
      } catch (e) {
        // Soft-refresh only: server already has the new emoji.
        logError('destination_emoji_color_refresh_failed', e, { id });
      }
    },
    [allScopedDestinations, canEditItinerary, groupId, refresh, t],
  );

  const confirmLeave = useCallback(() => {
    // Red style only on the confirm button in the dialog — not on settings rows.
    confirmAction(
      {
        title: isLeader ? t('map.endGroupTitle') : t('group.leaveTitle'),
        message: isLeader ? t('map.endGroupMsg') : t('group.leaveMsg'),
        confirmLabel: isLeader ? t('map.endGroupConfirm') : t('group.leaveConfirm'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      },
      () => {
        void runUiAction(
          'map.leave_group',
          async (token) => {
            logEvent('group_leave', { groupId, isLeader });
            if (groupId) {
              await leaveGroups([groupId]).catch(() => undefined);
              if (!token.isCurrent()) return;
              await clearLiveActivities({ groupIds: [groupId] });
            } else {
              await clearLiveActivities();
            }
            if (!token.isCurrent()) return;
            leaveGroup();
            navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
          },
          { screen: 'Map' },
        );
      },
    );
  }, [t, groupId, isLeader, leaveGroup, navigation]);
  const confirmSignOut = useCallback(() => {
    confirmAction(
      {
        title: t('settings.signOutTitle'),
        message: t('settings.signOutMsg'),
        confirmLabel: t('settings.signOut'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      },
      () => {
        void runUiAction(
          'map.sign_out',
          async (token) => {
            logEvent('sign_out');
            await signOut();
            if (!token.isCurrent()) return;
            navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          },
          { screen: 'Map' },
        );
      },
    );
  }, [t, signOut, navigation]);

  const resetPrefs = useCallback(async () => {
    logEvent('reset_prefs');
    try {
      await saveOnboardingProfile({});
    } catch (e) {
      logError('reset_prefs_failed', e);
      console.warn('[settings] resetPrefs saveOnboardingProfile failed', e);
    }
    // #171: mark durable onboarding replay for create/join home — do not navigate.
    await markOnboardingReplayForHome().catch(() => undefined);
    await clearGroupFeatureTour({
      accountId: user?.id ?? null,
      existingPreferences: user?.preferences ?? null,
    }).catch(() => undefined);
    await clearAddPlaceTour({
      accountId: user?.id ?? null,
      existingPreferences: {
        ...(user?.preferences ?? {}),
        groupFeatureTourCompleted: false,
      },
    }).catch(() => undefined);
    await clearRouteReorderTour({
      accountId: user?.id ?? null,
      existingPreferences: {
        ...(user?.preferences ?? {}),
        groupFeatureTourCompleted: false,
        addPlaceTourCompleted: false,
      },
    }).catch(() => undefined);
    reevaluateRouteTour();
    setAddPlaceTourLocalDone(false);
    // Optimistically clear session prefs so reevaluate does not see stale true.
    // clearGroupFeatureTour already best-effort wrote the account; this updates
    // in-memory user.preferences. Failures are non-fatal (reset intent covers them).
    try {
      await updateProfile({
        preferences: {
          ...(user?.preferences ?? {}),
          groupFeatureTourCompleted: false,
          addPlaceTourCompleted: false,
          routeReorderTourCompleted: false,
        },
      });
    } catch {
      // Pending / reset-intent paths keep replay working without session write.
    }
    Alert.alert(t('settings.resetAllPrefs'), t('settings.resetPrefsDone'));
  }, [t, user?.id, user?.preferences, updateProfile, reevaluateRouteTour]);

  const confirmResetPrefs = useCallback(() => {
    confirmAction(
      {
        title: t('settings.resetAllPrefs'),
        message: t('settings.resetPrefsConfirm'),
        confirmLabel: t('settings.resetAllPrefs'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      },
      () => void resetPrefs(),
    );
  }, [t, resetPrefs]);

  // Optimistic trip-details flip — clear once server truth matches.
  useEffect(() => {
    if (group && group.tripDays === optimisticTripDays && group.departureDate === optimisticDepartureDate) {
      setOptimisticTripDays(null);
      setOptimisticDepartureDate(null);
    }
  }, [group?.tripDays, group?.departureDate, optimisticTripDays, optimisticDepartureDate]);

  const handleUpdateTripDetails = useCallback(async (days: number, date: string) => {
    if (!groupId) return;
    // Departure picker enforces ≥ today for new choices. Existing past
    // departures can be re-saved unchanged so in-progress trips don't jump.
    // Route sheet: local draft only — flush on dismiss.
    setOptimisticTripDays(days);
    setOptimisticDepartureDate(date);
    routeDraftDirtyRef.current.trip = true;
    // Align meet times in the local destination draft (if any).
    const base = optimisticDestinationsRef.current ?? rawDestinations;
    const aligned = base.map((destination) => {
      if (!destination.meetAt) return destination;
      const alignedMeetAt = alignMeetTimeToTripDay(
        new Date(destination.meetAt),
        date,
        destination.day || 1,
      );
      return { ...destination, meetAt: alignedMeetAt.toISOString() };
    });
    setOptimisticDestinations(aligned);
    routeDraftDirtyRef.current.destinations = true;
  }, [groupId, rawDestinations]);
  // --- Derived view models --------------------------------------------------
  // Optimistic flip for the Solo switch — server round trip + realtime
  // refetch otherwise take long enough to read as the switch not responding,
  // especially when you're the only row in the flock. Cleared once `members`
  // (server truth) confirms it, below.
  const [soloOverride, setSoloOverride] = useState<boolean | null>(null);

  const flock = useMemo(
    () =>
      members.map((m) => {
        const isSelf = m.userId === user?.id;
        // Gathering-point distance still drives the arrived/en-route STATUS.
        const d =
          m.coordinates && activePoint
            ? distanceMeters(m.coordinates, activePoint.coordinates)
            : null;
        // Displayed distance/ETA is "how far this member is from ME" — more
        // useful for keeping the flock together than distance-to-destination.
        const memberRoute = memberRoutes[m.userId];
        const displayedDistance = memberRoute?.distanceMeters ?? d;
        const displayedEta = memberRoute?.expectedTravelTimeSeconds
          ?? (d != null ? etaSecondsFor(d, travelMode) : null);
        const arrived = m.status === 'arrived';
        const isMemberLeader = m.role === 'leader';
        // Member status strings that depend on "how recent is lastUpdated" are
        // resolved in FlockRow (30s local tick) so MapScreen is not on a timer.
        const solo =
          m.userId === user?.id && soloOverride !== null ? soloOverride : !!m.solo;
        return {
          userId: m.userId,
          name: (isSelf && user?.name) || m.name || t('group.travelerFallback'),
          // BUG-08: prefer session profile for self so a just-saved avatar
          // shows in the flock before realtime memberships refresh.
          avatar: (isSelf && user?.avatar) || m.avatar,
          avatarColor: (isSelf && user?.avatarColor) || m.avatarColor || memberColor(m.userId),
          solo,
          subgroupId: m.subgroupId,
          // Prefer the member's chosen avatar background colour; fall back to the
          // deterministic per-user colour when they haven't picked one.
          color: (isSelf && user?.avatarColor) || m.avatarColor || memberColor(m.userId),
          isLeader: isMemberLeader,
          arrived,
          // Self row: prefer latest accepted local sample so refresh/push does
          // not leave「尚無位置更新」when blue-dot already has a valid fix.
          lastUpdated: resolveSelfAwareLastUpdated({
            isSelf,
            remoteLastUpdated: m.lastUpdated,
            selfSampleAtMs: isSelf ? deviceCoordsAcceptedAtMs : null,
          }),
          // Color grade: secondary by default; green only arrived; warn only solo/straggler-like.
          statusColor: solo
            ? glass.warn
            : arrived
              ? glass.ok
              : glass.textSecondary,
          // "—" for my own row (distance to myself is meaningless); everyone
          // else shows how far they are from me.
          eta: displayedEta != null ? shortEta(displayedEta) : '',
          dist: isSelf
            ? ''
            : displayedDistance != null
              ? formatDistance(displayedDistance)
              : '',
        };
      }),
    [
      members,
      activePoint,
      t,
      user?.id,
      user?.name,
      user?.avatar,
      user?.avatarColor,
      soloOverride,
      memberRoutes,
      travelMode,
      deviceCoordsAcceptedAtMs,
    ],
  );

  // Drop the override once the server value catches up, so a later toggle
  // (from this device or another) isn't masked by a stale optimistic flip.
  useEffect(() => {
    if (soloOverride === null) return;
    const mine = members.find((m) => m.userId === user?.id);
    if (mine && !!mine.solo === soloOverride) setSoloOverride(null);
  }, [members, soloOverride, user?.id]);

  // My own subgroup, if any — gates the "invite a teammate" entry on my card.
  const mySubgroupId = flock.find((f) => f.userId === user?.id)?.subgroupId;

  const mySoloActive = useMemo(() => {
    if (soloOverride !== null) return soloOverride;
    return !!members.find((m) => m.userId === user?.id)?.solo;
  }, [soloOverride, members, user?.id]);

  useEffect(() => {
    let alive = true;
    void getNotificationPreferences()
      .then((prefs) => {
        if (alive) setNotifPrefs(prefs);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user?.id]);

  const derivedMacro = derivePresenceMacro({
    solo: mySoloActive,
    locationSharing: sharingEnabled,
    notifications: notifPrefs,
  });
  const myStatusKind: PresenceMacroKind = appliedMacro ?? derivedMacro;

  const statusMenuItems = useMemo(
    () => [
      {
        id: 'follow' as const,
        title: t('solo.followTeam'),
        subtitle: t('solo.followTeamHint'),
        selected: myStatusKind === 'follow',
      },
      {
        id: 'solo' as const,
        title: t('solo.switch'),
        subtitle: t('solo.soloHint'),
        selected: myStatusKind === 'solo',
      },
      {
        id: 'stealth' as const,
        title: t('solo.stealth'),
        subtitle: t('solo.stealthHint'),
        selected: myStatusKind === 'stealth',
      },
    ],
    [myStatusKind, t],
  );

  const applyPresenceMacroKind = useCallback(
    async (next: PresenceMacroKind): Promise<boolean> => {
      if (statusApplying) return false;
      lightTap();
      const current = {
        solo: mySoloActive,
        locationSharing: sharingEnabled,
        notifications: notifPrefs,
      };
      const writes = presenceMacroWrites(next, current);
      setStatusApplying(true);
      try {
        const ok = await applyPresenceMacroWrites(writes, current, {
          setSolo: toggleSolo,
          applyNotifications: async (nextPrefs) => {
            setNotifPrefs(nextPrefs);
            await setNotificationPreferences(nextPrefs);
          },
          disableLocationSharing: () =>
            new Promise<boolean>((resolve) => {
              const copy = locationSharingConfirmCopy(false);
              confirmAction({
                title: t(copy.titleKey),
                message: t(copy.bodyKey),
                destructive: copy.destructive,
              }, () => {
                void handleSharingEnabledChange(false).then((result) => resolve(result !== false));
              }, () => resolve(false));
            }),
        });
        if (!ok) return false;
        setAppliedMacro(next);
        return true;
      } catch {
        return false;
      } finally {
        setStatusApplying(false);
      }
    },
    [
      statusApplying,
      mySoloActive,
      sharingEnabled,
      notifPrefs,
      toggleSolo,
      handleSharingEnabledChange,
      t,
    ],
  );

  const openAndroidStatusSheet = useCallback(() => {
    lightTap();
    Alert.alert(
      t('solo.statusTitle'),
      statusMenuItems.map((item) => `${item.title}\n${item.subtitle}`).join('\n\n'),
      [
        ...statusMenuItems.map((item) => ({
          text: item.selected ? `${item.title} ✓` : item.title,
          onPress: () => {
            void applyPresenceMacroKind(item.id);
          },
        })),
        { text: t('common.cancel'), style: 'cancel' as const },
      ],
    );
  }, [applyPresenceMacroKind, statusMenuItems, t]);

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

  useEffect(() => {
    void refreshSentInvites(mySubgroupId);
  }, [mySubgroupId, refreshSentInvites]);

  // BUG-22: when invitee accepts/declines, inviter's pending list must drop
  // the row without a manual refresh — poll only while invites are outstanding
  // (membership realtime already covers accept → members.length change).
  useEffect(() => {
    if (!mySubgroupId || sentInvites.length === 0) return;
    const id = setInterval(() => {
      void refreshSentInvites(mySubgroupId);
    }, 15_000);
    return () => clearInterval(id);
  }, [mySubgroupId, refreshSentInvites, sentInvites.length, members.length]);
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
        lastUpdated={f.lastUpdated}
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
  }, [user?.id, t, doSelfMerge, doSelfSplit, styles, accent, isLeader, confirmKickMember]);

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
    if (!nextStop || !fromCoords) return null;
    return formatDistance(distanceMeters(fromCoords, nextStop.coordinates));
  }, [nextStop, fromCoords]);

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

  const closeOverlay = useCallback(() => {
    // Pure UI dismiss — minimal safe handler (no IO / navigation).
    setOverlay(null);
  }, []);
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

  // Entitlement snapshot is bound to the groupId it was fetched for. A slow
  // response for team A must never apply after the user switched to team B.
  const storeEntitlementGenRef = useRef(0);
  const storeEntitlementGroupRef = useRef<string | null>(null);
  /** Last group that successfully applied a store snapshot (for fail-closed scope). */
  const storeEntitlementAppliedGroupRef = useRef<string | null>(null);
  storeEntitlementGroupRef.current = groupId ?? null;

  const refreshStoreEntitlements = useCallback(async () => {
    const requestGroupId = groupId ?? null;
    const gen = ++storeEntitlementGenRef.current;
    if (!requestGroupId || isAnonymous) {
      if (gen === storeEntitlementGenRef.current
        && storeEntitlementGroupRef.current === requestGroupId) {
        setLiveActivityEffective(false);
        setExtraPointCredits(0);
        storeEntitlementAppliedGroupRef.current = null;
      }
      return;
    }
    // Fail-closed only when switching teams so a same-group refresh (e.g. isPro
    // flip) does not flash Tools back to the locked Live Activity row.
    if (storeEntitlementAppliedGroupRef.current !== requestGroupId) {
      setLiveActivityEffective(false);
      setExtraPointCredits(0);
    }
    try {
      const snap = await getStoreSnapshot(requestGroupId);
      if (gen !== storeEntitlementGenRef.current) return;
      if (storeEntitlementGroupRef.current !== requestGroupId) return;
      // Server bit is authoritative; Premium session is a client safety net when
      // snapshot lags after IAP/promo (tools must not stay locked while isPro).
      setLiveActivityEffective(!!snap.liveActivityEffective || isPro);
      setExtraPointCredits(Math.max(0, snap.extraPointCredits ?? 0));
      storeEntitlementAppliedGroupRef.current = requestGroupId;
    } catch {
      if (gen !== storeEntitlementGenRef.current) return;
      if (storeEntitlementGroupRef.current !== requestGroupId) return;
      // Keep Premium-granted LA unlocked offline when session already knows isPro.
      setLiveActivityEffective(isPro);
      if (!isPro) setExtraPointCredits(0);
    }
  }, [groupId, isAnonymous, isPro]);

  useEffect(() => {
    void refreshStoreEntitlements();
  }, [groupId, refreshStoreEntitlements, isPro]);

  const openPaywallForLiveActivity = useCallback(() => {
    lightTap();
    openPaywall();
  }, [openPaywall]);

  // ─── 成員：位置、狀態、個別操作、小隊（無「成員」標題） ────────────────
  const membersPaneBody = useMemo(() => (
    <>
      {/* My status + refresh on one row (stage 1+ body) */}
      <View style={styles.myStatusBar}>
        <View style={styles.myStatusCluster}>
          {Platform.OS === 'ios' ? (
            <NativeMenuHost
              items={statusMenuItems}
              onSelect={(id) => {
                if (id === 'follow' || id === 'solo' || id === 'stealth') {
                  void applyPresenceMacroKind(id);
                }
              }}
              accessibilityLabel={t('solo.statusTitle')}
              style={styles.myStatusTrigger}
            >
              <View style={styles.myStatusTriggerInner} pointerEvents="none">
                <Ionicons
                  name={statusIconForKind(myStatusKind)}
                  size={20}
                  color={glass.textSecondary}
                />
                <Text style={styles.myStatusName} numberOfLines={1}>
                  {myStatusKind === 'stealth'
                    ? t('solo.stealth')
                    : myStatusKind === 'solo'
                      ? t('solo.switch')
                      : t('solo.followTeam')}
                </Text>
              </View>
            </NativeMenuHost>
          ) : (
            <Pressable
              style={styles.myStatusTrigger}
              onPress={openAndroidStatusSheet}
              accessibilityRole="button"
              accessibilityLabel={t('solo.statusTitle')}
            >
              <View style={styles.myStatusTriggerInner} pointerEvents="none">
                <Ionicons
                  name={statusIconForKind(myStatusKind)}
                  size={20}
                  color={glass.textSecondary}
                />
                <Text style={styles.myStatusName} numberOfLines={1}>
                  {myStatusKind === 'stealth'
                    ? t('solo.stealth')
                    : myStatusKind === 'solo'
                      ? t('solo.switch')
                      : t('solo.followTeam')}
                </Text>
              </View>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.locationSharingButton,
              pressed && styles.locationSharingButtonPressed,
            ]}
            disabled={sharingApplying}
            accessibilityRole="button"
            accessibilityLabel={t('settings.locationSharing')}
            accessibilityHint={t('settings.locationSharingHint')}
            accessibilityState={{ disabled: sharingApplying, busy: sharingApplying }}
            testID="members-location-sharing"
            onPress={() => {
              mediumTap();
              handleSharingEnabledChangeAnimated();
            }}
            >
            {sharingApplying ? (
              <ActivityIndicator size="small" color={sharingEnabled ? accent : glass.danger} />
            ) : (
              <Ionicons
                name={sharingEnabled ? 'eye-outline' : 'eye-off-outline'}
                size={22}
                color={sharingEnabled ? accent : glass.danger}
              />
            )}
          </Pressable>
        </View>
        <RefreshLocationsButton
          refreshing={refreshingLocations}
          cooldownUntil={refreshCooldownUntil}
          accent={accent}
          styles={styles}
          t={t}
          onPress={refreshAllLocations}
        />
      </View>
      {subgroups.length === 0 && (
        <View style={styles.list}>
          {topFlockMemo.map((f, i) => renderFlockRow(f, i === topFlockMemo.length - 1, i))}
        </View>
      )}
      <SubgroupSection
        subgroups={subgroups}
        flock={flock}
        mySubgroupId={mySubgroupId}
        sentInvites={sentInvites}
        accent={accent}
        setInviteSheetOpen={setInviteSheetOpen}
        renderFlockRow={renderFlockRow}
        styles={styles}
      />
      {pendingInvites.length > 0 && (
        <View style={styles.list}>
          {pendingInvites.map((inv, i) => {
            const isRequest = inv.kind === 'request';
            const inviteStacked = fontBucket === 'large' || fontBucket === 'xl';
            return (
              <View
                key={`inv-${inv.id}-${i}`}
                style={[
                  styles.flockRow,
                  i === pendingInvites.length - 1 && styles.flockRowLast,
                  inviteStacked && styles.inviteRowStacked,
                ]}
              >
                <Text style={[styles.flockName, inviteStacked && styles.invitePromptFull]}>
                  {t(isRequest ? 'subgroup.requestPrompt' : 'subgroup.invitePrompt', {
                    name: inv.inviterName,
                    team: inv.subgroupName,
                  })}
                </Text>
                <View style={[styles.splitActions, inviteStacked && styles.inviteActionsRow]}>
                  <Pressable
                    style={[styles.chip, { backgroundColor: accentMix(accent, 24), borderColor: accentMix(accent, 50) }]}
                    onPress={() => void handleAcceptInvite(inv.id)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.chipText}>
                      {t(isRequest ? 'subgroup.approve' : 'subgroup.accept')}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.chipGhost}
                    onPress={() => void handleDeclineInvite(inv.id)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.chipText}>{t('subgroup.decline')}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.listGroup}>
        <Pressable
          style={[styles.listRow, styles.listRowLast]}
          onPress={() => {
            lightTap();
            setOverlay('invite');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.listRowTitle}>{t('map.inviteMembers')}</Text>
          <Ionicons name="chevron-forward" size={16} color={glass.textTertiary} />
        </Pressable>
      </View>

      {/* 精準定位 — 成員欄最下方 */}
      <View style={[styles.accuracyRow, styles.accuracyRowLast]}>
        <View style={styles.accuracyCopy}>
          <Text style={styles.accuracyLabel}>
            {t('settings.preciseLocation')}
          </Text>
          <Text style={styles.accuracyBattery}>{t('settings.preciseLocationHint')}</Text>
        </View>
        <SystemToggle
          value={highAccuracy}
          onValueChange={setHighAccuracy}
          accessibilityLabel={t('settings.preciseLocation')}
        />
      </View>
    </>
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
    <>
      {/* #173: leader pending gather requests — FIFO horizontal cards at Route top. */}
      {isLeader && sortedGatherRequests.length > 0 ? (
        <View testID="route-gather-request-inbox" style={{ marginBottom: 12 }}>
          <Text style={[styles.sheetHeading, styles.sheetHeadingFirst]}>
            {t('gatherRequest.pending')}
          </Text>
          <ScrollView
            ref={gatherRequestPagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            style={{ marginHorizontal: -4 }}
            onMomentumScrollEnd={(e) => {
              const page = Math.round(
                e.nativeEvent.contentOffset.x / Math.max(1, gatherRequestPageW),
              );
              const id = sortedGatherRequestIds[page];
              if (id) setSelectedGatherRequestId(id);
            }}
            onLayout={() => {
              const page = gatherRequestPageIndex(
                sortedGatherRequestIds,
                selectedGatherRequestId,
              );
              gatherRequestPagerRef.current?.scrollTo({
                x: page * gatherRequestPageW,
                animated: false,
              });
            }}
          >
            {sortedGatherRequests.map((request) => (
              <View
                key={request.id}
                style={{
                  width: gatherRequestPageW,
                  paddingHorizontal: 4,
                }}
              >
                <View style={[styles.tripSummaryCard, { marginBottom: 0 }]}>
                  <Text style={styles.tripCardKicker} numberOfLines={1}>
                    {members.find((member) => member.userId === request.requesterId)?.name
                      ?? t('map.memberFallback')}
                  </Text>
                  <Text style={styles.tripCardTitle} numberOfLines={2}>
                    {request.items.map((item) => item.title).join('、')}
                  </Text>
                  <Text style={styles.tripCardMeta} numberOfLines={1}>
                    {t('gatherRequest.target', {
                      team: request.subgroupId
                        ? subgroups.find((item) => item.id === request.subgroupId)?.name
                          ?? t('gatherRequest.unknownTeam')
                        : t('gatherRequest.mainTeam'),
                    })}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <Pressable
                      style={[
                        styles.chip,
                        { flex: 1, minHeight: 44 },
                        resolvingGatherRequestId === request.id ? { opacity: 0.5 } : null,
                      ]}
                      onPress={() => void handleGatherPointRequest(request.id, false)}
                      disabled={!!resolvingGatherRequestId}
                      accessibilityRole="button"
                      accessibilityLabel={t('gatherRequest.reject')}
                      testID={`gather-request-reject-${request.id}`}
                    >
                      <Text style={styles.chipText}>{t('gatherRequest.reject')}</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.chip,
                        {
                          flex: 1,
                          minHeight: 44,
                          backgroundColor: accentMix(accent, 24),
                        },
                        resolvingGatherRequestId === request.id ? { opacity: 0.5 } : null,
                      ]}
                      onPress={() => void handleGatherPointRequest(request.id, true)}
                      disabled={!!resolvingGatherRequestId}
                      accessibilityRole="button"
                      accessibilityLabel={t('gatherRequest.approve')}
                      testID={`gather-request-approve-${request.id}`}
                    >
                      <Text style={styles.chipText}>{t('gatherRequest.approve')}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
          {sortedGatherRequests.length > 1 ? (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
                marginTop: 8,
              }}
              accessibilityRole="adjustable"
            >
              {sortedGatherRequestIds.map((id) => (
                <View
                  key={id}
                  style={{
                    width: id === selectedGatherRequestId ? 14 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor:
                      id === selectedGatherRequestId ? accent : glass.textTertiary,
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <Text
        style={[
          styles.sheetHeading,
          !(isLeader && sortedGatherRequests.length > 0) && styles.sheetHeadingFirst,
        ]}
      >
        {t('map.gatheringPoints')}
      </Text>
      {extraPointCredits > 0 ? (
        <Text
          style={styles.extraCreditsHint}
          testID="route-extra-point-credits"
          accessibilityRole="text"
          accessibilityLabel={t('store.extraCreditsRemaining', { count: extraPointCredits })}
        >
          {t('store.extraCreditsRemaining', { count: extraPointCredits })}
        </Text>
      ) : null}
      {/* 下一站 — 唯一完整卡片；底部只顯示距離 */}
      {nextStopTitle ? (
        <View style={styles.tripSummaryCard}>
          <Text style={styles.tripCardKicker}>{t('map.nextTag')}</Text>
          <Text style={styles.tripCardTitle} numberOfLines={2}>{nextStopTitle}</Text>
          {nextStopDistLabel ? (
            <Text style={styles.tripCardMeta}>{nextStopDistLabel}</Text>
          ) : null}
        </View>
      ) : null}
      {canEditItinerary ? (
        <View style={styles.reorderActionCard} testID="map-reorder-action-card">
          <AmicroButton
            icon="pencil-outline"
            activeIcon="checkmark"
            active={editButtonActive}
            activeOnPress
            resetAfterComplete={false}
            color={accent}
            activeColor={accent}
            size={48}
            label={t('map.stopsReorder', { count: openForRouteEditor.length })}
            labelColor="#fff"
            accessibilityLabel={t('map.stopsReorder', { count: openForRouteEditor.length })}
            testID="map-edit-itinerary"
            style={styles.reorderActionPressable}
            onPress={() => {
              lightTap();
              setEditButtonActive(true);
            }}
            onAnimationComplete={() => setOverlay('route')}
          />
        </View>
      ) : (
        <DestinationReorderList
          groupId={groupId ?? undefined}
          destinations={openForRouteEditor}
          canReorder={false}
          tripDays={optimisticTripDays ?? group?.tripDays}
          departureDate={optimisticDepartureDate ?? group?.departureDate}
          colors={dark}
          emptyLabel={t('settings.noDestinations')}
          dailyByDate={Object.fromEntries(
            dailyAccommodations.map((d) => [
              d.stayDate,
              {
                id: d.id,
                stayDate: d.stayDate,
                title: d.title,
                coordinates: d.coordinates,
              },
            ]),
          )}
        />
      )}
      {/* 導航入口 = 普通 List Row，無圖示色塊 */}
      <View style={styles.listGroup}>
        {isLeader && destinations.length > 0 ? (
          <Pressable
            style={styles.listRow}
            onPress={() => { lightTap(); setOverlay('arrivalManage'); }}
            accessibilityRole="button"
            accessibilityLabel={t('arrival.manage')}
          >
            <Text style={styles.listRowTitle}>{t('arrival.manage')}</Text>
            <Ionicons name="chevron-forward" size={16} color={glass.textTertiary} />
          </Pressable>
        ) : null}
        <Pressable
          style={styles.listRow}
          onPress={() => { lightTap(); setOverlay('ops'); }}
          accessibilityRole="button"
          accessibilityLabel={t('map.opsCenter')}
          testID="map-open-ops"
        >
          <Text style={styles.listRowTitle}>{t('map.opsCenter')}</Text>
          {opsOpenCount > 0 ? (
            <Text style={[styles.listRowTrailing, { color: glass.warn }]}>
              {t('map.opsOpenCount', { count: opsOpenCount })}
            </Text>
          ) : null}
          <Ionicons name="chevron-forward" size={16} color={glass.textTertiary} />
        </Pressable>
        <Pressable
          style={[styles.listRow, styles.listRowLast]}
          onPress={() => { lightTap(); openHistoryOverlay(); }}
          accessibilityRole="button"
        >
          <Text style={styles.listRowTitle}>{t('history.title')}</Text>
          <Ionicons name="chevron-forward" size={16} color={glass.textTertiary} />
        </Pressable>
      </View>
    </>
  ), [
    t, styles, nextStopTitle, nextStopDistLabel, destinations.length,
    openHistoryOverlay, isLeader, canEditItinerary, openForRouteEditor,
    groupId, optimisticTripDays, optimisticDepartureDate, group, dailyAccommodations,
    opsOpenCount, editButtonActive, extraPointCredits, accent,
    sortedGatherRequests, sortedGatherRequestIds, selectedGatherRequestId,
    gatherRequestPageW, resolvingGatherRequestId, members, subgroups,
    handleGatherPointRequest,
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
    <>
      <View style={styles.passiveEnterBlock}>
      <Pressable
        style={({ pressed }) => [
          styles.passiveEnterButton,
          pressed && styles.passiveEnterButtonPressed,
        ]}
        onPress={() => {
          mediumTap();
          setPassiveCompanionMode(true);
        }}
        accessibilityLabel={t('passive.enter')}
        accessibilityRole="button"
        testID="tools-enter-passive"
      >
        <View style={styles.passiveEnterContent} pointerEvents="none">
          <Ionicons name="leaf-outline" size={28} color={glass.textPrimary} />
          <Text style={styles.passiveEnterLabel}>{t('passive.enter')}</Text>
        </View>
      </Pressable>
      </View>

      <View style={styles.accuracyRow} testID="tools-live-activity-row">
        <View style={styles.accuracyCopy}>
          <Text style={styles.accuracyLabel}>{t('settings.liveActivity')}</Text>
          <Text style={styles.accuracySubhint}>{t('settings.liveActivityHint')}</Text>
        </View>
        <SystemToggle
          value={liveActivityUnlocked && liveActivityEnabled}
          onValueChange={handleToolsLiveActivityChange}
          accessibilityLabel={t('settings.liveActivity')}
          testID="tools-live-activity-toggle"
        />
      </View>

      <Text style={styles.sheetHeading}>{t('arrival.radiusSection')}</Text>
      <View style={styles.accuracyRow}>
        <View style={styles.accuracyCopy}>
          <Text style={styles.accuracyLabel}>
            {t('arrival.radiusValue', { meters: String(arrivalRadiusM) })}
          </Text>
          <Text style={styles.accuracySubhint}>{t('arrival.radiusHint')}</Text>
        </View>
      </View>
      <View style={styles.marqueeSpeedBlock}>
        <PrefSlider
          value={arrivalRadiusM}
          values={ARRIVAL_RADIUS_OPTIONS}
          onChange={setArrivalRadiusM}
          accent={accent}
          accessibilityLabel={t('arrival.radiusSection')}
        />
      </View>

      <Text style={styles.sheetHeading}>{t('map.cmdTitle')}</Text>
      {groupId ? (
        <QuickCommandsCard
          groupId={groupId}
          isLeader={!!isLeader}
          colors={dark}
          onConfigureCustom={openCustomQuickCommand}
          variant="preview"
          onOpenAll={() => {
            lightTap();
            setOverlay('commands');
          }}
        />
      ) : null}
    </>
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
            <ActivityIndicator color={accent} size="large" />
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
        <ActivityIndicator color={accent} size="large" />
        <Text style={styles.loadingText}>{t('map.loading')}</Text>
      </View>
    );
  }

  // OTA-04: offline cold start with no prior snapshot — clear empty outcome.
  // OTA-07: passive still mounts switch-back so users are never trapped.
  if (!state && emptyLocalSnapshot) {
    if (inPassiveMode) {
      return (
        <View style={styles.flex}>
          <View style={styles.loading}>
            <Text style={styles.loadingText}>{t('coreData.emptySnapshot')}</Text>
            <Pressable
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
        <Text style={styles.loadingText}>{t('coreData.emptySnapshot')}</Text>
        <Pressable
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
          ref={mapRef}
          members={members}
          showsUserLocation={sharingEnabled && members.length > 0}
          gathering={activePoint}
          destinations={destinations}
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
      {showDenseChrome && !confirmCardReady && !atFull && (
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
      {showDenseChrome && !confirmCardReady && !atFull && (
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
          picking a search result. Add (accent) / Cancel (red) side by side. */}
      {confirmCardReady && pendingPlace && (() => {
        // Walking time + distance from me to the picked place — the follower-nav
        // card layout (arrow · N min · distance) applied to the add-confirm step.
        const pDist = fromCoords
          ? distanceMeters(fromCoords, pendingPlace.coordinates)
          : null;
        const pMin = pDist != null ? shortEta(walkingEtaSeconds(pDist)) : null;
        const confirmBottom = keyboardAvoidBottomOffset({
          baseBottom: insets.bottom + 24,
          keyboardHeight: confirmKeyboardHeight,
        });
        return (
          // Sits above the hidden sheet; lifts with keyboard (12pt gap).
          <Animated.View
            style={[styles.confirmCard, { bottom: confirmBottom }, confirmCardStyle]}
            pointerEvents="box-none"
          >
            <liquidGlass.GlassView
              glassStyle="regular"
              tintColor={Platform.OS === 'android' ? glass.cardActive : undefined}
              style={styles.confirmCardInner}
            >
              <View style={styles.confirmTopRow}>
                <View style={styles.confirmTextCol}>
                  <Text style={styles.confirmKicker} numberOfLines={1}>
                    {t('confirmGather.going', { name: '' })}
                  </Text>
                  {/* Inline rename — single draft; no separate Modal. */}
                  <TextInput
                    value={pendingPlaceTitle}
                    onChangeText={setPendingPlaceTitle}
                    style={styles.confirmTitleInput}
                    placeholder={pendingPlace.name || t('map.droppedPin')}
                    placeholderTextColor={glass.textTertiary}
                    maxLength={120}
                    returnKeyType="done"
                    blurOnSubmit
                    onSubmitEditing={() => Keyboard.dismiss()}
                    accessibilityLabel={t('map.renameTitle')}
                    accessibilityHint={t('map.droppedPinHint')}
                    testID="confirm-place-name"
                  />
                  <Text style={styles.confirmNameHint} numberOfLines={1}>
                    {t('map.droppedPinHint')}
                  </Text>
                  <View style={styles.confirmEtaRow}>
                    {pMin ? (
                      <Text style={[styles.confirmMin, { color: accent }]} numberOfLines={1}>
                        {pMin}
                      </Text>
                    ) : null}
                    {pDist != null ? (
                      <Text style={styles.confirmDist} numberOfLines={1}>
                        · {formatDistance(pDist)}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.confirmControlRow}>
                  <View
                    ref={(node) => setTourTargetRef('addPlaceFavoriteStar', node as View | null)}
                    style={styles.confirmArrow}
                  >
                    <Pressable
                      style={({ pressed }) => [
                        styles.confirmControl,
                        pressed && styles.confirmControlPressed,
                      ]}
                      testID="add-place-favorite-star"
                      onPress={() => {
                        // Tour is explanation-only: block real action while active.
                        if (addPlaceTourStep != null) return;
                        void togglePendingFavorite();
                      }}
                      disabled={favoriteBusy || !user?.id}
                      accessibilityRole="button"
                      accessibilityLabel={
                        pendingIsFavorite
                          ? t('stay.unfavoriteA11y')
                          : t('stay.favoriteA11y')
                      }
                      accessibilityState={{
                        disabled: favoriteBusy || !user?.id,
                        selected: pendingIsFavorite,
                        busy: favoriteBusy,
                      }}
                    >
                      {favoriteBusy ? (
                        <ActivityIndicator size="small" color={accent} />
                      ) : (
                        <Ionicons
                          name={pendingIsFavorite ? 'star' : 'star-outline'}
                          size={28}
                          color={accent}
                        />
                      )}
                    </Pressable>
                  </View>
                  <View
                    ref={(node) => setTourTargetRef('addPlaceCenter', node as View | null)}
                    style={styles.confirmArrow}
                  >
                    <Pressable
                      style={({ pressed }) => [
                        styles.confirmControl,
                        pressed && styles.confirmControlPressed,
                      ]}
                      testID="add-place-center-btn"
                      onPress={() => {
                        if (addPlaceTourStep != null) return;
                        if (obliqueLocate) {
                          mapRef.current?.focusOblique(pendingPlace.coordinates);
                        } else {
                          mapRef.current?.centerOn(pendingPlace.coordinates);
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t('stay.centerPlaceA11y')}
                    >
                      <Ionicons name="navigate" size={28} color={accent} />
                    </Pressable>
                  </View>
                </View>
              </View>
              <View style={styles.confirmBtnRow}>
                <Pressable
                  style={({ pressed }) => [styles.confirmCancel, pressed && styles.confirmControlPressed]}
                  accessibilityLabel={t('common.cancel')}
                  accessibilityRole="button"
                  onPress={() => {
                    selectionTick();
                    dismissConfirmCard();
                  }}
                >
                  <Text style={styles.confirmCancelText}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.confirmAdd, pressed && styles.confirmControlPressed]}
                  accessibilityLabel={t('confirmGather.add')}
                  accessibilityRole="button"
                  onPress={() => {
                    const place = {
                      ...pendingPlace,
                      name: pendingPlaceTitle.trim() || pendingPlace.name,
                    };
                    // Keep confirm card until success so failures do not wipe UI state.
                    void runUiAction(
                      'map.confirm_add_destination',
                      async (token) => {
                        const ok = await handlePickDestination(place);
                        if (ok && token.isCurrent()) dismissConfirmCard();
                      },
                      { screen: 'Map' },
                    );
                  }}
                >
                  <Text style={styles.confirmAddText}>{t('confirmGather.add')}</Text>
                </Pressable>
              </View>
            </liquidGlass.GlassView>
          </Animated.View>
        );
      })()}

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
          // Block advance until the next step has a non-zero measured rect.
          const nextStep = ADD_PLACE_TOUR_STEPS[next];
          if (!nextStep) return;
          const generation = ++addPlaceTourGenerationRef.current;
          setAddPlaceTourTransitioning(true);
          void (async () => {
            const rect = await measureTargetWithRetry({
              measure: measureTourTarget,
              target: nextStep.target,
            });
            if (generation !== addPlaceTourGenerationRef.current) return;
            if (!isMeasuredTourRect(rect)) {
              setAddPlaceTourTransitioning(false);
              return;
            }
            setAddPlaceTourTargetRect(rect);
            setAddPlaceTourStep(next);
          })();
        }}
        reduceMotion={tourReduceMotion}
      />

      {/* Gathering-point carousel — above locate/group capsules; sheet wrapper
          zIndex is higher so the sheet covers cards on overlap. */}
      {showDenseChrome && destinations.length > 0 && !atFull && (
        <Animated.View
          // a11y-layout:carouselCapsuleClearance
          style={[
            styles.carouselWrap,
            { top: insets.top + 8, maxHeight: carouselMaxHeight },
          ]}
          pointerEvents={atFull ? 'none' : 'box-none'}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0) setCarouselHeight(h);
          }}
        >
          <ScrollView
            ref={carouselRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScrollBeginDrag={handleScrollBeginDrag}
            onMomentumScrollEnd={handleMomentumEnd}
            scrollEventThrottle={16}
          >
            {destinations.map((dest, index) => {
              const active = index === selectedIndex;
              const routeForDestination = activePoint?.id === dest.id ? selfRoute : null;
              // Active nav target: shared personal progress (local GPS, no backend wait).
              // Other cards: one-shot straight/route distance from last known fix.
              const d = (navTarget?.id === dest.id && personalDistanceM != null)
                ? personalDistanceM
                : routeForDestination?.distanceMeters
                  ?? (fromCoords ? distanceMeters(fromCoords, dest.coordinates) : null);
              // Shared navigation is distinct from any member-only route preview.
              const { flockNavigatingThis } = deriveCardNavFlags({
                destId: dest.id,
                isLeader,
                sharedTargetId,
                pendingLeaderTargetId,
                journeyBusy,
              });
              // Live countdown UI is MeetCountdown (own 1s timer). a11y uses
              // a one-shot label on each parent render — no MapScreen clock.
              const meetLabel = dest.meetAt
                ? (() => {
                    const mins = minutesUntil(dest.meetAt as string, new Date());
                    if (mins >= 0) {
                      return t('meetTime.countdown', { minutes: mins });
                    }
                    const clock = new Date(dest.meetAt as string).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    });
                    // a11y: "{time} 集合"
                    return t('map.meetAtClock', { time: clock });
                  })()
                : null;
              // Team arrival toward THIS stop — scoped to destination subgroup.
              const cardArrival = deriveScopedArrivalCounts({
                members,
                destinationSubgroupId: dest.subgroupId,
                arrivedUserIds: destinationArrivals
                  .filter((arrival) => arrival.destinationId === dest.id)
                  .map((arrival) => arrival.userId),
              });
              const arrivedHere = cardArrival.arrivedCount;
              const totalMembers = cardArrival.totalCount;
              const modeIconName =
                travelMode === 'walk'
                  ? 'walk-outline'
                  : travelMode === 'drive'
                    ? 'car-outline'
                    : 'bus-outline';
              // Route ETA/distance — always visible; expand only scales layout.
              const etaSeconds = (navTarget?.id === dest.id && personalEtaSeconds != null)
                ? personalEtaSeconds
                : routeForDestination
                  ? routeForDestination.expectedTravelTimeSeconds
                  : d != null
                    ? etaSecondsFor(d, travelMode)
                    : null;
              const etaLabel = etaSeconds != null ? shortEta(etaSeconds) : '—';
              // Retain the last useful distance/ETA without a generic stale
              // warning; freshness still drives internal navigation safety.
              const distLabel = d != null ? formatDistance(d) : '';
              const distParts = splitDistanceParts(d);
              const etaParts = splitEtaParts(etaSeconds);
              const cardExpanded = isCardExpanded(dest.id);
              // Progressive density (single row always):
              // - compact: narrow phone OR large Dynamic Type → smaller squares
              // - tight: xl OR (narrow + large) → nav icon-only, smaller countdown
              // Never multi-row. Not tied to sheet stage.
              // a11y-layout:commandRowCompact
              const chromeCompact =
                narrowScreen || fontBucket === 'large' || fontBucket === 'xl';
              const chromeTight = fontBucket === 'xl' || (narrowScreen && fontBucket === 'large');
              // Use active itinerary (carousel list), not raw history-inclusive
              // scope — past-day open rows must not hide the arrive control.
              const canMarkArrival = canMarkDestinationArrival({
                destId: dest.id,
                destOrder: dest.order,
                destSubgroupId: dest.subgroupId,
                scopedDestinations: destinations,
                myArrivedDestinationIds: myCompletedDestinationIds,
              });
              // Product: only show 「已抵達」while this card's team nav is active.
              // Pre-start: Start occupies the arrived slot (3 controls).
              // Post-start: Arrived splits out. Post-end: Start swallows it again.
              const showArrivalControl =
                Boolean(user?.id)
                && canMarkArrival
                && !dest.closedAt
                && flockNavigatingThis;
              const arrivalJustSplit = arrivalControlJustSplit(
                dest.id,
                showArrivalControl,
                arrivalSplitSeenRef.current,
              );
              // #176: icon-only Start only when Arrived is also present under tight
              // density. When Arrived is absent, Start fills that slot (not square).
              const navIconOnly = chromeTight && showArrivalControl;
              const personallyArrived = myCompletedDestinationIds.has(dest.id) || (
                autoArrivedDestId === dest.id ||
                (navTarget?.id === dest.id && (
                  navigationSessionState.memberState?.localStatus === 'arrived' ||
                  (straightToTargetM != null && hasArrived(straightToTargetM, localArrivalRadiusM))
                ))
              );
              const navCmd = resolveNavCommand({
                isLeader,
                personallyArrived,
                flockNavigatingThis,
                isNextTeamPending: true,
                teamStartBlocked: false,
              });
              const navLabel = navCommandDisplayLabel(navCmd.kind, t);
              const startAccessibilityHint = isLeader
                ? navCmd.kind === 'leader_stop'
                  ? t('nav.a11yEndHint')
                  : navCmd.kind === 'leader_mark_complete'
                    ? t('nav.a11yCompleteHint')
                    : t('nav.a11yStartHint')
                : undefined;
              const leaderActionDisabled = false;
              const commandDisabled = !isLeader && (
                journeyBusy
                || navCmd.disabled
                || Boolean(requestingStartDestId)
              );
              const exitPhase = arrivalExitRecords.get(dest.id)?.phase ?? null;
              return (
                <View
                  key={`carousel-dest-${dest.id}`}
                  style={{ width: windowWidth, paddingHorizontal: narrowScreen ? 10 : 14 }}
                >
                  <View
                    ref={active ? (n) => setTourTargetRef('gatherCard', n) : undefined}
                    collapsable={false}
                  >
                  <ArrivalCardExitShell exiting={exitPhase === 'exit'}>
                  <SwiftUIGlassSurface
                    shape="roundedRectangle"
                    cornerRadius={gatherCardRadius}
                    fallbackTintColor={Platform.OS === 'android'
                      ? active ? glass.cardActive : glass.card
                      : undefined}
                    style={[
                      styles.card,
                      // Active state uses fill only — no theme-color rim
                      // (Android hairline + accent reads as a harsh outline).
                      active ? styles.cardActiveBorder : null,
                    ]}
                  >
                    {/* Celebrate flash only (1.6s): full-card dim + center check.
                        Must NOT key off personallyArrived or dim stays forever.
                        Siblings of padded content so absolute fill covers padding
                        + expanded command row (expanded and collapsed). */}
                    {arrivalCelebrateDestId === dest.id ? (
                      <View pointerEvents="none" style={styles.arrivalDimOverlay} />
                    ) : null}
                    {arrivalCelebrateDestId === dest.id ? (
                      <Animated.View
                        pointerEvents="none"
                        entering={FadeIn.duration(220)}
                        exiting={FadeOut.duration(220)}
                        style={styles.arrivalCenterCheckLayer}
                      >
                        <Animated.View
                          // No springify — ease-in only, no bounce/overshoot.
                          entering={ZoomIn.duration(240)}
                          exiting={ZoomOut.duration(200)}
                          style={[
                            styles.arrivalCenterCheckBox,
                            cardExpanded
                              ? styles.arrivalCenterCheckBoxExpanded
                              : styles.arrivalCenterCheckBoxCollapsed,
                          ]}
                        >
                          <Ionicons
                            name="checkmark"
                            size={cardExpanded ? 32 : 20}
                            color="#fff"
                          />
                        </Animated.View>
                      </Animated.View>
                    ) : null}
                    <View style={styles.cardInner}>
                    <GatheringCardPressable
                      onToggle={() => toggleGatheringCard(dest.id)}
                      accessibilityLabel={dest.title}
                      accessibilityHint={
                        cardExpanded ? t('gather.cardCollapseHint') : t('gather.cardExpandHint')
                      }
                    >
                    {/* Layout (expanded):
                        kicker · dots
                        title full-width
                        day line ····· people N/M
                        小隊行程 badge (subgroup only)
                        📍 dist | 🚗 eta | map
                        [導航] [移動] [抵達?] [交通] [集合倒數]
                       Collapsed: title marquee + compact ETA·dist only. */}
                    <View style={styles.cardHead}>
                      <View style={styles.grow}>
                        <View style={styles.cardKickerRow}>
                          <Text
                            style={[styles.cardKicker, { color: accent }]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {(() => {
                              // Counter is day-scoped: "stop N of M" among that day's stops only.
                              const dayNum = dest.day || 1;
                              let dayIndex = 0;
                              let dayTotal = 0;
                              for (const d of destinations) {
                                if ((d.day || 1) !== dayNum) continue;
                                dayTotal += 1;
                                if (d.id === dest.id) dayIndex = dayTotal;
                              }
                              return t('map.destinationCounter', {
                                index: dayIndex || 1,
                                total: dayTotal || 1,
                              });
                            })()}
                          </Text>
                          {destinations.length > 1 && (
                            <CarouselDots
                              total={destinations.length}
                              active={selectedIndex}
                              maxVisible={DOTS_MAX_VISIBLE}
                              destinationIds={destinationIds}
                              styles={styles}
                              reduceMotion={tourReduceMotion}
                            />
                          )}
                        </View>
                        {/* Collapsed / expanded swap in-tree — one shot, no Zoom / layout morph. */}
                        {cardExpanded ? (
                          <View>
                            <Text
                              style={[styles.cardTitle, styles.cardTitleExpanded]}
                              numberOfLines={3}
                              ellipsizeMode="tail"
                            >
                              {dest.title}
                            </Text>
                            <View style={styles.cardSubRow}>
                              <Text style={styles.cardDayLine} numberOfLines={1}>
                                {formatTripDayLine(
                                  dest.day || 1,
                                  optimisticDepartureDate ?? group?.departureDate,
                                  t,
                                )}
                              </Text>
                              <Pressable
                                ref={active ? (n) => setTourTargetRef('arrivalProgress', n) : undefined}
                                collapsable={false}
                                style={styles.arrivalPeopleChip}
                                disabled={!isLeader}
                                onPress={(event) => {
                                  event.stopPropagation();
                                  registerCardActivity(dest.id);
                                  setArrivalDestination(dest);
                                  setOverlay('arrival');
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={`${t('map.arrivalProgress')} ${arrivedHere}/${totalMembers}`}
                              >
                                <Ionicons name="people-outline" size={16} color={accent} />
                                <Text style={[styles.arrivalPeopleValue, { color: accent }]}>
                                  {arrivedHere}/{totalMembers}
                                </Text>
                              </Pressable>
                            </View>
                            {myScopeId != null && (
                              <Text style={styles.cardBadge}>{t('subgroup.itineraryBadge')}</Text>
                            )}
                            <View style={styles.metricsRow}>
                              <View style={styles.metricCol}>
                                <View style={styles.metricValueRow}>
                                  <Ionicons name="location" size={chromeCompact ? 16 : 18} color={accent} />
                                  <View style={styles.metricNumUnit}>
                                    <Text
                                      style={[styles.metricValue, { color: accent }]}
                                      numberOfLines={1}
                                      adjustsFontSizeToFit
                                      minimumFontScale={0.85}
                                      maxFontSizeMultiplier={1.15}
                                    >
                                      {distParts.value}
                                    </Text>
                                    {distParts.unit ? (
                                      <Text
                                        style={[styles.metricUnit, { color: accent }]}
                                        numberOfLines={1}
                                        maxFontSizeMultiplier={1.15}
                                      >
                                        {distParts.unit}
                                      </Text>
                                    ) : null}
                                  </View>
                                </View>
                                <Text
                                  style={styles.metricCaption}
                                  numberOfLines={2}
                                  maxFontSizeMultiplier={1.15}
                                >
                                  {t('map.distanceToGather')}
                                </Text>
                              </View>
                              <View style={styles.metricDivider} />
                              <View style={styles.metricCol}>
                                <View style={styles.metricValueRow}>
                                  <Ionicons
                                    name={
                                      travelMode === 'walk'
                                        ? 'walk'
                                        : travelMode === 'drive'
                                          ? 'car'
                                          : 'bus'
                                    }
                                    size={chromeCompact ? 14 : 16}
                                    color={accent}
                                  />
                                  <View style={styles.metricNumUnit}>
                                    <Text
                                      style={[styles.metricValue, { color: accent }]}
                                      numberOfLines={1}
                                      adjustsFontSizeToFit
                                      minimumFontScale={0.85}
                                      maxFontSizeMultiplier={1.15}
                                    >
                                      {etaParts.value}
                                    </Text>
                                    {etaParts.unit ? (
                                      <Text
                                        style={[styles.metricUnit, { color: accent }]}
                                        numberOfLines={1}
                                        maxFontSizeMultiplier={1.15}
                                      >
                                        {etaParts.unit}
                                      </Text>
                                    ) : null}
                                  </View>
                                </View>
                                <Text
                                  style={styles.metricCaption}
                                  numberOfLines={2}
                                  maxFontSizeMultiplier={1.15}
                                >
                                  {routeForDestination
                                    ? t('map.routeEstimate')
                                    : t('map.localEstimate')}
                                </Text>
                              </View>
                              <View style={styles.metricDivider} />
                              <Pressable
                                ref={active ? (n) => setTourTargetRef('externalMaps', n) : undefined}
                                collapsable={false}
                                style={styles.mapsChip}
                                onPress={(event) => {
                                  event.stopPropagation();
                                  registerCardActivity(dest.id);
                                  openExternalNavigation(dest);
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={t('map.openExternalNavigation')}
                              >
                                <Ionicons name="map" size={22} color="#fff" />
                              </Pressable>
                            </View>
                          </View>
                        ) : (
                          <View style={styles.cardDenseBody}>
                            <OverflowMarquee
                              text={dest.title}
                              enabled={gatherCardTitleMarquee}
                              active={active}
                              activationDelayMs={1600}
                              pixelsPerSecond={gatherCardMarqueeSpeed}
                              startPauseMs={1000}
                              endPauseMs={1500}
                              // Single stable style object (not an inline array) so
                              // MapScreen re-renders do not thrash marquee measure.
                              style={styles.cardTitleCollapsed}
                            />
                            <View style={styles.cardCollapsedMetrics}>
                              {etaLabel ? (
                                <Text
                                  style={[styles.cardRouteMetaEta, { color: glass.textSecondary }]}
                                  numberOfLines={1}
                                >
                                  {etaLabel}
                                </Text>
                              ) : null}
                              {etaLabel && distLabel ? (
                                <Text style={styles.cardRouteMetaDotExpanded}>·</Text>
                              ) : null}
                              {distLabel ? (
                                <Text
                                  style={[styles.cardRouteMetaDist, { color: accent }]}
                                  numberOfLines={1}
                                >
                                  {distLabel}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        )}
                      </View>
                    </View>

                    </GatheringCardPressable>
                    {/* a11y-layout:commandRow — always one row.
                        Order (#148): [Start/End | Arrived] [Countdown] [Transport]
                        Outside expand Pressable so Start never toggles the card.
                        Density tracks narrow + Dynamic Type. */}
                    {cardExpanded && (
                    <View style={styles.commandRow} pointerEvents="box-none">
                      {cardExpanded && navCmd.kind !== 'hidden' ? (
                        <Pressable
                          ref={active ? (n) => setTourTargetRef('navCommand', n) : undefined}
                          collapsable={false}
                          style={[
                            styles.navBtn,
                            navCmd.kind === 'member_waiting_complete'
                              || navCmd.kind === 'member_request_start'
                              ? styles.navBtnWide
                              : navIconOnly
                                ? styles.navBtnIconOnly
                                : null,
                            navCmd.kind === 'leader_stop'
                              ? styles.navBtnEnd
                              : commandDisabled
                                ? styles.navBtnDisabled
                                : { backgroundColor: accent },
                          ]}
                          hitSlop={8}
                          testID={`gather-nav-${dest.id}`}
                          onPress={() => {
                            registerCardActivity(dest.id);
                            mediumTap();
                            if (navCmd.action === 'start_nav') {
                              void startNavigation(dest, index);
                            } else if (navCmd.action === 'request_start') {
                              requestLeaderStart(dest);
                            } else if (navCmd.action === 'end_point') {
                              void requestTeamEnd(dest, index);
                            } else if (navCmd.action === 'mark_complete') {
                              // Leader manual complete while personally arrived
                              // (someone still missing → confirm; all arrived → auto).
                              promptCompleteAfterArrival(dest);
                            } else if (navCmd.disabled) {
                              logEvent('nav_command_ignored', {
                                reason: navCmd.kind,
                                destId: dest.id,
                              });
                            }
                          }}
                          disabled={commandDisabled}
                          accessibilityRole="button"
                          accessibilityLabel={navLabel}
                          accessibilityHint={startAccessibilityHint}
                          accessibilityState={{ disabled: commandDisabled }}
                        >
                          <Ionicons
                            name={
                              navCmd.kind === 'leader_stop'
                                ? 'stop'
                                : navCmd.kind === 'leader_mark_complete'
                                  ? 'checkmark-done'
                                  : navCmd.kind === 'member_waiting_complete'
                                    ? 'hourglass-outline'
                                    : navCmd.kind === 'member_navigating'
                                      ? 'navigate'
                                      : navCmd.kind === 'member_request_start'
                                        ? 'paper-plane-outline'
                                      : isLeader
                                        ? 'play'
                                        : 'navigate'
                            }
                            size={chromeCompact ? 16 : 15}
                            color={
                              navCmd.kind === 'leader_stop'
                                ? glass.danger
                                : navCmd.kind === 'member_navigating' || navCmd.kind === 'member_waiting_complete'
                                  ? glass.textSecondary
                                  : isLeader
                                    ? colors.accentText
                                    : '#0c1a12'
                            }
                          />
                          {navCmd.kind === 'member_waiting_complete'
                            || navCmd.kind === 'member_request_start'
                            || !navIconOnly ? (
                            <Text
                              style={[
                                styles.navBtnText,
                                {
                                  color:
                                    navCmd.kind === 'leader_stop'
                                      ? glass.danger
                                      : navCmd.kind === 'member_navigating' || navCmd.kind === 'member_waiting_complete'
                                        ? glass.textSecondary
                                        : isLeader
                                          ? colors.accentText
                                          : '#0c1a12',
                                  flexShrink: 1,
                                },
                              ]}
                              numberOfLines={
                                navCmd.kind === 'member_waiting_complete'
                                  || navCmd.kind === 'member_request_start'
                                  ? 2
                                  : 1
                              }
                              ellipsizeMode="tail"
                              adjustsFontSizeToFit
                              minimumFontScale={0.75}
                            >
                              {navLabel}
                            </Text>
                          ) : null}
                        </Pressable>
                      ) : null}

                      {/* Personal check-in splits from Start/End right (#148). */}
                      {showArrivalControl ? (
                        <Animated.View
                          entering={
                            arrivalJustSplit
                              ? (tourReduceMotion
                                ? FadeIn.duration(ARRIVED_FADE_MS)
                                : FadeInRight.duration(ARRIVED_SPLIT_MS))
                              : undefined
                          }
                          exiting={
                            tourReduceMotion
                              ? FadeOut.duration(ARRIVED_FADE_MS)
                              : FadeOutRight.duration(ARRIVED_SPLIT_MS)
                          }
                          collapsable={false}
                        >
                          {personallyArrived ? (
                            <Pressable
                              ref={active ? (n) => setTourTargetRef('personalArrive', n) : undefined}
                              collapsable={false}
                              style={[
                                styles.cmdSquare,
                                styles.arrivalCmdSquare,
                                styles.arrivalCmdArrived,
                              ]}
                              onPress={() => {
                                registerCardActivity(dest.id);
                                lightTap();
                                if (user?.id) handleArrival(dest, user.id, false);
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={t('arrival.undo')}
                            >
                              <Ionicons
                                name="checkmark-circle"
                                size={chromeTight ? 18 : 20}
                                color={glass.ok}
                              />
                            </Pressable>
                          ) : (
                            <Pressable
                              ref={active ? (n) => setTourTargetRef('personalArrive', n) : undefined}
                              collapsable={false}
                              style={[
                                styles.cmdSquare,
                                styles.arrivalCmdSquare,
                              ]}
                              onPress={() => {
                                registerCardActivity(dest.id);
                                lightTap();
                                if (user?.id) handleSelfArrival(dest, user.id);
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={t('arrival.mark')}
                            >
                              <Ionicons
                                name="checkmark-circle-outline"
                                size={chromeTight ? 18 : 20}
                                color={accent}
                              />
                            </Pressable>
                          )}
                        </Animated.View>
                      ) : null}

                      {/* Transport before meet countdown (product: swap order). */}
                      {cardExpanded ? (
                      <>
                      <Pressable
                        ref={active ? (n) => setTourTargetRef('transport', n) : undefined}
                        collapsable={false}
                        style={styles.cmdSquare}
                        onPress={() => {
                          registerCardActivity(dest.id);
                          lightTap();
                          const order = ['walk', 'transit', 'drive'] as const;
                          setTravelMode(order[(order.indexOf(travelMode) + 1) % order.length]);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${t(`map.travelMode.${travelMode}`)} ${etaLabel} ${distLabel}`.trim()}
                      >
                        <Ionicons
                          name={modeIconName}
                          size={chromeTight ? 18 : 20}
                          color={accent}
                        />
                      </Pressable>

                      <View
                        ref={active ? (n) => setTourTargetRef('meetTime', n) : undefined}
                        collapsable={false}
                        style={styles.meetBtnSlot}
                      >
                      <MeetTimeChip
                        meetAtIso={dest.meetAt as string | null | undefined}
                        meetRedMinutes={
                          dest.meetRedMinutes ?? meetRedMin ?? DEFAULT_MEET_RED_MIN
                        }
                        accent={accent}
                        chromeTight={chromeTight}
                        chromeCompact={chromeCompact}
                        expanded={!showArrivalControl}
                        styles={styles}
                        canEdit={canEditItinerary}
                        a11yLabel={
                          meetLabel
                            ? `${t('meetTime.set')} ${meetLabel}`
                            : t('meetTime.set')
                        }
                        onPress={() => {
                          registerCardActivity(dest.id);
                          openMeetTimePicker(dest);
                        }}
                        formatMinutes={(minutes) => t('map.meetMinutes', { minutes })}
                        formatDue={(time) => t('map.meetAtClock', { time })}
                        captionLive={t('map.meetCountdown')}
                        captionDue={t('map.meetTimeCaption')}
                      />
                      </View>
                      </>
                      ) : null}
                    </View>
                    )}
                    </View>
                  </SwiftUIGlassSurface>
                  </ArrivalCardExitShell>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </Animated.View>
      )}

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
      <OverlaySheet
        visible={overlay === 'route'}
        onClose={() => {
          // 完成 and swipe-dismiss both commit: unlock scroll, close, flush.
          lightTap();
          setRouteScrollEnabled(true);
          setRouteOverlayOpenComplete(false);
          setEditButtonActive(false);
          setOverlay(null);
          void flushRouteDraft();
        }}
        onOpenComplete={() => {
          setEditButtonActive(false);
          setRouteScrollEnabled(true);
          setRouteOverlayOpenComplete(true);
        }}
        title={t('map.gatheringPoints')}
        accent={accent}
        doneLabel={t('map.done')}
        doneSystemImage="checkmark"
        material="mapSheet"
        edgeToEdge
        headerLeft={
          canEditItinerary ? (
            routeSelectedIds.length > 0 ? (
              <Pressable
                ref={(node) => setTourTargetRef('routeMode', node as View | null)}
                onPress={() => {
                  lightTap();
                  handleDeleteMany(routeSelectedIds);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('route.deleteSelectedA11y')}
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Ionicons name="trash-outline" size={18} color="#FF5A5F" />
                <Text style={{ color: '#FF453A', fontSize: 14, fontWeight: '800' }}>
                  {t('route.deleteSelected', { count: routeSelectedIds.length })}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                ref={(node) => setTourTargetRef('routeMode', node as View | null)}
                onPress={() => {
                  lightTap();
                  setRouteSelectedIds([]);
                  setRouteInteractionMode((prev) =>
                    prev === 'drag' ? 'select' : prev === 'select' ? 'none' : 'drag',
                  );
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  routeInteractionMode === 'drag'
                    ? t('route.modeDragA11y')
                    : routeInteractionMode === 'select'
                      ? t('route.modeSelectA11y')
                      : t('route.modeHiddenA11y')
                }
                hitSlop={8}
                style={{ paddingVertical: 2, paddingHorizontal: 2 }}
              >
                <Ionicons
                  name={
                    routeInteractionMode === 'drag'
                      ? 'reorder-three-outline'
                      : routeInteractionMode === 'select'
                        ? 'checkbox-outline'
                        : 'lock-closed-outline'
                  }
                  size={22}
                  color={accent}
                />
              </Pressable>
            )
          ) : undefined
        }
      >
        <ScrollView
          ref={routeScrollRef}
          contentContainerStyle={styles.overlayBody}
          scrollEnabled={routeScrollEnabled}
          onLayout={(event) => {
            routeScrollViewportHeightRef.current = event.nativeEvent.layout.height;
          }}
          onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
            routeScrollYRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
        >
          <Text style={styles.overlayHint}>{t('map.routeHint')}</Text>
          <DestinationReorderList
            groupId={groupId ?? undefined}
            destinations={openForRouteEditor}
            canReorder={canEditItinerary}
            tripDays={optimisticTripDays ?? group?.tripDays}
            departureDate={optimisticDepartureDate ?? group?.departureDate}
            onUpdateTripDetails={handleUpdateTripDetails}
            onReorder={handleReorder}
            onDelete={canEditItinerary ? handleDelete : undefined}
            onUpdateEmojiColor={canEditItinerary ? handleUpdateEmojiColor : undefined}
            onImport={() => setKmlVisible(true)}
            onSync={routeSyncFailed ? retryRouteSync : undefined}
            syncFailed={routeSyncFailed}
            colors={dark}
            emptyLabel={t('settings.noDestinations')}
            interactionMode={routeInteractionMode}
            selectedIds={routeSelectedIds}
            onSelectedIdsChange={setRouteSelectedIds}
            onDragActiveChange={(active) => {
              // Defensive: never leave scroll locked after drag ends.
              setRouteScrollEnabled(!active);
              if (!active) setRouteScrollEnabled(true);
            }}
            onDragAutoScroll={handleRouteDragAutoScroll}
            onTourTargetRef={setTourTargetRef}
            accountId={user?.id}
            dailyByDate={Object.fromEntries(
              dailyAccommodations.map((d) => [
                d.stayDate,
                {
                  id: d.id,
                  stayDate: d.stayDate,
                  title: d.title,
                  coordinates: d.coordinates,
                },
              ]),
            )}
            favoritePlaces={favoritePlaces}
            onDeleteFavorite={
              user?.id
                ? (fav) => {
                    lightTap();
                    const snapshot = favoritePlaces;
                    setFavoritePlaces((prev) => prev.filter((f) => f.id !== fav.id));
                    void unsaveFavoritePlace(fav.id).catch(() => {
                      setFavoritePlaces(snapshot);
                    });
                  }
                : undefined
            }
            onClearDailyAccommodation={
              canEditItinerary && groupId
                ? (stayDate, _day) => {
                    // Local draft only — flush on sheet dismiss.
                    setDraftDailyAccommodations((prev) => {
                      const base = prev ?? serverDailyAccommodations;
                      return base.filter((d) => d.stayDate !== stayDate);
                    });
                    routeDraftDirtyRef.current.daily = true;
                  }
                : undefined
            }
            onSetDailyFromDestination={
              canEditItinerary && groupId
                ? (destinationId, day) => {
                    const baseDests = optimisticDestinationsRef.current ?? rawDestinations;
                    const dest =
                      baseDests.find((d) => d.id === destinationId)
                      ?? destinations.find((d) => d.id === destinationId);
                    if (!dest) return;
                    const departure = optimisticDepartureDate ?? group?.departureDate;
                    const date = dateForTripDay(departure, day);
                    if (!date) {
                      Alert.alert(
                        t('interaction.error'),
                        t('stay.needDepartureDate'),
                      );
                      return;
                    }
                    const stayDate = localDayKey(date);
                    const next: DailyAccommodation = {
                      id: `draft-daily-${stayDate}`,
                      groupId,
                      stayDate,
                      title: dest.title,
                      address: dest.address,
                      coordinates: dest.coordinates,
                      // Snapshot only (no FK); source stop is discarded below.
                      sourceDestinationId: dest.id,
                    };
                    setDraftDailyAccommodations((prev) => {
                      const base = prev ?? serverDailyAccommodations;
                      return [
                        ...base.filter((d) => d.stayDate !== stayDate),
                        next,
                      ];
                    });
                    // Setting stay from a gathering point discards that stop;
                    // only the daily accommodation setting remains.
                    setOptimisticDestinations(baseDests.filter((d) => d.id !== destinationId));
                    if (!destinationId.startsWith('draft-')) {
                      routeDraftDirtyRef.current.deletedIds = [
                        ...routeDraftDirtyRef.current.deletedIds.filter((x) => x !== destinationId),
                        destinationId,
                      ];
                    }
                    routeDraftDirtyRef.current.daily = true;
                    routeDraftDirtyRef.current.destinations = true;
                  }
                : undefined
            }
            onQuickAddAccommodation={
              canEditItinerary && groupId
                ? (day) => {
                    // Local draft card — only days with existing stops show this CTA.
                    // Use full open route-editor list (not day-gated carousel).
                    const daily = dailyAccommodations.find((d) => {
                      const date = dateForTripDay(
                        optimisticDepartureDate ?? group?.departureDate,
                        day,
                      );
                      return date ? d.stayDate === localDayKey(date) : false;
                    });
                    const dayStops = openForRouteEditor
                      .filter((d) => (d.day || 1) === day)
                      .sort((a, b) => a.order - b.order);
                    if (dayStops.length === 0) return;
                    const allSorted = openForRouteEditor.slice().sort((a, b) => {
                      if ((a.day || 1) !== (b.day || 1)) {
                        return (a.day || 1) - (b.day || 1);
                      }
                      return a.order - b.order;
                    });
                    const fallbackStop =
                      dayStops[dayStops.length - 1]
                      ?? allSorted[allSorted.length - 1];
                    const title = daily?.title ?? t('stay.defaultTitle');
                    const address = daily?.address ?? fallbackStop?.address;
                    const coords = daily?.coordinates
                      ?? fallbackStop?.coordinates
                      ?? {
                        latitude: 0,
                        longitude: 0,
                      };
                    const base = optimisticDestinationsRef.current ?? rawDestinations;
                    const sameDay = base.filter((d) => (d.day || 1) === day);
                    const insertOrder =
                      sameDay.length > 0
                        ? Math.max(...sameDay.map((d) => d.order)) + 1
                        : (fallbackStop?.order ?? 0) + 1;
                    const tempId = `draft-acc-${Date.now()}-${destinationMutationSequenceRef.current++}`;
                    const draftCard: Destination = {
                      id: tempId,
                      title,
                      address,
                      coordinates: coords,
                      order: insertOrder,
                      day,
                      kind: 'accommodation',
                      stayAnchor: false,
                      subgroupId: myScopeId,
                    };
                    const shifted = base.map((d) => {
                      if ((d.day || 1) !== day) return d;
                      if (d.order >= insertOrder) return { ...d, order: d.order + 1 };
                      return d;
                    });
                    setOptimisticDestinations(
                      [...shifted, draftCard].sort((a, b) => {
                        if ((a.day || 1) !== (b.day || 1)) {
                          return (a.day || 1) - (b.day || 1);
                        }
                        return a.order - b.order;
                      }),
                    );
                    routeDraftDirtyRef.current.destinations = true;
                  }
                : undefined
            }
            onPickFavorite={
              canEditItinerary && groupId
                ? (fav, day) => {
                    // Local draft stop from favorites — flush on dismiss.
                    const base = optimisticDestinationsRef.current ?? rawDestinations;
                    const sameDay = base.filter((d) => (d.day || 1) === day);
                    const insertOrder =
                      sameDay.length > 0
                        ? Math.max(...sameDay.map((d) => d.order)) + 1
                        : 0;
                    const tempId = `draft-fav-${Date.now()}-${destinationMutationSequenceRef.current++}`;
                    const draftStop: Destination = {
                      id: tempId,
                      title: fav.title,
                      address: fav.address,
                      coordinates: fav.coordinates,
                      order: insertOrder,
                      day,
                      kind: 'stop',
                      subgroupId: myScopeId,
                    };
                    const shifted = base.map((d) => {
                      if ((d.day || 1) !== day) return d;
                      if (d.order >= insertOrder) return { ...d, order: d.order + 1 };
                      return d;
                    });
                    setOptimisticDestinations(
                      [...shifted, draftStop].sort((a, b) => {
                        if ((a.day || 1) !== (b.day || 1)) {
                          return (a.day || 1) - (b.day || 1);
                        }
                        return a.order - b.order;
                      }),
                    );
                    routeDraftDirtyRef.current.destinations = true;
                  }
                : undefined
            }
          />
        </ScrollView>
      </OverlaySheet>

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
      <InviteMembersSheet
        visible={overlay === 'invite'}
        onClose={() => setOverlay(null)}
        title={t('map.inviteMembers')}
        accent={accent}
        doneLabel={t('map.done')}
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          <Text style={styles.overlayHint}>
            {inviteBlockedForAnonymousLeader
              ? t('anon.registrationRequiredBody')
              : t('map.inviteMembersHint')}
          </Text>
          {!inviteBlockedForAnonymousLeader && (
            <View
              style={styles.inviteCodeBoxes}
              accessible
              accessibilityRole="text"
              accessibilityLabel={group?.inviteCode ?? ''}
            >
              {Array.from({ length: 6 }, (_, index) => (
                <React.Fragment key={index}>
                  {index === 3 ? <Text style={styles.inviteCodeDash}>-</Text> : null}
                  <View style={styles.inviteCodeCell}>
                    <Text
                      style={styles.inviteCodeChar}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                      numberOfLines={1}
                    >
                      {group?.inviteCode?.[index] ?? ''}
                    </Text>
                  </View>
                </React.Fragment>
              ))}
            </View>
          )}
          {inviteBlockedForAnonymousLeader ? (
            <Pressable
              style={[styles.settingsButton, { marginBottom: 10 }]}
              onPress={promptAnonymousLeaderRegistration}
              accessibilityRole="button"
            >
              <Ionicons name="person-add-outline" size={20} color="#fff" />
              <Text style={styles.settingsText}>{t('anon.registrationRequiredCta')}</Text>
            </Pressable>
          ) : (
            <View style={styles.inviteActions}>
              <AmicroButton
                icon="link-outline"
                activeIcon="send-outline"
                color="#fff"
                label={t('map.share')}
                centeredLabel
                durationMs={420}
                style={styles.inviteActionButton}
                accessibilityLabel={t('map.shareInviteLink')}
                onPress={lightTap}
                onAnimationComplete={async () => {
                  try {
                    await shareCode();
                  } catch {
                    // Existing error path; always release busy via Amicro finally.
                  }
                }}
              />
              <AmicroButton
                icon="copy-outline"
                activeIcon="checkmark"
                active={codeCopied}
                activeOnPress
                resetAfterComplete={false}
                color="#fff"
                activeColor={glass.ok}
                label={t('map.copy')}
                centeredLabel
                style={styles.inviteActionButton}
                accessibilityLabel={codeCopied ? t('group.copied') : t('map.copyGroupCode')}
                onPress={lightTap}
                onAnimationComplete={() => { void copyCode(); }}
              />
            </View>
          )}
        </ScrollView>
      </InviteMembersSheet>

      {/* Exceptions + coordination — single full-bleed ops center. */}
      <OverlaySheet
        visible={overlay === 'ops'}
        onClose={() => setOverlay(null)}
        title={t('map.opsCenter')}
        accent={accent}
        doneLabel={t('map.done')}
        material="mapSheet"
        edgeToEdge
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          <Text style={[styles.sheetHeading, styles.sheetHeadingFirst]}>
            {t('exception.centerTitle')}
          </Text>
          {organizerExceptions.length === 0 ? (
            <Text style={styles.overlayHint}>{t('exception.centerEmpty')}</Text>
          ) : (
            organizerExceptions.map((item) => {
              const typeKey = `exception.type.${item.type}` as TranslationKey;
              const statusKey = `exception.status.${item.status}` as TranslationKey;
              const typeLabel = t(typeKey);
              const statusLabel = t(statusKey);
              const lastSeenLabel = (() => {
                const ms = Date.parse(item.lastSeenAt);
                if (!Number.isFinite(ms)) return item.lastSeenAt;
                return new Date(ms).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });
              })();
              const busy = exceptionPendingKeys.has(item.rootCauseKey);
              const muted = item.status === 'resolved';
              return (
                <View
                  key={item.id}
                  style={[styles.listGroup, muted && { opacity: 0.55 }]}
                >
                  <View style={styles.listRow}>
                    <View style={styles.grow}>
                      <Text style={styles.listRowTitle} numberOfLines={1}>
                        {item.memberName} · {typeLabel}
                      </Text>
                      <Text style={styles.overlayHint} numberOfLines={3}>
                        {item.gatheringPointTitle
                          ? `${t('exception.gathering', { title: item.gatheringPointTitle })} · `
                          : ''}
                        {statusLabel}
                        {` · ${t('exception.lastSeen', { time: lastSeenLabel })}`}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.splitActions, { paddingHorizontal: 12, paddingBottom: 10 }]}>
                    {item.availableActions.includes('acknowledge') ? (
                      <Pressable
                        style={[
                          styles.chip,
                          { backgroundColor: accentMix(accent, 24), borderColor: accentMix(accent, 50) },
                          busy && { opacity: 0.5 },
                        ]}
                        onPress={() => {
                          if (busy) return;
                          void markExceptionHandled(item.rootCauseKey, 'acknowledge');
                        }}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.memberName}, ${typeLabel}, ${t('exception.acknowledge')}`}
                        accessibilityState={{ disabled: busy }}
                      >
                        <Text style={styles.chipText}>{t('exception.acknowledge')}</Text>
                      </Pressable>
                    ) : null}
                    {item.availableActions.includes('resolve') ? (
                      <Pressable
                        style={[
                          styles.chip,
                          { backgroundColor: accentMix(accent, 24), borderColor: accentMix(accent, 50) },
                          busy && { opacity: 0.5 },
                        ]}
                        onPress={() => {
                          if (busy) return;
                          void markExceptionHandled(item.rootCauseKey, 'resolve');
                        }}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.memberName}, ${typeLabel}, ${t('exception.resolve')}`}
                        accessibilityState={{ disabled: busy }}
                      >
                        <Text style={styles.chipText}>{t('exception.resolve')}</Text>
                      </Pressable>
                    ) : null}
                    {item.availableActions.includes('reopen') ? (
                      <Pressable
                        style={[styles.chipGhost, busy && { opacity: 0.5 }]}
                        onPress={() => {
                          if (busy) return;
                          void markExceptionHandled(item.rootCauseKey, 'reopen');
                        }}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.memberName}, ${typeLabel}, ${t('exception.reopen')}`}
                        accessibilityState={{ disabled: busy }}
                      >
                        <Text style={styles.chipText}>{t('exception.reopen')}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}

          <Text style={styles.sheetHeading}>{t('coordination.title')}</Text>
          <CoordinationRequestsPanel
            accent={accent}
            isLeader={!!isLeader}
            styles={styles}
            coordination={coordination}
          />
        </ScrollView>
      </OverlaySheet>

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
      <OverlaySheet
        visible={overlay === 'arrivalManage'}
        onClose={() => setOverlay(null)}
        title={t('arrival.manage')}
        accent={accent}
        doneLabel={t('map.done')}
        doneSystemImage="checkmark"
        material="mapSheet"
        edgeToEdge
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          {(state?.destinations ?? []).length === 0 ? (
            <Text style={styles.overlayHint}>{t('settings.noDestinations')}</Text>
          ) : (
            (state?.destinations ?? []).map((destination) => {
              const scopedMembers = members.filter(
                (member) => member.subgroupId === destination.subgroupId,
              );
              const arrivedCount = destinationArrivals.filter(
                (entry) => entry.destinationId === destination.id,
              ).length;
              return (
                <View key={`arrival-manage-${destination.id}`} style={styles.listGroup}>
                  <View style={styles.listRow}>
                    <Text style={[styles.listRowTitle, styles.grow]} numberOfLines={2}>
                      {destination.title}
                    </Text>
                    <Text style={styles.listRowTrailing}>
                      {arrivedCount}/{scopedMembers.length}
                    </Text>
                  </View>
                  {scopedMembers.map((member, index) => {
                    const arrived = destinationArrivals.some(
                      (entry) =>
                        entry.destinationId === destination.id && entry.userId === member.userId,
                    );
                    const memberStateKey = arrived
                      ? 'memberStatus.arrived'
                      : destination.closedAt
                        ? 'memberStatus.missed'
                        : 'memberStatus.pending';
                    return (
                      <View
                        key={`${destination.id}-${member.userId}`}
                        style={[
                          styles.flockRow,
                          styles.arrivalMemberRow,
                          index === scopedMembers.length - 1 && styles.flockRowLast,
                        ]}
                      >
                        <View style={styles.grow}>
                          <Text style={styles.flockName} numberOfLines={1}>{member.name}</Text>
                          <Text style={styles.overlayHint}>{t(memberStateKey)}</Text>
                        </View>
                        <Pressable
                          style={styles.arrivalToggleBtn}
                          onPress={() => handleArrival(destination, member.userId, !arrived)}
                          accessibilityRole="button"
                          accessibilityLabel={t(arrived ? 'arrival.undo' : 'arrival.mark')}
                          accessibilityState={{ checked: arrived }}
                        >
                          <Ionicons
                            name={arrived ? 'checkmark-circle' : 'checkmark-circle-outline'}
                            size={36}
                            color={arrived ? glass.ok : glass.textTertiary}
                          />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              );
            })
          )}
        </ScrollView>
      </OverlaySheet>

      {/* Single-destination arrival (gathering-card shortcut only). */}
      <OverlaySheet
        visible={overlay === 'arrival'}
        onClose={() => {
          setArrivalDestination(null);
          setOverlay(null);
        }}
        title={arrivalDestination?.title ?? t('map.arrivalProgress')}
        accent={accent}
        doneLabel={t('map.done')}
        doneSystemImage="checkmark"
        material="mapSheet"
        edgeToEdge
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          {arrivalDestination ? members
            .filter((member) => member.subgroupId === arrivalDestination.subgroupId)
            .map((member) => {
              const arrived = destinationArrivals.some(
                (entry) => entry.destinationId === arrivalDestination.id && entry.userId === member.userId,
              );
              const memberStateKey = arrived
                ? 'memberStatus.arrived'
                : arrivalDestination.closedAt
                  ? 'memberStatus.missed'
                  : 'memberStatus.pending';
              return (
                <View key={member.userId} style={[styles.flockRow, styles.arrivalMemberRow]}>
                  <View style={styles.grow}>
                    <Text style={styles.flockName} numberOfLines={1}>{member.name}</Text>
                    <Text style={styles.overlayHint}>{t(memberStateKey)}</Text>
                  </View>
                  <Pressable
                    style={styles.arrivalToggleBtn}
                    onPress={() => handleArrival(arrivalDestination, member.userId, !arrived)}
                    accessibilityRole="button"
                    accessibilityLabel={t(arrived ? 'arrival.undo' : 'arrival.mark')}
                    accessibilityState={{ checked: arrived }}
                  >
                    <Ionicons
                      name={arrived ? 'checkmark-circle' : 'checkmark-circle-outline'}
                      size={36}
                      color={arrived ? glass.ok : glass.textTertiary}
                    />
                  </Pressable>
                </View>
              );
            }) : null}
        </ScrollView>
      </OverlaySheet>

      {/* History overlay: gathering points actually reached, grouped by day. */}
      <OverlaySheet
        visible={overlay === 'history'}
        onClose={() => setOverlay(null)}
        title={t('history.title')}
        accent={accent}
        doneLabel={t('map.done')}
        material="mapSheet"
        edgeToEdge
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          {historyGroups.length === 0 ? (
            <Text style={styles.overlayHint}>{t('history.empty')}</Text>
          ) : (
            historyGroups.map((group) => {
              const [y, m, dNum] = group.day.split('-').map(Number);
              const dayLabel = new Date(y, m - 1, dNum).toLocaleDateString();
              return (
                <View key={group.day} style={styles.historyDayBlock}>
                  <Text style={styles.sectionLabel}>{dayLabel}</Text>
                  <View style={styles.list}>
                    {group.items.map((item, i) => {
                      const status = item.status ?? 'arrived';
                      const statusLabel =
                        status === 'missed'
                          ? t('history.statusMissed')
                          : status === 'incomplete'
                            ? t('history.statusIncomplete')
                            : null;
                      return (
                      <View
                        key={item.id}
                        style={[
                          styles.flockRow,
                          i === group.items.length - 1 && styles.flockRowLast,
                        ]}
                      >
                        <View style={styles.flockRowMain}>
                          <View style={styles.grow}>
                            <Text style={styles.flockName}>{item.name}</Text>
                            {item.userName ? (
                              <Text style={styles.overlayHint}>{item.userName}</Text>
                            ) : null}
                          </View>
                          {statusLabel ? (
                            <Text style={[styles.historyTime, { color: glass.textTertiary }]}>
                              {statusLabel}
                            </Text>
                          ) : (
                            <Text style={styles.historyTime}>
                              {new Date(item.arrivedAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </Text>
                          )}
                          {!item.synthetic && (item.userId === user?.id || isLeader) ? (
                            <Pressable
                              style={styles.cmdSquare}
                              onPress={() => handleDeleteHistory(item)}
                              accessibilityRole="button"
                              accessibilityLabel={t('common.delete')}
                            >
                              <Ionicons name="trash-outline" size={18} color={glass.danger} />
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                      );
                    })}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </OverlaySheet>

      {/* Report-a-problem stacks over settings; dismissing it reveals settings. */}
      <View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, styles.settingsChildLayer]}
      >
      <FeedbackSheet
        visible={overlay === 'feedback'}
        onClose={() => setOverlay(null)}
        screenshotUri={feedbackShot}
      />
      </View>

      <CustomQuickCommandSheet
        visible={overlay === 'custom'}
        slot={customSlot}
        onClose={() => setOverlay(null)}
      />

      {/* Invite-a-teammate picker, opened from my own subgroup card. */}
      <OverlaySheet
        visible={inviteSheetOpen}
        onClose={() => setInviteSheetOpen(false)}
        title={t('subgroup.inviteTitle')}
        accent={accent}
        doneLabel={t('map.done')}
        edgeToEdge
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          {invitable.length === 0 ? (
            <Text style={styles.overlayHint}>{t('subgroup.inviteEmpty')}</Text>
          ) : (
            <View style={styles.list}>
              {invitable.map((f, i) => (
                <View
                  key={f.userId}
                  style={[styles.flockRow, i === invitable.length - 1 && styles.flockRowLast]}
                >
                  <View style={styles.flockRowMain}>
                    <View style={[styles.flockAvatar, { backgroundColor: f.color, borderColor: 'transparent' }]}>
                      <HitherText typeRole="emoji" style={styles.flockEmoji}>
                        {displayMemberAvatar(f.avatar, f.userId).emoji}
                      </HitherText>
                    </View>
                    <View style={styles.grow}>
                      <Text style={styles.flockName}>{f.name}</Text>
                    </View>
                    <Pressable
                      style={[styles.chip, { backgroundColor: accentMix(accent, 24), borderColor: accentMix(accent, 50) }]}
                      onPress={() => mySubgroupId && void handleInvite(mySubgroupId, f.userId)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.chipText}>{t('subgroup.inviteAction')}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </OverlaySheet>

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
      />
      </View>
      {purchaseUnlocking ? (
        <View
          style={[styles.loading, StyleSheet.absoluteFill, { zIndex: 200 }]}
          pointerEvents="auto"
          testID="purchase-unlock-loading"
        >
          <ActivityIndicator color={accent} size="large" />
          <Text style={styles.loadingText}>{t('map.loading')}</Text>
        </View>
      ) : null}

      <KmlImportSheet
        visible={kmlVisible}
        onClose={() => setKmlVisible(false)}
        currentCount={countOpenDestinations(allScopedDestinations)}
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
      <OverlaySheet
        visible={!!meetTimeEditor}
        onClose={() => setMeetTimeEditor(null)}
        title={t('meetTime.set')}
        accent={accent}
        doneLabel={t('common.cancel')}
        doneSystemImage="xmark"
        edgeToEdge
      >
        {meetTimeEditor && (
          <View style={styles.meetEditorBody}>
            <Text style={[styles.sectionLabel, styles.meetSectionLabel]}>
              {t('meetTime.quickSection')}
            </Text>
            <View style={styles.meetQuickRow}>
              {[10, 30, 60].map((m) => (
                <Pressable
                  key={m}
                  style={[
                    styles.meetQuickBtn,
                    meetTimeEditor.quickMinutes === m && {
                      borderColor: accent,
                      backgroundColor: accentMix(accent, 14),
                    },
                  ]}
                  onPress={() => {
                    lightTap();
                    const shortcut = addMinutesToPickerValue(meetTimeEditor.value, m);
                    setMeetTimeEditor((s) =>
                      s ? { ...s, value: shortcut, quickMinutes: m } : s,
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    m < 60
                      ? t('map.meetInMinutes', { n: m })
                      : t('map.meetInHours', { n: m / 60 })
                  }
                >
                  <Ionicons
                    name="time-outline"
                    size={16}
                    color={
                      meetTimeEditor.quickMinutes === m ? accent : glass.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.meetQuickBtnText,
                      meetTimeEditor.quickMinutes === m && { color: accent },
                    ]}
                  >
                    {m < 60
                      ? t('map.meetInMinutes', { n: m })
                      : t('map.meetInHours', { n: m / 60 })}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.sectionLabel, styles.meetSectionLabel]}>
              {t('meetTime.timeSection')}
            </Text>
            <Pressable
              style={styles.meetDateSummary}
              onPress={
                Platform.OS === 'android'
                  ? () => {
                      lightTap();
                      openAndroidMeetDate();
                    }
                  : undefined
              }
              accessibilityRole={Platform.OS === 'android' ? 'button' : undefined}
              accessibilityLabel={t('meetTime.pickDateTime')}
            >
              <Ionicons name="calendar-outline" size={20} color={accent} />
              <Text style={styles.meetSelectedClock}>
                {meetTimeEditor.value.toLocaleString(undefined, {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={glass.textSecondary}
              />
            </Pressable>

            {Platform.OS !== 'android' && (
              <View style={styles.meetPickerWrap}>
                <DateTimePicker
                  value={meetTimeEditor.value}
                  mode="datetime"
                  display="spinner"
                  minuteInterval={1}
                  minimumDate={startOfTodayLocal()}
                  onChange={(_event, selected) =>
                    selected &&
                    setMeetTimeEditor((s) =>
                      s
                        ? {
                            ...s,
                            value: clampDateNotBeforeToday(selected),
                            quickMinutes: null,
                          }
                        : s,
                    )
                  }
                />
              </View>
            )}

            <View style={{ marginTop: 10, marginBottom: 6 }}>
              <View style={styles.meetSectionHeader}>
                <Text style={styles.meetSectionHeaderLabel}>
                  {t('meetTime.redSection')}
                </Text>
                <Pressable
                  hitSlop={10}
                  onPress={() =>
                    Alert.alert(t('meetTime.redSection'), t('meetTime.redHint'))
                  }
                  accessibilityRole="button"
                  accessibilityLabel={t('meetTime.redInfo')}
                  style={styles.meetSectionHeaderInfo}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={20}
                    color={accent}
                  />
                </Pressable>
              </View>
              <Segmented
                accent={accent}
                options={MEET_RED_OPTIONS.map((m) => ({
                  key: String(m),
                  label: t('meetTime.redOption', { minutes: m }),
                }))}
                value={String(meetTimeEditor.redMin)}
                onChange={(v) =>
                  setMeetTimeEditor((s) => (s ? { ...s, redMin: Number(v) } : s))
                }
              />
            </View>
            <Pressable
              style={[
                styles.meetSetBtn,
                { backgroundColor: accentMix(accent, 90), borderColor: accentMix(accent, 50) },
              ]}
              onPress={() => {
                persistMeetTime(
                  meetTimeEditor.id,
                  meetTimeEditor.value,
                  meetTimeEditor.redMin,
                );
                setMeetTimeEditor(null);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.meetSetText}>{t('meetTime.set')}</Text>
            </Pressable>
            <Pressable
              style={styles.meetClearBtn}
              onPress={() => {
                persistMeetTime(meetTimeEditor.id, null);
                setMeetTimeEditor(null);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.meetClearText}>{t('meetTime.clear')}</Text>
            </Pressable>
          </View>
        )}
      </OverlaySheet>

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

/** Gathering-point card press shell — haptic only, no scale animation. */
/**
 * #149 whole-card exit: 440ms fade + slight upward slide when stop completes.
 */
function ArrivalCardExitShell({
  exiting,
  children,
}: {
  exiting: boolean;
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    return {
      opacity: withTiming(exiting ? 0 : 1, {
        duration: ARRIVAL_CARD_EXIT_MS,
        easing: Easing.out(Easing.cubic),
      }),
      transform: [
        {
          translateY: withTiming(exiting ? -16 : 0, {
            duration: ARRIVAL_CARD_EXIT_MS,
            easing: Easing.out(Easing.cubic),
          }),
        },
      ],
    };
  }, [exiting]);
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * Meet-time chip on the gather card. Owns due/live caption switching so the
 * parent carousel does not re-render 1×/s — only this chip ticks.
 * Due: top "{time} 集合", bottom "集合時間". Live: top "N 分鐘", bottom "集合倒數".
 */
const MeetTimeChip = React.memo(function MeetTimeChip({
  meetAtIso,
  meetRedMinutes,
  accent,
  chromeTight,
  chromeCompact,
  expanded,
  styles,
  canEdit,
  a11yLabel,
  onPress,
  formatMinutes,
  formatDue,
  captionLive,
  captionDue,
}: {
  meetAtIso: string | null | undefined;
  meetRedMinutes: number;
  accent: string;
  chromeTight: boolean;
  chromeCompact: boolean;
  expanded: boolean;
  styles: any;
  canEdit: boolean;
  a11yLabel: string;
  onPress: () => void;
  formatMinutes: (minutes: number) => string;
  formatDue: (time: string) => string;
  captionLive: string;
  captionDue: string;
}) {
  const [due, setDue] = useState(() => {
    if (!meetAtIso) return false;
    const t = new Date(meetAtIso).getTime();
    return Number.isFinite(t) && t <= Date.now();
  });
  const onDueChange = useCallback((next: boolean) => {
    setDue(next);
  }, []);
  const labelStyle = chromeTight
    ? styles.meetBtnLabelTight
    : chromeCompact
      ? styles.meetBtnLabelCompact
      : styles.meetBtnLabel;

  return (
    <Pressable
      style={[styles.meetBtn, expanded ? styles.meetBtnExpanded : null]}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      disabled={!canEdit}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <View style={styles.meetBtnStack}>
        <View style={styles.meetBtnTimeRow}>
          <Ionicons
            name="time-outline"
            size={chromeTight ? 14 : chromeCompact ? 15 : 16}
            color={meetAtIso ? accent : glass.textSecondary}
          />
          {meetAtIso ? (
            <MeetCountdown
              meetAtIso={meetAtIso}
              redWithinMin={meetRedMinutes}
              redColor={glass.danger}
              variant="minutes"
              formatMinutes={formatMinutes}
              formatDue={formatDue}
              onDueChange={onDueChange}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              baseStyle={[labelStyle, { color: accent }]}
            />
          ) : (
            <Text
              style={labelStyle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              ——
            </Text>
          )}
        </View>
        <Text
          style={styles.meetBtnCaption}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {meetAtIso && due ? captionDue : captionLive}
        </Text>
      </View>
    </Pressable>
  );
});

/**
 * Gathering-point pagination (max 5 visible). Each item occupies its own
 * active pill / inactive dot width in normal flow — no absolute overlay.
 */
function CarouselDots({
  total,
  active,
  maxVisible,
  destinationIds,
  styles,
  reduceMotion = false,
}: {
  total: number;
  active: number;
  maxVisible: number;
  destinationIds: readonly string[];
  styles: {
    dots: object;
    dot: object;
    dotActive: object;
  };
  reduceMotion?: boolean;
}) {
  const row = useMemo(
    () => indicatorRowGeometry(total, active, maxVisible),
    [total, active, maxVisible],
  );

  return (
    <View style={[styles.dots, { flexShrink: 0 }]}>
      {row.items.map((item) => (
        <CarouselDot
          key={`dot-${destinationIds[item.index] ?? item.index}`}
          active={item.active}
          reduceMotion={reduceMotion}
          styles={styles}
        />
      ))}
    </View>
  );
}

function CarouselDot({
  active,
  reduceMotion,
  styles,
}: {
  active: boolean;
  reduceMotion: boolean;
  styles: {
    dot: object;
    dotActive: object;
  };
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    width: withTiming(active ? 18 : 6, {
      duration: reduceMotion ? 0 : 200,
    }),
  }), [active, reduceMotion]);

  return (
    <Animated.View
      style={[styles.dot, active ? styles.dotActive : null, animatedStyle]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

function GatheringCardPressable({
  onToggle,
  accessibilityLabel,
  accessibilityHint,
  children,
}: {
  onToggle: () => void;
  accessibilityLabel: string;
  accessibilityHint: string;
  children: React.ReactNode;
}) {
  // Guard against double-fire (expand then instant collapse) from a single gesture.
  const lastPressAtRef = useRef(0);
  const handlePress = useCallback(() => {
    const now = Date.now();
    if (now - lastPressAtRef.current < 300) return;
    lastPressAtRef.current = now;
    rigidTap();
    onToggle();
  }, [onToggle]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {children}
    </Pressable>
  );
}

/**
 * Location-refresh control owns the 1 Hz cooldown clock so MapScreen is not
 * re-rendered every second while the button counts down.
 */
const RefreshLocationsButton = React.memo(function RefreshLocationsButton({
  refreshing,
  cooldownUntil,
  accent,
  styles,
  t,
  onPress,
}: {
  refreshing: boolean;
  cooldownUntil: number;
  accent: string;
  styles: any;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onPress: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);
  const remaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const cooling = remaining > 0;

  if (refreshing) {
    return (
      <View style={styles.refreshLocationsButton} accessibilityLabel={t('map.refreshLocationsA11y')}>
        <ActivityIndicator size="small" color={accent} />
      </View>
    );
  }
  return (
    <AmicroButton
      icon="refresh"
      mode="rotate"
      color={accent}
      style={styles.refreshLocationsButton}
      onPress={lightTap}
      onAnimationComplete={onPress}
      disabled={refreshing || cooling}
      accessibilityLabel={t('map.refreshLocationsA11y')}
      accessibilityHint={
        cooling ? t('map.refreshLocationsCooldown', { seconds: remaining }) : undefined
      }
    />
  );
});

/**
 * One flock member row. Owns a 30s tick for freshness / "moving" status so the
 * parent MapScreen tree is not on a location-age interval.
 */
const FlockRow = React.memo(function FlockRow({
  userId,
  name,
  avatar,
  color,
  isLeader,
  solo,
  subgroupId,
  dist,
  arrived,
  lastUpdated,
  isMe,
  canKick = false,
  last,
  styles,
  t,
  accent,
  onSelfMerge,
  onSelfSplit,
  onKick,
}: {
  userId: string;
  name: string;
  avatar?: string | null;
  color: string;
  isLeader: boolean;
  solo: boolean;
  subgroupId?: string | null;
  dist: string;
  arrived: boolean;
  lastUpdated?: string;
  isMe: boolean;
  canKick?: boolean;
  last: boolean;
  styles: any;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  /** Theme accent for primary self actions (e.g. 建立小隊). */
  accent: string;
  onSelfMerge: () => void | Promise<unknown>;
  onSelfSplit: () => void | Promise<unknown>;
  onKick?: () => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const movingRecently =
    !!lastUpdated && nowMs - new Date(lastUpdated).getTime() < 2 * 60_000;
  const statusText = solo
    ? t('solo.badge')
    : isLeader
      ? t('flock.leading')
      : arrived
        ? t('memberStatus.arrived')
        : movingRecently
          ? t('memberStatus.moving')
          : t('memberStatus.notStarted');
  const role = isLeader ? t('map.leaderRole') : t('map.memberRole');
  const distOrStatus = dist || statusText;
  const freshness = locationFreshness(lastUpdated, nowMs);
  const freshnessText =
    freshness.unit === 'minutes'
      ? t('locationUpdate.minutes', { minutes: freshness.value })
      : freshness.unit === 'hours'
        ? t('locationUpdate.hours', { hours: freshness.value })
        : t(`locationUpdate.${freshness.unit}`);

  return (
    <View style={[styles.flockRow, last && styles.flockRowLast]}>
      <View style={styles.flockRowMain}>
        <View
          style={[
            styles.flockAvatar,
            {
              backgroundColor: color,
              borderColor: isLeader ? 'rgba(255,255,255,0.55)' : 'transparent',
            },
          ]}
        >
          <HitherText typeRole="emoji" style={styles.flockEmoji}>
            {displayMemberAvatar(avatar, userId).emoji}
          </HitherText>
        </View>
        <View style={styles.grow}>
          <Text style={styles.flockName}>{isMe ? t('flock.you') : name}</Text>
          <Text style={styles.flockStatus} numberOfLines={2}>
            <Text style={styles.flockMetaRole}>{role}</Text>
            {!isMe && distOrStatus ? (
              <Text style={styles.flockMetaDist}>{` · ${distOrStatus}`}</Text>
            ) : null}
            {freshnessText ? (
              <Text style={styles.flockMetaFresh}>{` · ${freshnessText}`}</Text>
            ) : null}
            {!isMe && solo ? (
              <Text style={styles.flockMetaWarn}>{` · ${t('solo.badge')}`}</Text>
            ) : null}
          </Text>
        </View>
      </View>
      {isMe && (
        <View style={styles.selfControls}>
          {subgroupId ? (
            <Pressable
              onPress={() => void onSelfMerge()}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => pressed && styles.rowActionPressed}
            >
              <Text style={styles.rowActionSecondary}>
                {t('subgroup.leaveTeam')}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void onSelfSplit()}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => pressed && styles.rowActionPressed}
            >
              <Text style={[styles.rowActionSecondary, { color: accent }]}>
                {t('subgroup.createTeam')}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {!isMe && canKick && onKick ? (
        <View style={styles.selfControls}>
          <Pressable
            onPress={onKick}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('group.kick')}
            style={({ pressed }) => pressed && styles.rowActionPressed}
          >
            <Text style={[styles.rowActionSecondary, { color: glass.danger }]}>
              {t('group.kick')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

const segStyles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: glass.fill,
    borderRadius: 13,
    padding: 4,
    marginBottom: 4,
  },
  seg: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlight: {
    position: 'absolute',
    left: 4,
    top: 4,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  segLocked: { opacity: 0.4 },
  segText: { fontSize: 15, fontWeight: '600', color: glass.textSecondary },
});

/**
 * Design sizes × live (capped) font scale — layout tracks Dynamic Type.
 * `narrow` densifies chrome for iPhone 15 / mini / SE.
 * `bucket` chooses compact/tight density so the command row STAYS one row
 * (never stacks) while still fitting large Dynamic Type + small widths.
 * `boldText` (iOS Bold Text) is already folded into `scale`/`bucket` via
 * layoutFontScale; we also soften 700→600 so OS bold doesn't double-thicken.
 */
/**
 * Apply app Settings textScale to design fontSize only.
 * Do NOT multiply by full layout scale here — RN allowFontScaling still
 * applies system Dynamic Type (would double-count system otherwise).
 * Emoji styles are skipped so avatar glyphs stay fixed in their shells.
 */
function applyAppTextScale<T extends Record<string, any>>(
  defs: T,
  textScale: number,
  emojiKeys: ReadonlySet<string>,
): T {
  if (!Number.isFinite(textScale) || textScale === 1 || textScale <= 0) return defs;
  const out = { ...defs } as T;
  for (const key of Object.keys(defs)) {
    if (emojiKeys.has(key)) continue;
    const entry = defs[key];
    if (entry && typeof entry === 'object' && typeof entry.fontSize === 'number') {
      (out as any)[key] = {
        ...entry,
        fontSize: Math.round(entry.fontSize * textScale),
      };
    }
  }
  return out;
}

/**
 * When system Bold Text is on, drop design-time 700/bold to 600 so SF Pro
 * doesn't render double-thick (OS bold + explicit heavy weight) and clip
 * short labels in pills / command chrome.
 */
function applyBoldTextWeights<T extends Record<string, any>>(
  defs: T,
  boldText: boolean,
  emojiKeys: ReadonlySet<string>,
): T {
  if (!boldText) return defs;
  const out = { ...defs } as T;
  for (const key of Object.keys(defs)) {
    if (emojiKeys.has(key)) continue;
    const entry = defs[key];
    if (!entry || typeof entry !== 'object') continue;
    const w = entry.fontWeight;
    if (w === '700' || w === 'bold' || w === 700) {
      (out as any)[key] = { ...entry, fontWeight: '600' };
    }
  }
  return out;
}

const EMOJI_STYLE_KEYS = new Set([
  'headerAvatarEmoji',
  'peekStackEmoji',
  'avatarEmoji',
  'flockEmoji',
  'pillEmoji',
  'profilePreviewEmoji',
  'emojiChar',
]);

const makeStyles = (
  accent: string,
  scale: number,
  narrow = false,
  bucket: 'regular' | 'large' | 'xl' = 'regular',
  textScale = 1,
  boldText = false,
) => {
  const s = (n: number, min = 0) => Math.max(min, Math.round(n * scale));
  // Density ladder (single-row only):
  // regular → full labels + larger meet
  // compact → smaller squares (narrow OR large type OR Bold Text via bucket)
  // tight   → icon-only nav + smallest meet type (xl OR narrow+large)
  // Bold Text is already reflected in `scale`/`bucket` (layoutFontScale factor).
  const tight = bucket === 'xl' || (narrow && bucket === 'large');
  const compact = tight || narrow || bucket === 'large';
  const cardPad = compact ? s(14, 10) : s(18, 14);
  const cmdGap = tight ? s(5, 4) : compact ? s(6, 4) : s(8, 6);
  // Every control is at least 48pt; mode/arrived stay exact squares (#148).
  const cmdSize = Math.max(
    GATHER_CMD_MIN_HIT_PT,
    tight ? s(48, 44) : compact ? s(52, 48) : s(56, 52),
  );
  // Meet grows with free width; min leaves room for countdown digits.
  // Collapsed 3-btn row gets more meet width than expanded 4-btn.
  const meetMinW = tight ? s(72, 64) : compact ? s(84, 76) : s(104, 92);
  // Expanded metric numerals — drop size under large Dynamic Type / Bold so
  // distance + ETA never clip inside the two metric columns.
  // Caption floor stays ≥11 so 「距離集合點」「預估步行」 never go microscopic.
  const metricNumSize = tight ? 18 : compact ? 22 : 28;
  const metricUnitSize = tight ? 11 : compact ? 12 : 14;
  const metricCaptionSize = tight ? 11 : compact ? 11 : 12;
  const mapsChipSize = tight ? s(44, 40) : compact ? s(48, 44) : s(52, 48);
  const defs = {
    flex: { flex: 1, backgroundColor: '#0c1118' },
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(12, 8),
      backgroundColor: '#0c1118',
    },
    loadingText: { color: glass.textSecondary, fontSize: 15 },

    topRow: {
      position: 'absolute',
      left: 14,
      right: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      zIndex: 40,
    },
    subgroupToggleWrapper: {
      position: 'absolute',
      width: '100%',
      paddingHorizontal: 16,
      alignItems: 'center',
      zIndex: 20,
    },
    groupPill: {
      flexShrink: 1,
      minWidth: 112,
      minHeight: s(44, 40),
      paddingLeft: s(8, 6),
      paddingRight: s(14, 10),
      paddingVertical: s(6, 4),
      borderRadius: s(22, 18),
      overflow: 'hidden',
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(9, 6),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    groupPillPressed: { opacity: 0.82 },
    groupPillText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
      flexShrink: 1,
    },
    pillAvatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // flexShrink + numberOfLines(1) so an overlong group name ellipsizes
    // instead of pushing the role chip off-screen.
    pillName: { fontSize: 15, fontWeight: '600', color: '#fff', flexShrink: 1, minWidth: 0 },
    pillCount: { fontFamily: DISPLAY_FONT, fontSize: 14, color: glass.textSecondary, fontVariant: ['tabular-nums'] },
    roleChip: {
      minHeight: s(44, 40),
      paddingHorizontal: s(16, 12),
      paddingVertical: s(6, 4),
      borderRadius: s(22, 18),
      overflow: 'hidden',
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(7, 5),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineSoft,
    },
    roleDot: { width: 8, height: 8, borderRadius: 4 },
    roleWord: { fontSize: 14, fontWeight: '600', color: '#fff' },

    // Stack (low → high): capsules (50) < gathering cards (58) < sheet layer (70).
    // Fully-rounded pill (width/2) holding fit-all + locate stacked.
    recenter: { position: 'absolute', right: 14, zIndex: 50 },
    recenterCapsule: {
      width: 50,
      borderRadius: 25,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineSoft,
    },
    recenterHit: { width: 50, height: 48, alignItems: 'center', justifyContent: 'center' },
    recenterDivider: { height: StyleSheet.hairlineWidth, backgroundColor: glass.hairlineStrong },

    teamCapsuleWrap: {
      position: 'absolute',
      left: 14,
      zIndex: 50,
    },

    // a11y-layout:carouselCapsuleClearance — cards above capsules; maxHeight inline.
    // Must stay below sheetLayer (70).
    carouselWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      zIndex: 58,
      overflow: 'visible',
    },
    // Parent of BottomSheet — zIndex on this sibling beats carousel 58.
    sheetLayer: {
      zIndex: 70,
    },
    // Settings root is 80. Child OverlaySheets have no wrapper z-index of
    // their own, so this sibling stacking context must beat settings.
    settingsChildLayer: {
      zIndex: 90,
    },
    // Gathering-point card shell — radius + overflow only.
    // Padding lives on cardInner so celebrate dim can absolute-fill the full
    // glass surface (no bright padding rim / command-row gap).
    card: {
      borderRadius: narrow ? s(22, 16) : s(26, 20),
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      // Soft system-gray rim only — never theme/accent outline.
      borderColor: glass.hairlineSoft,
    },
    cardInner: {
      paddingHorizontal: cardPad,
      paddingTop: s(compact ? 14 : 16, 10),
      paddingBottom: s(compact ? 14 : 16, 10),
    },
    cardActiveBorder: {
      borderColor: glass.hairline,
    },
    // kicker → title → day+people → metrics → command row.
    cardHead: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      minWidth: 0,
    },
    grow: { flex: 1, minWidth: 0 },
    cardKickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: s(8, 6),
      minWidth: 0,
    },
    cardKicker: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.3,
      flexShrink: 1,
      minWidth: 0,
      lineHeight: s(15, 13),
    },
    // Full-card celebrate dim (GlassView child, not inside padded Pressable).
    arrivalDimOverlay: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(0, 0, 0, 0.28)',
      zIndex: 4,
    },
    arrivalCenterCheckLayer: {
      ...StyleSheet.absoluteFill,
      zIndex: 5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    arrivalCenterCheckBox: {
      alignItems: 'center',
      justifyContent: 'center',
      // Solid green disc — filled check, not outline-on-dark.
      backgroundColor: glass.ok,
      borderWidth: 0,
    },
    arrivalCenterCheckBoxExpanded: {
      width: 56,
      height: 56,
      borderRadius: 28,
    },
    arrivalCenterCheckBoxCollapsed: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    cardDenseBody: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(10, 8),
      marginTop: s(8, 6),
      minWidth: 0,
      width: '100%',
      overflow: 'hidden',
    },
    cardCollapsedMetrics: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      flexShrink: 0,
      gap: 4,
    },
    cardTitle: {
      fontFamily: DISPLAY_FONT,
      fontSize: compact ? 20 : 22,
      color: '#fff',
      lineHeight: s(28, 26),
      flexShrink: 1,
    },
    // Full title style for collapsed marquee (single object — not merged at call site).
    cardTitleCollapsed: {
      fontFamily: DISPLAY_FONT,
      fontSize: compact ? 20 : 22,
      color: '#fff',
      lineHeight: s(26, 24),
      marginBottom: s(2, 1),
      flexShrink: 0,
    },
    cardTitleExpanded: {
      fontSize: compact ? 27 : 29,
      lineHeight: s(34, 32),
      marginTop: s(6, 4),
    },
    // Expanded: day line left · people N/M right-aligned.
    cardSubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: s(8, 6),
      marginTop: s(2, 1),
      minWidth: 0,
    },
    cardDayLine: {
      color: glass.textSecondary,
      fontSize: 13,
      lineHeight: s(16, 15),
      marginTop: 0,
      marginBottom: 0,
      flex: 1,
      flexShrink: 1,
      minWidth: 0,
    },
    arrivalPeopleChip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: s(4, 3),
      flexShrink: 0,
      marginLeft: s(8, 6),
    },
    arrivalPeopleValue: {
      fontFamily: DISPLAY_FONT,
      fontSize: 15,
      fontVariant: ['tabular-nums'],
      fontWeight: '700',
      lineHeight: s(18, 16),
    },
    cardBadge: {
      color: glass.textSecondary,
      fontSize: 11,
      marginTop: s(1, 0),
      marginBottom: 0,
      lineHeight: s(14, 13),
    },

    // Expanded metrics: 📍 dist | 🚗 eta | map — numbers large, units small, centered.
    metricsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(8, 6),
      marginTop: s(8, 6),
      minWidth: 0,
      width: '100%',
    },
    metricCol: {
      flex: 1,
      minWidth: s(64, 56),
      alignItems: 'center',
      gap: s(3, 2),
    },
    metricValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(3, 2),
      minWidth: 0,
      width: '100%',
    },
    metricNumUnit: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: s(3, 2),
      minWidth: 0,
      flexShrink: 1,
    },
    metricValue: {
      fontFamily: DISPLAY_FONT,
      fontSize: metricNumSize,
      fontVariant: ['tabular-nums'],
      fontWeight: '700',
      lineHeight: Math.round(metricNumSize * 1.15),
      flexShrink: 1,
      minWidth: 0,
      includeFontPadding: false,
    },
    metricUnit: {
      fontFamily: DISPLAY_FONT,
      fontSize: metricUnitSize,
      fontVariant: ['tabular-nums'],
      fontWeight: '600',
      lineHeight: Math.round(metricUnitSize * 1.25),
      flexShrink: 0,
      includeFontPadding: false,
      opacity: 0.9,
    },
    metricCaption: {
      fontSize: metricCaptionSize,
      color: glass.textSecondary,
      lineHeight: Math.round(metricCaptionSize * 1.3),
      textAlign: 'center',
      alignSelf: 'stretch',
      width: '100%',
    },
    metricDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
      backgroundColor: glass.hairlineStrong,
      marginVertical: s(2, 1),
    },
    cardRouteMetaDotExpanded: {
      fontFamily: DISPLAY_FONT,
      fontSize: compact ? 18 : 20,
      color: glass.textTertiary,
      lineHeight: s(24, 22),
    },
    // Apple Maps — expanded metrics row square.
    mapsChip: {
      width: mapsChipSize,
      height: mapsChipSize,
      borderRadius: s(16, 14),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.10)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineStrong,
      flexShrink: 0,
      marginLeft: s(2, 0),
    },
    // Collapsed route meta — may shrink under large Dynamic Type so digits stay visible.
    cardRouteMetaEta: {
      fontFamily: DISPLAY_FONT,
      fontSize: tight ? 14 : compact ? 16 : 20,
      fontVariant: ['tabular-nums'],
      fontWeight: '600',
      flexShrink: 1,
      minWidth: 0,
      lineHeight: tight ? s(18, 16) : compact ? s(20, 18) : s(22, 20),
      textAlign: 'right',
      includeFontPadding: false,
    },
    cardRouteMetaDist: {
      fontFamily: DISPLAY_FONT,
      fontSize: tight ? 15 : compact ? 18 : 22,
      fontVariant: ['tabular-nums'],
      fontWeight: '700',
      flexShrink: 1,
      minWidth: 0,
      lineHeight: tight ? s(18, 16) : compact ? s(22, 20) : s(24, 22),
      textAlign: 'right',
      includeFontPadding: false,
      marginTop: -1,
    },

    // a11y-layout:commandRow — single row always; density via cmdSize/labels.
    // Mode exact square; nav/meet grow. Meet may grow taller than cmdSize under large type.
    commandRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      flexWrap: 'nowrap',
      gap: cmdGap,
      marginTop: s(12, 8),
      minWidth: 0,
      width: '100%',
    },
    navBtn: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: cmdSize,
      minHeight: cmdSize,
      borderRadius: s(15, 12),
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(6, 4),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'transparent',
      paddingHorizontal: compact ? s(8, 6) : s(10, 8),
      overflow: 'hidden',
    },
    navBtnDisabled: {
      backgroundColor: 'rgba(255,255,255,0.12)',
      opacity: 0.85,
    },
    // Tight density: exact square so meet keeps countdown width.
    navBtnIconOnly: {
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: cmdSize,
      width: cmdSize,
      minWidth: cmdSize,
      maxWidth: cmdSize,
      paddingHorizontal: 0,
    },
    // "End navigation" state — a soft danger tint over the accent-solid "go".
    navBtnEnd: { backgroundColor: 'rgba(255,107,107,0.14)', borderColor: 'rgba(255,107,107,0.4)' },
    // Member waiting-for-leader label needs more width than icon-only nav.
    navBtnWide: {
      flexGrow: 1.4,
      minWidth: cmdSize * 1.6,
      paddingHorizontal: s(8, 6),
    },
    navBtnText: {
      fontSize: compact ? 13 : 14,
      fontWeight: '700',
      flexShrink: 1,
      minWidth: 0,
    },

    // Exact square secondary controls (travel mode). minHeight only so row can
    // stretch when meet grows taller under large Dynamic Type.
    cmdSquare: {
      width: cmdSize,
      minWidth: cmdSize,
      maxWidth: cmdSize,
      minHeight: cmdSize,
      flexGrow: 0,
      flexShrink: 0,
      borderRadius: s(15, 12),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.09)',
      borderWidth: StyleSheet.hairlineWidth,
      // Neutral rim — avoid accent outlines on Android.
      borderColor: glass.hairlineSoft,
      overflow: 'hidden',
    },
    arrivalCmdArrived: {
      backgroundColor: accentMix(glass.ok, 22),
      borderColor: glass.hairlineSoft,
    },
    // Meet-time slot keeps countdown from shifting when Arrived appears (#148).
    meetBtnSlot: {
      flexGrow: 0,
      flexShrink: 0,
      // 1.5× prior baseline; extra width is taken from the nav flex region.
      minWidth: Math.max(
        GATHER_CMD_MIN_HIT_PT,
        Math.round((meetMinW - 8) * COUNTDOWN_WIDTH_FACTOR),
      ),
      maxWidth: Math.max(
        GATHER_CMD_MIN_HIT_PT,
        Math.round((meetMinW - 8) * COUNTDOWN_WIDTH_FACTOR) + (tight ? 0 : 24),
      ),
    },
    // Meet-time — fixed-ish width (slot); minHeight floor only so
    // countdown +「集合倒數」never clip under large/bold system type.
    meetBtn: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: '100%',
      minWidth: Math.max(
        GATHER_CMD_MIN_HIT_PT,
        Math.round((meetMinW - 8) * COUNTDOWN_WIDTH_FACTOR),
      ),
      minHeight: cmdSize,
      borderRadius: s(15, 12),
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0,
      backgroundColor: 'rgba(255,255,255,0.09)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
      paddingHorizontal: compact ? s(8, 6) : s(10, 8),
      paddingVertical: s(6, 4),
      overflow: 'visible',
    },
    meetBtnExpanded: {
      // When Arrived is hidden, allow countdown to absorb free nav space.
      flexGrow: 2.1,
    },
    meetBtnStack: {
      flexShrink: 1,
      minWidth: 0,
      maxWidth: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    meetBtnTimeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(4, 3),
      minWidth: 0,
      maxWidth: '100%',
    },
    meetBtnCaption: {
      fontSize: tight ? 9 : 10,
      fontWeight: '600',
      color: glass.textSecondary,
      lineHeight: tight ? s(11, 10) : s(12, 11),
      marginTop: 1,
      textAlign: 'center',
      width: '100%',
    },
    meetBtnLabel: {
      fontFamily: DISPLAY_FONT,
      fontSize: tight ? 13 : compact ? 14 : 16,
      fontWeight: '700',
      color: glass.textSecondary,
      fontVariant: ['tabular-nums'],
      flexShrink: 1,
      minWidth: 0,
      maxWidth: '100%',
      textAlign: 'center',
    },
    meetBtnLabelCompact: {
      fontFamily: DISPLAY_FONT,
      fontSize: 13,
      fontWeight: '700',
      color: glass.textSecondary,
      fontVariant: ['tabular-nums'],
      flexShrink: 1,
      minWidth: 0,
      maxWidth: '100%',
      textAlign: 'center',
    },
    meetBtnLabelTight: {
      fontFamily: DISPLAY_FONT,
      fontSize: 12,
      fontWeight: '700',
      color: glass.textSecondary,
      fontVariant: ['tabular-nums'],
      flexShrink: 1,
      minWidth: 0,
      maxWidth: '100%',
      textAlign: 'center',
    },

    // Add-gather-point confirm card — follower-nav layout, extra-round corners.
    confirmCard: { position: 'absolute', left: 14, right: 14, zIndex: 60 },
    confirmCardInner: {
      overflow: 'hidden',
      borderRadius: 34,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineStrong,
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 10,
      gap: 4,
    },
    // Hide the bottom sheet while the confirm card is up without animating an
    // ancestor of its Liquid Glass surface.
    sheetHidden: { display: 'none' },
    sheetBodyHidden: { display: 'none' },
    confirmTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    confirmControlRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    confirmTextCol: { flex: 1, gap: 2 },
    confirmKicker: { fontSize: 16, fontWeight: '600', color: '#fff', marginLeft: 2 },
    confirmTitleInput: {
      color: '#fff',
      fontSize: 18,
      fontWeight: '700',
      margin: 0,
      paddingVertical: 2,
      paddingHorizontal: 2,
      minHeight: 26,
    },
    confirmNameHint: {
      fontSize: 12,
      color: glass.textTertiary,
      marginLeft: 2,
      marginBottom: 2,
    },
    confirmEtaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    confirmArrow: {
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmControl: {
      width: 60,
      height: 60,
      borderRadius: 30,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.fillStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    confirmControlPressed: { opacity: 0.82 },
    arrivalCmdSquare: {
      borderWidth: StyleSheet.hairlineWidth,
    },
    confirmMin: { fontFamily: DISPLAY_FONT, fontSize: 36, includeFontPadding: false },
    confirmDist: { fontSize: 16, color: glass.textSecondary },
    confirmBtnRow: {
      width: '100%',
      alignSelf: 'stretch',
      flexDirection: 'row',
      gap: 12,
      marginTop: 6,
    },
    confirmCancel: {
      flex: 1,
      height: 60,
      borderRadius: 30,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.fillStrong,
      paddingHorizontal: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    confirmCancelText: { fontSize: 16, fontWeight: '700', color: '#FF453A', textAlign: 'center' },
    confirmAdd: {
      flex: 1,
      height: 60,
      borderRadius: 30,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
      backgroundColor: Platform.OS === 'ios' ? '#0A84FF' : accent,
    },
    confirmAddText: { fontSize: 16, fontWeight: '700', color: '#fff', textAlign: 'center' },
    // Meet-time editor sheet: roomy, full-width controls (not the old cramped
    // left-aligned chips).
    meetEditorBody: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40, gap: 14 },
    meetSectionLabel: { marginTop: 0, marginBottom: -6 },
    meetQuickRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginBottom: -4 },
    meetQuickBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderRadius: 20,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    meetQuickBtnText: { color: glass.textSecondary, fontSize: 14, fontWeight: '600' },
    meetSelectedClock: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: glass.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    meetDateSummary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 50,
      borderRadius: 14,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
      paddingHorizontal: 14,
    },
    meetSectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 6,
      marginBottom: 8,
      minHeight: 22,
    },
    // Strip sectionLabel margins so title + info icon share one baseline.
    meetSectionHeaderLabel: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: glass.textTertiary,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      includeFontPadding: false,
      textAlignVertical: 'center' as const,
    },
    meetSectionHeaderInfo: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    meetPickerWrap: { alignItems: 'center', marginBottom: 4 },
    meetSetBtn: {
      minHeight: s(52, 48),
      borderRadius: s(15, 12),
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      paddingVertical: s(12, 10),
      paddingHorizontal: s(12, 10),
    },
    meetSetText: { fontSize: 17, fontWeight: '700', color: '#fff', textAlign: 'center' },
    meetClearBtn: {
      minHeight: s(50, 46),
      borderRadius: s(15, 12),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
      paddingVertical: s(12, 10),
      paddingHorizontal: s(12, 10),
    },
    meetClearText: { fontSize: 17, fontWeight: '600', color: glass.textSecondary, textAlign: 'center' },
    dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
    dotActive: { width: 18, backgroundColor: accent },

    // Peek chrome: compact grabZone (paddingTop 3 + bar 4 + paddingBottom 2 = 9)
    // plus 2pt/11pt header padding keeps the 46pt action row centered with
    // approximately 11pt from each Peek edge.
    sheetHeaderBlock: {
      paddingHorizontal: 12,
      paddingTop: 2,
      paddingBottom: 11,
    },
    sheetTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minWidth: 0,
      minHeight: 46,
    },
    peekActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
    },
    groupNameHit: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minWidth: 0,
      marginRight: 4,
    },
    sheetGroupTitle: {
      fontFamily: DISPLAY_FONT,
      fontSize: s(18, 16),
      fontWeight: '600',
      color: '#fff',
      flexShrink: 1,
    },
    myStatusBar: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
      marginBottom: 8,
      minWidth: 0,
    },
    myStatusCluster: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: STATUS_SHARE_CLUSTER_GAP,
    },
    myStatusTrigger: {
      minWidth: 112,
      minHeight: 44,
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 16,
      flexShrink: 1,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    myStatusTriggerInner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    myStatusName: {
      color: glass.textSecondary,
      fontSize: 14,
      lineHeight: 16,
      fontWeight: '600',
      maxWidth: 128,
      textAlign: 'left',
    },
    statusOption: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 12,
      marginBottom: 10,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.12)',
      backgroundColor: 'rgba(255,255,255,0.04)',
    },
    statusOptionIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.08)',
      flexShrink: 0,
    },
    statusOptionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: '#fff',
      marginBottom: 4,
    },
    statusOptionHint: {
      fontSize: 13,
      lineHeight: 18,
      color: glass.textTertiary,
      fontWeight: '500',
    },
    statusOptionCheck: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      marginTop: 8,
    },
    statusOptionRadio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.28)',
      flexShrink: 0,
      marginTop: 9,
    },
    headerIconBtn: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
      flexShrink: 0,
      marginTop: 0,
    },
    headerIconSlot: {
      width: 46,
      height: 46,
      flexShrink: 0,
    },
    headerAvatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      flexShrink: 0,
      marginTop: 0,
    },
    headerAvatarEmoji: { fontSize: 24 },
    headerAvatarText: { fontSize: 18, fontWeight: '700', color: '#fff' },
    peekAvatarStack: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      minWidth: 0,
      marginRight: 6,
    },
    peekEmptyHint: {
      fontSize: 14,
      fontWeight: '500',
      color: glass.textTertiary,
    },
    peekStackAv: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: 2.5,
    },
    peekStackMore: {
      backgroundColor: 'rgba(60,64,72,0.95)',
      borderColor: 'rgba(255,255,255,0.35)',
    },
    peekStackEmoji: { fontSize: 20 },
    peekStackInitial: { fontSize: 15, fontWeight: '700', color: '#fff' },
    peekStatusList: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    peekStatusLine: {
      fontSize: 11,
      fontWeight: '500',
      color: glass.textSecondary,
      lineHeight: 14,
    },
    peekStatusName: {
      fontWeight: '700',
      color: '#fff',
    },
    peekStatusMore: {
      fontSize: 11,
      fontWeight: '600',
      color: glass.textTertiary,
    },
    sheetPaneToggleWrap: {
      marginTop: 0,
      marginBottom: 4,
    },
    accuracyRowLast: {
      marginTop: 12,
      borderBottomWidth: 0,
    },
    /** Inactive toggle panes: skip layout work during sheet stage morphs. */
    extraCreditsHint: {
      fontSize: 13,
      fontWeight: '600',
      color: glass.textSecondary,
      marginBottom: 8,
    },
    sheetPaneHidden: {
      display: 'none',
    },
    passiveEnterBlock: {
      marginTop: 8,
      marginBottom: 10,
      width: '100%',
    },
    passiveEnterButton: {
      width: '100%',
      height: PASSIVE_ENTER_HEIGHT,
      borderRadius: PASSIVE_ENTER_HEIGHT / 2,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    passiveEnterButtonPressed: { opacity: 0.82 },
    passiveEnterContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    passiveEnterLabel: {
      color: glass.textPrimary,
      fontSize: 18,
      fontWeight: '700',
    },
    sheetHeadingFirst: {
      marginTop: 4,
    },
    // Full card only for grouped "next stop" reading.
    tripSummaryCard: {
      borderRadius: 16,
      padding: 14,
      marginBottom: 8,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    tripCardKicker: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
      color: accent,
      marginBottom: 4,
      textTransform: 'uppercase',
    },
    tripCardTitle: {
      fontFamily: DISPLAY_FONT,
      fontSize: 18,
      fontWeight: '600',
      color: '#fff',
      marginBottom: 4,
    },
    tripCardMeta: {
      fontSize: 13,
      color: glass.textSecondary,
    },
    // Plain navigation list (Sheet → rows only, no icon tiles).
    listGroup: {
      marginBottom: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(255,255,255,0.08)',
    },
    /** Standalone framed reorder action (outside listGroup). */
    reorderActionCard: {
      marginBottom: 10,
      minHeight: 52,
      paddingVertical: 4,
      paddingHorizontal: 4,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineStrong,
      backgroundColor: glass.fill,
      overflow: 'hidden',
    },
    /** Full-row single press target (label + pencil share one AmicroButton). */
    reorderActionPressable: {
      width: '100%',
      minHeight: 48,
      paddingVertical: 8,
      paddingHorizontal: 10,
      flexDirection: 'row-reverse',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    renameModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    renameModalCard: {
      width: '100%',
      maxWidth: 360,
      borderRadius: 18,
      backgroundColor: glass.cardActive,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineStrong,
      padding: 18,
      gap: 12,
    },
    renameModalTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: '#fff',
    },
    renameModalInput: {
      fontSize: 18,
      fontWeight: '600',
      color: '#fff',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineStrong,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: glass.fill,
    },
    renameModalActions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 4,
    },
    renameModalBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.fill,
    },
    renameModalBtnPrimary: {},
    renameModalBtnText: {
      fontSize: 16,
      fontWeight: '700',
      color: glass.textSecondary,
    },
    listRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 13,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    listRowLast: {},
    listRowTitle: {
      flex: 1,
      fontSize: 16,
      fontWeight: '500',
      color: '#fff',
      minWidth: 0,
    },
    listRowTrailing: {
      fontSize: 15,
      fontWeight: '500',
      color: glass.textSecondary,
    },
    // Legacy search field styles (still used by overlays / confirm flows).
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    searchField: {
      flex: 1,
      minHeight: s(44, 40),
      borderRadius: s(22, 18),
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(8, 6),
      paddingHorizontal: s(14, 10),
      paddingVertical: s(10, 8),
      backgroundColor: 'rgba(118,118,128,0.26)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.15)',
    },
    searchPlaceholder: { fontSize: 15, color: 'rgba(235,235,245,0.5)', flexShrink: 1 },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
    avatarEmoji: { fontSize: 20 },
    flockEmoji: { fontSize: 20 },
    pillEmoji: { fontSize: 13 },

    // Profile overlay
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
    profileInput: {
      flex: 1,
      minHeight: 48,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: '#fff',
      fontSize: 16,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    profileBody: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 28 },
    profilePreviewRow: { alignItems: 'center', marginBottom: 8 },
    profilePreviewAvatar: {
      width: 76,
      height: 76,
      borderRadius: 38,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    profilePreviewEmoji: { fontSize: 40 },
    profilePreviewInitial: { fontSize: 32, fontWeight: '700', color: '#fff' },
    // 5 columns × 6 rows filling edge-to-edge: 5 × (18% + 1% + 1%) = 100%.
    emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
    emojiCell: {
      width: '18%',
      aspectRatio: 1,
      marginHorizontal: '1%',
      marginVertical: 3,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.fill,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    emojiChar: { fontSize: 26 },
    colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
    colorSwatch: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },

    // Subgroups
    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingRight: 4,
      marginBottom: 8,
    },
    memberHeadingActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    // Toggle rows: flat list-style, no nested icon tile cards.
    accuracyRow: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 4,
      paddingRight: 16,
      marginBottom: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    accuracyCopy: { flex: 1, minWidth: 0 },
    accuracySwitch: { flexShrink: 0, alignSelf: 'center' },
    locationSharingButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
      flexShrink: 0,
    },
    locationSharingButtonPressed: { opacity: 0.82 },
    accuracyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
    accuracyLabel: { color: '#fff', fontSize: 15, fontWeight: '600', lineHeight: 22, flexShrink: 1 },
    // Hint is secondary gray — not orange (orange reserved for primary / on).
    accuracyBattery: {
      marginTop: 2,
      color: glass.textTertiary,
      fontSize: 11,
      fontWeight: '500',
      lineHeight: 16,
      flexShrink: 1,
    },
    accuracySubhint: {
      marginTop: 2,
      color: glass.textTertiary,
      fontSize: 11,
      fontWeight: '500',
      lineHeight: 16,
      flexShrink: 1,
    },
    marqueeSpeedBlock: {
      paddingHorizontal: 4,
      paddingTop: 4,
      paddingBottom: 12,
      marginBottom: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.08)',
      gap: 6,
    },
    marqueeSpeedLabels: { gap: 2 },
    marqueeSpeedEnds: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    refreshLocationsButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 0,
      marginLeft: 'auto',
    },
    splitBar: {
      borderRadius: 16,
      padding: 12,
      marginBottom: 12,
      gap: 10,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    splitHint: { fontSize: 13, color: glass.textSecondary },
    // BUG-18: more room between accept/decline and the prompt text above.
    splitActions: { flexDirection: 'row', gap: 12, marginTop: 10, flexWrap: 'wrap' },
    selectDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.4)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    subgroupCard: {
      borderRadius: 20,
      overflow: 'hidden',
      marginBottom: 12,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    subgroupHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 6,
    },
    subgroupName: { fontSize: 15, fontWeight: '700', color: '#fff' },
    subgroupMeta: { fontSize: 12.5, color: glass.textSecondary, marginTop: 1 },
    subgroupPendingHint: {
      fontSize: 12.5,
      color: glass.textSecondary,
      paddingHorizontal: 14,
      paddingBottom: 10,
    },

    codeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 12,
      marginBottom: 16,
      minWidth: 0,
    },
    // Section labels — lighter than nested card chrome.
    sheetHeading: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: glass.textTertiary,
      marginTop: 20,
      marginBottom: 8,
      marginLeft: 4,
    },
    memberCapHint: {
      fontSize: 12,
      color: glass.textTertiary,
      marginTop: 24,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: glass.textTertiary,
      marginBottom: 8,
      marginLeft: 4,
      marginTop: 22,
    },
    settingsInlineLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: glass.textSecondary,
      marginBottom: 8,
      marginLeft: 4,
      marginTop: 8,
    },
    profileNickLabel: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.3,
      color: glass.textTertiary,
      marginBottom: 6,
      marginLeft: 4,
      marginTop: 10,
    },
    profileSectionLabel: {
      fontSize: 15,
      fontWeight: '800',
      letterSpacing: 0.4,
      color: '#fff',
      marginBottom: 8,
      marginLeft: 4,
      marginTop: 12,
    },
    profileColorLabel: {
      fontSize: 15,
      fontWeight: '800',
      letterSpacing: 0.4,
      color: '#fff',
      marginBottom: 8,
      marginLeft: 4,
      marginTop: 0,
    },
    historyDayBlock: { marginBottom: 16 },
    historyTime: {
      fontSize: 14,
      fontWeight: '600',
      color: glass.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    settingSwitchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 4,
      marginBottom: 18,
    },
    settingSwitchText: { flex: 1, minWidth: 0 },
    settingSwitchLabel: { fontSize: 15, fontWeight: '600', color: '#fff', flexShrink: 1, lineHeight: 22 },
    settingSwitchHint: { fontSize: 12, color: glass.textTertiary, marginTop: 2, flexShrink: 1 },
    chip: {
      minHeight: s(38, 34),
      paddingHorizontal: s(16, 12),
      paddingVertical: s(8, 6),
      borderRadius: s(19, 16),
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      flexShrink: 0,
      borderWidth: StyleSheet.hairlineWidth,
    },
    chipGhost: {
      height: 38,
      paddingHorizontal: 14,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.fill,
    },
    chipText: { fontSize: 14, fontWeight: '600', color: '#fff' },

    list: {
      borderRadius: 20,
      overflow: 'hidden',
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
      marginBottom: 20,
    },
    flockRow: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.08)',
      gap: 4,
    },
    flockRowLast: { borderBottomWidth: 0 },
    flockRowMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    arrivalMemberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    arrivalToggleBtn: {
      width: 60,
      height: 60,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    // a11y-layout:inviteRow
    inviteRowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
    invitePromptFull: { flex: 0, width: '100%' },
    inviteActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    flockAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
    },
    flockInitial: { fontSize: 16, fontWeight: '600', color: '#fff' },
    flockName: { fontSize: 16, color: '#fff', fontWeight: '600' },
    flockStatus: { fontSize: 13, marginTop: 2 },
    flockMetaRole: { color: glass.textSecondary, fontWeight: '500' },
    flockMetaDist: { color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
    flockMetaFresh: { color: glass.textTertiary, fontWeight: '500' },
    flockMetaWarn: { color: glass.warn, fontWeight: '600' },
    flockFreshness: { fontSize: 11.5, color: glass.textTertiary, marginTop: 2 },
    flockMeta: { alignItems: 'flex-end' },
    flockEta: { fontFamily: DISPLAY_FONT, fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.9)', fontVariant: ['tabular-nums'] },
    flockDist: { fontSize: 12, color: glass.textTertiary },
    selfControls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(255,255,255,0.08)',
    },
    selfSoloRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    inviteMemberBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      marginTop: 14,
      marginHorizontal: 8,
      marginBottom: 4,
      paddingVertical: 13,
      borderRadius: 16,
    },
    selfControlLabel: { fontSize: 13, color: glass.textSecondary },

    // Legacy aliases (overlays may still reference these).
    rowButton: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 13,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    rowIcon: {
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowTitle: { flex: 1, fontSize: 16, fontWeight: '500', color: '#fff', flexShrink: 1 },
    rowSub: { fontSize: 13, color: glass.textTertiary },
    rowAction: { fontSize: 14, fontWeight: '500', color: glass.textSecondary },
    rowActionSecondary: { fontSize: 14, fontWeight: '500', color: glass.textSecondary },
    rowActionPressed: { opacity: 0.5 },

    settingsButton: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    settingsText: { flex: 1, fontSize: 16, fontWeight: '500', color: '#fff' },
    inviteActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      minHeight: 64,
      marginTop: 4,
    },
    inviteActionButton: {
      flex: 1,
      height: 48,
      borderRadius: 14,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    inviteCodeBoxes: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: narrow ? 4 : 8,
      marginVertical: 20,
    },
    inviteCodeCell: {
      flex: 1,
      minWidth: 0,
      height: narrow ? 56 : 64,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.fill,
      borderWidth: 1,
      borderColor: glass.hairline,
    },
    inviteCodeChar: {
      fontFamily: DISPLAY_FONT,
      fontSize: 32,
      fontWeight: '700',
      color: '#fff',
    },
    inviteCodeDash: {
      fontSize: 22,
      fontWeight: '600',
      color: glass.textTertiary,
      flexShrink: 0,
    },

    // Overlays
    overlayBody: { paddingHorizontal: 16, paddingBottom: 40 },
    overlayHint: { fontSize: 12.5, color: glass.textSecondary, marginBottom: 12, marginHorizontal: 4 },
    addStop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      height: 56,
      paddingHorizontal: 14,
      marginTop: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: 'rgba(255,255,255,0.22)',
      backgroundColor: 'rgba(255,255,255,0.05)',
    },
    addStopIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addStopText: { fontSize: 16, fontWeight: '600' },

    dangerBtn: {
      height: 52,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 16,
      backgroundColor: 'rgba(255,107,107,0.1)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,107,107,0.3)',
    },
    dangerText: { fontSize: 16, fontWeight: '600', color: glass.danger },
    accountBtn: {
      height: 48,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 10,
      backgroundColor: accentMix(accent, 14),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accentMix(accent, 40),
    },
    accountBtnText: { fontSize: 15, fontWeight: '600' },
    settingsTopGroup: {
      marginBottom: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(255,255,255,0.08)',
    },
    settingsTopRow: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 4,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    settingsTopCopy: { flex: 1, gap: 3, minWidth: 0 },
    settingsTopTitle: { color: '#fff', fontSize: 16, fontWeight: '500' },
    settingsTopDescription: { color: glass.textTertiary, fontSize: 12.5 },
    reportButton: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      marginTop: 20,
      borderRadius: 16,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    reportButtonText: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '600' },
  };
  // applyAppTextScale / applyBoldTextWeights spread style objects; cast keeps
  // StyleSheet.create happy with the wide inferred defs shape.
  const scaled = applyAppTextScale(defs, textScale, EMOJI_STYLE_KEYS);
  return StyleSheet.create(
    applyBoldTextWeights(scaled, boldText, EMOJI_STYLE_KEYS) as any,
  );
};
