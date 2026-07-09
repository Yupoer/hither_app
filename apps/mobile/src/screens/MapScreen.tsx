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
  useWindowDimensions,
  View,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import GroupMap, { type GroupMapHandle } from '../components/GroupMap';
import DestinationSearch from '../components/DestinationSearch';
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
import { usePreferences, useTheme, type Language } from '../state/PreferencesContext';
import { useTranslation, type TranslationKey } from '../i18n';
import { useGroupState } from '../state/useGroupState';
import { useStragglerAlerts } from '../state/useStragglerAlerts';
import { useSubgroupInvites } from '../state/useSubgroupInvites';
import { useLiveActivity } from '../state/useLiveActivity';
import {
  distanceMeters,
  formatDistance,
  walkingEtaSeconds,
} from '../utils/geo';
import { minutesUntil } from '../utils/meetTime';
import { liquidGlass, location, notifications, type MapRegion, type PlaceResult } from '../native';
import {
  addDestination,
  deleteDestination,
  inviteToSubgroup,
  reorderDestinations,
  saveOnboardingProfile,
  selfMerge,
  selfSplit,
  setDestinationMeetTime,
  setJourneyStatus,
  setSolo,
  setStragglerConfig,
  updateMyLocation,
} from '../api/client';
import { captureScreen } from 'react-native-view-shot';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_STORAGE_KEY } from '../onboarding/sync';
import { isDemoGroup } from '../api/demo';
import { isVirtualMember } from '../api/virtualMates';
import { confirmAction } from '../utils/confirm';
import { logEvent, logError } from '../utils/activityLog';
import { lightTap, mediumTap, selectionTick, alertBuzz } from '../utils/haptics';
import { AVATAR_EMOJI } from '../constants/avatars';
import type { Coordinates, Destination, MemberLocation } from '../types';
import type { KmlPlacemark } from '../utils/kml';
import { FREE_LIMITS } from '../entitlements';
import { themes, THEME_ORDER, type ThemeName } from '../theme';
import { glass, accentMix, memberColor } from '../glass';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

const ARRIVAL_RADIUS_M = 30;

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
  const { language, themeName, powerSaver, setLanguage, setThemeName, setPowerSaver } =
    usePreferences();
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

  const members = state?.members ?? [];
  // My current scope: undefined = main group's itinerary, a subgroup id =
  // that subgroup's own itinerary. Everything itinerary-related below reads
  // only from this scope's list (carousel, reorder, nav target, meet-time,
  // straggler nav target) — filtering once here means nothing downstream
  // needs its own leader/subgroup branching to stay scoped correctly.
  const me = members.find((m) => m.userId === user?.id);
  const myScopeId = me?.subgroupId;
  const destinations: Destination[] = (state?.destinations ?? []).filter(
    (d) => (d.subgroupId ?? undefined) === (myScopeId ?? undefined),
  );
  // Main-group scope: leader-only (unchanged). Subgroup scope: everyone in
  // the subgroup may add/reorder/delete its stops — no sub-leader.
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
  const [overlay, setOverlay] = useState<null | 'route' | 'settings' | 'profile' | 'feedback'>(
    null,
  );
  // Screenshot captured the instant the feedback entry is tapped (before the
  // form opens over the screen), handed to the sheet as evidence.
  const [feedbackShot, setFeedbackShot] = useState<string | null>(null);
  // "Invite a teammate" picker, opened from my own subgroup card.
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [kmlVisible, setKmlVisible] = useState(false);
  const [paywallTrigger, setPaywallTrigger] = useState<TranslationKey | undefined>(undefined);
  const [paywallVisible, setPaywallVisible] = useState(false);
  function openPaywall(trigger?: TranslationKey) {
    setPaywallTrigger(trigger);
    setPaywallVisible(true);
  }

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

  function persistMeetTime(destinationId: string, value: Date | null) {
    setDestinationMeetTime(destinationId, value ? value.toISOString() : null)
      .then(() => refresh())
      .catch(() => Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg')));
  }

  function openMeetTimePicker(dest: Destination) {
    if (!canEditItinerary) return;
    const initial = dest.meetAt ? new Date(dest.meetAt) : new Date();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: initial,
        mode: 'time',
        onChange: (event, selected) => {
          if (event.type === 'set' && selected) persistMeetTime(dest.id, selected);
        },
      });
    } else {
      setMeetTimeEditor({ id: dest.id, value: initial });
    }
  }
  // Freeze the route overlay's scroll while a stop is being drag-reordered so
  // the two vertical gestures never fight.
  const [routeScrollEnabled, setRouteScrollEnabled] = useState(true);

  // --- Device GPS ----------------------------------------------------------
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);
  const refreshDeviceLocation = useCallback(async (): Promise<Coordinates | null> => {
    const fix = await location.getCurrentLocation();
    if (fix) {
      setDeviceCoords(fix.coordinates);
      if (groupId) void updateMyLocation(fix.coordinates, groupId);
      return fix.coordinates;
    }
    return null;
  }, [groupId]);
  useEffect(() => {
    void refreshDeviceLocation();
  }, [refreshDeviceLocation]);

  // Continuous foreground tracking: teammates' dots move in near real time.
  // The watch's distanceInterval/timeInterval already bound how often this
  // fires (power-saver widens both), so each sample writes straight through —
  // no extra throttle needed. Restarts when the group or the saver flag change.
  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    let stop = () => {};
    void location
      .watchLocation((sample) => {
        setDeviceCoords(sample.coordinates);
        void updateMyLocation(sample.coordinates, groupId);
      }, powerSaver)
      .then((unsub) => {
        if (cancelled) unsub();
        else stop = unsub;
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [groupId, powerSaver]);

  // --- Carousel selection ---------------------------------------------------
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => {
    const clamped =
      destinations.length === 0 ? 0 : Math.min(selectedIndex, destinations.length - 1);
    if (clamped !== selectedIndex) setSelectedIndex(clamped);
    carouselRef.current?.scrollTo({ x: clamped * windowWidth, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinations.length, windowWidth]);

  // The map only recenters on explicit user intent (swiping the carousel,
  // picking a search result, starting navigation) — NOT whenever the selected
  // id changes, or a background reorder/refetch would yank the map around.
  const selectedDestination: Destination | undefined = destinations[selectedIndex];

  const reference = useMemo<MemberLocation | undefined>(
    () =>
      members.find((m) => m.userId === user?.id) ??
      members.find((m) => m.role === 'leader') ??
      members[0],
    [members, user?.id],
  );
  const fromCoords = deviceCoords ?? reference?.coordinates;

  // --- Journey navigation + Live Activity ----------------------------------
  const journeyStatus = state?.group.journeyStatus ?? 'paused';
  const journeyGoing = journeyStatus === 'going';
  const [navTargetId, setNavTargetId] = useState<string | null>(null);
  const navTarget = useMemo<Destination | undefined>(
    () => destinations.find((d) => d.id === navTargetId),
    [destinations, navTargetId],
  );
  useEffect(() => {
    if (journeyGoing && !navTargetId && selectedDestination) {
      setNavTargetId(selectedDestination.id);
    } else if (!journeyGoing && navTargetId) {
      setNavTargetId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyGoing]);
  const journeyActive = journeyGoing && !!navTarget;

  // The point the whole UI (carousel highlight, flock ETAs) refers to.
  const activePoint = navTarget ?? selectedDestination;

  // --- Straggler alerts ------------------------------------------------------
  const { stragglers } = useStragglerAlerts(state, navTarget?.coordinates);
  const [stragglerBannerCollapsed, setStragglerBannerCollapsed] = useState(false);
  const lastStragglerIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(stragglers.map((s) => s.userId));
    const grew = [...ids].some((id) => !lastStragglerIdsRef.current.has(id));
    if (grew) setStragglerBannerCollapsed(false);
    lastStragglerIdsRef.current = ids;
  }, [stragglers]);

  const numericDistance =
    fromCoords && navTarget ? distanceMeters(fromCoords, navTarget.coordinates) : undefined;
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
  });

  // ponytail: temporary hand-off to Apple Maps until native routing (MKDirections,
  // Dev Build) exists. Coords in daddr guarantee the exact pin; label names it;
  // dirflg=w matches Hither's walking-ETA model. Universal-link fallback if the
  // maps:// scheme is unavailable. Works in Expo Go (pure Linking, no native mod).
  const openInAppleMaps = useCallback((dest: Destination) => {
    const { latitude, longitude } = dest.coordinates;
    const label = encodeURIComponent(dest.title);
    const scheme = `maps://?daddr=${label}@${latitude},${longitude}&dirflg=w`;
    const universal = `https://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=w`;
    Linking.openURL(scheme).catch(() => void Linking.openURL(universal));
  }, []);

  const [journeyBusy, setJourneyBusy] = useState(false);
  const startNavigation = useCallback(
    async (dest: Destination, index: number) => {
      if (!groupId || journeyBusy) return;
      setJourneyBusy(true);
      setNavTargetId(dest.id);
      mapRef.current?.centerOn(dest.coordinates);
      try {
        if (index > 0) {
          const ids = destinations.map((d) => d.id);
          const [moved] = ids.splice(index, 1);
          ids.unshift(moved);
          await reorderDestinations(groupId, ids);
        }
        // The navigated stop is now first — snap the carousel card with it.
        setSelectedIndex(0);
        carouselRef.current?.scrollTo({ x: 0, animated: true });
        await setJourneyStatus(groupId, 'going');
        refresh();
      } catch {
        setNavTargetId(null);
        Alert.alert(t('map.setFailedTitle'), t('map.journeyFailed'));
      } finally {
        setJourneyBusy(false);
      }
    },
    [groupId, journeyBusy, destinations, refresh, t],
  );

  const stopNavigation = useCallback(async () => {
    if (!groupId) return;
    setNavTargetId(null);
    try {
      await setJourneyStatus(groupId, 'paused');
      refresh();
    } catch {
      Alert.alert(t('map.setFailedTitle'), t('map.journeyFailed'));
    }
  }, [groupId, refresh, t]);

  const arrivalFiredRef = useRef(false);
  useEffect(() => {
    if (!journeyActive) {
      arrivalFiredRef.current = false;
      return;
    }
    if (
      isLeader &&
      !arrivalFiredRef.current &&
      numericDistance != null &&
      numericDistance <= ARRIVAL_RADIUS_M
    ) {
      arrivalFiredRef.current = true;
      confirmAction(
        {
          title: t('map.arriveTitle'),
          message: t('map.arriveBody', { title: navTarget?.title ?? '' }),
          confirmLabel: t('map.arriveConfirm'),
          cancelLabel: t('map.arriveDismiss'),
        },
        () => void stopNavigation(),
      );
    }
  }, [journeyActive, isLeader, numericDistance, navTarget?.title, stopNavigation, t]);

  async function locateMe() {
    refresh();
    const coords = (await refreshDeviceLocation()) ?? deviceCoords;
    if (coords) mapRef.current?.centerOn(coords);
  }

  function fitAllMembers() {
    mapRef.current?.fitToMembers();
  }

  const biasCenter = deviceCoords ?? selectedDestination?.coordinates;
  const biasRegion: MapRegion | undefined = biasCenter
    ? {
        latitude: biasCenter.latitude,
        longitude: biasCenter.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      }
    : undefined;

  async function handlePickDestination(place: PlaceResult) {
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
  }

  async function handleKmlImport(items: KmlPlacemark[], onProgress: (done: number) => void) {
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
  }

  function handleMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (destinations.length === 0) return;
    const index = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
    const clamped = Math.max(0, Math.min(index, destinations.length - 1));
    if (clamped !== selectedIndex) {
      setSelectedIndex(clamped);
      logEvent('carousel_swipe', { index: clamped });
      mapRef.current?.centerOn(destinations[clamped].coordinates);
    }
  }

  // --- Group actions --------------------------------------------------------
  const [codeCopied, setCodeCopied] = useState(false);
  async function copyCode() {
    if (!group) return;
    lightTap();
    logEvent('code_copy');
    await Clipboard.setStringAsync(group.inviteCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }
  async function shareCode() {
    if (!group) return;
    lightTap();
    logEvent('code_share');
    await Share.share({ message: t('map.shareMsg', { code: group.inviteCode }) });
  }

  // --- Profile (nickname + emoji avatar) ------------------------------------
  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState<string | undefined>(undefined);
  function openProfile() {
    lightTap();
    setProfileName(user?.name ?? '');
    setProfileAvatar(user?.avatar);
    setOverlay('profile');
  }
  // "Done" (and the scrim tap) closes instantly, then persists whatever changed
  // in one write — picking an avatar is a pure local highlight until then.
  function closeProfile() {
    setOverlay(null);
    const nickname = profileName.trim();
    const fields: { nickname?: string; avatar?: string } = {};
    if (nickname && nickname !== user?.name) fields.nickname = nickname;
    if (profileAvatar && profileAvatar !== user?.avatar) fields.avatar = profileAvatar;
    if (!fields.nickname && !fields.avatar) return;
    logEvent('profile_save', { changed: Object.keys(fields) });
    updateProfile(fields)
      .then(() => refresh())
      .catch((e) => {
        logError('profile_save_failed', e);
        Alert.alert(
          t('profile.saveFailed'),
          e instanceof Error ? e.message : undefined,
        );
      });
  }

  // --- Solo mode -------------------------------------------------------------
  async function toggleSolo(next: boolean) {
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
  }

  // --- Subgroups (小隊：邀請制、無隊長) ---------------------------------------
  const subgroups = state?.subgroups ?? [];
  const {
    invites: pendingInvites,
    accept: acceptInvite,
    decline: declineInvite,
    refresh: refreshInvites,
  } = useSubgroupInvites();

  async function handleAcceptInvite(inviteId: string) {
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
  }
  async function handleDeclineInvite(inviteId: string) {
    selectionTick();
    logEvent('invite_decline', { inviteId });
    try {
      await declineInvite(inviteId);
    } catch (e) {
      logError('invite_decline_failed', e, { inviteId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }

  async function handleInvite(subgroupId: string, inviteeId: string) {
    mediumTap();
    logEvent('invite_send', { subgroupId, inviteeId });
    try {
      await inviteToSubgroup(subgroupId, inviteeId);
      logEvent('invite_send_ok', { subgroupId, inviteeId });
      // Demo has no realtime channel to nudge the invite list, and simulates
      // the invitee replying with a join-request — pull it in so the pending
      // approve/decline card shows immediately.
      if (isDemoGroup(groupId)) refreshInvites();
      Alert.alert(t('subgroup.inviteSent'));
    } catch (e) {
      logError('invite_send_failed', e, { subgroupId, inviteeId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }

  // Any member can split themselves into their own new (collab, no-leader)
  // subgroup, or merge themselves back up a level — no leader say-so needed.
  async function doSelfSplit() {
    if (!groupId) return;
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
  }
  async function doSelfMerge() {
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
  }

  // Report-a-problem: grab the current screen, then swap the settings overlay
  // for the feedback form. Uses the SAME `overlay` state so the two are
  // mutually exclusive — opening feedback closes settings, so the translucent
  // panels can never stack and interleave their text.
  async function openFeedback() {
    lightTap();
    let uri: string | null = null;
    try {
      uri = await captureScreen({ format: 'jpg', quality: 0.6, result: 'tmpfile' });
    } catch {
      uri = null;
    }
    setFeedbackShot(uri);
    setOverlay('feedback');
  }

  const handleReorder = useCallback(
    async (orderedIds: string[]) => {
      if (!groupId) return;
      logEvent('destination_reorder', { count: orderedIds.length });
      try {
        await reorderDestinations(groupId, orderedIds);
        refresh();
      } catch (e) {
        logError('destination_reorder_failed', e);
        Alert.alert(t('settings.reorderFailed'));
        refresh();
      }
    },
    [groupId, refresh, t],
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

  function confirmLeave() {
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
  }
  function confirmSignOut() {
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
  }

  // --- Account upgrade (anonymous -> email) ---------------------------------
  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [upgradeEmail, setUpgradeEmail] = useState('');
  const [upgradePassword, setUpgradePassword] = useState('');
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const upgradeCanSubmit =
    /\S+@\S+\.\S+/.test(upgradeEmail.trim()) && upgradePassword.length >= 6 && !upgradeBusy;

  function closeUpgrade() {
    setUpgradeVisible(false);
    setUpgradeEmail('');
    setUpgradePassword('');
    setUpgradeError(null);
  }

  async function submitUpgrade() {
    if (!upgradeCanSubmit) return;
    setUpgradeBusy(true);
    setUpgradeError(null);
    try {
      await upgradeToEmailAccount(upgradeEmail.trim(), upgradePassword);
      Alert.alert(t('account.section'), t('account.upgradeSent'));
      closeUpgrade();
    } catch (e) {
      setUpgradeError(e instanceof Error ? e.message : t('account.upgradeSent'));
    } finally {
      setUpgradeBusy(false);
    }
  }

  function confirmResetPrefs() {
    confirmAction(
      {
        title: t('settings.resetPrefs'),
        message: t('settings.resetPrefsConfirm'),
        confirmLabel: t('settings.resetPrefs'),
        destructive: true,
      },
      () => void resetPrefs(),
    );
  }

  async function resetPrefs() {
    logEvent('reset_prefs');
    try {
      await saveOnboardingProfile({});
    } catch (e) {
      logError('reset_prefs_failed', e);
      console.warn('[settings] resetPrefs saveOnboardingProfile failed', e);
    }
    await AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY);
    Alert.alert(t('settings.resetPrefs'), t('settings.resetPrefsDone'));
  }

  function persistStragglerConfig(enabled: boolean, thresholdM: number) {
    if (!groupId) return;
    setStragglerConfig(groupId, enabled, thresholdM)
      .then(() => refresh())
      .catch(() => Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg')));
  }

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
        // Member status chip: arrived (within the radius) > moving (a fresh
        // location ping in the last 2 minutes) > not started (no recent ping).
        const movingRecently =
          !!m.lastUpdated && Date.now() - new Date(m.lastUpdated).getTime() < 2 * 60_000;
        const memberStatusKey = arrived
          ? 'memberStatus.arrived'
          : movingRecently
            ? 'memberStatus.moving'
            : 'memberStatus.notStarted';
        const solo =
          m.userId === user?.id && soloOverride !== null ? soloOverride : !!m.solo;
        return {
          userId: m.userId,
          name: m.name || t('group.travelerFallback'),
          avatar: m.avatar,
          solo,
          subgroupId: m.subgroupId,
          color: memberColor(m.userId),
          isLeader: isMemberLeader,
          memberStatusKey,
          statusText: solo
            ? t('solo.badge')
            : isMemberLeader
              ? t('flock.leading')
              : d == null
                ? t('flock.unknown')
                : arrived
                  ? t('flock.arrived')
                  : t('flock.enroute'),
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
  // Co-members I could still pull into my team. Virtual solo-test mates are
  // excluded in a real group (no one on the other end to accept) — BUT in the
  // demo group they ARE invitable, because handleInvite simulates them
  // accepting; otherwise a solo tester's invite picker is always empty.
  const invitable = flock.filter(
    (f) =>
      f.userId !== user?.id &&
      f.subgroupId !== mySubgroupId &&
      (isDemoGroup(groupId) || !isVirtualMember(f.userId)),
  );

  // One flock row, shared by the main list and the subgroup cards.
  const renderFlockRow = (f: (typeof flock)[number], last: boolean) => {
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
            <Text style={styles.flockMemberStatus}>{t(f.memberStatusKey)}</Text>
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
              <Pressable onPress={() => void doSelfMerge()} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.rowAction, { color: accent }]}>
                  {t('subgroup.leaveTeam')}
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => void doSelfSplit()} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.rowAction, { color: accent }]}>
                  {t('subgroup.createTeam')}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    );
  };

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
        currentUserId={user?.id}
        // Capped at mid: at full the sheet covers the map anyway.
        // ponytail: updates once per detent settle (3 discrete values), not
        // per frame — per-frame MapView prop updates re-render the native map
        // 60×/s; switch to a heightAnim listener if the step reads harsh.
        bottomOverlap={Math.min(detents[detent], detents[1])}
      />

      {/* Group pill + role chip — hidden once a gathering point takes the top slot. */}
      {destinations.length === 0 && (
        <Animated.View
          style={[styles.topRow, { top: insets.top + 8 }, chromeOpacityStyle]}
          pointerEvents={atFull ? 'none' : 'box-none'}
        >
          <liquidGlass.GlassView tintColor={glass.pill} style={styles.groupPill}>
            <View style={styles.pillAvatars}>
              {flock.slice(0, 3).map((f, i) => (
                <View
                  key={f.userId}
                  style={[styles.pillAvatar, { backgroundColor: f.color, marginLeft: i ? -10 : 0 }]}
                >
                  {f.avatar ? <Text style={styles.pillEmoji}>{f.avatar}</Text> : null}
                </View>
              ))}
            </View>
            <Text style={styles.pillName} numberOfLines={1}>
              {group?.name ?? 'Hither'}
            </Text>
            <Text style={styles.pillCount}>· {members.length}</Text>
          </liquidGlass.GlassView>
          <liquidGlass.GlassView tintColor={glass.pill} style={styles.roleChip}>
            <View style={[styles.roleDot, { backgroundColor: accent }]} />
            <Text style={styles.roleWord}>
              {isLeader ? t('settings.roleLeader') : t('settings.roleFollower')}
            </Text>
          </liquidGlass.GlassView>
        </Animated.View>
      )}

      {/* Recenter capsule — rides above the sheet. Fit-all on top, locate-me
          below, sharing one pill-shaped glass surface. */}
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
              return (
                <View key={dest.id} style={{ width: windowWidth, paddingHorizontal: 14 }}>
                  <liquidGlass.GlassView
                    tintColor={active ? glass.cardActive : glass.card}
                    style={[styles.card, active && { borderColor: accentMix(accent, 50) }]}
                  >
                    <View style={styles.cardHead}>
                      <View style={[styles.cardIcon, { backgroundColor: accentMix(accent, 22), borderColor: accentMix(accent, 45) }]}>
                        <CrookIcon size={26} color={accent} />
                      </View>
                      <View style={styles.grow}>
                        <Text style={[styles.cardKicker, { color: accent }]}>
                          {index === 0 ? t('map.nextTag') + ' · ' : ''}
                          {t('map.destinationCounter', { index: index + 1, total: destinations.length })}
                        </Text>
                        <View style={styles.titleRow}>
                          <Text style={styles.cardTitle} numberOfLines={1}>
                            {dest.title}
                          </Text>
                          {d != null && (
                            <Text style={styles.titleDist}>{formatDistance(d)}</Text>
                          )}
                        </View>
                        {myScopeId != null && (
                          <Text style={{ color: glass.textSecondary, fontSize: 11 }}>
                            {t('subgroup.itineraryBadge')}
                          </Text>
                        )}
                      </View>
                      {/* Pagination — lives inside the card now that the
                          carousel sits at the screen's top edge, where there's
                          no room below it for a separate dots row. */}
                      {destinations.length > 1 && (
                        <View style={styles.dots}>
                          {destinations.map((d2, i2) => (
                            <View
                              key={d2.id}
                              style={[styles.dot, i2 === selectedIndex && styles.dotActive]}
                            />
                          ))}
                        </View>
                      )}
                    </View>
                    <View style={styles.cardActions}>
                      <Pressable
                        style={[styles.directions, { backgroundColor: accentMix(accent, 26), borderColor: accentMix(accent, 50) }]}
                        onPress={() => {
                          if (navigatingThis) {
                            void stopNavigation();
                          } else if (isLeader) {
                            // Keep the in-app journey state (flock "going" /
                            // arrival / live activity) AND hand off turn-by-turn
                            // to Apple Maps with the address pre-filled.
                            startNavigation(dest, index);
                            openInAppleMaps(dest);
                          } else {
                            mapRef.current?.centerOn(dest.coordinates);
                          }
                        }}
                        disabled={journeyBusy}
                        accessibilityRole="button"
                      >
                        <CrookIcon size={16} color={accent} />
                        <Text style={styles.directionsText}>
                          {navigatingThis
                            ? t('map.stopNav')
                            : isLeader
                              ? t('map.directions')
                              : t('map.viewOnMap')}
                        </Text>
                      </Pressable>
                      <View style={styles.etaPill}>
                        <Text style={styles.etaPillEta}>
                          {d != null ? shortEta(walkingEtaSeconds(d)) : '—'}
                        </Text>
                      </View>
                    </View>
                    {(meetLabel || canEditItinerary) && (
                      <Pressable
                        style={[
                          styles.meetTimeBtn,
                          meetLabel && {
                            backgroundColor: accentMix(accent, 20),
                            borderColor: accentMix(accent, 45),
                          },
                        ]}
                        onPress={() => openMeetTimePicker(dest)}
                        disabled={!canEditItinerary}
                        accessibilityRole="button"
                        accessibilityLabel={t('meetTime.set')}
                      >
                        <Ionicons
                          name="time-outline"
                          size={15}
                          color={meetLabel ? accent : glass.textSecondary}
                        />
                        <Text
                          style={[
                            styles.meetTimeText,
                            meetLabel ? { color: accent, fontWeight: '700' } : null,
                          ]}
                        >
                          {meetLabel ?? t('meetTime.set')}
                        </Text>
                      </Pressable>
                    )}
                  </liquidGlass.GlassView>
                </View>
              );
            })}
          </ScrollView>
        </Animated.View>
      )}

      {/* Straggler alert banner — sits below the carousel/top pill, below its
          zIndex so it never fights the carousel's own touches. */}
      {group?.stragglerAlerts && stragglers.length > 0 && !stragglerBannerCollapsed && (
        <Animated.View
          style={[
            styles.stragglerBanner,
            { top: insets.top + 8 + (destinations.length > 0 ? 200 : 96) },
            chromeOpacityStyle,
          ]}
          pointerEvents={atFull ? 'none' : 'box-none'}
        >
          <Pressable
            style={styles.stragglerCard}
            onPress={() => setStragglerBannerCollapsed(true)}
            accessibilityRole="button"
          >
            {stragglers.slice(0, 2).map((s) => (
              <Text key={s.userId} style={styles.stragglerText} numberOfLines={1}>
                {t(
                  s.userId === user?.id ? 'straggler.selfWarning' : 'straggler.banner',
                  { name: s.name, distance: formatDistance(s.distanceM) },
                )}
              </Text>
            ))}
            {stragglers.length > 2 && (
              <Text style={styles.stragglerMore}>
                {t('straggler.bannerMore', { n: stragglers.length - 2 })}
              </Text>
            )}
          </Pressable>
        </Animated.View>
      )}

      {/* The pull-up sheet. */}
      <BottomSheet
        height={heightSV}
        detents={detents}
        index={detent}
        onIndexChange={setDetent}
        bottomInset={insets.bottom}
        onHeaderHeight={setSheetHeaderH}
        header={
          /* Search row + account avatar — pinned over the scroll content on
             BottomSheet's frosted header veil (Apple-Maps look). */
          <View style={styles.searchRow}>
            <Pressable
              style={styles.searchField}
              onPress={() => (canEditItinerary ? setSearchVisible(true) : undefined)}
              accessibilityRole="button"
              accessibilityLabel={t('map.searchA11y')}
            >
              <Ionicons name="search" size={17} color={glass.textSecondary} />
              <Text style={styles.searchPlaceholder}>{t('map.searchPlaces')}</Text>
            </Pressable>
            <Pressable
              style={[styles.avatar, { backgroundColor: accent }]}
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
        }
      >
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
        {subgroups.map((sg) => {
          const memberRows = flock.filter((f) => f.subgroupId === sg.id);
          const parentName = subgroups.find((s) => s.id === sg.parentId)?.name;
          return (
            <View key={sg.id} style={styles.subgroupCard}>
              <View style={styles.subgroupHead}>
                <View style={styles.grow}>
                  <Text style={styles.subgroupName}>
                    {sg.name} · {memberRows.length}
                  </Text>
                  <Text style={styles.subgroupMeta}>
                    {t('subgroup.collab')}
                    {parentName ? ` · ${t('subgroup.childOf', { name: parentName })}` : ''}
                  </Text>
                </View>
              </View>
              {memberRows.map((f, i) => renderFlockRow(f, i === memberRows.length - 1))}
              {/* Invite entry lives ON my own team card — where you look to grow
                  the team — instead of buried on every other member's row. */}
              {sg.id === mySubgroupId && (
                <Pressable
                  style={[styles.inviteMemberBtn, { borderColor: accentMix(accent, 45) }]}
                  onPress={() => {
                    lightTap();
                    setInviteSheetOpen(true);
                  }}
                  accessibilityRole="button"
                >
                  <Ionicons name="person-add-outline" size={16} color={accent} />
                  <Text style={[styles.rowAction, { color: accent }]}>
                    {t('subgroup.inviteAction')}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}

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
                value={group.stragglerAlerts}
                onValueChange={(v) => persistStragglerConfig(v, group.stragglerThresholdM)}
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
              value={String(group.stragglerThresholdM)}
              onChange={(v) => persistStragglerConfig(group.stragglerAlerts, Number(v))}
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
      </BottomSheet>

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
            destinations={destinations}
            canReorder={canEditItinerary}
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

      {/* Settings overlay. */}
      <OverlaySheet
        visible={overlay === 'settings'}
        onClose={() => setOverlay(null)}
        title={t('map.overlaySettings')}
        accent={accent}
        doneLabel={t('map.done')}
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          <Text style={styles.sectionLabel}>{t('settings.language')}</Text>
          <Segmented
            accent={accent}
            options={[
              { key: 'zh', label: '中文' },
              { key: 'en', label: 'English' },
            ]}
            value={language}
            onChange={(v) => setLanguage(v as Language)}
          />

          <Text style={styles.sectionLabel}>{t('settings.theme')}</Text>
          <Segmented
            accent={accent}
            options={THEME_ORDER.map((n) => ({
              key: n,
              label: t(
                n === 'night'
                  ? 'settings.themeNight'
                  : n === 'day'
                    ? 'settings.themeDay'
                    : n === 'dusk'
                      ? 'settings.themeDusk'
                      : 'settings.themeForest',
              ),
            }))}
            value={themeName}
            onChange={(v) => setThemeName(v as ThemeName)}
          />

          <Text style={styles.sectionLabel}>{t('settings.locationSection')}</Text>
          <View style={styles.settingSwitchRow}>
            <View style={styles.settingSwitchText}>
              <Text style={styles.settingSwitchLabel}>{t('settings.powerSaver')}</Text>
              <Text style={styles.settingSwitchHint}>{t('settings.powerSaverHint')}</Text>
            </View>
            <Switch
              value={powerSaver}
              onValueChange={setPowerSaver}
              trackColor={{ true: accent, false: 'rgba(120,120,128,0.32)' }}
              thumbColor="#fff"
            />
          </View>

          <Text style={styles.sectionLabel}>{t('settings.notifSection')}</Text>
          {/* Force the LIVE theme accent onto the otherwise-frozen night
              palette so the toggles recolour when the theme changes. */}
          <NotificationPreferencesCard colors={{ ...dark, accent }} />

          <View style={styles.settingsSectionHeaderRow}>
            <Text style={styles.sectionLabel}>{t('account.section')}</Text>
            <Pressable
              style={styles.feedbackEntry}
              onPress={openFeedback}
              accessibilityRole="button"
              accessibilityLabel={t('feedback.title')}
              hitSlop={8}
            >
              <Ionicons name="warning-outline" size={17} color={glass.textSecondary} />
            </Pressable>
          </View>
          {isAnonymous ? (
            <>
              <Text style={styles.overlayHint}>{t('anon.expiryWarning')}</Text>
              <Pressable
                style={styles.accountBtn}
                onPress={() => setUpgradeVisible(true)}
                accessibilityRole="button"
              >
                <Text style={[styles.accountBtnText, { color: accent }]}>
                  {t('account.upgradeButton')}
                </Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.overlayHint}>
              {t('account.signedInAs', { email: user?.email ?? '' })}
            </Text>
          )}

          <Text style={styles.sectionLabel}>{t('paywall.title')}</Text>
          {isPro ? (
            <Text style={styles.overlayHint}>{t('paywall.active')}</Text>
          ) : (
            <Pressable
              style={styles.accountBtn}
              onPress={() => openPaywall()}
              accessibilityRole="button"
            >
              <Text style={[styles.accountBtnText, { color: accent }]}>
                {t('paywall.upgrade')}
              </Text>
            </Pressable>
          )}

          <Pressable style={styles.dangerBtn} onPress={confirmResetPrefs} accessibilityRole="button">
            <Text style={styles.dangerText}>{t('settings.resetPrefs')}</Text>
          </Pressable>
          <Pressable style={styles.dangerBtn} onPress={confirmLeave} accessibilityRole="button">
            <Text style={styles.dangerText}>
              {isLeader ? t('map.endGroup') : t('group.leave')}
            </Text>
          </Pressable>
          <Pressable style={styles.dangerBtn} onPress={confirmSignOut} accessibilityRole="button">
            <Text style={styles.dangerText}>{t('settings.signOut')}</Text>
          </Pressable>
        </ScrollView>
      </OverlaySheet>

      {/* Anonymous -> email upgrade: same uid, keeps profiles/memberships. */}
      <OverlaySheet
        visible={upgradeVisible}
        onClose={closeUpgrade}
        title={t('account.upgradeButton')}
        accent={accent}
        doneLabel={t('map.done')}
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          <Text style={styles.sectionLabel}>{t('account.email')}</Text>
          <View style={styles.profileRow}>
            <TextInput
              style={styles.profileInput}
              value={upgradeEmail}
              onChangeText={setUpgradeEmail}
              placeholder="you@example.com"
              placeholderTextColor={glass.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
          </View>
          <Text style={styles.sectionLabel}>{t('account.password')}</Text>
          <View style={styles.profileRow}>
            <TextInput
              style={styles.profileInput}
              value={upgradePassword}
              onChangeText={setUpgradePassword}
              placeholder={t('account.password')}
              placeholderTextColor={glass.textTertiary}
              autoCapitalize="none"
              secureTextEntry
            />
          </View>
          {upgradeError && <Text style={styles.upgradeError}>{upgradeError}</Text>}
          <Pressable
            style={[styles.accountBtn, !upgradeCanSubmit && { opacity: 0.4 }]}
            onPress={submitUpgrade}
            disabled={!upgradeCanSubmit}
            accessibilityRole="button"
          >
            {upgradeBusy ? (
              <ActivityIndicator color={accent} />
            ) : (
              <Text style={[styles.accountBtnText, { color: accent }]}>
                {t('account.submit')}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </OverlaySheet>

      {/* Profile overlay: nickname + emoji avatar, synced to the group. */}
      <OverlaySheet
        visible={overlay === 'profile'}
        onClose={closeProfile}
        title={t('profile.title')}
        accent={accent}
        doneLabel={t('map.done')}
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          <Text style={styles.sectionLabel}>{t('settings.nickname')}</Text>
          <View style={styles.profileRow}>
            <TextInput
              style={styles.profileInput}
              value={profileName}
              onChangeText={setProfileName}
              maxLength={24}
              placeholder={t('auth.namePlaceholder')}
              placeholderTextColor={glass.textTertiary}
              returnKeyType="done"
              onSubmitEditing={closeProfile}
            />
          </View>

          <Text style={styles.sectionLabel}>{t('profile.avatar')}</Text>
          <View style={styles.emojiGrid}>
            {AVATAR_EMOJI.map((e) => (
              <Pressable
                key={e}
                onPress={() => setProfileAvatar(e)}
                accessibilityRole="button"
                accessibilityState={{ selected: profileAvatar === e }}
                style={[
                  styles.emojiCell,
                  profileAvatar === e && {
                    borderColor: accent,
                    backgroundColor: accentMix(accent, 18),
                  },
                ]}
              >
                <Text style={styles.emojiChar}>{e}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.overlayHint}>{t('profile.syncHint')}</Text>
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
        onClose={() => setSearchVisible(false)}
        biasRegion={biasRegion}
        onPick={handlePickDestination}
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

      {/* iOS meet-time editor: embedded spinner + Set/Clear (Android uses the
          native dialog directly, see openMeetTimePicker). */}
      {Platform.OS !== 'android' && (
        <OverlaySheet
          visible={!!meetTimeEditor}
          onClose={() => setMeetTimeEditor(null)}
          title={t('meetTime.set')}
          accent={accent}
          doneLabel={t('common.cancel')}
        >
          {meetTimeEditor && (
            <View style={styles.meetEditorBody}>
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
      )}
    </View>
  );
}

function Segmented({
  options,
  value,
  onChange,
  accent,
  disabledKeys,
  onDisabledPress,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  accent: string;
  /** Options shown greyed-out/locked; tapping them calls `onDisabledPress` instead of `onChange`. */
  disabledKeys?: string[];
  onDisabledPress?: (key: string) => void;
}) {
  return (
    <View style={segStyles.track}>
      {options.map((o) => {
        const active = o.key === value;
        const locked = !!disabledKeys?.includes(o.key);
        return (
          <Pressable
            key={o.key}
            style={[
              segStyles.seg,
              active && { backgroundColor: 'rgba(255,255,255,0.16)' },
              locked && segStyles.segLocked,
            ]}
            onPress={() => (locked ? onDisabledPress?.(o.key) : onChange(o.key))}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: locked }}
          >
            <Text style={[segStyles.segText, active && { color: '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
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

    carouselWrap: { position: 'absolute', left: 0, right: 0, zIndex: 58 },
    stragglerBanner: { position: 'absolute', left: 14, right: 14, zIndex: 50 },
    stragglerCard: {
      backgroundColor: 'rgba(197,58,68,0.28)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.danger,
      borderRadius: 16,
      paddingVertical: 10,
      paddingHorizontal: 14,
      gap: 2,
    },
    stragglerText: { fontSize: 13.5, fontWeight: '600', color: '#fff' },
    stragglerMore: { fontSize: 12, color: glass.textSecondary, marginTop: 2 },
    card: {
      borderRadius: 22,
      overflow: 'hidden',
      padding: 15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
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
    titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    cardTitle: { flexShrink: 1, fontSize: 18, fontWeight: '600', color: '#fff' },
    titleDist: {
      fontSize: 13,
      fontWeight: '600',
      color: glass.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13 },
    directions: {
      flex: 1,
      height: 44,
      borderRadius: 13,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
    },
    directionsText: { fontSize: 15, fontWeight: '600', color: '#fff' },
    etaPill: {
      height: 44,
      paddingHorizontal: 16,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.fillStrong,
    },
    etaPillEta: { fontSize: 15, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums'] },
    // Prominent capsule pinned at the card's foot (kept compact so the card
    // height barely moves — see the straggler banner's fixed top offset).
    meetTimeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      height: 32,
      borderRadius: 11,
      marginTop: 12,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    meetTimeText: { fontSize: 13, fontWeight: '600', color: glass.textSecondary },
    // Meet-time editor sheet: roomy, full-width controls (not the old cramped
    // left-aligned chips).
    meetEditorBody: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40, gap: 14 },
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
    dotActive: { width: 20, backgroundColor: accent },

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
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.8,
      color: glass.textTertiary,
      marginBottom: 8,
      marginLeft: 4,
      marginTop: 4,
    },
    settingSwitchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 4,
      marginBottom: 12,
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
    flockMemberStatus: { fontSize: 11, color: glass.textTertiary, marginTop: 1 },
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
      marginTop: 12,
      paddingVertical: 11,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
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
