import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
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

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
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
  withTiming,
  withSpring,
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import GroupMap, { type GroupMapHandle } from '../components/GroupMap';
import DestinationSearch from '../components/DestinationSearch';
import MeetCountdown from '../components/MeetCountdown';
import DestinationReorderList from '../components/DestinationReorderList';
import NotificationPreferencesCard from '../components/NotificationPreferencesCard';
import QuickCommandsCard from '../components/QuickCommandsCard';
import BottomSheet, { sheetBottomOffset } from '../components/BottomSheet';
import OverlaySheet from '../components/OverlaySheet';
import PaywallSheet from '../components/PaywallSheet';
import KmlImportSheet from '../components/KmlImportSheet';
import FeedbackSheet from '../components/FeedbackSheet';
import CrookIcon from '../components/CrookIcon';
import { useSession } from '../state/SessionContext';
import {
  usePreferences,
  useTheme,
  MEET_RED_OPTIONS,
  type Language,
} from '../state/PreferencesContext';
import { useTranslation, type TranslationKey } from '../i18n';
import { useDeviceLocation } from './MapScreen/hooks/useDeviceLocation';
import { useCarouselSelection } from './MapScreen/hooks/useCarouselSelection';
import { useJourneyNavigation } from './MapScreen/hooks/useJourneyNavigation';
import { SettingsOverlay } from './MapScreen/components/SettingsOverlay';
import { ProfileOverlay } from './MapScreen/components/ProfileOverlay';
import { SubgroupSection } from './MapScreen/components/SubgroupSection';
import { Segmented } from './MapScreen/components/Segmented';
import AccountSheet from '../components/AccountSheet';
import { useGroupState } from '../state/useGroupState';
import { useStragglerAlerts } from '../state/useStragglerAlerts';
import { useSubgroupInvites } from '../state/useSubgroupInvites';
import { useLiveActivity } from '../state/useLiveActivity';
import {
  distanceMeters,
  etaSecondsFor,
  formatDistance,
  walkingEtaSeconds,
  type TravelMode,
} from '../utils/geo';
import { dotWindow } from '../utils/pagination';
import { minutesUntil } from '../utils/meetTime';
import { groupHistoryByDay, type HistoryDayGroup } from '../utils/history';
import { liquidGlass, location, notifications, type MapRegion, type PlaceResult } from '../native';
import {
  addDestination,
  deleteDestination,
  fetchSentInvites,
  fetchVisitedWaypoints,
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
  updateMyLocation,
  updateGroupTripDetails,
} from '../api/client';
import { captureScreen } from 'react-native-view-shot';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_STORAGE_KEY } from '../onboarding/sync';
import { isDemoGroup } from '../api/demo';
import { isVirtualMember, assignVirtualToSubgroup } from '../api/virtualMates';
import { confirmAction } from '../utils/confirm';
import { logEvent, logError } from '../utils/activityLog';
import { lightTap, mediumTap, rigidTap, selectionTick, alertBuzz } from '../utils/haptics';
import { AVATAR_EMOJI, AVATAR_COLORS } from '../constants/avatars';
import type { Coordinates, Destination, MemberLocation } from '../types';
import type { KmlPlacemark } from '../utils/kml';
import { FREE_LIMITS } from '../entitlements';
import { themes, THEME_ORDER, type ThemeName } from '../theme';
import { glass, accentMix, memberColor } from '../glass';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

const ARRIVAL_RADIUS_M = 30;
// Auto-advance to the next gathering point once the leader is this close —
// separate from ARRIVAL_RADIUS_M, which drives the flock's "arrived" status.
const AUTO_ADVANCE_RADIUS_M = 50;
// Cap on gathering-point pagination dots shown at once (see utils/pagination.ts).
const DOTS_MAX_VISIBLE = 5;

/** The design's display face — Fredoka (loaded in App.tsx). Used for
 * gathering-point titles, ETA numerals and the set-gather-time. */
const DISPLAY_FONT = 'Fredoka_600SemiBold';

/** Persisted "don't warn me again" flag for the leave-the-main-group notice. */
const LEAVE_GROUP_WARN_KEY = 'hither.subgroupLeaveWarnDismissed';

/** Preset straggler-alert distance chips shown in settings. */
const STRAGGLER_THRESHOLD_OPTIONS = [300, 500, 1000, 2000];

/** Nominal walk that reads as ~"just started" for the progress bar. */
const PROGRESS_REF_M = 1500;

/** Short ETA like the design's "4 min" / "now" / "2 hr". */
function shortEta(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr`;
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
    language,
    themeName,
    powerSaver,
    meetRedMin,
    setLanguage,
    setThemeName,
    setPowerSaver,
    setMeetRedMin,
  } = usePreferences();
  const { colors } = useTheme();
  const accent = colors.accent;
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(accent), [accent]);
  // Embedded themed components (reorder list, notifications, commands) always
  // render on the dark glass overlay — force the night palette so they stay dark.
  const dark = themes.night;

  const groupId = route.params?.groupId ?? membership?.group.id ?? null;
  // The demo flock has no membership row; the tester drives it as leader.
  const isLeader = membership?.role === 'leader' || isDemoGroup(groupId);
  const { state, loading, refresh } = useGroupState(groupId);
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
  const activeScopeId = viewingScope === 'sub' ? myScopeId : undefined;

  const rawDestinations: Destination[] = useMemo(() => {
    return (state?.destinations ?? []).filter(
      (d) => (d.subgroupId ?? undefined) === (activeScopeId ?? undefined),
    );
  }, [state?.destinations, activeScopeId]);
  
  const [optimisticDestinations, setOptimisticDestinations] = useState<Destination[] | null>(null);
  const destinations = optimisticDestinations ?? rawDestinations;
  const optimisticTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const canEditItinerary = isLeader || myScopeId != null;

  // --- Sheet / overlay / island UI state -----------------------------------
  // Measured height of the sheet's pinned header (grabber + search row) —
  // peek shows exactly that block, floating high off the screen edges.
  const [sheetHeaderH, setSheetHeaderH] = useState(78);
  const detents = useMemo(() => {
    // Full fills the screen flush, leaving only the status bar.
    const peek = sheetHeaderH;
    const full = windowHeight - insets.top - 6;
    const mid = Math.round(full * 0.55);
    return [peek, mid, full];
  }, [insets.top, windowHeight, sheetHeaderH]);
  const heightSV = useSharedValue(detents[0]);
  const [detent, setDetent] = useState(0);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [pressedCardId, setPressedCardId] = useState<string | null>(null);
  const pendingExpandId = useRef<string | null>(null);
  const [overlay, setOverlay] = useState<
    null | 'route' | 'settings' | 'profile' | 'feedback' | 'history' | 'account'
  >(null);
  // Screenshot captured the instant the feedback entry is tapped (before the
  // form opens over the screen), handed to the sheet as evidence.
  const [feedbackShot, setFeedbackShot] = useState<string | null>(null);
  // Visited-waypoint history — fetched fresh each time the overlay opens.
  const [historyGroups, setHistoryGroups] = useState<HistoryDayGroup[]>([]);
  useEffect(() => {
    if (overlay !== 'history') return;
    let cancelled = false;
    void fetchVisitedWaypoints().then((items) => {
      if (!cancelled) setHistoryGroups(groupHistoryByDay(items));
    });
    return () => {
      cancelled = true;
    };
  }, [overlay]);
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
  // Two-phase flow: pendingPlace is set immediately when a place is picked
  // (so the search sheet can close and the bottom sheet collapses to peek).
  // confirmCardReady flips true instantly — then the bounce-up
  // card appears and the search bar / recenter capsule hide.
  const [confirmCardReady, setConfirmCardReady] = useState(false);
  const [kmlVisible, setKmlVisible] = useState(false);
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
  }
  const [paywallTrigger, setPaywallTrigger] = useState<TranslationKey | undefined>(undefined);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const openPaywall = useCallback((trigger?: TranslationKey) => {
    setPaywallTrigger(trigger);
    setPaywallVisible(true);
  }, []);

  // --- Meet-time countdown + editor (iOS embeds a spinner overlay; Android
  // opens the native dialog imperatively) -------------------------------------
  const [meetTimeEditor, setMeetTimeEditor] = useState<{ id: string; value: Date } | null>(
    null,
  );
  const [nowTick, setNowTick] = useState(() => new Date());
  const hasMeetTimes = destinations.some((d) => d.meetAt);
  useEffect(() => {
    if (!hasMeetTimes) return;
    const id = setInterval(() => setNowTick(new Date()), 30_000);
    return () => clearInterval(id);
  }, [hasMeetTimes]);

  // The soonest gathering point whose meet time is still ahead — the one worth
  // scheduling an "it's time" alert for.
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

  // Fire a local notification + buzz when that meet time arrives. OS-scheduled,
  // so it shows (and vibrates, per the user's notification settings) even from
  // the lock screen; the foreground listener adds an in-app buzz on top.
  useEffect(() => {
    if (!nextMeet?.meetAt) return;
    let id: string | null = null;
    let cancelled = false;
    void notifications
      .scheduleLocalNotificationAt(
        {
          title: t('meetTime.notifyTitle'),
          body: t('meetTime.notifyBody', { title: nextMeet.title }),
          data: { kind: 'meetTime', destinationId: nextMeet.id },
        },
        new Date(nextMeet.meetAt as string),
      )
      .then((nid) => {
        if (cancelled && nid) void notifications.cancelScheduledNotification(nid);
        else id = nid;
      });
    const off = notifications.addForegroundListener((data) => {
      if (data.kind === 'meetTime') alertBuzz();
    });
    return () => {
      cancelled = true;
      if (id) void notifications.cancelScheduledNotification(id);
      off();
    };
  }, [nextMeet?.id, nextMeet?.meetAt, t]);

  const persistMeetTime = useCallback((destinationId: string, value: Date | null) => {
    setDestinationMeetTime(destinationId, value ? value.toISOString() : null)
      .then(() => refresh())
      .catch(() => Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg')));
  }, [refresh, t]);

  const openMeetTimePicker = useCallback((dest: Destination) => {
    if (!canEditItinerary) return;
    const initial = dest.meetAt ? new Date(dest.meetAt) : new Date();
    setMeetTimeEditor({ id: dest.id, value: initial });
  }, [canEditItinerary]);
  // Freeze the route overlay's scroll while a stop is being drag-reordered so
  // the two vertical gestures never fight.
  const [routeScrollEnabled, setRouteScrollEnabled] = useState(true);

  // --- Device GPS ----------------------------------------------------------
  const { deviceCoords, refreshDeviceLocation } = useDeviceLocation({
    groupId,
    powerSaver,
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

  // --- Journey navigation + Live Activity ----------------------------------
  const {
    journeyStatus,
    journeyGoing,
    journeyActive,
    navTarget,
    navTargetId,
    setNavTargetId,
    activePoint,
    numericDistance,
    journeyBusy,
    openInAppleMaps,
    startNavigation,
    stopNavigation,
  } = useJourneyNavigation({
    state,
    groupId,
    isLeader,
    destinations,
    selectedDestination,
    fromCoords,
    refresh,
    t,
    mapRef,
    carouselRef,
    setSelectedIndex,
  });

  // --- Straggler alerts ------------------------------------------------------
  // Reference is ME, not the gathering point — "fell behind" means fell
  // behind the flock (specifically me), not "hasn't reached the destination".
  const { stragglers } = useStragglerAlerts(state, fromCoords ?? undefined);
  // Fire a native OS notification per NEWLY-flagged straggler (hysteresis in
  // the hook already prevents re-firing while still over the release band) —
  // no in-app banner; the system notification is the only surface for this.
  const lastStragglerIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(stragglers.map((s) => s.userId));
    const newOnes = stragglers.filter((s) => !lastStragglerIdsRef.current.has(s.userId));
    lastStragglerIdsRef.current = ids;
    for (const s of newOnes) {
      void notifications.scheduleLocalNotification({
        title: t('straggler.notifyTitle'),
        body: t(s.userId === user?.id ? 'straggler.selfWarning' : 'straggler.banner', {
          name: s.name,
          distance: formatDistance(s.distanceM),
        }),
        data: { kind: 'straggler', userId: s.userId },
      });
    }
  }, [stragglers, t, user?.id]);


  const liveProgress =
    numericDistance != null
      ? Math.max(0.05, Math.min(0.95, 1 - Math.min(1, numericDistance / PROGRESS_REF_M)))
      : undefined;
  const liveGathered = navTarget
    ? members.filter(
        (m) =>
          m.coordinates &&
          distanceMeters(m.coordinates, navTarget.coordinates) <= ARRIVAL_RADIUS_M,
      ).length
    : undefined;
  useLiveActivity(journeyActive, {
    groupName: membership?.group.name ?? '',
    gatheringTitle: navTarget?.title,
    distanceMeters: numericDistance,
    etaSeconds: numericDistance != null ? walkingEtaSeconds(numericDistance) : undefined,
    gatheringCoordinates: navTarget?.coordinates,
    progress: liveProgress,
    gatheredCount: liveGathered,
    memberCount: members.length,
    accentHex: accent,
    travelMode,
    memberEmojis: members.map((m) => m.avatar ?? ''),
  });



  const locateMe = useCallback(async () => {
    refresh();
    const coords = (await refreshDeviceLocation()) ?? deviceCoords;
    if (coords) mapRef.current?.centerOn(coords);
  }, [refresh, refreshDeviceLocation, deviceCoords]);

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
  const handleSearchPick = useCallback((place: PlaceResult) => {
    setPendingPlace(place);
    mapRef.current?.centerOn(place.coordinates);
    return Promise.resolve();
  }, []);

  const handlePickDestination = useCallback(async (place: PlaceResult) => {
    if (!groupId) return;
    if (!isPro && destinations.length >= FREE_LIMITS.destinationsPerItinerary) {
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
        },
        myScopeId,
      );
      logEvent('destination_add', { source: 'search' });
      setSelectedIndex(destinations.length);
      mapRef.current?.centerOn(place.coordinates);
      refresh();
    } catch (e) {
      logError('destination_add_failed', e, { source: 'search' });
      Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
    }
  }, [groupId, isPro, destinations.length, myScopeId, refresh, openPaywall, t]);

  const handleKmlImport = useCallback(async (items: KmlPlacemark[], onProgress: (done: number) => void) => {
    if (!groupId) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await addDestination(
        groupId,
        { title: item.name, coordinates: { latitude: item.latitude, longitude: item.longitude } },
        myScopeId,
      );
      onProgress(i + 1);
    }
    logEvent('kml_import', { count: items.length });
    refresh();
  }, [groupId, myScopeId, refresh]);



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

  // --- Profile (nickname + emoji avatar) ------------------------------------
  const openProfile = useCallback(() => {
    lightTap();
    setOverlay('profile');
  }, []);

  // --- Solo mode -------------------------------------------------------------
  const toggleSolo = useCallback(async (next: boolean) => {
    if (!groupId) return;
    selectionTick();
    logEvent('solo_toggle', { groupId, next });
    setSoloOverride(next);
    try {
      await setSolo(groupId, next);
      // memberships is realtime-subscribed (useGroupState); its debounced
      // reload refreshes `members` and clears the override above once it
      // matches — no need to force an extra fetch here.
    } catch (e) {
      logError('solo_toggle_failed', e, { groupId, next });
      setSoloOverride(null);
      Alert.alert(t('solo.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [groupId, t]);

  // --- Subgroups (小隊：邀請制、無隊長) ---------------------------------------
  const subgroups = state?.subgroups ?? [];
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
    // Virtual mates aren't real Supabase users — mock the invite: they always
    // accept, so drop them straight into my subgroup (client-side) and refresh.
    if (isVirtualMember(inviteeId)) {
      assignVirtualToSubgroup(inviteeId, subgroupId);
      setInviteSheetOpen(false);
      refresh();
      Alert.alert(t('subgroup.inviteSent'));
      return;
    }
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
  }, [refresh, t, groupId, refreshInvites, refreshSentInvites]);

  // Any member can split themselves into their own new (collab, no-leader)
  // subgroup, or merge themselves back up a level — no leader say-so needed.
  const doSelfSplit = useCallback(async () => {
    if (!groupId) return;
    if (!(await confirmLeaveMainGroup())) return;
    mediumTap();
    logEvent('team_create', { groupId });
    try {
      await selfSplit(
        groupId,
        t('subgroup.selfSplitName', { name: user?.name ?? t('group.travelerFallback') }),
      );
      logEvent('team_create_ok', { groupId });
      refresh();
    } catch (e) {
      logError('team_create_failed', e, { groupId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [groupId, confirmLeaveMainGroup, user?.name, t, refresh]);
  const doSelfMerge = useCallback(async () => {
    if (!groupId) return;
    selectionTick();
    logEvent('team_leave', { groupId });
    try {
      await selfMerge(groupId);
      logEvent('team_leave_ok', { groupId });
      refresh();
    } catch (e) {
      logError('team_leave_failed', e, { groupId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
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
    async (updates: { id: string; position: number; day: number }[]) => {
      if (!groupId) return;
      logEvent('destination_reorder', { count: updates.length });
      
      const newDests = rawDestinations.map(d => ({ ...d }));
      updates.forEach(u => {
         const dest = newDests.find(d => d.id === u.id);
         if (dest) {
            dest.order = u.position;
            dest.day = u.day;
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
        await reorderDestinations(groupId, updates);
        refresh();
      } catch (e) {
        logError('destination_reorder_failed', e);
        Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
        setOptimisticDestinations(null);
        refresh();
      }
    },
    [groupId, t, refresh, rawDestinations],
  );
  const handleDelete = useCallback(
    (id: string) => {
      if (!groupId) return;
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
            refresh();
          } catch (e) {
            logError('destination_delete_failed', e, { id });
            Alert.alert(t('settings.deleteFailed'));
            refresh();
          }
        },
      );
    },
    [groupId, destinations, refresh, t],
  );

  const confirmLeave = useCallback(() => {
    confirmAction(
      {
        title: t('group.leaveTitle'),
        message: t('group.leaveMsg'),
        confirmLabel: t('group.leaveConfirm'),
        destructive: true,
      },
      () => {
        logEvent('group_leave', { groupId, isLeader });
        leaveGroup();
        navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
      },
    );
  }, [t, groupId, isLeader, leaveGroup, navigation]);
  const confirmSignOut = useCallback(() => {
    confirmAction(
      {
        title: t('settings.signOutTitle'),
        message: t('settings.signOutMsg'),
        confirmLabel: t('settings.signOut'),
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
    Alert.alert(t('settings.resetPrefs'), t('settings.resetPrefsDone'));
  }, [t]);

  const confirmResetPrefs = useCallback(() => {
    confirmAction(
      {
        title: t('settings.resetPrefs'),
        message: t('settings.resetPrefsConfirm'),
        confirmLabel: t('settings.resetPrefs'),
        destructive: true,
      },
      () => void resetPrefs(),
    );
  }, [t, resetPrefs]);

  // Optimistic flip for the straggler-alert switch — the server round trip +
  // realtime refetch otherwise reads as a 1-2s lag. Cleared once server truth
  // (group.stragglerAlerts) matches, in the effect below.
  const [optimisticTripDays, setOptimisticTripDays] = useState<number | null>(null);
  const [optimisticDepartureDate, setOptimisticDepartureDate] = useState<string | null>(null);

  useEffect(() => {
    if (group && group.tripDays === optimisticTripDays && group.departureDate === optimisticDepartureDate) {
      setOptimisticTripDays(null);
      setOptimisticDepartureDate(null);
    }
  }, [group?.tripDays, group?.departureDate, optimisticTripDays, optimisticDepartureDate]);

  const handleUpdateTripDetails = useCallback(async (days: number, date: string) => {
    if (groupId) {
       setOptimisticTripDays(days);
       setOptimisticDepartureDate(date);
       try {
         await updateGroupTripDetails(groupId, days, date);
         refresh();
       } catch(e) {
         setOptimisticTripDays(null);
         setOptimisticDepartureDate(null);
         Alert.alert('更新失敗', e instanceof Error ? e.message : String(e));
       }
    }
  }, [groupId, refresh]);

  const [stragglerOverride, setStragglerOverride] = useState<boolean | null>(null);
  const [stragglerThresholdOverride, setStragglerThresholdOverride] = useState<number | null>(null);
  useEffect(() => {
    if (stragglerOverride === null) return;
    if (group && group.stragglerAlerts === stragglerOverride) setStragglerOverride(null);
  }, [group?.stragglerAlerts, stragglerOverride]);

  useEffect(() => {
    if (stragglerThresholdOverride === null) return;
    if (group && group.stragglerThresholdM === stragglerThresholdOverride) setStragglerThresholdOverride(null);
  }, [group?.stragglerThresholdM, stragglerThresholdOverride]);

  const persistStragglerConfig = useCallback((enabled: boolean, thresholdM: number) => {
    if (!groupId) return;
    setStragglerOverride(enabled);
    setStragglerThresholdOverride(thresholdM);
    setStragglerConfig(groupId, enabled, thresholdM)
      .then(() => refresh())
      .catch(() => {
        setStragglerOverride(null);
        setStragglerThresholdOverride(null);
        Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
      });
  }, [groupId, refresh, t]);

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
        const dToMe =
          !isSelf && m.coordinates && fromCoords
            ? distanceMeters(m.coordinates, fromCoords)
            : null;
        const arrived = d != null && d <= ARRIVAL_RADIUS_M;
        const isMemberLeader = m.role === 'leader';
        // Member status: arrived (within the radius) > moving (a fresh
        // location ping in the last 2 minutes) > not started (no recent ping —
        // the app hasn't sent a location update, e.g. before they've left).
        const movingRecently =
          !!m.lastUpdated && Date.now() - new Date(m.lastUpdated).getTime() < 2 * 60_000;
        const solo =
          m.userId === user?.id && soloOverride !== null ? soloOverride : !!m.solo;
        return {
          userId: m.userId,
          name: m.name || t('group.travelerFallback'),
          avatar: m.avatar,
          solo,
          subgroupId: m.subgroupId,
          // Prefer the member's chosen avatar background colour; fall back to the
          // deterministic per-user colour when they haven't picked one.
          color: m.avatarColor ?? memberColor(m.userId),
          isLeader: isMemberLeader,
          statusText: solo
            ? t('solo.badge')
            : isMemberLeader
              ? t('flock.leading')
              : arrived
                ? t('memberStatus.arrived')
                : movingRecently
                  ? t('memberStatus.moving')
                  : t('memberStatus.notStarted'),
          statusColor: solo
            ? glass.warn
            : isMemberLeader
              ? accent
              : arrived
                ? glass.ok
                : glass.textSecondary,
          // "—" for my own row (distance to myself is meaningless); everyone
          // else shows how far they are from me.
          eta: isSelf ? '' : dToMe != null ? shortEta(walkingEtaSeconds(dToMe)) : '',
          dist: isSelf ? t('flock.you') : dToMe != null ? formatDistance(dToMe) : '',
          arrived,
        };
      }),
    [members, activePoint, accent, t, user?.id, soloOverride, fromCoords],
  );

  // Drop the override once the server value catches up, so a later toggle
  // (from this device or another) isn't masked by a stale optimistic flip.
  useEffect(() => {
    if (soloOverride === null) return;
    const mine = members.find((m) => m.userId === user?.id);
    if (mine && !!mine.solo === soloOverride) setSoloOverride(null);
  }, [members, soloOverride, user?.id]);

  const topFlock = flock.filter((f) => !f.subgroupId);
  // My own subgroup, if any — gates the "invite a teammate" entry on my card.
  const mySubgroupId = flock.find((f) => f.userId === user?.id)?.subgroupId;
  useEffect(() => {
    void refreshSentInvites(mySubgroupId);
  }, [mySubgroupId, refreshSentInvites]);
  // Co-members I could still pull into my team — anyone not me and not already
  // in my subgroup. Virtual solo-test mates ARE invitable now: handleInvite
  // mock-accepts them so a solo tester can exercise the whole team flow.
  const invitable = flock.filter(
    (f) => f.userId !== user?.id && f.subgroupId !== mySubgroupId,
  );

  // One flock row, shared by the main list and the subgroup cards.
  const renderFlockRow = useCallback((f: (typeof flock)[number], last: boolean) => {
    const isMe = f.userId === user?.id;
    return (
      <View key={f.userId} style={[styles.flockRow, last && styles.flockRowLast]}>
        <View style={styles.flockRowMain}>
          <View
            style={[
              styles.flockAvatar,
              { backgroundColor: f.color, borderColor: f.isLeader ? accent : 'transparent' },
            ]}
          >
            {f.avatar ? (
              <Text style={styles.flockEmoji}>{f.avatar}</Text>
            ) : (
              <Text style={styles.flockInitial}>{f.name.slice(0, 1).toUpperCase()}</Text>
            )}
          </View>
          <View style={styles.grow}>
            <Text style={styles.flockName}>{f.name}</Text>
            <Text style={[styles.flockStatus, { color: f.statusColor }]}>{f.statusText}</Text>
          </View>
          <View style={styles.flockMeta}>
            <Text style={styles.flockEta}>{f.eta}</Text>
            <Text style={styles.flockDist}>{f.dist}</Text>
          </View>
        </View>
        {/* Self-service: only on your own row. Everyone gets to choose Solo
            mode or create/leave a team, independent of any leader. */}
        {isMe && (
          <View style={styles.selfControls}>
            <View style={styles.selfSoloRow}>
              <Text style={styles.selfControlLabel}>{t('solo.switch')}</Text>
              <Switch
                value={f.solo}
                onValueChange={toggleSolo}
                trackColor={{ true: accent, false: 'rgba(120,120,128,0.32)' }}
                thumbColor="#fff"
              />
            </View>
            {f.subgroupId ? (
              <Pressable
                onPress={() => void doSelfMerge()}
                hitSlop={8}
                accessibilityRole="button"
                style={({ pressed }) => pressed && styles.rowActionPressed}
              >
                <Text style={[styles.rowAction, { color: accent }]}>
                  {t('subgroup.leaveTeam')}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => void doSelfSplit()}
                hitSlop={8}
                accessibilityRole="button"
                style={({ pressed }) => pressed && styles.rowActionPressed}
              >
                <Text style={[styles.rowAction, { color: accent }]}>
                  {t('subgroup.createTeam')}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    );
  }, [user?.id, accent, t, toggleSolo, doSelfMerge, doSelfSplit, styles]);

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



  const sheetHeader = useMemo(() => (
    /* Search row + account avatar — pinned over the scroll content on
             BottomSheet's frosted header veil (Apple-Maps look). */
          <View style={styles.searchRow}>
            {pendingPlace ? (
              // Search field hides while the add-gather-point confirm card is up.
              <View style={styles.searchField} />
            ) : (
              <Pressable
                style={styles.searchField}
                onPress={() => (canEditItinerary ? setSearchVisible(true) : undefined)}
                accessibilityRole="button"
                accessibilityLabel={t('map.searchA11y')}
              >
                <Ionicons name="search" size={17} color={glass.textSecondary} />
                <Text style={styles.searchPlaceholder}>{t('map.searchPlaces')}</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.avatar, { backgroundColor: user?.avatarColor ?? accent }]}
              onPress={openProfile}
              accessibilityRole="button"
              accessibilityLabel={t('profile.title')}
            >
              {user?.avatar ? (
                <Text style={styles.avatarEmoji}>{user.avatar}</Text>
              ) : (
                <Text style={styles.avatarText}>
                  {(user?.name ?? '?').slice(0, 1).toUpperCase()}
                </Text>
              )}
            </Pressable>
          </View>
  ), [pendingPlace, canEditItinerary, user, accent, openProfile, styles, t]);

  const sheetChildren = useMemo(() => (
    <>
      {/* Flock — first section, Apple-Maps-style heading. Members with no
            subgroup list first; each subgroup renders as its own card. */}
        <View style={styles.headingRow}>
          <Text style={styles.sheetHeading}>
            {t('map.flockLabel')} · {members.length}
          </Text>
          {!isPro && (
            <Text style={styles.memberCapHint}>
              {t('paywall.memberCap', { n: FREE_LIMITS.groupMembers })}
            </Text>
          )}
        </View>
        {pendingInvites.length > 0 && (
          <View style={styles.list}>
            {pendingInvites.map((inv, i) => {
              const isRequest = inv.kind === 'request';
              return (
                <View
                  key={inv.id}
                  style={[styles.flockRow, i === pendingInvites.length - 1 && styles.flockRowLast]}
                >
                  <Text style={styles.flockName}>
                    {t(isRequest ? 'subgroup.requestPrompt' : 'subgroup.invitePrompt', {
                      name: inv.inviterName,
                      team: inv.subgroupName,
                    })}
                  </Text>
                  <View style={styles.splitActions}>
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
        <View style={styles.list}>
          {topFlock.map((f, i) => renderFlockRow(f, i === topFlock.length - 1))}
        </View>
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

        {/* Group code + share / copy. */}
        <Text style={styles.sheetHeading}>{t('group.codeLabel')}</Text>
        <View style={styles.codeRow}>
          <View style={styles.grow}>
            <Text style={styles.codeText}>{group?.inviteCode ?? '——'}</Text>
          </View>
          <Pressable
            style={[styles.chip, { backgroundColor: accentMix(accent, 24), borderColor: accentMix(accent, 50) }]}
            onPress={shareCode}
            accessibilityRole="button"
          >
            <Ionicons name="share-outline" size={15} color="#fff" />
            <Text style={styles.chipText}>{t('map.share')}</Text>
          </Pressable>
          <Pressable style={styles.chipGhost} onPress={copyCode} accessibilityRole="button">
            <Text style={styles.chipText}>{codeCopied ? t('group.copied') : t('map.copy')}</Text>
          </Pressable>
        </View>

        {/* Gathering points → route overlay. */}
        <Text style={styles.sheetHeading}>{t('map.gatheringPoints')}</Text>
        <Pressable style={styles.rowButton} onPress={() => { lightTap(); setOverlay('route'); }} accessibilityRole="button">
          <View style={[styles.rowIcon, { backgroundColor: accentMix(accent, 20) }]}>
            <CrookIcon size={22} color={accent} />
          </View>
          <View style={styles.grow}>
            <Text style={styles.rowTitle}>
              {t('map.stopsReorder', { count: destinations.length })}
            </Text>
          </View>
          <Text style={[styles.rowAction, { color: accent }]}>{t('map.edit')}</Text>
        </Pressable>

        {/* KML import — a sub-item of gathering points (moved out of the reorder
            overlay so it's reachable without opening "調整順序"). */}
        {canEditItinerary && (
          <Pressable style={styles.rowButton} onPress={() => { lightTap(); setKmlVisible(true); }} accessibilityRole="button">
            <View style={[styles.rowIcon, { backgroundColor: accentMix(accent, 20) }]}>
              <Ionicons name="document-attach-outline" size={20} color={accent} />
            </View>
            <View style={styles.grow}>
              <Text style={styles.rowTitle}>{t('kml.entry')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={glass.textTertiary} />
          </Pressable>
        )}

        {/* Straggler alerts — also a gathering-point sub-item (moved out of the
            Settings overlay). Leader-only; threshold is paywall-gated. */}
        {isLeader && group && (
          <>
            <View style={styles.settingSwitchRow}>
              <View style={styles.settingSwitchText}>
                <Text style={styles.settingSwitchLabel}>{t('straggler.section')}</Text>
              </View>
              <Switch
                value={stragglerOverride ?? group.stragglerAlerts}
                onValueChange={(v) => persistStragglerConfig(v, stragglerThresholdOverride ?? group.stragglerThresholdM)}
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
              value={String(stragglerThresholdOverride ?? group.stragglerThresholdM)}
              onChange={(v) => persistStragglerConfig(stragglerOverride ?? group.stragglerAlerts, Number(v))}
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
        )}

        {/* Quick commands. */}
        <Text style={styles.sheetHeading}>
          {isLeader ? t('map.cmdLeaderTitle') : t('map.cmdFollowerTitle')}
        </Text>
        {groupId ? (
          <QuickCommandsCard groupId={groupId} isLeader={!!isLeader} colors={dark} />
        ) : null}

        {/* Settings. */}
        <Pressable style={styles.settingsButton} onPress={() => { lightTap(); setOverlay('settings'); }} accessibilityRole="button">
          <Ionicons name="settings-sharp" size={20} color="#fff" />
          <Text style={styles.settingsText}>{t('map.settingsAll')}</Text>
          <Ionicons name="chevron-forward" size={16} color={glass.textTertiary} />
        </Pressable>
    </>
  ), [
    t, members.length, isPro, pendingInvites, accent, handleAcceptInvite, handleDeclineInvite, topFlock, renderFlockRow, subgroups, flock, mySubgroupId, sentInvites, group, shareCode, codeCopied, copyCode, destinations.length, canEditItinerary, isLeader, stragglerOverride, stragglerThresholdOverride, persistStragglerConfig, openPaywall, groupId, dark, styles
  ]);

  const closeOverlay = useCallback(() => setOverlay(null), []);
  const openHistoryOverlay = useCallback(() => setOverlay('history'), []);
  const openAccountOverlay = useCallback(() => setOverlay('account'), []);
  const openPaywallCb = useCallback(() => openPaywall(), [openPaywall]);

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
        // Capped at mid: at full the sheet covers the map anyway.
        // ponytail: updates once per detent settle (3 discrete values), not
        // per frame — per-frame MapView prop updates re-render the native map
        // 60×/s; switch to a heightAnim listener if the step reads harsh.
        bottomOverlap={detents[1]}
      />

      {/* Group pill — moved to bottom left, tracking sheet like recenter capsule. */}
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
                      {f.avatar ? <Text style={styles.pillEmoji}>{f.avatar}</Text> : null}
                    </View>
                  ));
                })()}
              </View>
              <Text style={styles.pillName} numberOfLines={1}>
                {myScopeId 
                  ? (viewingScope === 'main' ? (group?.name ?? 'Hither') : '小隊')
                  : (group?.name ?? 'Hither')}
              </Text>
              <Text style={styles.pillCount}>· {viewingScope === 'main' || !myScopeId ? members.length : flock.filter(f => f.subgroupId === myScopeId).length}</Text>
            </liquidGlass.GlassView>
          </Pressable>
        </View>
      </Animated.View>


      {/* Recenter capsule — rides above the sheet. Fit-all on top, locate-me
          below, sharing one pill-shaped glass surface. Hidden while the
          add-gather-point confirm card owns the bottom of the screen. */}
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
            onPress={fitAllMembers}
            accessibilityRole="button"
            accessibilityLabel={t('map.fitAllA11y')}
          >
            <Ionicons name="expand-outline" size={19} color="#fff" />
          </Pressable>
          <View style={styles.recenterDivider} />
          <Pressable
            style={styles.recenterHit}
            onPress={locateMe}
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
                    {t('confirmGather.going', { name: pendingPlace.name })}
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
                <Pressable
                  style={({ pressed }) => [
                    styles.confirmArrow,
                    { backgroundColor: accentMix(accent, 18) },
                    pressed && { opacity: 0.8 }
                  ]}
                  onPress={() => mapRef.current?.centerOn(pendingPlace.coordinates)}
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
                    const place = pendingPlace;
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

      {/* Gathering-point carousel — takes over the top slot (where the group
          pill was) instead of floating above the sheet, so it no longer
          covers the recenter button. */}
      {destinations.length > 0 && (
        <Animated.View
          style={[styles.carouselWrap, { top: insets.top + 8 }, chromeOpacityStyle]}
          pointerEvents={atFull ? 'none' : 'auto'}
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
              const d = fromCoords ? distanceMeters(fromCoords, dest.coordinates) : null;
              // This card is the stop we're actively navigating to — its
              // button flips to "end navigation" (leader only; followers
              // can't change journey status).
              const navigatingThis = isLeader && journeyActive && navTarget?.id === dest.id;
              // Leader-set target meet time, formatted as a live countdown /
              // overdue label. Recomputed every 30s by the nowTick interval.
              const meetLabel = dest.meetAt
                ? (() => {
                    const mins = minutesUntil(dest.meetAt as string, nowTick);
                    return mins >= 0
                      ? t('meetTime.countdown', { minutes: mins })
                      : t('meetTime.overdue', { minutes: Math.abs(mins) });
                  })()
                : null;
              // Team arrival toward THIS stop — how many of the flock are
              // already within the arrival radius. Drives the top hairline and
              // the "隊伍抵達進度" caption (design 1b).
              const arrivedHere = members.filter(
                (m) =>
                  m.coordinates &&
                  distanceMeters(m.coordinates, dest.coordinates) <= ARRIVAL_RADIUS_M,
              ).length;
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
              return (
                <View key={dest.id} style={{ width: windowWidth, paddingHorizontal: 14 }}>
                  <Pressable
                    delayLongPress={300}
                    onPressIn={() => {
                      LayoutAnimation.configureNext({
                        duration: 150,
                        update: { type: 'easeInEaseOut' },
                      });
                      setPressedCardId(dest.id);
                      pendingExpandId.current = null;
                    }}
                    onPressOut={() => {
                      LayoutAnimation.configureNext({
                        duration: 300,
                        create: { type: 'linear', property: 'opacity' },
                        update: { type: 'linear' },
                        delete: { type: 'linear', property: 'opacity' },
                      });
                      setPressedCardId(null);
                      if (pendingExpandId.current === dest.id) {
                        setExpandedCardId((prev) => (prev === dest.id ? null : dest.id));
                        pendingExpandId.current = null;
                      }
                    }}
                    onLongPress={() => {
                      rigidTap();
                      pendingExpandId.current = dest.id;
                    }}
                  >
                    <Animated.View layout={LinearTransition.duration(300)}>
                      <liquidGlass.GlassView
                        tintColor={active ? glass.cardActive : glass.card}
                        style={[
                          styles.card,
                          active && { borderColor: accentMix(accent, 50) },
                          pressedCardId === dest.id && { transform: [{ scale: 0.96 }] }
                        ]}
                      >
                    {/* Top arrival hairline — team progress toward this stop. */}
                    <View style={styles.arrivalHairline}>
                      <View
                        style={[
                          styles.arrivalHairlineFill,
                          { width: `${arrivalPct}%`, backgroundColor: accent },
                        ]}
                      />
                    </View>
                    <View style={styles.cardHead}>
                      <View style={[styles.cardIcon, { backgroundColor: accentMix(accent, 22), borderColor: accentMix(accent, 45) }]}>
                        <CrookIcon size={26} color={accent} />
                      </View>
                      <View style={styles.grow}>
                        <Text style={[styles.cardKicker, { color: accent }]}>
                          {index === 0 ? t('map.nextTag') + ' · ' : ''}
                          {t('map.destinationCounter', { index: index + 1, total: destinations.length })}
                        </Text>
                        <Text style={styles.cardTitle} numberOfLines={expandedCardId === dest.id ? undefined : 1}>
                          {dest.title}
                        </Text>
                        {expandedCardId === dest.id && (
                          <Animated.Text entering={FadeIn.duration(200)} style={{ color: glass.textSecondary, fontSize: 13, marginTop: 4 }}>
                            {(() => {
                              const dayNum = dest.day || 1;
                              let dateStr = '';
                              if (group?.departureDate) {
                                const d = new Date(group.departureDate);
                                d.setDate(d.getDate() + (dayNum - 1));
                                dateStr = `${d.getMonth() + 1}月${d.getDate()}號`;
                              }
                              return `第${dayNum}天${dateStr ? ` · ${dateStr}` : ''}`;
                            })()}
                          </Animated.Text>
                        )}
                        {myScopeId != null && (
                          <Text style={styles.cardBadge}>{t('subgroup.itineraryBadge')}</Text>
                        )}
                      </View>
                      {/* Pagination — lives inside the card now that the
                          carousel sits at the screen's top edge, where there's
                          no room below it for a separate dots row. Capped at
                          DOTS_MAX_VISIBLE; the window slides to keep the
                          active dot centered until it nears either end. */}
                      {destinations.length > 1 && (
                        <Animated.View style={styles.dots} layout={LinearTransition.duration(100)}>
                          {dotWindow(destinations.length, selectedIndex, DOTS_MAX_VISIBLE).map(
                            (i2) => (
                              <Animated.View
                                key={`dot-${destinations[i2].id}`}
                                entering={FadeIn.duration(100)}
                                exiting={FadeOut.duration(100)}
                                layout={LinearTransition.springify().damping(14).stiffness(300)}
                                style={[styles.dot, i2 === selectedIndex && styles.dotActive]}
                              />
                            ),
                          )}
                        </Animated.View>
                      )}
                    </View>
                    {/* Arrival caption — mirrors the top hairline in words. */}
                    <View style={styles.arrivalCaption}>
                      <Text style={styles.arrivalCaptionLabel}>{t('map.arrivalProgress')}</Text>
                      <Text style={[styles.arrivalCaptionValue, { color: accent }]}>
                        {arrivedHere} / {totalMembers}
                      </Text>
                    </View>

                    {/* One command row: nav toggle · transit (cycles mode, shows
                        live time·distance) · Apple Maps hand-off · gather-time. */}
                    <View style={styles.commandRow}>
                      <Pressable
                        style={[
                          styles.navBtn,
                          navigatingThis ? styles.navBtnEnd : { backgroundColor: accent },
                        ]}
                        onPress={() => {
                          if (navigatingThis) {
                            void stopNavigation();
                          } else if (isLeader) {
                            // In-app journey: flock "going" state, arrival
                            // detection, and the Live Activity all drive off
                            // this — Apple Maps is a separate opt-in button.
                            startNavigation(dest, index);
                          } else {
                            mapRef.current?.centerOn(dest.coordinates);
                          }
                        }}
                        disabled={journeyBusy}
                        accessibilityRole="button"
                      >
                        <Ionicons
                          name={navigatingThis ? 'stop' : isLeader ? 'play' : 'navigate'}
                          size={15}
                          color={navigatingThis ? glass.danger : '#0c1a12'}
                        />
                        <Text
                          style={[
                            styles.navBtnText,
                            { color: navigatingThis ? glass.danger : '#0c1a12' },
                          ]}
                        >
                          {navigatingThis
                            ? t('map.stopNav')
                            : isLeader
                              ? t('map.directions')
                              : t('map.viewOnMap')}
                        </Text>
                      </Pressable>

                      <Pressable
                        style={[
                          styles.transitPill,
                          { backgroundColor: accentMix(accent, 16), borderColor: accentMix(accent, 38) },
                        ]}
                        onPress={() => {
                          const order = ['walk', 'transit', 'drive'] as const;
                          setTravelMode(order[(order.indexOf(travelMode) + 1) % order.length]);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t(`map.travelMode.${travelMode}`)}
                      >
                        <View style={styles.transitPillTop}>
                          <Ionicons name={modeIconName} size={16} color={accent} />
                          <Text style={styles.transitPillTime}>
                            {d != null ? shortEta(etaSecondsFor(d, travelMode)) : '—'}
                          </Text>
                        </View>
                        <Text style={styles.transitPillDist}>
                          {d != null ? formatDistance(d) : ''}
                        </Text>
                      </Pressable>

                      <Pressable
                        style={styles.cmdSquare}
                        onPress={() => openInAppleMaps(dest)}
                        accessibilityRole="button"
                        accessibilityLabel={t('map.openInAppleMaps')}
                      >
                        <Ionicons name="open-outline" size={18} color={glass.textSecondary} />
                      </Pressable>

                      <Pressable
                        style={styles.cmdSquare}
                        onPress={() => openMeetTimePicker(dest)}
                        disabled={!canEditItinerary}
                        accessibilityRole="button"
                        accessibilityLabel={t('meetTime.set')}
                      >
                        <Ionicons
                          name="time-outline"
                          size={16}
                          color={meetLabel ? accent : glass.textSecondary}
                        />
                        {dest.meetAt ? (
                          <MeetCountdown
                            meetAtIso={dest.meetAt as string}
                            redWithinMin={meetRedMin}
                            redColor={glass.danger}
                            baseStyle={[styles.cmdSquareLabel, { color: accent }]}
                          />
                        ) : (
                          <Text style={styles.cmdSquareLabel} numberOfLines={1}>
                            ——
                          </Text>
                        )}
                      </Pressable>
                    </View>
                      </liquidGlass.GlassView>
                    </Animated.View>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </Animated.View>
      )}

      {/* Straggler alerts fire as a native OS notification (see the effect
          above) — no in-app banner, so they don't cover the map. */}
      {/* The pull-up sheet — hidden while the add-gather-point confirm card
          owns the screen (search bar + recenter capsule disappear). */}
      <Animated.View style={[StyleSheet.absoluteFill, confirmCardReady && styles.sheetHidden]} pointerEvents={confirmCardReady ? 'none' : 'auto'}>
      <BottomSheet
        height={heightSV}
        detents={detents}
        index={detent}
        onIndexChange={setDetent}
        bottomInset={insets.bottom}
        onHeaderHeight={setSheetHeaderH}
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
          <DestinationReorderList
            groupId={groupId ?? undefined}
            destinations={destinations}
            canReorder={canEditItinerary}
            tripDays={optimisticTripDays ?? group?.tripDays}
            departureDate={optimisticDepartureDate ?? group?.departureDate}
            onUpdateTripDetails={handleUpdateTripDetails}
            onReorder={handleReorder}
            onDelete={canEditItinerary ? handleDelete : undefined}
            colors={dark}
            emptyLabel={t('settings.noDestinations')}
            onDragActiveChange={(active) => setRouteScrollEnabled(!active)}
          />
          {canEditItinerary && (
            <Pressable
              style={styles.addStop}
              onPress={() => {
                setOverlay(null);
                setSearchVisible(true);
              }}
              accessibilityRole="button"
            >
              <View style={[styles.addStopIcon, { backgroundColor: accentMix(accent, 26) }]}>
                <Ionicons name="add" size={16} color={accent} />
              </View>
              <Text style={[styles.addStopText, { color: accent }]}>{t('map.addStop')}</Text>
            </Pressable>
          )}
        </ScrollView>
      </OverlaySheet>

      <SettingsOverlay
        visible={overlay === 'settings'}
        onClose={closeOverlay}
        isLeader={isLeader}
        onOpenHistory={openHistoryOverlay}
        onArchiveAllForTest={archiveAllForTest}
        onOpenFeedback={openFeedback}
        onConfirmResetPrefs={confirmResetPrefs}
        onConfirmLeave={confirmLeave}
        onConfirmSignOut={confirmSignOut}
        onOpenPaywall={openPaywallCb}
        onOpenAccount={openAccountOverlay}
        styles={styles}
      />

      <AccountSheet
        visible={overlay === 'account'}
        onClose={() => setOverlay(null)}
        accent={accent}
      />

      <ProfileOverlay
        visible={overlay === 'profile'}
        onClose={() => setOverlay(null)}
        refresh={refresh}
        styles={styles}
      />

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
                    {group.items.map((item, i) => (
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
                          </View>
                          <Text style={styles.historyTime}>
                            {new Date(item.arrivedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </Text>
                        </View>
                      </View>
                    ))}
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
        onClose={() => setOverlay(null)}
        screenshotUri={feedbackShot}
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
                        <Text style={styles.flockEmoji}>{f.avatar}</Text>
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
      />

      <PaywallSheet
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        trigger={paywallTrigger}
      />

      <KmlImportSheet
        visible={kmlVisible}
        onClose={() => setKmlVisible(false)}
        currentCount={destinations.length}
        isPro={isPro}
        onImport={handleKmlImport}
        onUpgrade={() => {
          setKmlVisible(false);
          openPaywall('paywall.triggerDestinations');
        }}
      />

      {/* Meet-time editor: embedded spinner + Set/Clear + Quick Shortcuts */}
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
                    const d = new Date();
                    d.setMinutes(d.getMinutes() + m);
                    setMeetTimeEditor((s) => (s ? { ...s, value: d } : s));
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.meetQuickBtnText}>
                    +{m < 60 ? `${m}分` : `${m / 60}小時`}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.meetPickerWrap}>
              <DateTimePicker
                  value={meetTimeEditor.value}
                  mode="time"
                  display="spinner"
                  onChange={(_event, selected) =>
                    selected && setMeetTimeEditor((s) => (s ? { ...s, value: selected } : s))
                  }
                />
              </View>
              <Pressable
                style={[
                  styles.meetSetBtn,
                  { backgroundColor: accentMix(accent, 90), borderColor: accentMix(accent, 50) },
                ]}
                onPress={() => {
                  persistMeetTime(meetTimeEditor.id, meetTimeEditor.value);
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

const makeStyles = (accent: string) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: '#0c1118' },
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
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
      height: 44,
      paddingLeft: 8,
      paddingRight: 14,
      borderRadius: 22,
      overflow: 'hidden',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineStrong,
    },
    pillAvatars: { flexDirection: 'row' },
    pillAvatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1.5,
      borderColor: 'rgba(20,24,32,0.9)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // flexShrink + numberOfLines(1) so an overlong group name ellipsizes
    // instead of pushing the role chip off-screen.
    pillName: { fontSize: 15, fontWeight: '600', color: '#fff', flexShrink: 1, minWidth: 0 },
    pillCount: { fontSize: 14, color: glass.textSecondary },
    roleChip: {
      height: 44,
      paddingHorizontal: 16,
      borderRadius: 22,
      overflow: 'hidden',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineStrong,
    },
    roleDot: { width: 8, height: 8, borderRadius: 4 },
    roleWord: { fontSize: 14, fontWeight: '600', color: '#fff' },

    recenter: { position: 'absolute', right: 14, zIndex: 40 },
    settingsSectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    feedbackEntry: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    recenterCapsule: {
      width: 48,
      borderRadius: 24,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineStrong,
    },
    recenterHit: { height: 48, alignItems: 'center', justifyContent: 'center' },
    recenterDivider: { height: StyleSheet.hairlineWidth, backgroundColor: glass.hairlineStrong },

    teamCapsuleWrap: {
      position: 'absolute',
      left: 14,
      zIndex: 50,
    },

    carouselWrap: { position: 'absolute', left: 0, right: 0, zIndex: 58 },
    card: {
      borderRadius: 30,
      overflow: 'hidden',
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    // Top arrival hairline (design 1b) — full-bleed above the padded content.
    arrivalHairline: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      backgroundColor: 'rgba(255,255,255,0.08)',
      zIndex: 2,
    },
    arrivalHairlineFill: { height: '100%' },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardIcon: {
      width: 46,
      height: 46,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
    },
    grow: { flex: 1, minWidth: 0 },
    cardKicker: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
    // marginTop nudges the (system-font) CJK title clear of the kicker line —
    // Fredoka only covers Latin, so CJK sits higher and would otherwise crowd it.
    cardTitle: { fontFamily: DISPLAY_FONT, fontSize: 20, color: '#fff', lineHeight: 23, marginTop: 4 },
    cardBadge: { color: glass.textSecondary, fontSize: 11, marginTop: 1 },

    // Arrival caption row (design 1b) — "隊伍抵達進度 · X / Y".
    arrivalCaption: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 11, paddingLeft: 2 },
    arrivalCaptionLabel: { fontSize: 12.5, color: glass.textSecondary },
    arrivalCaptionValue: { fontFamily: DISPLAY_FONT, fontSize: 13, fontVariant: ['tabular-nums'] },

    // The single command row and its four controls.
    commandRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginTop: 10 },
    navBtn: {
      flex: 1,
      minWidth: 0,
      height: 54,
      borderRadius: 15,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'transparent',
    },
    // "End navigation" state — a soft danger tint over the accent-solid "go".
    navBtnEnd: { backgroundColor: 'rgba(255,107,107,0.14)', borderColor: 'rgba(255,107,107,0.4)' },
    navBtnText: { fontSize: 15, fontWeight: '700' },
    // Transit pill: tap to cycle mode; shows the live time · distance for it.
    transitPill: {
      width: 92,
      height: 54,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1,
      borderWidth: StyleSheet.hairlineWidth,
    },
    transitPillTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    transitPillTime: { fontFamily: DISPLAY_FONT, fontSize: 15, color: '#fff', fontVariant: ['tabular-nums'] },
    transitPillDist: { fontSize: 10.5, color: glass.textSecondary, fontVariant: ['tabular-nums'] },
    // Square secondary controls (Apple-Maps hand-off, gather-time clock).
    cmdSquare: {
      width: 54,
      height: 54,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      backgroundColor: 'rgba(255,255,255,0.09)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    cmdSquareLabel: { fontSize: 10, fontWeight: '700', color: glass.textSecondary, fontVariant: ['tabular-nums'] },

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
    confirmEtaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    confirmArrow: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmMin: { fontFamily: DISPLAY_FONT, fontSize: 36, includeFontPadding: false },
    confirmDist: { fontSize: 16, color: glass.textSecondary },
    confirmBtnRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
    confirmCancel: {
      flex: 1,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,69,58,0.16)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,69,58,0.5)',
    },
    confirmCancelText: { fontSize: 16, fontWeight: '700', color: '#FF453A' },
    confirmAdd: {
      flex: 1,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmAddText: { fontSize: 16, fontWeight: '700', color: '#0c1a12' },
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
    meetPickerWrap: { alignItems: 'center', marginBottom: 4 },
    meetSetBtn: {
      height: 52,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
    },
    meetSetText: { fontSize: 17, fontWeight: '700', color: '#fff' },
    meetClearBtn: {
      height: 50,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    meetClearText: { fontSize: 17, fontWeight: '600', color: glass.textSecondary },
    dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
    dotActive: { width: 18, backgroundColor: accent },

    // Sheet content
    // Slim Apple-Maps search capsule, pinned inside the sheet's frosted
    // header block (BottomSheet's `header` prop supplies the veil).
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    searchField: {
      flex: 1,
      height: 44,
      borderRadius: 22,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      backgroundColor: 'rgba(118,118,128,0.26)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.15)',
    },
    searchPlaceholder: { fontSize: 15, color: 'rgba(235,235,245,0.5)' },
    avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
    avatarEmoji: { fontSize: 20 },
    flockEmoji: { fontSize: 20 },
    pillEmoji: { fontSize: 13 },

    // Profile overlay
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
    profileInput: {
      flex: 1,
      height: 48,
      borderRadius: 14,
      paddingHorizontal: 14,
      color: '#fff',
      fontSize: 16,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    profilePreviewRow: { alignItems: 'center', marginBottom: 16 },
    profilePreviewAvatar: {
      width: 76,
      height: 76,
      borderRadius: 38,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profilePreviewEmoji: { fontSize: 40 },
    profilePreviewInitial: { fontSize: 32, fontWeight: '700', color: '#fff' },
    // 5 columns × 6 rows filling edge-to-edge: 5 × (18% + 1% + 1%) = 100%.
    emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
    emojiCell: {
      width: '18%',
      aspectRatio: 1,
      marginHorizontal: '1%',
      marginVertical: 4,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.fill,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    emojiChar: { fontSize: 26 },
    colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
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
    splitActions: { flexDirection: 'row', gap: 8 },
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

    codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
    // Big bold white section headings on the main sheet (Apple Maps style).
    // Generous top margin so each section visibly separates from the last.
    sheetHeading: {
      fontSize: 20,
      fontWeight: '700',
      color: '#fff',
      marginTop: 24,
      marginBottom: 12,
      marginLeft: 4,
    },
    memberCapHint: {
      fontSize: 12,
      color: glass.textTertiary,
      marginTop: 24,
    },
    sectionLabel: {
      fontSize: 15,
      fontWeight: '800',
      letterSpacing: 0.4,
      color: glass.textSecondary,
      marginBottom: 12,
      marginLeft: 4,
      marginTop: 26,
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
    settingSwitchText: { flex: 1 },
    settingSwitchLabel: { fontSize: 15, fontWeight: '600', color: '#fff' },
    settingSwitchHint: { fontSize: 12, color: glass.textTertiary, marginTop: 2 },
    codeText: { fontSize: 24, fontWeight: '700', color: '#fff', letterSpacing: 2 },
    chip: {
      height: 38,
      paddingHorizontal: 16,
      borderRadius: 19,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
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
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    flockRowLast: { borderBottomWidth: 0 },
    flockRowMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    flockAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
    },
    flockInitial: { fontSize: 16, fontWeight: '600', color: '#fff' },
    flockName: { fontSize: 16, color: '#fff' },
    flockStatus: { fontSize: 13 },
    flockMeta: { alignItems: 'flex-end' },
    flockEta: { fontSize: 15, fontWeight: '600', color: '#fff', fontVariant: ['tabular-nums'] },
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

    rowButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      height: 58,
      borderRadius: 16,
      paddingHorizontal: 14,
      marginBottom: 20,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    rowIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
    rowSub: { fontSize: 13, color: glass.textSecondary },
    rowAction: { fontSize: 14, fontWeight: '600' },
    rowActionPressed: { opacity: 0.5 },

    settingsButton: {
      height: 54,
      borderRadius: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      marginTop: 20,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    settingsText: { flex: 1, fontSize: 16, fontWeight: '600', color: '#fff' },

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
    upgradeError: {
      fontSize: 13,
      color: glass.danger,
      marginTop: 8,
      marginHorizontal: 4,
    },
  });
