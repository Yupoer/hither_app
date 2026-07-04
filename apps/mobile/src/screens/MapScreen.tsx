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
  NativeScrollEvent,
  NativeSyntheticEvent,
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
import CrookIcon from '../components/CrookIcon';
import { useSession } from '../state/SessionContext';
import { usePreferences, useTheme, type Language } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { useGroupState } from '../state/useGroupState';
import { useSubgroupInvites } from '../state/useSubgroupInvites';
import { useLiveActivity } from '../state/useLiveActivity';
import {
  distanceMeters,
  formatDistance,
  walkingEtaSeconds,
} from '../utils/geo';
import { liquidGlass, location, type MapRegion, type PlaceResult } from '../native';
import {
  addDestination,
  deleteDestination,
  inviteToSubgroup,
  reorderDestinations,
  selfMerge,
  selfSplit,
  setJourneyStatus,
  setSolo,
  updateMyLocation,
} from '../api/client';
import { isDemoGroup } from '../api/demo';
import { isVirtualMember } from '../api/virtualMates';
import { confirmAction } from '../utils/confirm';
import type { Coordinates, Destination, MemberLocation } from '../types';
import { themes, THEME_ORDER, type ThemeName } from '../theme';
import { glass, accentMix, memberColor } from '../glass';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

const ARRIVAL_RADIUS_M = 30;

/** Preset emoji avatars for the profile editor. */
const AVATAR_EMOJI = [
  '🐑', '🐺', '🦊', '🐰', '🐻', '🐼', '🐸', '🐥',
  '🦁', '🐯', '🐨', '🐢', '🐙', '🦄', '🐳', '🦉',
  '⭐', '🔥', '🌙', '🍀', '🍎', '⚽', '🎧', '🎈',
] as const;
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
  const { membership, user, updateProfile, leaveGroup, signOut } = useSession();
  const { language, themeName, setLanguage, setThemeName } = usePreferences();
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
  const destinations: Destination[] = state?.destinations ?? [];

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
  const [overlay, setOverlay] = useState<null | 'route' | 'settings' | 'profile'>(null);
  const [searchVisible, setSearchVisible] = useState(false);
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
    try {
      await addDestination(groupId, {
        title: place.name,
        address: place.address,
        coordinates: place.coordinates,
      });
      setSelectedIndex(destinations.length);
      mapRef.current?.centerOn(place.coordinates);
      refresh();
    } catch {
      Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
    }
  }

  function handleMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (destinations.length === 0) return;
    const index = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
    const clamped = Math.max(0, Math.min(index, destinations.length - 1));
    if (clamped !== selectedIndex) {
      setSelectedIndex(clamped);
      mapRef.current?.centerOn(destinations[clamped].coordinates);
    }
  }

  // --- Group actions --------------------------------------------------------
  const [codeCopied, setCodeCopied] = useState(false);
  async function copyCode() {
    if (!group) return;
    await Clipboard.setStringAsync(group.inviteCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }
  async function shareCode() {
    if (!group) return;
    await Share.share({ message: t('map.shareMsg', { code: group.inviteCode }) });
  }

  // --- Profile (nickname + emoji avatar) ------------------------------------
  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState<string | undefined>(undefined);
  function openProfile() {
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
    updateProfile(fields)
      .then(() => refresh())
      .catch((e) =>
        Alert.alert(
          t('profile.saveFailed'),
          e instanceof Error ? e.message : undefined,
        ),
      );
  }

  // --- Solo mode -------------------------------------------------------------
  async function toggleSolo(next: boolean) {
    if (!groupId) return;
    setSoloOverride(next);
    try {
      await setSolo(groupId, next);
      // memberships is realtime-subscribed (useGroupState); its debounced
      // reload refreshes `members` and clears the override above once it
      // matches — no need to force an extra fetch here.
    } catch (e) {
      setSoloOverride(null);
      Alert.alert(t('solo.failed'), e instanceof Error ? e.message : undefined);
    }
  }

  // --- Subgroups (小隊：邀請制、無隊長) ---------------------------------------
  const subgroups = state?.subgroups ?? [];
  const { invites: pendingInvites, accept: acceptInvite, decline: declineInvite } =
    useSubgroupInvites();

  async function handleAcceptInvite(inviteId: string) {
    try {
      await acceptInvite(inviteId);
      refresh();
    } catch (e) {
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }
  async function handleDeclineInvite(inviteId: string) {
    try {
      await declineInvite(inviteId);
    } catch (e) {
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }

  async function handleInvite(subgroupId: string, inviteeId: string) {
    try {
      await inviteToSubgroup(subgroupId, inviteeId);
      Alert.alert(t('subgroup.inviteSent'));
    } catch (e) {
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }

  // Any member can split themselves into their own new (collab, no-leader)
  // subgroup, or merge themselves back up a level — no leader say-so needed.
  async function doSelfSplit() {
    if (!groupId) return;
    try {
      await selfSplit(
        groupId,
        t('subgroup.selfSplitName', { name: user?.name ?? t('group.travelerFallback') }),
      );
      refresh();
    } catch (e) {
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }
  async function doSelfMerge() {
    if (!groupId) return;
    try {
      await selfMerge(groupId);
      refresh();
    } catch (e) {
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }

  const handleReorder = useCallback(
    async (orderedIds: string[]) => {
      if (!groupId) return;
      try {
        await reorderDestinations(groupId, orderedIds);
        refresh();
      } catch {
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
          try {
            await deleteDestination(groupId, id);
            refresh();
          } catch {
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
        void signOut();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      },
    );
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
        const d =
          m.coordinates && activePoint
            ? distanceMeters(m.coordinates, activePoint.coordinates)
            : null;
        const arrived = d != null && d <= ARRIVAL_RADIUS_M;
        const isMemberLeader = m.role === 'leader';
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
          eta: isMemberLeader ? '—' : d != null ? shortEta(walkingEtaSeconds(d)) : '',
          dist: isMemberLeader ? t('flock.here') : d != null ? formatDistance(d) : '',
          arrived,
        };
      }),
    [members, activePoint, accent, t, user?.id, soloOverride],
  );

  // Drop the override once the server value catches up, so a later toggle
  // (from this device or another) isn't masked by a stale optimistic flip.
  useEffect(() => {
    if (soloOverride === null) return;
    const mine = members.find((m) => m.userId === user?.id);
    if (mine && !!mine.solo === soloOverride) setSoloOverride(null);
  }, [members, soloOverride, user?.id]);

  const topFlock = flock.filter((f) => !f.subgroupId);
  // My own subgroup, if any — drives which other rows get an "Invite" button.
  const mySubgroupId = flock.find((f) => f.userId === user?.id)?.subgroupId;

  // One flock row, shared by the main list and the subgroup cards.
  const renderFlockRow = (f: (typeof flock)[number], last: boolean) => {
    const isMe = f.userId === user?.id;
    // Show "invite" on a real (non-virtual), non-me row that isn't already in
    // my team — only meaningful once I'm in a team myself.
    const canInvite =
      !isMe &&
      !!mySubgroupId &&
      f.subgroupId !== mySubgroupId &&
      !isVirtualMember(f.userId);
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
        {canInvite && mySubgroupId && (
          <Pressable
            onPress={() => void handleInvite(mySubgroupId, f.userId)}
            hitSlop={8}
            accessibilityRole="button"
            style={styles.inviteRow}
          >
            <Text style={[styles.rowAction, { color: accent }]}>{t('subgroup.inviteAction')}</Text>
          </Pressable>
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

      {/* Recenter — rides above the sheet. */}
      <Animated.View
        style={[styles.recenter, recenterStyle]}
        pointerEvents={atFull ? 'none' : 'auto'}
      >
        <Pressable
          style={styles.recenterHit}
          onPress={locateMe}
          accessibilityRole="button"
          accessibilityLabel={t('map.locateA11y')}
        >
          <liquidGlass.GlassView
            tintColor={glass.pill}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Ionicons name="navigate" size={20} color="#fff" />
        </Pressable>
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
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          {dest.title}
                        </Text>
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
                        onPress={() =>
                          navigatingThis
                            ? void stopNavigation()
                            : isLeader
                              ? startNavigation(dest, index)
                              : mapRef.current?.centerOn(dest.coordinates)
                        }
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
                        <Text style={styles.etaPillDist}>
                          {d != null ? formatDistance(d) : ''}
                        </Text>
                      </View>
                    </View>
                  </liquidGlass.GlassView>
                </View>
              );
            })}
          </ScrollView>
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
              onPress={() => (isLeader ? setSearchVisible(true) : undefined)}
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
        </View>
        {pendingInvites.length > 0 && (
          <View style={styles.list}>
            {pendingInvites.map((inv, i) => (
              <View
                key={inv.id}
                style={[styles.flockRow, i === pendingInvites.length - 1 && styles.flockRowLast]}
              >
                <Text style={styles.flockName}>
                  {t('subgroup.invitePrompt', { name: inv.inviterName, team: inv.subgroupName })}
                </Text>
                <View style={styles.splitActions}>
                  <Pressable
                    style={[styles.chip, { backgroundColor: accentMix(accent, 24), borderColor: accentMix(accent, 50) }]}
                    onPress={() => void handleAcceptInvite(inv.id)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.chipText}>{t('subgroup.accept')}</Text>
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
            ))}
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
        <Pressable style={styles.rowButton} onPress={() => setOverlay('route')} accessibilityRole="button">
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

        {/* Quick commands. */}
        <Text style={styles.sheetHeading}>
          {isLeader ? t('map.cmdLeaderTitle') : t('map.cmdFollowerTitle')}
        </Text>
        {groupId ? (
          <QuickCommandsCard groupId={groupId} isLeader={!!isLeader} colors={dark} />
        ) : null}

        {/* Settings. */}
        <Pressable style={styles.settingsButton} onPress={() => setOverlay('settings')} accessibilityRole="button">
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
            canReorder={!!isLeader}
            onReorder={handleReorder}
            onDelete={isLeader ? handleDelete : undefined}
            colors={dark}
            emptyLabel={t('settings.noDestinations')}
            onDragActiveChange={(active) => setRouteScrollEnabled(!active)}
          />
          {isLeader && (
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
                    : 'settings.themeDusk',
              ),
            }))}
            value={themeName}
            onChange={(v) => setThemeName(v as ThemeName)}
          />

          <Text style={styles.sectionLabel}>{t('settings.notifSection')}</Text>
          <NotificationPreferencesCard colors={dark} />

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

      <DestinationSearch
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        biasRegion={biasRegion}
        onPick={handlePickDestination}
      />
    </View>
  );
}

function Segmented({
  options,
  value,
  onChange,
  accent,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  accent: string;
}) {
  return (
    <View style={segStyles.track}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            style={[segStyles.seg, active && { backgroundColor: 'rgba(255,255,255,0.16)' }]}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
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
    recenterHit: {
      width: 48,
      height: 48,
      borderRadius: 24,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineStrong,
    },

    carouselWrap: { position: 'absolute', left: 0, right: 0, zIndex: 58 },
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
    cardTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
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
    etaPillDist: { fontSize: 11, color: glass.textSecondary },
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
    emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    emojiCell: {
      width: 52,
      height: 52,
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
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.8,
      color: glass.textTertiary,
      marginBottom: 8,
      marginLeft: 4,
      marginTop: 4,
    },
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
    inviteRow: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(255,255,255,0.08)',
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
  });
