import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  AppState,
  LayoutAnimation,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
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
  FadeIn,
  FadeOut,
  ZoomIn,
  ZoomOut,
  LinearTransition,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import GroupMap, { type GroupMapHandle } from '../components/GroupMap';
import { PLACE_ALTITUDE, PLACE_ZOOM } from '../components/mapCameraMath';
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
import { HitherText } from '../components/HitherText';
import OverflowMarquee from '../components/OverflowMarquee';
import {
  deriveCardNavFlags,
  projectHistoryForViewer,
  resolveCompletePrompt,
  resolveNavCommand,
} from '../utils/gatherCommand';
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
import { canMarkDestinationArrival } from '../utils/arrivalMarking';
import { hasArrived } from '../utils/journeyProgress';
import { uploadLocalLogs } from '../utils/uploadLocalLogs';
import { useTranslation, type TranslationKey } from '../i18n';
import { useDeviceLocation } from './MapScreen/hooks/useDeviceLocation';
import { useCarouselSelection } from './MapScreen/hooks/useCarouselSelection';
import { useJourneyNavigation } from './MapScreen/hooks/useJourneyNavigation';
import { useMapKitRoutes } from './MapScreen/hooks/useMapKitRoutes';
import { startNavigationEnergyMonitor } from '../state/performance';
import { useGatherCardExpansion } from './MapScreen/hooks/useGatherCardExpansion';
import { SettingsOverlay } from './MapScreen/components/SettingsOverlay';
import { DiagnosticsOverlay } from './MapScreen/components/DiagnosticsOverlay';
import { ProfileOverlay } from './MapScreen/components/ProfileOverlay';
import { SubgroupSection } from './MapScreen/components/SubgroupSection';
import { Segmented } from './MapScreen/components/Segmented';
import AccountSheet from '../components/AccountSheet';
import { useGroupState } from '../state/useGroupState';
import { useNavigationSession } from '../state/useNavigationSession';
import { useStragglerAlerts } from '../state/useStragglerAlerts';
import { useSubgroupInvites } from '../state/useSubgroupInvites';
import { clearLiveActivities, useLiveActivity } from '../state/useLiveActivity';
import {
  startBackgroundJourney,
  stopBackgroundJourney,
} from '../state/backgroundJourney';
import { purgeLocationOutbox } from '../state/locationOutbox';
import { diagnostics } from '../state/diagnostics';
import {
  getLocationSharingEnabled,
  setLocationSharingEnabled,
} from '../api/services/NavigationService';
import {
  consumePendingLocationPermission,
  consumePendingLocationRefresh,
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
import { dotWindow } from '../utils/pagination';
import {
  alignMeetTimeToTripDay,
  clampDateNotBeforeToday,
  minutesUntil,
  startOfTodayLocal,
} from '../utils/meetTime';
import { locationFreshness } from '../utils/locationFreshness';
import {
  groupHistoryByDay,
  mergeHistoryWithPastStops,
  type HistoryDayGroup,
} from '../utils/history';
import {
  filterActiveDestinations,
  nextOrderedDestination,
  resolveAddDay,
} from '../utils/tripDay';
import { createArrivalState, reduceArrival, type ArrivalState } from '../utils/navigationArrival';
import { liquidGlass, location, notifications, type MapRegion, type PlaceResult } from '../native';
import {
  addDestination,
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
  setStragglerConfig,
  reportStraggler,
  leaveGroups,
  requestGroupLocationRefresh,
  resolveGatherPointRequestResilient,
  isNetworkRequestError,
  setDestinationArrival,
  setDestinationArrivalAt,
  submitGatherPointRequest,
  updateMyLocation,
  updateGroupTripDetails,
} from '../api/client';
import { supabase } from '../api/supabase';
import { captureScreen } from 'react-native-view-shot';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_STORAGE_KEY } from '../onboarding/sync';
import { isDemoGroup } from '../api/demo';
import { confirmAction } from '../utils/confirm';
import { logEvent, logError } from '../utils/activityLog';
import { lightTap, mediumTap, rigidTap, selectionTick, alertBuzz } from '../utils/haptics';
import { AVATAR_EMOJI, AVATAR_COLORS } from '../constants/avatars';
import type {
  Coordinates,
  Destination,
  DestinationArrival,
  GatherPointRequest,
  GatherPointRequestItem,
  MemberLocation,
  VisitedWaypoint,
} from '../types';
import type { KmlPlacemark } from '../utils/kml';
import { FREE_LIMITS } from '../entitlements';
import { radius, themes, THEME_ORDER, type ThemeName } from '../theme';
import { glass, accentMix, memberColor } from '../glass';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

// Auto-advance to the next gathering point once the leader is this close —
// separate from the server's 30 m arrival boundary.
const AUTO_ADVANCE_RADIUS_M = 50;
// Cap on gathering-point pagination dots shown at once (see utils/pagination.ts).
const DOTS_MAX_VISIBLE = 5;

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

/** Preset straggler-alert distance chips shown in settings. */
const STRAGGLER_THRESHOLD_OPTIONS = [300, 500, 1000, 2000];

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
function formatTripDayLine(dayNum: number, departureDate?: string | null): string {
  const day = Math.max(1, dayNum || 1);
  const dayPart = `第 ${day} 天`;
  if (!departureDate) return dayPart;
  const raw = departureDate.trim();
  const base = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(base.getTime())) return dayPart;
  base.setDate(base.getDate() + (day - 1));
  const datePart = `${base.getMonth() + 1}月${base.getDate()}號`;
  return `${dayPart} · ${datePart}`;
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
    setMeetRedMin,
    setHighAccuracy,
    setSharingEnabled,
    setArrivalRadiusM,
  } = usePreferences();
  const { isCardExpanded, toggleCard, registerCardActivity } =
    useGatherCardExpansion(gatherCardDefaultExpanded);
  const { colors } = useTheme();
  const accent = colors.accent;
  const { t, language } = useTranslation();
  // Live Dynamic Type layout — rebuilds when system fontScale changes.
  // a11y-layout:commandRow — always ONE row; density (size/labels) tracks
  // font bucket + physical width, never multi-row stacking.
  // a11y-layout:narrowScreen — iPhone 15 / mini (~375) denser chrome.
  const fontLayout = useFontLayout();
  const fontBucket = fontLayout.bucket;
  // ≤390 ≈ iPhone 15 / mini / SE; slightly denser chrome so fixed command
  // controls don't clip past the card edge on small physical widths.
  const narrowScreen = windowWidth < 400;
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

  const { state, loading, refresh } = useGroupState(groupId, {
    myUserId: user?.id ?? null,
    highAccuracy,
  });
  const navigationSessionState = useNavigationSession(groupId);
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

  const mapRef = useRef<GroupMapHandle | null>(null);
  const carouselRef = useRef<ScrollView | null>(null);

  const members = useMemo(() => state?.members ?? [], [state?.members]);
  // My current scope: undefined = main group's itinerary, a subgroup id =
  // that subgroup's own itinerary. Everything itinerary-related below reads
  // only from this scope's list (carousel, reorder, nav target, meet-time,
  // straggler nav target) — filtering once here means nothing downstream
  // needs its own leader/subgroup branching to stay scoped correctly.

  const me = useMemo(() => members.find((m) => m.userId === user?.id), [members, user?.id]);
  const myScopeId = me?.subgroupId;
  
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
    if (isLeader) return all;
    if (myScopeId) {
      return all.filter((d) => d.subgroupId === myScopeId);
    }
    return all.filter((d) => d.subgroupId == null);
  }, [state?.destinations, isLeader, myScopeId]);
  
  const [optimisticDestinations, setOptimisticDestinations] = useState<Destination[] | null>(null);
  const allScopedDestinations = optimisticDestinations ?? rawDestinations;
  const [destinationArrivals, setDestinationArrivals] = useState<DestinationArrival[]>([]);
  /** Dest ids where leader chose「先不要完成」after arriving — still shows「完成此行程」. */
  const [pendingCompleteDestIds, setPendingCompleteDestIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [gatherPointRequests, setGatherPointRequests] = useState<GatherPointRequest[]>([]);
  const [resolvingGatherRequestId, setResolvingGatherRequestId] = useState<string | null>(null);
  const optimisticTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const workflowReloadRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [optimisticTripDays, setOptimisticTripDays] = useState<number | null>(null);
  const [optimisticDepartureDate, setOptimisticDepartureDate] = useState<string | null>(null);
  const myCompletedDestinationIds = useMemo(
    () => new Set(
      destinationArrivals
        .filter((arrival) => arrival.userId === user?.id)
        .map((arrival) => arrival.destinationId),
    ),
    [destinationArrivals, user?.id],
  );
  // Open stops on today + future trip days (local device date). Past days
  // leave the carousel / reorder list and surface in 歷史行程 instead.
  const destinations = useMemo(
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
  const canEditItinerary = !!isLeader;

  /** Pull destinations/group state only — used before arrival writes too. */
  const syncFromDatabase = useCallback(async () => {
    setOptimisticDestinations(null);
    setOptimisticTripDays(null);
    setOptimisticDepartureDate(null);
    if (!(await refresh())) {
      throw new Error(t('map.syncDbFailedMsg'));
    }
  }, [refresh, t]);

  /**
   * Reorder-list "同步資料庫": refresh itinerary only (business data).
   * Opt-in diagnostic Log batch is owned by logBatchScheduler, not this control.
   */
  const syncFromDatabaseAndUploadLogs = useCallback(async () => {
    await syncFromDatabase();
    let logResult: Awaited<ReturnType<typeof uploadLocalLogs>> | null = null;
    try {
      // No-op when consent is off; never multi-round drain.
      logResult = await uploadLocalLogs({ source: 'destination_reorder_sync' });
    } catch {
      logResult = null;
    }
    if (!logResult) {
      Alert.alert(t('map.syncDbOkTitle'), t('map.syncDbOkLogsFailed'));
      return;
    }
    const logsFailed =
      logResult.diagnosticRemaining < 0 || logResult.performanceRemaining < 0;
    if (logsFailed) {
      Alert.alert(t('map.syncDbOkTitle'), t('map.syncDbOkLogsFailed'));
      return;
    }
    const totalSent = logResult.diagnosticSent + logResult.performanceSent;
    const totalRemaining =
      logResult.diagnosticRemaining + logResult.performanceRemaining;
    if (totalSent === 0 && totalRemaining === 0) {
      Alert.alert(t('map.syncDbOkTitle'), t('map.syncDbOkNoLogs'));
      return;
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
      return;
    }
    Alert.alert(
      t('map.syncDbOkTitle'),
      t('map.syncDbOkFull', { sent: String(totalSent) }),
    );
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
      .channel(`gathering-workflow:${groupId}`)
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
  const [sheetHeaderH, setSheetHeaderH] = useState(78);
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
  /** Mid/Full sheet body: 成員 · 路線 · 工具. */
  const [sheetPane, setSheetPane] = useState<'members' | 'route' | 'tools'>('members');
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
    | 'myStatus'
    | 'arrivalManage'
    | 'arrival'
    | 'diagnostics'
  >(null);
  const [arrivalDestination, setArrivalDestination] = useState<Destination | null>(null);
  /** Draft selection in the my-status sheet; committed only via Done. */
  const [draftMyStatus, setDraftMyStatus] = useState<'follow' | 'solo' | 'away' | null>(null);
  const [statusApplying, setStatusApplying] = useState(false);
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
    // Same events, role-projected: members own rows; leaders see team rows.
    const projected = projectHistoryForViewer(items, {
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
  // A place picked in search, awaiting the bottom "add / cancel" confirm card.
  const [pendingPlace, setPendingPlace] = useState<PlaceResult | null>(null);
  // Editable only during this add confirmation. There is no later rename
  // action, so the persisted itinerary title stays stable after creation.
  const [pendingPlaceTitle, setPendingPlaceTitle] = useState('');
  // Two-phase flow: pendingPlace is set immediately when a place is picked
  // (so the search sheet can close and the bottom sheet collapses to peek).
  // confirmCardReady flips true instantly — then the bounce-up
  // card appears and the search bar / recenter capsule hide.
  const [confirmCardReady, setConfirmCardReady] = useState(false);
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
    opacity: interpolate(confirmCardAnim.value, [0, 0.4], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(confirmCardAnim.value, [0, 1], [120, 0], Extrapolation.CLAMP) }],
  }));
  /** Dismiss the confirm card (used by both Cancel and Add buttons). */
  function dismissConfirmCard() {
    setConfirmCardReady(false);
    setPendingPlace(null);
    setPendingPlaceTitle('');
  }
  const [paywallTrigger, setPaywallTrigger] = useState<TranslationKey | undefined>(undefined);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const openPaywall = useCallback((trigger?: TranslationKey) => {
    setPaywallTrigger(trigger);
    setPaywallVisible(true);
  }, []);

  // --- Meet-time countdown + editor (date + time; red threshold shared via DB)
  const [meetTimeEditor, setMeetTimeEditor] = useState<{
    id: string;
    value: Date;
    redMin: number;
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
      setMeetTimeEditor({ id: dest.id, value: initial, redMin: red });
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
        setMeetTimeEditor((s) => (s ? { ...s, value: clamped } : s));
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
              return { ...s, value: clampDateNotBeforeToday(merged) };
            });
          },
        });
      },
    });
  }, [meetTimeEditor]);
  // Freeze the route overlay's scroll while a stop is being drag-reordered so
  // the two vertical gestures never fight.
  const [routeScrollEnabled, setRouteScrollEnabled] = useState(true);

  // --- Device GPS ----------------------------------------------------------
  const {
    deviceCoords,
    deviceAccuracyM,
    appState,
    refreshDeviceLocation,
    consumeForegroundSample,
  } = useDeviceLocation({
    groupId,
    highAccuracy,
    nativeMapLocationEnabled: Platform.OS === 'ios',
  });

  // --- Carousel selection ---------------------------------------------------
  const {
    selectedIndex,
    setSelectedIndex,
    travelMode,
    setTravelMode,
    selectedDestination,
    handleMomentumEnd,
  } = useCarouselSelection({
    destinations,
    windowWidth,
    carouselRef,
    mapRef,
  });

  const reference = useMemo<MemberLocation | undefined>(
    () =>
      members.find((m) => m.userId === user?.id) ??
      members.find((m) => m.role === 'leader') ??
      members[0],
    [members, user?.id],
  );
  const fromCoords = deviceCoords ?? reference?.coordinates;

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
    localTargetId,
    pendingLeaderTargetId,
    activePoint,
    numericDistance,
    journeyBusy,
    openExternalNavigation,
    startNavigation,
    stopNavigation,
    startLocalRoutePlan,
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
    // Prefer live session. Only fall back to legacy journey_status while the
    // first fetch is still in flight (undefined), so a cold-start member still
    // enters flock nav as soon as the active session row is available.
    navigationSession: navigationSessionState.loading
      && !navigationSessionState.session
      ? undefined
      : navigationSessionState.session,
    startSession: navigationSessionState.start,
    cancelSession: navigationSessionState.cancel,
    // handleReorder is defined later; keep a stable bridge via ref.
    reorderForNavigation: (updates) => reorderForNavigationRef.current(updates),
    travelMode,
  });

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

  const handleSharingEnabledChange = async (enabled: boolean) => {
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
    } catch (error) {
      await diagnostics.write({
        event: 'diagnostic_error',
        errorCode: 'privacy_sync_failed',
        success: false,
      }).catch(() => undefined);
      // Enabling must fail closed if the server-side ingestion gate could not sync.
      if (enabled) setSharingEnabled(false);
      Alert.alert(t('settings.locationSharingSyncFailed'));
    }
  };

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

  const { selfRoute, memberRoutes } = useMapKitRoutes({
    selfCoordinates: fromCoords,
    members,
    gathering: activePoint,
    travelMode,
    highAccuracy,
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
  const [autoArrivedDestId, setAutoArrivedDestId] = useState<string | null>(null);
  const [arrivalCelebrateDestId, setArrivalCelebrateDestId] = useState<string | null>(null);

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
    // Product: tools radius is the geofence (e.g. 300 m) — not only distance 0.
    const insideRadius = hasArrived(straightM, localArrivalRadiusM);
    const previous = foregroundArrivalRef.current?.key === key
      ? foregroundArrivalRef.current.state
      : createArrivalState(straightM);
    const next = reduceArrival(
      previous,
      {
        distanceM: straightM,
        accuracyM: deviceAccuracyM,
      },
      { radiusM: localArrivalRadiusM },
    );
    // Prefer the product threshold; still keep reducer for ACK telemetry.
    const arrivedNow = insideRadius || next.status === 'arrived';
    foregroundArrivalRef.current = {
      key,
      state: arrivedNow
        ? {
            ...next,
            status: 'arrived',
            progress: 1,
            consecutiveFixes: Math.max(1, next.consecutiveFixes),
            lastDistanceM: straightM,
          }
        : next,
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
        // Do not block user-facing arrival state on Supabase latency. The
        // RPC below only reconciles the shared record and can be retried.
        afterPersonalArrivalRef.current(navTarget, {
          stopNav: true,
          promptComplete: true,
        });
        void setDestinationArrival(navTarget.id, user.id, true)
          .then(() => {
            patchLocalArrival(navTarget.id, user.id, true);
            void loadGatheringWorkflow();
          })
          .catch(() => {
            // Keep the local arrival UI; retry the shared write on a later fix.
            autoArrivalMarkedRef.current = null;
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

  // Journey progress baseline (foreground only) — separate from GPS ownership.
  useEffect(() => {
    if (!journeyActive || !groupId || !navTarget) {
      initialJourneyRef.current = null;
      lastRouteDistanceRef.current = undefined;
      departedStartRef.current = false;
      setInitialDistanceM(undefined);
      setDistanceSource(undefined);
      setProgressDepartedStart(false);
      return;
    }

    const key = `${groupId}:${navTarget.id}:${state?.group.journeyStartedAt ?? ''}`;
    // Never baseline progress from peer/stale pins — only real device GPS.
    if (!deviceCoords) return;

    const routeDistanceM = selfRoute?.distanceMeters;
    if (routeDistanceM != null && Number.isFinite(routeDistanceM)) {
      lastRouteDistanceRef.current = routeDistanceM;
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
    }
  }, [
    deviceAccuracyM,
    deviceCoords,
    groupId,
    journeyActive,
    navTarget,
    selfRoute?.distanceMeters,
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
      void stopBackgroundJourney();
      return;
    }

    // Foreground owns GPS.
    if (appState === 'active') {
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
      navigationSessionId: navigationSessionState.session?.id ?? null,
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
      teamNavigationActive: Boolean(
        navigationSessionState.session || (journeyActive && navTarget),
      ),
      appState: appState === 'background' ? 'background' : 'inactive',
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
    deviceCoords,
    groupId,
    highAccuracy,
    journeyActive,
    navTarget,
    navigationSessionState.session,
    sharingEnabled,
    showLocationPermissionAlert,
    travelMode,
  ]);

  useEffect(() => () => void stopBackgroundJourney(), []);

  // Low-overhead energy samples while navigating in the foreground (no full API tracing).
  useEffect(() => {
    if (!journeyActive || appState !== 'active') return;
    const trackingMode = navigationSessionState.session
      ? highAccuracy
        ? 'navigationMax'
        : 'teamNavigation'
      : highAccuracy
        ? 'manualHighAccuracy'
        : 'foreground';
    return startNavigationEnergyMonitor({
      navigationSessionId: navigationSessionState.session?.id ?? null,
      trackingMode,
    });
  }, [
    appState,
    groupId,
    highAccuracy,
    journeyActive,
    navigationSessionState.session,
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
  // UI toggle is source of truth while dirty; DB only persists the setting.
  const [stragglerOverride, setStragglerOverride] = useState<{
    alerts: boolean;
    thresholdM: number;
  } | null>(null);
  useEffect(() => {
    if (!group || !stragglerOverride) return;
    if (
      group.stragglerAlerts === stragglerOverride.alerts &&
      group.stragglerThresholdM === stragglerOverride.thresholdM
    ) {
      setStragglerOverride(null);
    }
  }, [group?.stragglerAlerts, group?.stragglerThresholdM, stragglerOverride]);
  const effectiveStragglerAlerts =
    stragglerOverride?.alerts ?? group?.stragglerAlerts ?? true;
  const effectiveStragglerThresholdM =
    stragglerOverride?.thresholdM ?? group?.stragglerThresholdM ?? 500;
  const { stragglers } = useStragglerAlerts(state, fromCoords ?? undefined, {
    enabled: !!isLeader,
    leaderUserId: user?.id,
    alertsEnabled: effectiveStragglerAlerts,
    thresholdM: effectiveStragglerThresholdM,
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
        // Soft-fail: network blip should not crash the map; next entry after
        // release band will re-report.
      });
    }
  }, [stragglers, isLeader, groupId]);

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
  // Start the lock-screen Live Update as soon as navigation is active. GPS
  // baseline hydration can lag behind the session start; a route/straight-line
  // distance is sufficient for the initial Android notification and is
  // replaced by the locked baseline on the next render.
  const liveActivityBaselineM = initialDistanceM ?? liveDistance ?? numericDistance;
  useLiveActivity(journeyActive && !localNavigationArrived && liveActivityEnabled, {
    groupName: membership?.group.name ?? '',
    navigationSessionId: navigationSessionState.session?.id,
    status: navigationSessionState.session ? 'active' : undefined,
    gatheringTitle: navTarget?.title,
    distanceMeters: liveDistance,
    etaSeconds:
      selfRoute?.expectedTravelTimeSeconds ??
      (liveDistance != null ? etaSecondsFor(liveDistance, travelMode) : undefined),
    gatheringCoordinates: navTarget?.coordinates,
    progress: liveProgress,
    gatheredCount: liveGathered,
    memberCount: members.length,
    accentHex: accent,
    travelMode,
    memberEmojis: members.map((m) => m.avatar ?? ''),
    memberArrived: members.map((m) => m.status === 'arrived'),
  }, groupId && navTarget && liveActivityBaselineM != null ? {
    groupId,
    navigationSessionId: navigationSessionState.session?.id,
    destinationId: navTarget.id,
    initialDistanceM: Math.max(1, liveActivityBaselineM),
    travelMode,
  } : undefined, liveActivityEnabled);



  const locateMe = useCallback(() => {
    const go = (coords: NonNullable<typeof deviceCoords>) => {
      // Settings toggle: flat top-down vs 45° oblique (Apple-Maps-style).
      if (obliqueLocate) mapRef.current?.focusOblique(coords);
      else mapRef.current?.centerOn(coords);
    };
    // Instant feedback from last known fix — don't wait on GPS / network.
    if (deviceCoords) go(deviceCoords);
    // Background: refine GPS + soft re-center; group refresh is non-blocking.
    void (async () => {
      const fresh = await refreshDeviceLocation().catch(() => null);
      if (fresh) go(fresh);
      else if (!deviceCoords) return;
      void refresh();
    })();
  }, [refresh, refreshDeviceLocation, deviceCoords, obliqueLocate]);

  const [refreshingLocations, setRefreshingLocations] = useState(false);
  const [refreshCooldownUntil, setRefreshCooldownUntil] = useState(0);

  const handleLocationRefreshRequest = useCallback(async (refreshGroupId = groupId) => {
    if (!refreshGroupId) return;
    const permission = await location.getPermissionState().catch(() => null);
    if (!permission || permission.foregroundStatus !== 'granted') {
      if (permission?.foregroundCanAskAgain !== false) {
        const granted = await location.requestPermission();
        if (granted) return handleLocationRefreshRequest(refreshGroupId);
      }
      showLocationPermissionAlert();
      return;
    }

    const fix = await location.getCurrentLocation(false).catch(() => null);
    if (!fix) {
      showLocationPermissionAlert();
      return;
    }
    // A manual refresh must surface a failed self update; otherwise the UI can
    // falsely report the old timestamp as if the tap had worked.
    await updateMyLocation(fix.coordinates, refreshGroupId);
    await refresh();
  }, [groupId, refresh, showLocationPermissionAlert]);

  useEffect(() => {
    const remove = notifications.addForegroundListener((data) => {
      if (data.category !== 'location_refresh') return;
      void handleLocationRefreshRequest(
        typeof data.groupId === 'string' ? data.groupId : groupId,
      ).catch((error) => Alert.alert(
        t('map.setFailedTitle'),
        error instanceof Error ? error.message : t('map.setFailedMsg'),
      ));
    });
    return remove;
  }, [groupId, handleLocationRefreshRequest]);

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
          '需要背景定位',
          '全天群組定位與鎖定螢幕導航需要「永遠」取用位置。請在設定允許後，鎖定螢幕仍可省電更新位置。',
        );
      }
    });
    void consumePendingLocationRefresh(groupId).then((pendingGroupId) => {
      if (pendingGroupId && pendingGroupId === groupId) {
        void handleLocationRefreshRequest(pendingGroupId).catch(() => undefined);
      }
    });
  }, [
    appState,
    groupId,
    handleLocationRefreshRequest,
    showLocationPermissionAlert,
  ]);

  const refreshAllLocations = useCallback(async () => {
    if (!groupId || refreshingLocations) return;
    setRefreshingLocations(true);
    try {
      if (isDemoGroup(groupId)) {
        await handleLocationRefreshRequest(groupId);
        return;
      }

      // Always refresh the initiator immediately. The server cooldown only
      // governs the fan-out request to peers.
      await handleLocationRefreshRequest(groupId);
      const result = await requestGroupLocationRefresh(groupId);
      const retryAfter = Math.max(0, result.retryAfterSeconds);
      setRefreshCooldownUntil(Date.now() + retryAfter * 1000);
      if (result.accepted) {
        await refresh();
        Alert.alert(t('map.refreshLocationsAccepted'));
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
  }, [groupId, handleLocationRefreshRequest, refreshingLocations, t]);

  const fitAllMembers = useCallback(() => {
    mapRef.current?.fitToMembers();
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

  const closeSearch = useCallback(() => setSearchVisible(false), []);

  // Followers submit durable, actionable requests instead of plain-text commands.
  const notifyLeaderPlace = useCallback(
    async (items: GatherPointRequestItem[], source: 'search' | 'kml') => {
      if (!groupId) return;
      const label = items.length === 1 ? items[0].title : `${items.length} 個地點`;
      try {
        await submitGatherPointRequest(groupId, myScopeId, items);
        logEvent('destination_suggest', { source, label });
        Alert.alert(t('gatherRequest.sentTitle'), t('gatherRequest.sentBody'));
      } catch (e) {
        logError('destination_suggest_failed', e, { source });
        Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
      }
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
      setPendingPlace(place);
      setPendingPlaceTitle(place.name);
      // Wider than locate-me so the new pin has neighborhood context, not street-close.
      mapRef.current?.centerOn(place.coordinates, {
        zoom: PLACE_ZOOM,
        altitude: PLACE_ALTITUDE,
      });
    },
    [canEditItinerary, notifyLeaderPlace, tripDayForAdd],
  );

  const handlePickDestination = useCallback(async (place: PlaceResult) => {
    if (!groupId) return;
    const addDay = tripDayForAdd();
    if (!canEditItinerary) {
      await notifyLeaderPlace([{
        title: place.name,
        address: place.address,
        coordinates: place.coordinates,
        day: addDay,
      }], 'search');
      return;
    }
    if (!isPro && allScopedDestinations.length >= FREE_LIMITS.destinationsPerItinerary) {
      openPaywall('paywall.triggerDestinations');
      return;
    }
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
      logEvent('destination_add', { source: 'search', day: addDay });
      setSelectedIndex(destinations.length);
      mapRef.current?.centerOn(place.coordinates, {
        zoom: PLACE_ZOOM,
        altitude: PLACE_ALTITUDE,
      });
      await refresh();
    } catch (e) {
      logError('destination_add_failed', e, { source: 'search' });
      Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
    }
  }, [
    groupId,
    canEditItinerary,
    notifyLeaderPlace,
    isPro,
    destinations.length,
    allScopedDestinations.length,
    myScopeId,
    refresh,
    openPaywall,
    t,
    tripDayForAdd,
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
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await addDestination(
        groupId,
        {
          title: item.name,
          coordinates: { latitude: item.latitude, longitude: item.longitude },
          day: addDay,
        },
        myScopeId,
      );
      onProgress(i + 1);
    }
    logEvent('kml_import', { count: items.length, day: addDay });
    await refresh();
  }, [groupId, canEditItinerary, notifyLeaderPlace, myScopeId, refresh, tripDayForAdd]);

  const openCoordinateSheet = useCallback((coords?: { latitude: number; longitude: number }) => {
    setCoordSheetInitial(coords);
    setCoordSheetVisible(true);
  }, []);

  const handleLongPressCoordinate = useCallback(
    (coordinates: { latitude: number; longitude: number }) => {
      mediumTap();
      openCoordinateSheet(coordinates);
    },
    [openCoordinateSheet],
  );

  const handleCoordinateDestination = useCallback(
    async (input: CoordinateDestinationInput) => {
      if (!groupId) return;
      const addDay = tripDayForAdd();
      if (!canEditItinerary) {
        await notifyLeaderPlace([{
          title: input.title,
          coordinates: input.coordinates,
          day: addDay,
        }], 'search');
        return;
      }
      if (!isPro && allScopedDestinations.length >= FREE_LIMITS.destinationsPerItinerary) {
        openPaywall('paywall.triggerDestinations');
        return;
      }
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
        logEvent('destination_add', { source: 'coordinates', day: addDay });
        setSelectedIndex(destinations.length);
        mapRef.current?.centerOn(input.coordinates, {
          zoom: PLACE_ZOOM,
          altitude: PLACE_ALTITUDE,
        });
        await refresh();
      } catch (e) {
        logError('destination_add_failed', e, { source: 'coordinates' });
        Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
        throw e;
      }
    },
    [
      groupId,
      canEditItinerary,
      notifyLeaderPlace,
      isPro,
      allScopedDestinations.length,
      destinations.length,
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
      // Restore pending list from server if the RPC truly failed.
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
  }, [groupId, loadGatheringWorkflow, refresh, resolvingGatherRequestId, t]);

  const runCompleteGatheringStop = useCallback(async (destination: Destination) => {
    if (!groupId) return;
    try {
      await completeGatheringStop(groupId, destination.id);
      setPendingCompleteDestIds((prev) => {
        if (!prev.has(destination.id)) return prev;
        const next = new Set(prev);
        next.delete(destination.id);
        return next;
      });
      await stopNavigation();
      await refresh();
      await loadGatheringWorkflow();
    } catch (error) {
      Alert.alert(
        t('map.setFailedTitle'),
        error instanceof Error ? error.message : t('map.setFailedMsg'),
      );
    }
  }, [groupId, loadGatheringWorkflow, refresh, stopNavigation, t]);

  const promptCompleteAfterArrival = useCallback((destination: Destination) => {
    const arrivedIds = new Set(
      destinationArrivals
        .filter((a) => a.destinationId === destination.id)
        .map((a) => a.userId),
    );
    // Self just marked arrived — include them even if workflow not yet reloaded.
    if (user?.id) arrivedIds.add(user.id);
    const missingMemberNames = members
      .filter((m) => !arrivedIds.has(m.userId))
      .map((m) => m.name || t('group.travelerFallback'));
    const stopAlreadyComplete = !!destination.closedAt
      || allScopedDestinations.find((d) => d.id === destination.id)?.closedAt != null;
    const prompt = resolveCompletePrompt({
      isLeader,
      missingMemberNames,
      allArrived: missingMemberNames.length === 0,
      stopAlreadyComplete: !!stopAlreadyComplete,
    });
    if (prompt.kind === 'none') return;

    const buttons: Array<{ text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }> = [
      {
        text: prompt.confirmLabel,
        onPress: () => {
          // Leader RPC only — members already have arrival/history; just refresh.
          if (prompt.kind === 'member_leader_already_done') {
            void refresh();
            void loadGatheringWorkflow();
            return;
          }
          void runCompleteGatheringStop(destination);
        },
      },
    ];
    if (prompt.deferLabel) {
      buttons.push({
        text: prompt.deferLabel,
        onPress: () => {
          setPendingCompleteDestIds((prev) => {
            const next = new Set(prev);
            next.add(destination.id);
            return next;
          });
        },
      });
    }
    buttons.push({ text: t('common.cancel'), style: 'cancel' });
    Alert.alert(prompt.title, prompt.message, buttons);
  }, [
    allScopedDestinations,
    destinationArrivals,
    isLeader,
    loadGatheringWorkflow,
    members,
    refresh,
    runCompleteGatheringStop,
    t,
    user?.id,
  ]);

  // Shared arrive feedback: center check animation (1.6s) + haptic; complete
  // prompt after animation + 1s. Leader skips the plain 「已抵達」Alert.
  // Permanent arrived state is the arrival button style only (no badge).
  afterPersonalArrivalRef.current = (destination, opts) => {
    const alreadyShown = arrivalFeedbackShownRef.current === destination.id;
    if (!alreadyShown) {
      arrivalFeedbackShownRef.current = destination.id;
      setArrivalCelebrateDestId(destination.id);
      alertBuzz();
      setTimeout(() => {
        setArrivalCelebrateDestId((cur) => (cur === destination.id ? null : cur));
      }, 1_600);
    }
    if (opts?.stopNav) void stopNavigation();

    const COMPLETE_PROMPT_DELAY_MS = 1_600 + 1_000;
    if (opts?.promptComplete && isLeader) {
      setTimeout(() => {
        promptCompleteAfterArrival(destination);
      }, alreadyShown ? 0 : COMPLETE_PROMPT_DELAY_MS);
      return;
    }

    if (!alreadyShown) {
      const fallback =
        language === 'en'
          ? `You have arrived at "${destination.title}"`
          : `你已經抵達集合點「${destination.title}」`;
      const raw = t('map.arriveBody', { title: destination.title });
      const body = !raw || raw === 'map.arriveBody' || raw.includes('map.arriveBody')
        ? fallback
        : raw;
      // After center animation so it does not stack with the check overlay.
      setTimeout(() => {
        Alert.alert(t('map.arriveTitle'), body);
      }, 1_600);
    }
    if (opts?.promptComplete && !isLeader) {
      setTimeout(() => {
        promptCompleteAfterArrival(destination);
      }, alreadyShown ? 0 : COMPLETE_PROMPT_DELAY_MS);
    }
  };

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
          if (!arrived && targetUserId === user?.id) {
            setPendingCompleteDestIds((prev) => {
              if (!prev.has(destination.id)) return prev;
              const next = new Set(prev);
              next.delete(destination.id);
              return next;
            });
            setAutoArrivedDestId((cur) => (cur === destination.id ? null : cur));
            if (autoArrivalMarkedRef.current === destination.id) {
              autoArrivalMarkedRef.current = null;
            }
            if (arrivalFeedbackShownRef.current === destination.id) {
              arrivalFeedbackShownRef.current = null;
            }
          }
          await syncFromDatabase();
          await setDestinationArrival(destination.id, targetUserId, arrived);
          patchLocalArrival(destination.id, targetUserId, arrived);
          await loadGatheringWorkflow();
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
      try {
        await syncFromDatabase();
        await setDestinationArrivalAt(destination.id, targetUserId, true, arrivedAt);
        // Optimistic N/M progress before network reload finishes.
        patchLocalArrival(destination.id, targetUserId, true, arrivedAt);
        await loadGatheringWorkflow();
        afterPersonalArrivalRef.current(destination, {
          stopNav: navTarget?.id === destination.id,
          promptComplete: true,
        });
      } catch (error) {
        Alert.alert(
          t('arrival.failedTitle'),
          arrivalErrorMessage(error, t),
        );
      }
    })();
  }, [
    loadGatheringWorkflow,
    navTarget?.id,
    patchLocalArrival,
    syncFromDatabase,
    t,
  ]);

  const handleSelfArrival = useCallback((destination: Destination, targetUserId: string) => {
    const leaderArrival = destinationArrivals.find((arrival) => (
      arrival.destinationId === destination.id
      && members.some((member) => member.userId === arrival.userId && member.role === 'leader')
    ));
    const buttons: Array<{ text: string; onPress?: () => void; style?: 'cancel' }> = [];
    if (leaderArrival) {
      buttons.push({
        text: t('arrival.timeLeader'),
        onPress: () => submitArrivalWithTimestamp(destination, targetUserId, leaderArrival.arrivedAt),
      });
    }
    buttons.push(
      {
        text: t('arrival.timeNow'),
        onPress: () => submitArrivalWithTimestamp(destination, targetUserId, new Date().toISOString()),
      },
      {
        text: t('arrival.timeAutomatic'),
        onPress: () => submitArrivalWithTimestamp(destination, targetUserId, null),
      },
      { text: t('common.cancel'), style: 'cancel' },
    );
    Alert.alert(t('arrival.timeTitle'), destination.title, buttons);
  }, [destinationArrivals, members, submitArrivalWithTimestamp, t]);

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
  const copyCode = useCallback(async () => {
    if (!group) return;
    lightTap();
    logEvent('code_copy');
    await Clipboard.setStringAsync(group.inviteCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }, [group]);
  const shareCode = useCallback(async () => {
    if (!group) return;
    lightTap();
    logEvent('code_share');
    await Share.share({ message: t('map.shareMsg', { code: group.inviteCode }) });
  }, [group, t]);

  // --- Profile (nickname + emoji avatar) — avatar button only --------------
  const openProfile = useCallback(() => {
    lightTap();
    setOverlay('profile');
  }, []);

  const switchGroup = useCallback(() => {
    lightTap();
    navigation.navigate('MyTeams');
  }, [navigation]);

  /** RoleSelect create/join home — keep membership so user is not forced to leave. */
  const goHomeCreateOrJoin = useCallback(() => {
    lightTap();
    logEvent('settings_go_home_create_or_join');
    navigation.navigate('RoleSelect');
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
  const openFeedback = useCallback(async () => {
    lightTap();
    let uri: string | null = null;
    try {
      uri = await captureScreen({ format: 'jpg', quality: 0.6, result: 'tmpfile' });
    } catch {
      uri = null;
    }
    setFeedbackShot(uri);
    setOverlay('feedback');
  }, []);

  const handleReorder = useCallback(
    async (updates: { id: string; position: number; day: number }[]): Promise<boolean> => {
      if (!groupId) return false;
      logEvent('destination_reorder', { count: updates.length });

      const departureDate = group?.departureDate;
      // Closed stops are intentionally absent from the editor, but their
      // original position slots remain reserved so editing open stops cannot
      // move anything across a historical closure or create duplicate slots.
      const openPositionSlots = [...destinations]
        .sort((a, b) => a.order - b.order)
        .map((destination) => destination.order);
      const persistedUpdates: {
        id: string;
        position: number;
        day: number;
        meetAt?: string;
      }[] = updates.map((update, index) => {
        const original = rawDestinations.find((dest) => dest.id === update.id);
        const position = openPositionSlots[index] ?? update.position;
        if (!departureDate || !original?.meetAt || (original.day || 1) === update.day) {
          return { ...update, position };
        }
        const alignedMeetAt = alignMeetTimeToTripDay(
          new Date(original.meetAt),
          departureDate,
          update.day,
        );
        return { ...update, position, meetAt: alignedMeetAt.toISOString() };
      });
      const newDests = rawDestinations.map(d => ({ ...d }));
      persistedUpdates.forEach(u => {
         const dest = newDests.find(d => d.id === u.id);
         if (dest) {
            dest.order = u.position;
            dest.day = u.day;
            if (u.meetAt !== undefined) dest.meetAt = u.meetAt;
         }
      });
      newDests.sort((a, b) => {
         if ((a.day || 1) !== (b.day || 1)) return (a.day || 1) - (b.day || 1);
         return a.order - b.order;
      });
      setOptimisticDestinations(newDests);
      
      if (optimisticTimeoutRef.current) clearTimeout(optimisticTimeoutRef.current);
      optimisticTimeoutRef.current = setTimeout(() => {
        setOptimisticDestinations(null);
      }, 3000);

      try {
        await reorderDestinations(groupId, persistedUpdates);
        refresh();
        return true;
      } catch (e) {
        logError('destination_reorder_failed', e);
        Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
        setOptimisticDestinations(null);
        refresh();
        return false;
      }
    },
    [
      groupId,
      t,
      refresh,
      rawDestinations,
      destinations,
      group?.departureDate,
    ],
  );
  reorderForNavigationRef.current = handleReorder;
  const handleDelete = useCallback(
    (id: string) => {
      if (!groupId || !canEditItinerary) return;
      const target = destinations.find((d) => d.id === id);
      confirmAction(
        {
          title: t('settings.deleteTitle'),
          message: t('settings.deleteMsg', { title: target?.title ?? '' }),
          confirmLabel: t('settings.deleteConfirm'),
          destructive: true,
        },
        async () => {
          logEvent('destination_delete', { id });
          try {
            await deleteDestination(groupId, id);
            await refresh();
          } catch (e) {
            logError('destination_delete_failed', e, { id });
            Alert.alert(t('settings.deleteFailed'));
            await refresh();
          }
        },
      );
    },
    [canEditItinerary, groupId, destinations, refresh, t],
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
        logEvent('group_leave', { groupId, isLeader });
        void (async () => {
          if (groupId) {
            await leaveGroups([groupId]).catch(() => undefined);
            await clearLiveActivities({ groupIds: [groupId] });
          } else {
            await clearLiveActivities();
          }
          leaveGroup();
          navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
        })();
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
        logEvent('sign_out');
        void signOut();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
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
    await AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY);
    Alert.alert(t('settings.resetAllPrefs'), t('settings.resetPrefsDone'));
  }, [t]);

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

  // Optimistic flip for the straggler-alert switch — the server round trip +
  // realtime refetch otherwise reads as a 1-2s lag. Cleared once server truth
  // (group.stragglerAlerts) matches, in the effect below.
  useEffect(() => {
    if (group && group.tripDays === optimisticTripDays && group.departureDate === optimisticDepartureDate) {
      setOptimisticTripDays(null);
      setOptimisticDepartureDate(null);
    }
  }, [group?.tripDays, group?.departureDate, optimisticTripDays, optimisticDepartureDate]);

  const handleUpdateTripDetails = useCallback(async (days: number, date: string) => {
    if (groupId) {
       // Departure picker enforces ≥ today for new choices. Existing past
       // departures can be re-saved unchanged so in-progress trips don't jump.
       setOptimisticTripDays(days);
       setOptimisticDepartureDate(date);
       try {
         await updateGroupTripDetails(groupId, days, date);
         const meetUpdates = rawDestinations
           .filter((destination) => destination.meetAt)
           .map((destination) => {
             const alignedMeetAt = alignMeetTimeToTripDay(
               new Date(destination.meetAt as string),
               date,
               destination.day || 1,
             );
             return {
               id: destination.id,
               position: destination.order,
               day: destination.day || 1,
               meetAt: alignedMeetAt.toISOString(),
             };
           });
         if (meetUpdates.length > 0) {
           await reorderDestinations(groupId, meetUpdates);
         }
         refresh();
       } catch(e) {
         setOptimisticTripDays(null);
         setOptimisticDepartureDate(null);
         Alert.alert('更新失敗', e instanceof Error ? e.message : String(e));
       }
    }
  }, [groupId, rawDestinations, refresh]);
  // Persist group setting only — not the live distance loop. UI stays optimistic;
  // never call refresh() here (realtime would also thrash the toggle).
  const persistStragglerConfig = useCallback(async (enabled: boolean, thresholdM: number) => {
    if (!groupId) return;
    try {
      await setStragglerConfig(groupId, enabled, thresholdM);
    } catch (e) {
      Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
      throw e;
    }
  }, [groupId, t]);

  const handleStragglerLocalChange = useCallback(
    (config: { alerts: boolean; thresholdM: number } | null) => {
      setStragglerOverride(config);
    },
    [],
  );

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
          solo,
          subgroupId: m.subgroupId,
          // Prefer the member's chosen avatar background colour; fall back to the
          // deterministic per-user colour when they haven't picked one.
          color: (isSelf && user?.avatarColor) || m.avatarColor || memberColor(m.userId),
          isLeader: isMemberLeader,
          arrived,
          lastUpdated: m.lastUpdated,
          // Color grade: secondary by default; green only arrived; warn only solo/straggler-like.
          statusColor: solo
            ? glass.warn
            : arrived
              ? glass.ok
              : glass.textSecondary,
          // "—" for my own row (distance to myself is meaningless); everyone
          // else shows how far they are from me.
          eta: displayedEta != null ? shortEta(displayedEta) : '',
          dist: displayedDistance != null ? formatDistance(displayedDistance) : isSelf ? t('flock.you') : '',
        };
      }),
    [members, activePoint, t, user?.id, user?.name, user?.avatar, user?.avatarColor, soloOverride, memberRoutes, travelMode],
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

  /**
   * My presence relative to the flock (UI + API mapping):
   * - follow: solo=false and on main group itinerary
   * - solo:   solo=true — still in structure, mute group pushes
   * - away:   in a personal/subgroup split — main gather cards hidden
   * Priority when both solo + subgroup: show solo (notifications muted is primary).
   */
  type MyStatusKind = 'follow' | 'solo' | 'away';
  const myStatusKind: MyStatusKind = mySoloActive
    ? 'solo'
    : mySubgroupId
      ? 'away'
      : 'follow';

  const myStatusLabel =
    myStatusKind === 'solo'
      ? t('solo.switch')
      : myStatusKind === 'away'
        ? t('solo.tempLeave')
        : t('solo.followTeam');

  const openMyStatusPicker = useCallback(() => {
    lightTap();
    setDraftMyStatus(myStatusKind);
    setOverlay('myStatus');
  }, [myStatusKind]);

  const closeMyStatusPicker = useCallback(() => {
    setOverlay(null);
    setDraftMyStatus(null);
    setStatusApplying(false);
  }, []);

  /**
   * Commit a status change. Returns true if the sheet may close (no-op or success).
   * Returns false if the user cancelled a confirm dialog or an RPC failed — keep
   * the draft sheet open.
   */
  const applyMyStatus = useCallback(
    async (next: MyStatusKind): Promise<boolean> => {
      if (next === myStatusKind) return true;
      lightTap();
      try {
        if (next === 'follow') {
          // Full participation: clear solo, return to main itinerary if split away.
          if (mySoloActive) {
            if (!(await toggleSolo(false))) return false;
          }
          if (mySubgroupId) {
            if (!(await doSelfMerge())) return false;
          }
        } else if (next === 'solo') {
          // Soft step-away: stay where you are, mute group commands/pushes.
          if (!mySoloActive) {
            if (!(await toggleSolo(true))) return false;
          }
        } else {
          // 暫時離隊: leave main itinerary (self-split). Clear solo so status reads as "away".
          if (mySoloActive) {
            if (!(await toggleSolo(false))) return false;
          }
          if (!mySubgroupId) {
            if (!(await doSelfSplit())) return false;
          }
        }
        return true;
      } catch {
        // Errors already alerted inside toggle / split / merge helpers.
        return false;
      }
    },
    [myStatusKind, mySoloActive, mySubgroupId, toggleSolo, doSelfMerge, doSelfSplit],
  );

  const commitMyStatus = useCallback(async () => {
    if (statusApplying) return;
    const next = draftMyStatus ?? myStatusKind;
    setStatusApplying(true);
    try {
      const ok = await applyMyStatus(next);
      if (ok) closeMyStatusPicker();
    } finally {
      setStatusApplying(false);
    }
  }, [statusApplying, draftMyStatus, myStatusKind, applyMyStatus, closeMyStatusPicker]);

  const openGroupMenu = useCallback(() => {
    lightTap();
    // ⋯ next to avatar: home / settings / leave — invite lives in Members only.
    const run = (action: 'home' | 'settings' | 'end') => {
      if (action === 'home') goHomeCreateOrJoin();
      else if (action === 'settings') setOverlay('settings');
      else confirmLeave();
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t('map.groupMenu'),
          options: [
            t('map.backToHome'),
            t('map.overlaySettings'),
            t('group.leave'),
            t('common.cancel'),
          ],
          cancelButtonIndex: 3,
          destructiveButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) run('home');
          else if (idx === 1) run('settings');
          else if (idx === 2) run('end');
        },
      );
    } else {
      Alert.alert(t('map.groupMenu'), undefined, [
        { text: t('map.backToHome'), onPress: () => run('home') },
        { text: t('map.overlaySettings'), onPress: () => run('settings') },
        { text: t('group.leave'), style: 'destructive', onPress: () => run('end') },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
    }
  }, [t, confirmLeave, goHomeCreateOrJoin]);

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

  // One flock row, shared by the main list and the subgroup cards.
  // Display: name + "角色 · 距離/狀態 · 最後更新". Solo is NOT on the card.
  const renderFlockRow = useCallback((f: (typeof flock)[number], last: boolean, index?: number) => {
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
        isMe={f.userId === user?.id}
        last={last}
        styles={styles}
        t={t}
        onSelfMerge={doSelfMerge}
        onSelfSplit={doSelfSplit}
      />
    );
  }, [user?.id, t, doSelfMerge, doSelfSplit, styles]);

  // Floating chrome rides just above the sheet's live top edge; its baseline
  // follows the sheet's animated gap to the screen bottom. At full the map
  // chrome (group pill, role chip, recenter) fades away and stops catching
  // touches; leaving full brings it back.
  const chromeOpacityStyle = useAnimatedStyle(() => ({
    opacity: interpolate(heightSV.value, [detents[1], detents[2]], [1, 0], Extrapolation.CLAMP),
  }));
  const recenterStyle = useAnimatedStyle(() => ({
    bottom: heightSV.value + sheetBottomOffset(heightSV.value, detents, insets.bottom) + 12,
    opacity: interpolate(heightSV.value, [detents[1], detents[2]], [1, 0], Extrapolation.CLAMP),
  }));
  const atFull = detent === detents.length - 1;
  // Peek (stage 1): cards may grow into the capsule band (cards paint above
  // capsules; sheet still paints above cards). Cap height so cards don't
  // swallow the whole map between safe top and the peek sheet.
  // a11y-layout:carouselCapsuleClearance
  const CAPSULE_CLEARANCE = fontLayout.s(24, 16);
  const carouselMaxHeight = Math.max(
    fontLayout.s(140, 120),
    windowHeight - detents[0] - CAPSULE_CLEARANCE - (insets.top + 8) - 8,
  );

  // Camera insets: midpoint of the strip between gathering-point cards (top)
  // and the settled sheet (bottom). Used by locate-me / fit-all so pins land
  // in the unobstructed band rather than geometric screen center.
  const sheetH = detents[detent] ?? detents[0];
  const bottomPad = sheetH + sheetBottomOffset(sheetH, detents, insets.bottom);
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
       - ⋯ → group menu (home / settings / leave)
       - Avatar → personal account only
       - Search → place search only
    */
    const actions = (
      <>
        {!pendingPlace ? (
          <Pressable
            style={styles.headerIconBtn}
            onPress={() => setSearchVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={t('map.searchA11y')}
          >
            <Ionicons name="search" size={20} color="#fff" />
          </Pressable>
        ) : (
          <View style={styles.headerIconBtn} />
        )}
        <Pressable
          style={styles.headerIconBtn}
          onPress={openGroupMenu}
          accessibilityRole="button"
          accessibilityLabel={t('map.groupMenu')}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
        </Pressable>
        <Pressable
          style={[styles.headerAvatar, { backgroundColor: user?.avatarColor ?? accent }]}
          onPress={openProfile}
          accessibilityRole="button"
          accessibilityLabel={t('profile.title')}
        >
          {user?.avatar ? (
            <HitherText typeRole="emoji" style={styles.headerAvatarEmoji}>{user.avatar}</HitherText>
          ) : (
            <Text style={styles.headerAvatarText}>
              {(user?.name ?? '?').slice(0, 1).toUpperCase()}
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
                {f.avatar ? (
                  <HitherText typeRole="emoji" style={styles.peekStackEmoji}>{f.avatar}</HitherText>
                ) : (
                  <Text style={styles.peekStackInitial}>{f.name.slice(0, 1).toUpperCase()}</Text>
                )}
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
    styles, t, pendingPlace, user, accent, openProfile, openGroupMenu, flock,
  ]);

  const closeOverlay = useCallback(() => setOverlay(null), []);
  const openHistoryOverlay = useCallback(() => setOverlay('history'), []);
  const openAccountOverlay = useCallback(() => setOverlay('account'), []);
  const openCustomQuickCommand = useCallback((slot = 0) => {
    setCustomSlot(typeof slot === 'number' ? slot : 0);
    setOverlay('custom');
  }, []);
  const openPaywallCb = useCallback(() => openPaywall(), [openPaywall]);

  const selectSheetPane = useCallback((key: 'members' | 'route' | 'tools') => {
    if (key === sheetPane) return;
    // Pill slide is handled by Segmented (same as 脫隊示警); no LayoutAnimation.
    setSheetPane(key);
  }, [sheetPane]);

  // ─── 成員：位置、狀態、個別操作、小隊（無「成員」標題） ────────────────
  const membersPaneBody = useMemo(() => (
    <>
      {/* My status + refresh on one row (stage 1+ body) */}
      <View style={styles.myStatusBar}>
        <Pressable
          style={styles.myStatusRow}
          onPress={openMyStatusPicker}
          accessibilityRole="button"
          accessibilityLabel={t('solo.statusTitle')}
        >
          <Text style={styles.myStatusText} numberOfLines={1}>
            {t('solo.statusCurrent', { status: myStatusLabel })}
          </Text>
          <Ionicons name="chevron-down" size={14} color={glass.textSecondary} />
        </Pressable>
        <RefreshLocationsButton
          refreshing={refreshingLocations}
          cooldownUntil={refreshCooldownUntil}
          accent={accent}
          styles={styles}
          t={t}
          onPress={refreshAllLocations}
        />
      </View>
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
        <Switch
          style={styles.accuracySwitch}
          value={highAccuracy}
          onValueChange={setHighAccuracy}
          trackColor={{ true: accent, false: 'rgba(120,120,128,0.32)' }}
          thumbColor="#fff"
          ios_backgroundColor="rgba(120,120,128,0.32)"
          accessibilityLabel={t('settings.preciseLocation')}
        />
      </View>
    </>
  ), [
    t, styles, refreshingLocations, refreshAllLocations, refreshCooldownUntil, accent, highAccuracy,
    setHighAccuracy, pendingInvites, fontBucket, handleAcceptInvite, handleDeclineInvite,
    subgroups, topFlockMemo, renderFlockRow, flock, mySubgroupId, sentInvites,
    openMyStatusPicker, myStatusLabel,
  ]);

  // ─── 路線：集合點、排序、Google Maps 匯入、歷史 ───────────────────────
  const routePaneBody = useMemo(() => (
    <>
      <Text style={[styles.sheetHeading, styles.sheetHeadingFirst]}>{t('map.gatheringPoints')}</Text>
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
      {/* 導航入口 = 普通 List Row，無圖示色塊 */}
      <View style={styles.listGroup}>
        <Pressable style={styles.listRow} onPress={() => { lightTap(); setOverlay('route'); }} accessibilityRole="button">
          <Text style={styles.listRowTitle}>
            {t('map.stopsReorder', { count: destinations.length })}
          </Text>
          <Text style={styles.listRowTrailing}>{t('map.edit')}</Text>
          <Ionicons name="chevron-forward" size={16} color={glass.textTertiary} />
        </Pressable>
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
          onPress={() => {
            lightTap();
            openCoordinateSheet(undefined);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('coord.manualEntry')}
        >
          <Text style={styles.listRowTitle}>{t('coord.manualEntry')}</Text>
          <Ionicons name="locate-outline" size={16} color={glass.textTertiary} />
        </Pressable>
        <Pressable style={styles.listRow} onPress={() => { lightTap(); setKmlVisible(true); }} accessibilityRole="button">
          <Text style={styles.listRowTitle}>
            {canEditItinerary ? t('kml.entry') : '匯入並請求隊長同意'}
          </Text>
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
    t, styles, nextStopTitle, nextStopDistLabel, destinations.length, canEditItinerary,
    openHistoryOverlay, isLeader, openCoordinateSheet,
  ]);

  // ─── 工具：抵達距離、快捷指令、脫隊示警（設定改走頭像旁 ⋯ 選單）──────
  const toolsPaneBody = useMemo(() => (
    <>
      <Text style={[styles.sheetHeading, styles.sheetHeadingFirst]}>
        {t('arrival.radiusSection')}
      </Text>
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

      {isLeader && group && groupId ? (
        <>
          <Text style={styles.sheetHeading}>{t('straggler.section')}</Text>
          <StragglerConfigSection
            groupAlerts={group.stragglerAlerts}
            groupThreshold={group.stragglerThresholdM}
            accent={accent}
            isPro={isPro}
            openPaywall={openPaywall}
            onPersist={persistStragglerConfig}
            onLocalChange={handleStragglerLocalChange}
            styles={styles}
            t={t}
          />
        </>
      ) : null}
    </>
  ), [
    styles, t, groupId, isLeader, dark, openCustomQuickCommand, group, accent, isPro,
    openPaywall, persistStragglerConfig, handleStragglerLocalChange,
    arrivalRadiusM, setArrivalRadiusM,
  ]);

  const sheetPaneOptions = useMemo(
    () => [
      { key: 'members', label: t('map.tabMembers') },
      { key: 'route', label: t('map.tabRoute') },
      { key: 'tools', label: t('map.tabTools') },
    ],
    [t],
  );

  const sheetChildren = useMemo(() => (
    <>
      {/* Same sliding-pill animation as 脫隊示警 Segmented */}
      <View style={styles.sheetPaneToggleWrap}>
        <Segmented
          accent={accent}
          options={sheetPaneOptions}
          value={sheetPane}
          onChange={selectSheetPane as (key: string) => void}
        />
      </View>

      <View
        style={sheetPane === 'members' ? undefined : styles.sheetPaneHidden}
        pointerEvents={sheetPane === 'members' ? 'auto' : 'none'}
        collapsable={false}
      >
        {membersPaneBody}
      </View>
      <View
        style={sheetPane === 'route' ? undefined : styles.sheetPaneHidden}
        pointerEvents={sheetPane === 'route' ? 'auto' : 'none'}
        collapsable={false}
      >
        {routePaneBody}
      </View>
      <View
        style={sheetPane === 'tools' ? undefined : styles.sheetPaneHidden}
        pointerEvents={sheetPane === 'tools' ? 'auto' : 'none'}
        collapsable={false}
      >
        {toolsPaneBody}
      </View>
    </>
  ), [
    styles, accent, sheetPane, sheetPaneOptions, selectSheetPane, membersPaneBody, routePaneBody, toolsPaneBody,
  ]);

  if (loading && !state) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={accent} size="large" />
        <Text style={styles.loadingText}>{t('map.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <GroupMap
        ref={mapRef}
        members={members}
        gathering={activePoint}
        destinations={destinations}
        pendingPlace={pendingPlace}
        currentUserId={user?.id}
        initialCenter={fromCoords}
        // Show the planned path for everyone while journey is live (leader
        // broadcast or local follower plan). When paused, keep a light path
        // to the selected card so ETA still makes sense.
        routePoints={selfRoute?.points}
        routeColor={accent}
        // Settled detent only (not heightSV) so we don't re-render the map
        // mid-drag; top tracks measured carousel card height.
        topOverlap={topPad}
        bottomOverlap={bottomPad}
        onUserLocationSample={
          Platform.OS === 'ios' ? consumeForegroundSample : undefined
        }
        onLongPressCoordinate={handleLongPressCoordinate}
      />

      {/* Group pill — moved to bottom left, tracking sheet like recenter capsule. */}
      {!confirmCardReady && (
      <Animated.View
        style={[styles.teamCapsuleWrap, recenterStyle]}
        pointerEvents={atFull ? 'none' : 'box-none'}
      >
        <View style={{ alignItems: 'flex-start' }}>
          <Pressable 
            style={{ zIndex: 2 }}
            onPress={() => {
              if (myScopeId) {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
                setViewingScope(prev => prev === 'sub' ? 'main' : 'sub');
              }
            }}
          >
            <liquidGlass.GlassView 
              tintColor={glass.pill} 
              style={styles.groupPill}
            >
              <View style={styles.pillAvatars}>
                {(() => {
                  const visibleMembers = viewingScope === 'main' || !myScopeId ? flock : flock.filter(f => f.subgroupId === myScopeId);
                  return visibleMembers.slice(0, 3).map((f, i) => (
                    <View
                      key={f.userId}
                      style={[styles.pillAvatar, { backgroundColor: f.color, marginLeft: i ? -10 : 0 }]}
                    >
                      {f.avatar ? (
                        <HitherText typeRole="emoji" style={styles.pillEmoji}>{f.avatar}</HitherText>
                      ) : null}
                    </View>
                  ));
                })()}
              </View>
              <Text style={styles.pillName} numberOfLines={1}>
                {myScopeId 
                  ? (viewingScope === 'main' ? (group?.name ?? 'Hither') : '小隊')
                  : (group?.name ?? 'Hither')}
              </Text>
              {/* large+: drop secondary count so the name can ellipsis cleanly */}
              {fontBucket === 'regular' ? (
                <Text style={styles.pillCount}>· {viewingScope === 'main' || !myScopeId ? members.length : flock.filter(f => f.subgroupId === myScopeId).length}</Text>
              ) : null}
            </liquidGlass.GlassView>
          </Pressable>
        </View>
      </Animated.View>
      )}


      {/* Recenter capsule — fit-all (top) + locate-me (bottom), always both. */}
      {!confirmCardReady && (
      <Animated.View
        style={[styles.recenter, recenterStyle]}
        pointerEvents={atFull ? 'none' : 'auto'}
      >
        <View style={styles.recenterCapsule}>
          <liquidGlass.GlassView
            tintColor={glass.pill}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Pressable
            style={styles.recenterHit}
            onPress={() => {
              lightTap();
              fitAllMembers();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('map.fitAllA11y')}
          >
            <Ionicons name="expand-outline" size={19} color="#fff" />
          </Pressable>
          <View style={styles.recenterDivider} />
          <Pressable
            style={styles.recenterHit}
            onPress={() => {
              lightTap();
              locateMe();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('map.locateA11y')}
          >
            <Ionicons name="navigate" size={19} color="#fff" />
          </Pressable>
        </View>
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
        return (
          // Sits above the hidden sheet; centred vertically near the bottom.
          <Animated.View
            style={[styles.confirmCard, { bottom: insets.bottom + 24 }, confirmCardStyle]}
            pointerEvents="box-none"
          >
            <liquidGlass.GlassView tintColor={glass.cardActive} style={styles.confirmCardInner}>
              <View style={styles.confirmTopRow}>
                <View style={styles.confirmTextCol}>
                  <Text style={styles.confirmKicker} numberOfLines={1}>
                    {t('confirmGather.going', { name: '' })}
                  </Text>
                  <TextInput
                    value={pendingPlaceTitle}
                    onChangeText={setPendingPlaceTitle}
                    style={styles.confirmTitleInput}
                    numberOfLines={1}
                    maxLength={120}
                    placeholder={pendingPlace.name}
                    placeholderTextColor={glass.textTertiary}
                    accessibilityLabel={t('confirmGather.going', { name: pendingPlace.name })}
                  />
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
                <Pressable
                  style={({ pressed }) => [
                    styles.confirmArrow,
                    { backgroundColor: accentMix(accent, 18) },
                    pressed && { opacity: 0.8 }
                  ]}
                  onPress={() => mapRef.current?.focusOblique(pendingPlace.coordinates)}
                >
                  <Ionicons name="navigate" size={28} color={accent} />
                </Pressable>
              </View>
              <View style={styles.confirmBtnRow}>
                <Pressable
                  style={({ pressed }) => [styles.confirmCancel, pressed && { opacity: 0.85 }]}
                  onPress={() => {
                    selectionTick();
                    dismissConfirmCard();
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.confirmCancelText}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.confirmAdd,
                    { backgroundColor: accent },
                    pressed && { opacity: 0.9 },
                  ]}
                  onPress={() => {
                    const place = {
                      ...pendingPlace,
                      name: pendingPlaceTitle.trim() || pendingPlace.name,
                    };
                    dismissConfirmCard();
                    void handlePickDestination(place);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.confirmAddText}>{t('confirmGather.add')}</Text>
                </Pressable>
              </View>
            </liquidGlass.GlassView>
          </Animated.View>
        );
      })()}

      {/* Gathering-point carousel — above locate/group capsules; sheet wrapper
          zIndex is higher so the sheet covers cards on overlap. */}
      {destinations.length > 0 && (
        <Animated.View
          // a11y-layout:carouselCapsuleClearance
          style={[
            styles.carouselWrap,
            { top: insets.top + 8, maxHeight: carouselMaxHeight },
            chromeOpacityStyle,
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
            onMomentumScrollEnd={handleMomentumEnd}
            scrollEventThrottle={16}
          >
            {destinations.map((dest, index) => {
              const active = index === selectedIndex;
              const routeForDestination = activePoint?.id === dest.id ? selfRoute : null;
              const d = routeForDestination?.distanceMeters
                ?? (fromCoords ? distanceMeters(fromCoords, dest.coordinates) : null);
              // Shared flock vs member local plan — must not use journeyActive
              // (true for localTargetId too) or 路徑規劃 becomes 導航中.
              const { flockNavigatingThis, localRouteThis } = deriveCardNavFlags({
                destId: dest.id,
                isLeader,
                sharedTargetId,
                localTargetId,
                pendingLeaderTargetId,
                journeyBusy,
              });
              // Live countdown UI is MeetCountdown (own 1s timer). a11y uses
              // a one-shot label on each parent render — no MapScreen clock.
              const meetLabel = dest.meetAt
                ? (() => {
                    const mins = minutesUntil(dest.meetAt as string, new Date());
                    return mins >= 0
                      ? t('meetTime.countdown', { minutes: mins })
                      : t('meetTime.overdue', { minutes: Math.abs(mins) });
                  })()
                : null;
              // Team arrival toward THIS stop — how many of the flock are
              // already within the arrival radius. Drives the top hairline and
              // the "隊伍抵達進度" caption (design 1b).
              const arrivedHere = new Set(
                destinationArrivals
                  .filter((arrival) => arrival.destinationId === dest.id)
                  .map((arrival) => arrival.userId),
              ).size;
              const totalMembers = members.length;
              const arrivalPct = totalMembers
                ? Math.round((arrivedHere / totalMembers) * 100)
                : 0;
              const modeIconName =
                travelMode === 'walk'
                  ? 'walk-outline'
                  : travelMode === 'drive'
                    ? 'car-outline'
                    : 'bus-outline';
              // Route ETA/distance — always visible; expand only scales layout.
              const etaSeconds = routeForDestination
                ? routeForDestination.expectedTravelTimeSeconds
                : d != null
                  ? etaSecondsFor(d, travelMode)
                  : null;
              const etaLabel = etaSeconds != null ? shortEta(etaSeconds) : '—';
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
              // On tight density, drop nav label so meet countdown + mode stay
              // square-floor sized in one row (especially when Maps appears).
              const navIconOnly = chromeTight;
              // Use active itinerary (carousel list), not raw history-inclusive
              // scope — past-day open rows must not hide the arrive control.
              const canMarkArrival = canMarkDestinationArrival({
                destId: dest.id,
                destOrder: dest.order,
                destSubgroupId: dest.subgroupId,
                scopedDestinations: destinations,
                myArrivedDestinationIds: myCompletedDestinationIds,
              });
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
                localRouteThis,
                pendingComplete: pendingCompleteDestIds.has(dest.id),
              });
              return (
                <View
                  key={`carousel-dest-${dest.id}-${index}`}
                  style={{ width: windowWidth, paddingHorizontal: narrowScreen ? 10 : 14 }}
                >
                  <GatheringCardPressable
                    onToggle={() => toggleCard(dest.id)}
                    accessibilityLabel={dest.title}
                    accessibilityHint={cardExpanded ? '收合集合點卡片' : '展開集合點卡片'}
                  >
                      <liquidGlass.GlassView
                        tintColor={active ? glass.cardActive : glass.card}
                        style={[
                          styles.card,
                          // Active state uses fill only — no theme-color rim
                          // (Android hairline + accent reads as a harsh outline).
                          active ? styles.cardActiveBorder : null,
                        ]}
                      >
                    {(personallyArrived || arrivalCelebrateDestId === dest.id) ? (
                      <View pointerEvents="none" style={styles.arrivalDimOverlay} />
                    ) : null}
                    {arrivalCelebrateDestId === dest.id ? (
                      <Animated.View
                        pointerEvents="none"
                        entering={FadeIn.duration(280)}
                        exiting={FadeOut.duration(320)}
                        style={styles.arrivalCenterCheckLayer}
                      >
                        <Animated.View
                          entering={ZoomIn.duration(360).springify().damping(14)}
                          exiting={ZoomOut.duration(280)}
                          style={[
                            styles.arrivalCenterCheckBox,
                            cardExpanded
                              ? styles.arrivalCenterCheckBoxExpanded
                              : styles.arrivalCenterCheckBoxCollapsed,
                          ]}
                        >
                          <Ionicons
                            name="checkmark"
                            size={cardExpanded ? 36 : 22}
                            color={glass.ok}
                          />
                        </Animated.View>
                      </Animated.View>
                    ) : null}
                    {/* Top arrival hairline — team progress toward this stop. */}
                    {cardExpanded ? (
                      <View style={styles.arrivalHairline}>
                        <View
                          style={[
                            styles.arrivalHairlineFill,
                            { width: `${arrivalPct}%`, backgroundColor: accent },
                          ]}
                        />
                      </View>
                    ) : null}
                    {/* Layout (expanded):
                        kicker · dots
                        title full-width
                        day line ····· people N/M
                        小隊行程 badge (subgroup only)
                        📍 dist | 🚗 eta | map
                        [導航] [移動] [抵達?] [集合倒數]
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
                            <Animated.View
                              style={styles.dots}
                              layout={LinearTransition.duration(160)}
                            >
                              {dotWindow(destinations.length, selectedIndex, DOTS_MAX_VISIBLE).map(
                                (i2) => (
                                  <Animated.View
                                    key={`dot-${destinations[i2]?.id || i2}-${i2}`}
                                    entering={FadeIn.duration(160)}
                                    exiting={FadeOut.duration(160)}
                                    layout={LinearTransition.springify()
                                      .damping(28)
                                      .stiffness(240)
                                      .mass(0.85)}
                                    style={[styles.dot, i2 === selectedIndex && styles.dotActive]}
                                  />
                                ),
                              )}
                            </Animated.View>
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
                                )}
                              </Text>
                              <Pressable
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

                    {/* a11y-layout:commandRow — always one row.
                        Maps lives in the metrics row when expanded.
                        Density tracks narrow + Dynamic Type. */}
                    {cardExpanded && (
                    <View style={styles.commandRow}>
                      {navCmd.kind !== 'hidden' ? (
                        <Pressable
                          style={[
                            styles.navBtn,
                            navCmd.kind === 'member_waiting_complete'
                              ? styles.navBtnWide
                              : navIconOnly
                                ? styles.navBtnIconOnly
                                : null,
                            navCmd.kind === 'leader_stop' || navCmd.kind === 'member_close_plan'
                              ? styles.navBtnEnd
                              : navCmd.kind === 'member_navigating' || navCmd.kind === 'member_waiting_complete'
                                ? styles.navBtnDisabled
                                : navCmd.kind === 'leader_mark_complete'
                                  ? { backgroundColor: glass.ok }
                                  : { backgroundColor: accent },
                          ]}
                          onPress={(event) => {
                            event.stopPropagation();
                            registerCardActivity(dest.id);
                            mediumTap();
                            if (navCmd.action === 'stop_nav' || navCmd.action === 'close_plan') {
                              void stopNavigation();
                            } else if (navCmd.action === 'start_nav') {
                              startNavigation(dest, index);
                            } else if (navCmd.action === 'start_plan') {
                              startLocalRoutePlan(dest, index);
                            } else if (navCmd.action === 'mark_complete') {
                              promptCompleteAfterArrival(dest);
                            }
                          }}
                          disabled={journeyBusy || navCmd.disabled}
                          accessibilityRole="button"
                          accessibilityLabel={
                            navCmd.kind === 'leader_mark_complete'
                              ? '完成此行程'
                              : navCmd.kind === 'member_plan'
                                ? '路徑規劃'
                                : navCmd.kind === 'member_close_plan'
                                  ? '關閉路線圖'
                                  : navCmd.label
                          }
                          accessibilityState={{ disabled: journeyBusy || navCmd.disabled }}
                        >
                          <Ionicons
                            name={
                              navCmd.kind === 'leader_stop' || navCmd.kind === 'member_close_plan'
                                ? 'stop'
                                : navCmd.kind === 'leader_mark_complete'
                                  ? 'checkmark-done'
                                  : navCmd.kind === 'member_waiting_complete'
                                    ? 'hourglass-outline'
                                    : navCmd.kind === 'member_navigating'
                                      ? 'navigate'
                                      : isLeader
                                        ? 'play'
                                        : 'navigate'
                            }
                            size={chromeCompact ? 16 : 15}
                            color={
                              navCmd.kind === 'leader_stop' || navCmd.kind === 'member_close_plan'
                                ? glass.danger
                                : navCmd.kind === 'member_navigating' || navCmd.kind === 'member_waiting_complete'
                                  ? glass.textSecondary
                                  : navCmd.kind === 'leader_mark_complete'
                                    ? '#0c1a12'
                                    : '#0c1a12'
                            }
                          />
                          {navCmd.kind === 'member_waiting_complete' || !navIconOnly ? (
                            <Text
                              style={[
                                styles.navBtnText,
                                {
                                  color:
                                    navCmd.kind === 'leader_stop' || navCmd.kind === 'member_close_plan'
                                      ? glass.danger
                                      : navCmd.kind === 'member_navigating' || navCmd.kind === 'member_waiting_complete'
                                        ? glass.textSecondary
                                        : '#0c1a12',
                                  flexShrink: 1,
                                },
                              ]}
                              numberOfLines={navCmd.kind === 'member_waiting_complete' ? 2 : 1}
                              ellipsizeMode="tail"
                              adjustsFontSizeToFit
                              minimumFontScale={0.75}
                            >
                              {navCmd.label}
                            </Text>
                          ) : null}
                        </Pressable>
                      ) : null}

                      <Pressable
                        style={styles.cmdSquare}
                        onPress={(event) => {
                          event.stopPropagation();
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

                      {/* Personal check-in (arrive ≠ complete). Always visible
                          for open stops when sequential rules allow marking. */}
                      {user?.id && canMarkArrival ? personallyArrived ? (
                        <Pressable
                          style={[
                            styles.cmdSquare,
                            styles.arrivalCmdSquare,
                            styles.arrivalCmdArrived,
                          ]}
                          onPress={(event) => {
                            event.stopPropagation();
                            registerCardActivity(dest.id);
                            lightTap();
                            handleArrival(dest, user.id, false);
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
                          style={[
                            styles.cmdSquare,
                            styles.arrivalCmdSquare,
                          ]}
                          onPress={(event) => {
                            event.stopPropagation();
                            registerCardActivity(dest.id);
                            lightTap();
                            handleSelfArrival(dest, user.id);
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
                      ) : null}

                      <Pressable
                        style={styles.meetBtn}
                        onPress={(event) => {
                          event.stopPropagation();
                          registerCardActivity(dest.id);
                          openMeetTimePicker(dest);
                        }}
                        disabled={!canEditItinerary}
                        accessibilityRole="button"
                        accessibilityLabel={
                          meetLabel
                            ? `${t('meetTime.set')} ${meetLabel}`
                            : t('meetTime.set')
                        }
                      >
                        <View style={styles.meetBtnStack}>
                          <View style={styles.meetBtnTimeRow}>
                            <Ionicons
                              name="time-outline"
                              size={chromeTight ? 14 : chromeCompact ? 15 : 16}
                              color={meetLabel ? accent : glass.textSecondary}
                            />
                            {dest.meetAt ? (
                              <MeetCountdown
                                meetAtIso={dest.meetAt as string}
                                redWithinMin={
                                  dest.meetRedMinutes ?? meetRedMin ?? DEFAULT_MEET_RED_MIN
                                }
                                redColor={glass.danger}
                                variant="minutes"
                                formatMinutes={(minutes) =>
                                  t('map.meetMinutes', { minutes })
                                }
                                adjustsFontSizeToFit
                                minimumFontScale={0.7}
                                baseStyle={[
                                  chromeTight
                                    ? styles.meetBtnLabelTight
                                    : chromeCompact
                                      ? styles.meetBtnLabelCompact
                                      : styles.meetBtnLabel,
                                  { color: accent },
                                ]}
                              />
                            ) : (
                              <Text
                                style={
                                  chromeTight
                                    ? styles.meetBtnLabelTight
                                    : chromeCompact
                                      ? styles.meetBtnLabelCompact
                                      : styles.meetBtnLabel
                                }
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
                            {t('map.meetCountdown')}
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                    )}
                      </liquidGlass.GlassView>
                  </GatheringCardPressable>
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
          cannot win against a sibling with higher zIndex. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.sheetLayer,
          confirmCardReady && styles.sheetHidden,
        ]}
        pointerEvents={confirmCardReady ? 'none' : 'box-none'}
      >
      <BottomSheet
        height={heightSV}
        detents={detents}
        index={detent}
        onIndexChange={setDetent}
        bottomInset={insets.bottom}
        onHeaderHeight={(h) => {
          // Ignore 1–2px jitter so detents don't thrash and reverse mid-spring.
          setSheetHeaderH((prev) => (Math.abs(prev - h) > 2 ? h : prev));
        }}
        header={sheetHeader}
      >
        {sheetChildren}
      </BottomSheet>
      </Animated.View>

      {/* Route overlay: reorder gathering points. */}
      <OverlaySheet
        visible={overlay === 'route'}
        onClose={() => setOverlay(null)}
        title={t('map.gatheringPoints')}
        accent={accent}
        doneLabel={t('map.done')}
      >
        <ScrollView
          contentContainerStyle={styles.overlayBody}
          scrollEnabled={routeScrollEnabled}
        >
          <Text style={styles.overlayHint}>{t('map.routeHint')}</Text>
          {isLeader && gatherPointRequests.length > 0 ? (
            <View style={styles.listGroup}>
              <Text style={styles.sectionLabel}>{t('gatherRequest.pending')}</Text>
              {gatherPointRequests.map((request) => (
                <View key={request.id} style={styles.flockRow}>
                  <View style={styles.grow}>
                    <Text style={styles.flockName}>
                      {members.find((member) => member.userId === request.requesterId)?.name ?? '隊員'}
                    </Text>
                    <Text style={styles.overlayHint}>
                      {t('gatherRequest.target', {
                        team: request.subgroupId
                          ? subgroups.find((item) => item.id === request.subgroupId)?.name
                            ?? t('gatherRequest.unknownTeam')
                          : t('gatherRequest.mainTeam'),
                      })}
                    </Text>
                    <Text style={styles.overlayHint}>
                      {request.items.map((item) => item.title).join('、')}
                    </Text>
                  </View>
                  <Pressable
                    style={[styles.chip, resolvingGatherRequestId ? { opacity: 0.5 } : null]}
                    onPress={() => void handleGatherPointRequest(request.id, false)}
                    disabled={!!resolvingGatherRequestId}
                    accessibilityRole="button"
                  >
                    <Text style={styles.chipText}>{t('gatherRequest.reject')}</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.chip,
                      { backgroundColor: accentMix(accent, 24) },
                      resolvingGatherRequestId ? { opacity: 0.5 } : null,
                    ]}
                    onPress={() => void handleGatherPointRequest(request.id, true)}
                    disabled={!!resolvingGatherRequestId}
                    accessibilityRole="button"
                  >
                    <Text style={styles.chipText}>{t('gatherRequest.approve')}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          <DestinationReorderList
            groupId={groupId ?? undefined}
            destinations={destinations}
            canReorder={canEditItinerary}
            tripDays={optimisticTripDays ?? group?.tripDays}
            departureDate={optimisticDepartureDate ?? group?.departureDate}
            onUpdateTripDetails={handleUpdateTripDetails}
            onReorder={handleReorder}
            onDelete={canEditItinerary ? handleDelete : undefined}
            onSync={syncFromDatabaseAndUploadLogs}
            colors={dark}
            emptyLabel={t('settings.noDestinations')}
            onDragActiveChange={(active) => setRouteScrollEnabled(!active)}
          />
        </ScrollView>
      </OverlaySheet>

      <SettingsOverlay
        visible={overlay === 'settings'}
        onClose={closeOverlay}
        isLeader={isLeader}
        onArchiveAllForTest={archiveAllForTest}
        onOpenFeedback={openFeedback}
        onConfirmResetPrefs={confirmResetPrefs}
        onConfirmLeave={confirmLeave}
        onConfirmSignOut={confirmSignOut}
        onOpenPaywall={openPaywallCb}
        onOpenAccount={openAccountOverlay}
        onOpenCustomQuickCommand={openCustomQuickCommand}
        onSharingEnabledChange={(enabled) => {
          void handleSharingEnabledChange(enabled);
        }}
        onOpenDiagnostics={() => setOverlay('diagnostics')}
        onOpenStraggler={() => {
          setOverlay(null);
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setSheetPane('tools');
          if (detent === 0) setDetent(1);
        }}
        onSwitchGroup={() => {
          setOverlay(null);
          switchGroup();
        }}
        onGoHome={() => {
          setOverlay(null);
          goHomeCreateOrJoin();
        }}
        styles={styles}
      />

      <DiagnosticsOverlay
        visible={overlay === 'diagnostics'}
        onClose={closeOverlay}
        accent={accent}
        navigationSessionId={navigationSessionState.session?.id ?? null}
        trackingMode={
          !sharingEnabled
            ? 'hidden'
            : navigationSessionState.session
              ? 'teamNavigation'
              : journeyActive
                ? 'navigationMax'
                : appState === 'active'
                  ? 'foreground'
                  : 'passiveBackground'
        }
        liveActivityStatus={
          journeyActive && liveActivityEnabled ? 'active/requested' : 'inactive'
        }
        destinations={destinations}
        activeDestinationId={navTargetId ?? selectedDestination?.id ?? null}
      />

      {/* 邀請成員 — independent share sheet (code / share / copy). */}
      <OverlaySheet
        visible={overlay === 'invite'}
        onClose={() => setOverlay(null)}
        title={t('map.inviteMembers')}
        accent={accent}
        doneLabel={t('map.done')}
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          <Text style={styles.overlayHint}>{t('map.inviteMembersHint')}</Text>
          <Text style={[styles.codeText, { textAlign: 'center', marginVertical: 20 }]}>
            {group?.inviteCode ?? '——'}
          </Text>
          <Pressable
            style={[styles.settingsButton, { marginBottom: 10 }]}
            onPress={() => void shareCode()}
            accessibilityRole="button"
          >
            <Ionicons name="share-outline" size={20} color="#fff" />
            <Text style={styles.settingsText}>{t('map.shareInviteLink')}</Text>
          </Pressable>
          <Pressable
            style={styles.settingsButton}
            onPress={() => void copyCode()}
            accessibilityRole="button"
          >
            <Ionicons name="copy-outline" size={20} color="#fff" />
            <Text style={styles.settingsText}>
              {codeCopied ? t('group.copied') : t('map.copyGroupCode')}
            </Text>
          </Pressable>
        </ScrollView>
      </OverlaySheet>

      {/* 我的狀態 — 跟隨 / 獨自 / 暫時離隊；選取為草稿，完成才提交 */}
      <OverlaySheet
        visible={overlay === 'myStatus'}
        onClose={closeMyStatusPicker}
        onDone={() => { void commitMyStatus(); }}
        title={t('solo.statusTitle')}
        accent={accent}
        doneLabel={t('map.done')}
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          <Text style={styles.overlayHint}>{t('solo.pickHint')}</Text>
          {(
            [
              {
                key: 'follow' as const,
                title: t('solo.followTeam'),
                hint: t('solo.followTeamHint'),
                icon: 'people' as const,
              },
              {
                key: 'solo' as const,
                title: t('solo.switch'),
                hint: t('solo.soloHint'),
                icon: 'walk' as const,
              },
              {
                key: 'away' as const,
                title: t('solo.tempLeave'),
                hint: t('solo.tempLeaveHint'),
                icon: 'exit-outline' as const,
              },
            ] as const
          ).map((opt) => {
            const selected = (draftMyStatus ?? myStatusKind) === opt.key;
            return (
              <Pressable
                key={opt.key}
                style={[
                  styles.statusOption,
                  selected && { borderColor: accentMix(accent, 55), backgroundColor: accentMix(accent, 14) },
                  statusApplying && { opacity: 0.6 },
                ]}
                onPress={() => {
                  if (statusApplying) return;
                  selectionTick();
                  setDraftMyStatus(opt.key);
                }}
                disabled={statusApplying}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: statusApplying }}
                accessibilityLabel={`${opt.title}. ${opt.hint}`}
              >
                <View style={[styles.statusOptionIcon, selected && { backgroundColor: accentMix(accent, 28) }]}>
                  <Ionicons
                    name={opt.icon}
                    size={22}
                    color={selected ? accent : glass.textSecondary}
                  />
                </View>
                <View style={styles.grow}>
                  <Text style={styles.statusOptionTitle}>{opt.title}</Text>
                  <Text style={styles.statusOptionHint}>{opt.hint}</Text>
                </View>
                {selected ? (
                  <View style={[styles.statusOptionCheck, { backgroundColor: accent }]}>
                    <Ionicons name="checkmark" size={14} color="#1a0a00" />
                  </View>
                ) : (
                  <View style={styles.statusOptionRadio} />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </OverlaySheet>

      {/* 全部快捷指令 */}
      <OverlaySheet
        visible={overlay === 'commands'}
        onClose={() => setOverlay(null)}
        title={t('map.cmdTitle')}
        accent={accent}
        doneLabel={t('map.done')}
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

      <AccountSheet
        visible={overlay === 'account'}
        onClose={() => setOverlay('settings')}
        accent={accent}
      />

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
                            size={26}
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
                      size={26}
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

      {/* Report-a-problem — a top-level overlay sharing the `overlay` state, so
          it fully replaces (never stacks over) the settings sheet. */}
      <FeedbackSheet
        visible={overlay === 'feedback'}
        onClose={() => setOverlay('settings')}
        screenshotUri={feedbackShot}
      />

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
                      {f.avatar ? (
                        <HitherText typeRole="emoji" style={styles.flockEmoji}>{f.avatar}</HitherText>
                      ) : (
                        <Text style={styles.flockInitial}>{f.name.slice(0, 1).toUpperCase()}</Text>
                      )}
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
        biasRegion={biasRegion}
        // Don't persist on pick — stage the place for the bottom confirm card
        // (Add / Cancel). Resolves immediately so the search sheet closes.
        onPick={handleSearchPick}
        onOpenCoordinateEntry={() => {
          closeSearch();
          openCoordinateSheet(undefined);
        }}
      />

      <PaywallSheet
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        trigger={paywallTrigger}
      />

      <KmlImportSheet
        visible={kmlVisible}
        onClose={() => setKmlVisible(false)}
        currentCount={allScopedDestinations.length}
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
      >
        {meetTimeEditor && (
          <View style={styles.meetEditorBody}>
            <View style={styles.meetQuickRow}>
              {[10, 30, 60].map((m) => (
                <Pressable
                  key={m}
                  style={styles.meetQuickBtn}
                  onPress={() => {
                    lightTap();
                    const shortcut = new Date(meetTimeEditor.value);
                    shortcut.setMinutes(shortcut.getMinutes() + m);
                    shortcut.setSeconds(0, 0);
                    setMeetTimeEditor((s) => (s ? { ...s, value: shortcut } : s));
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.meetQuickBtnText}>
                    {m < 60 ? `${m}分鐘` : `${m / 60}小時`}後
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.meetSelectedClock}>
              {t('meetTime.selected', {
                datetime: meetTimeEditor.value.toLocaleString(undefined, {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                }),
              })}
            </Text>

            {Platform.OS === 'android' ? (
              <Pressable
                style={styles.meetAndroidPickBtn}
                onPress={() => {
                  lightTap();
                  openAndroidMeetDate();
                }}
                accessibilityRole="button"
              >
                <Ionicons name="calendar-outline" size={18} color={accent} />
                <Text style={[styles.meetAndroidPickText, { color: accent }]}>
                  {t('meetTime.pickDateTime')}
                </Text>
              </Pressable>
            ) : (
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
                      s ? { ...s, value: clampDateNotBeforeToday(selected) } : s,
                    )
                  }
                />
              </View>
            )}

            <View style={{ marginTop: 10, marginBottom: 6 }}>
              <Text style={[styles.sectionLabel, { marginTop: 0, marginBottom: 8 }]}>
                {t('meetTime.redSection')}
              </Text>
              <Text style={styles.meetRedHint}>{t('meetTime.redHint')}</Text>
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
    </View>
  );
}

/** Gathering-point card press shell — haptic only, no scale animation. */
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

  return (
    <Pressable
      style={({ pressed }) => [
        styles.refreshLocationsButton,
        pressed && !refreshing && styles.rowActionPressed,
      ]}
      onPress={() => void onPress()}
      disabled={refreshing}
      accessibilityRole="button"
      accessibilityLabel={t('map.refreshLocationsA11y')}
      accessibilityHint={
        cooling ? t('map.refreshLocationsCooldown', { seconds: remaining }) : undefined
      }
    >
      {refreshing ? (
        <ActivityIndicator size="small" color={accent} />
      ) : (
        <Ionicons name="refresh" size={19} color={accent} />
      )}
    </Pressable>
  );
});

/**
 * One flock member row. Owns a 30s tick for freshness / "moving" status so the
 * parent MapScreen tree is not on a location-age interval.
 */
const FlockRow = React.memo(function FlockRow({
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
  last,
  styles,
  t,
  onSelfMerge,
  onSelfSplit,
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
  last: boolean;
  styles: any;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onSelfMerge: () => void | Promise<unknown>;
  onSelfSplit: () => void | Promise<unknown>;
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
          {avatar ? (
            <HitherText typeRole="emoji" style={styles.flockEmoji}>{avatar}</HitherText>
          ) : (
            <Text style={styles.flockInitial}>{name.slice(0, 1).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.grow}>
          <Text style={styles.flockName}>{name}{isMe ? ` · ${t('flock.you')}` : ''}</Text>
          <Text style={styles.flockStatus} numberOfLines={2}>
            <Text style={styles.flockMetaRole}>{role}</Text>
            {distOrStatus ? (
              <Text style={styles.flockMetaDist}>{` · ${distOrStatus}`}</Text>
            ) : null}
            {freshnessText ? (
              <Text style={styles.flockMetaFresh}>{` · ${freshnessText}`}</Text>
            ) : null}
            {solo ? (
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
              <Text style={styles.rowActionSecondary}>
                {t('subgroup.createTeam')}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
});

interface StragglerConfigSectionProps {
  groupAlerts: boolean;
  groupThreshold: number;
  accent: string;
  isPro: boolean;
  openPaywall: (trigger?: TranslationKey) => void;
  /** Background write of group setting (not live distance). UI does not await this to render. */
  onPersist: (enabled: boolean, thresholdM: number) => Promise<void>;
  /** Immediate local config for distance calc; null clears override after rollback. */
  onLocalChange?: (config: { alerts: boolean; thresholdM: number } | null) => void;
  styles: any;
  t: any;
}

/**
 * Leader-only straggler setting UI.
 * UI is source of truth while the user is interacting; DB/realtime must not yank
 * the Switch/Segmented back mid-tap. `groups.straggler_*` only persists the
 * preference so reopen / other devices / distance gate stay consistent.
 */
const StragglerConfigSection = React.memo(function StragglerConfigSection({
  groupAlerts,
  groupThreshold,
  accent,
  isPro,
  openPaywall,
  onPersist,
  onLocalChange,
  styles,
  t,
}: StragglerConfigSectionProps) {
  const [localAlerts, setLocalAlerts] = useState(groupAlerts);
  const [localThreshold, setLocalThreshold] = useState(groupThreshold);
  const dirtyRef = useRef(false);
  const seqRef = useRef(0);
  const lastSubmittedRef = useRef({ alerts: groupAlerts, threshold: groupThreshold });
  const localAlertsRef = useRef(localAlerts);
  const localThresholdRef = useRef(localThreshold);
  const groupAlertsRef = useRef(groupAlerts);
  const groupThresholdRef = useRef(groupThreshold);
  localAlertsRef.current = localAlerts;
  localThresholdRef.current = localThreshold;
  groupAlertsRef.current = groupAlerts;
  groupThresholdRef.current = groupThreshold;

  // Accept server → UI only when idle, or when server has caught up to our last submit.
  useEffect(() => {
    if (dirtyRef.current) {
      if (
        groupAlerts === lastSubmittedRef.current.alerts &&
        groupThreshold === lastSubmittedRef.current.threshold
      ) {
        dirtyRef.current = false;
        setLocalAlerts(groupAlerts);
        setLocalThreshold(groupThreshold);
      }
      return;
    }
    setLocalAlerts(groupAlerts);
    setLocalThreshold(groupThreshold);
  }, [groupAlerts, groupThreshold]);

  const commit = useCallback(
    (alerts: boolean, thresholdM: number) => {
      dirtyRef.current = true;
      lastSubmittedRef.current = { alerts, threshold: thresholdM };
      onLocalChange?.({ alerts, thresholdM });
      const seq = ++seqRef.current;
      onPersist(alerts, thresholdM).catch(() => {
        // Last-write-wins: only the latest in-flight request may roll back UI.
        if (seq !== seqRef.current) return;
        dirtyRef.current = false;
        setLocalAlerts(groupAlertsRef.current);
        setLocalThreshold(groupThresholdRef.current);
        onLocalChange?.(null);
      });
    },
    [onPersist, onLocalChange],
  );

  const handleToggle = useCallback(
    (v: boolean) => {
      setLocalAlerts(v);
      localAlertsRef.current = v;
      commit(v, localThresholdRef.current);
    },
    [commit],
  );

  const handleThresholdChange = useCallback(
    (v: string) => {
      const nextVal = Number(v);
      setLocalThreshold(nextVal);
      localThresholdRef.current = nextVal;
      commit(localAlertsRef.current, nextVal);
    },
    [commit],
  );

  return (
    <>
      <View style={styles.settingSwitchRow}>
        <View style={styles.settingSwitchText}>
          <Text style={styles.settingSwitchLabel}>{t('straggler.section')}</Text>
        </View>
        <Switch
          value={localAlerts}
          onValueChange={handleToggle}
          trackColor={{ true: accent, false: 'rgba(120,120,128,0.32)' }}
          thumbColor="#fff"
        />
      </View>
      <Segmented
        accent={accent}
        options={STRAGGLER_THRESHOLD_OPTIONS.map((m) => ({
          key: String(m),
          label: formatDistance(m),
        }))}
        value={String(localThreshold)}
        onChange={handleThresholdChange}
        disabledKeys={
          isPro
            ? []
            : STRAGGLER_THRESHOLD_OPTIONS.filter(
                (m) => m !== FREE_LIMITS.stragglerThresholdM,
              ).map(String)
        }
        onDisabledPress={() => openPaywall('paywall.triggerStraggler')}
      />
      <Text style={styles.overlayHint}>{t('straggler.freeNote')}</Text>
    </>
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
  // Every control is at least cmdSize×cmdSize; mode/maps stay exact squares.
  const cmdSize = tight ? s(48, 44) : compact ? s(52, 48) : s(56, 52);
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
      borderColor: glass.hairlineSoft,
    },
    pillAvatars: { flexDirection: 'row' },
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
    recenterHit: { height: 48, alignItems: 'center', justifyContent: 'center' },
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
    // Gathering-point card — padding / radius / gaps track live font scale.
    // overflow hidden clips glass radius; command row must flex so buttons
    // never paint past the edge (untappable when clipped).
    card: {
      borderRadius: narrow ? s(22, 16) : s(26, 20),
      overflow: 'hidden',
      paddingHorizontal: cardPad,
      paddingTop: s(compact ? 14 : 16, 10),
      paddingBottom: s(compact ? 14 : 16, 10),
      borderWidth: StyleSheet.hairlineWidth,
      // Soft system-gray rim only — never theme/accent outline.
      borderColor: glass.hairlineSoft,
    },
    cardActiveBorder: {
      borderColor: glass.hairline,
    },
    // Top arrival hairline (design 1b) — full-bleed above the padded content.
    arrivalHairline: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      backgroundColor: glass.hairlineSoft,
      zIndex: 2,
    },
    arrivalHairlineFill: { height: '100%' },
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
    arrivalDimOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.28)',
      borderRadius: radius.lg,
      zIndex: 3,
    },
    arrivalCenterCheckLayer: {
      ...StyleSheet.absoluteFill,
      zIndex: 5,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderRadius: radius.lg,
    },
    arrivalCenterCheckBox: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(12, 26, 18, 0.88)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.ok,
    },
    arrivalCenterCheckBoxExpanded: {
      width: 56,
      height: 56,
      borderRadius: 12,
    },
    arrivalCenterCheckBoxCollapsed: {
      width: 32,
      height: 32,
      borderRadius: 8,
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
    // Meet-time — flex-grows; minHeight floor only (no fixed height) so
    // countdown +「集合倒數」never clip under large/bold system type.
    meetBtn: {
      // Slightly less grow so nav 「完成／路徑／關閉」keeps two characters visible.
      flexGrow: 1.1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: Math.max(48, meetMinW - 8),
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
      paddingTop: 16,
      paddingBottom: 16,
      gap: 6,
    },
    // Hide the bottom sheet while the confirm card is up.
    sheetHidden: { opacity: 0 },
    confirmTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    confirmTextCol: { flex: 1, gap: 2 },
    confirmKicker: { fontSize: 16, fontWeight: '600', color: '#fff', marginLeft: 2 },
    confirmTitleInput: {
      color: '#fff',
      fontSize: 18,
      fontWeight: '700',
      paddingVertical: 0,
      paddingHorizontal: 2,
      minHeight: 26,
    },
    confirmEtaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    confirmArrow: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
    },
    arrivalCmdSquare: {
      borderWidth: StyleSheet.hairlineWidth,
    },
    confirmMin: { fontFamily: DISPLAY_FONT, fontSize: 36, includeFontPadding: false },
    confirmDist: { fontSize: 16, color: glass.textSecondary },
    confirmBtnRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
    confirmCancel: {
      flex: 1,
      minHeight: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,69,58,0.16)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,69,58,0.5)',
      paddingVertical: 12,
      paddingHorizontal: 8,
    },
    confirmCancelText: { fontSize: 16, fontWeight: '700', color: '#FF453A', textAlign: 'center' },
    confirmAdd: {
      flex: 1,
      minHeight: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 8,
    },
    confirmAddText: { fontSize: 16, fontWeight: '700', color: '#0c1a12', textAlign: 'center' },
    // Meet-time editor sheet: roomy, full-width controls (not the old cramped
    // left-aligned chips).
    meetEditorBody: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40, gap: 14 },
    meetQuickRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginBottom: -4 },
    meetQuickBtn: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 20,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    meetQuickBtnText: { color: glass.textSecondary, fontSize: 14, fontWeight: '600' },
    meetSelectedClock: {
      textAlign: 'center',
      fontSize: 16,
      fontWeight: '600',
      color: glass.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    meetAndroidPickBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 48,
      borderRadius: 14,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
      paddingHorizontal: 14,
    },
    meetAndroidPickText: { fontSize: 16, fontWeight: '600' },
    meetRedHint: {
      fontSize: 13,
      color: glass.textSecondary,
      marginBottom: 10,
      lineHeight: 18,
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

    // Peek chrome: bottom pad = top pad + BottomSheet grabZone height so the
    // grabber (paddingTop 6 + bar 4 + paddingBottom 4 ≈ 14) is included in the
    // visual balance — equal pads leave the action row looking low.
    sheetHeaderBlock: {
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 8 + 14,
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
      justifyContent: 'space-between',
      gap: 8,
      marginTop: 4,
      marginBottom: 8,
      minWidth: 0,
    },
    myStatusRow: {
      // Hug content — no flex:1 stretch (was leaving empty space on the right).
      flexGrow: 0,
      flexShrink: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minHeight: 44,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 999,
      backgroundColor: 'rgba(255,255,255,0.07)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
      maxWidth: '78%',
    },
    myStatusText: {
      fontSize: 12,
      fontWeight: '600',
      color: glass.textSecondary,
      flexShrink: 1,
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
      marginTop: 14,
      marginBottom: 8,
    },
    accuracyRowLast: {
      marginTop: 12,
      borderBottomWidth: 0,
    },
    /** Inactive toggle panes stay mounted but take no layout space. */
    sheetPaneHidden: {
      position: 'absolute',
      opacity: 0,
      left: 0,
      right: 0,
      height: 0,
      overflow: 'hidden',
      zIndex: -1,
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
      marginBottom: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    accuracyCopy: { flex: 1, minWidth: 0 },
    accuracySwitch: { flexShrink: 0, transform: [{ translateY: 2 }] },
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
    codeText: {
      fontFamily: DISPLAY_FONT,
      fontSize: narrow ? 20 : 24,
      fontWeight: '700',
      color: '#fff',
      letterSpacing: narrow ? 1 : 2,
      flexShrink: 1,
    },
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
      width: 40,
      height: 40,
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
