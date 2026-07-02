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
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
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
import BottomSheet from '../components/BottomSheet';
import OverlaySheet from '../components/OverlaySheet';
import CrookIcon from '../components/CrookIcon';
import { useSession } from '../state/SessionContext';
import { usePreferences, useTheme, type Language } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { useGroupState } from '../state/useGroupState';
import { useLiveActivity } from '../state/useLiveActivity';
import {
  distanceMeters,
  formatDistance,
  walkingEtaSeconds,
} from '../utils/geo';
import { location, type MapRegion, type PlaceResult } from '../native';
import {
  addDestination,
  deleteDestination,
  reorderDestinations,
  setJourneyStatus,
  updateMyLocation,
} from '../api/client';
import { confirmAction } from '../utils/confirm';
import type { Coordinates, Destination, MemberLocation } from '../types';
import { themes, THEME_ORDER, type ThemeName } from '../theme';
import { glass, accentMix, memberColor, SHEET_FULL_HEIGHT } from '../glass';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

const ARRIVAL_RADIUS_M = 30;
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
  const { membership, user, updateNickname, leaveGroup, signOut } = useSession();
  const { language, themeName, setLanguage, setThemeName } = usePreferences();
  const { colors } = useTheme();
  const accent = colors.accent;
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(accent), [accent]);
  // Embedded themed components (reorder list, notifications, commands) always
  // render on the dark glass overlay — force the night palette so they stay dark.
  const dark = themes.night;

  const groupId = route.params?.groupId ?? membership?.group.id ?? null;
  const group = membership?.group ?? null;
  const isLeader = membership?.role === 'leader';
  const { state, loading, refresh } = useGroupState(groupId);

  const mapRef = useRef<GroupMapHandle | null>(null);
  const carouselRef = useRef<ScrollView | null>(null);

  const members = state?.members ?? [];
  const destinations: Destination[] = state?.destinations ?? [];

  // --- Sheet / overlay / island UI state -----------------------------------
  const detents = useMemo(() => {
    // Peek shows just the search bar + avatar row (the sheet floats
    // insets.bottom + 10 above the screen edge, so no inset is added here).
    const peek = 82;
    const full = Math.min(
      SHEET_FULL_HEIGHT,
      windowHeight - insets.top - insets.bottom - 30,
    );
    const mid = Math.round(full * 0.56);
    return [peek, mid, full];
  }, [insets.bottom, insets.top, windowHeight]);
  const heightAnim = useRef(new Animated.Value(detents[0])).current;
  const [detent, setDetent] = useState(0);
  const [overlay, setOverlay] = useState<null | 'route' | 'settings'>(null);
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

  const selectedDestination: Destination | undefined = destinations[selectedIndex];
  useEffect(() => {
    if (selectedDestination) mapRef.current?.centerOn(selectedDestination.coordinates);
  }, [selectedDestination?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      try {
        if (index > 0) {
          const ids = destinations.map((d) => d.id);
          const [moved] = ids.splice(index, 1);
          ids.unshift(moved);
          await reorderDestinations(groupId, ids);
          setSelectedIndex(0);
        }
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
      refresh();
    } catch {
      Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
    }
  }

  function handleMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (destinations.length === 0) return;
    const index = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
    const clamped = Math.max(0, Math.min(index, destinations.length - 1));
    if (clamped !== selectedIndex) setSelectedIndex(clamped);
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

  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  async function saveNickname() {
    const trimmed = nicknameDraft.trim();
    if (!trimmed) return;
    try {
      await updateNickname(trimmed);
      setEditingNickname(false);
    } catch {
      Alert.alert(t('settings.nicknameFailed'));
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
        navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
      },
    );
  }

  // --- Derived view models --------------------------------------------------
  const flock = useMemo(
    () =>
      members.map((m) => {
        const d =
          m.coordinates && activePoint
            ? distanceMeters(m.coordinates, activePoint.coordinates)
            : null;
        const arrived = d != null && d <= ARRIVAL_RADIUS_M;
        const isMemberLeader = m.role === 'leader';
        return {
          userId: m.userId,
          name: m.name || t('group.travelerFallback'),
          color: memberColor(m.userId),
          isLeader: isMemberLeader,
          statusText: isMemberLeader
            ? t('flock.leading')
            : d == null
              ? t('flock.unknown')
              : arrived
                ? t('flock.arrived')
                : t('flock.enroute'),
          statusColor: isMemberLeader
            ? accent
            : arrived
              ? glass.ok
              : glass.textSecondary,
          eta: isMemberLeader ? '—' : d != null ? shortEta(walkingEtaSeconds(d)) : '',
          dist: isMemberLeader ? t('flock.here') : d != null ? formatDistance(d) : '',
          arrived,
        };
      }),
    [members, activePoint, accent, t],
  );

  // Floating chrome rides just above the sheet's live top edge (the sheet
  // itself floats insets.bottom + 10 off the screen bottom).
  const chromeBottom = Animated.add(heightAnim, insets.bottom + 22);
  const carouselOpacity = heightAnim.interpolate({
    inputRange: [detents[0], detents[0] + 90],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

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
      />

      {/* Group pill + role chip. */}
      <View
        style={[styles.topRow, { top: insets.top + 8 }]}
        pointerEvents="box-none"
      >
        <View style={styles.groupPill}>
          <View style={styles.pillAvatars}>
            {flock.slice(0, 3).map((f, i) => (
              <View
                key={f.userId}
                style={[styles.pillAvatar, { backgroundColor: f.color, marginLeft: i ? -10 : 0 }]}
              />
            ))}
          </View>
          <Text style={styles.pillName} numberOfLines={1}>
            {group?.name ?? 'Hither'}
          </Text>
          <Text style={styles.pillCount}>· {members.length}</Text>
        </View>
        <View style={styles.roleChip}>
          <View style={[styles.roleDot, { backgroundColor: accent }]} />
          <Text style={styles.roleWord}>
            {isLeader ? t('settings.roleLeader') : t('settings.roleFollower')}
          </Text>
        </View>
      </View>

      {/* Recenter — rides above the sheet. */}
      <Animated.View style={[styles.recenter, { bottom: chromeBottom }]}>
        <Pressable
          style={styles.recenterHit}
          onPress={locateMe}
          accessibilityRole="button"
          accessibilityLabel={t('map.locateA11y')}
        >
          <Ionicons name="navigate" size={20} color="#fff" />
        </Pressable>
      </Animated.View>

      {/* Floating gathering-point carousel (peek only). */}
      {destinations.length > 0 && (
        <Animated.View
          style={[styles.carouselWrap, { bottom: chromeBottom, opacity: carouselOpacity }]}
          pointerEvents={detent === 0 ? 'auto' : 'none'}
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
              return (
                <View key={dest.id} style={{ width: windowWidth, paddingHorizontal: 14 }}>
                  <View
                    style={[
                      styles.card,
                      { backgroundColor: active ? glass.cardActive : glass.card },
                      active && { borderColor: accentMix(accent, 50) },
                    ]}
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
                    </View>
                    <View style={styles.cardActions}>
                      <Pressable
                        style={[styles.directions, { backgroundColor: accentMix(accent, 26), borderColor: accentMix(accent, 50) }]}
                        onPress={() => (isLeader ? startNavigation(dest, index) : mapRef.current?.centerOn(dest.coordinates))}
                        disabled={journeyBusy}
                        accessibilityRole="button"
                      >
                        <CrookIcon size={16} color={accent} />
                        <Text style={styles.directionsText}>
                          {isLeader ? t('map.directions') : t('map.viewOnMap')}
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
                  </View>
                </View>
              );
            })}
          </ScrollView>
          {destinations.length > 1 && (
            <View style={styles.dots}>
              {destinations.map((dest, index) => (
                <View
                  key={dest.id}
                  style={[styles.dot, index === selectedIndex && styles.dotActive]}
                />
              ))}
            </View>
          )}
        </Animated.View>
      )}

      {/* The pull-up sheet. */}
      <BottomSheet
        heightAnim={heightAnim}
        detents={detents}
        index={detent}
        onIndexChange={setDetent}
        bottomInset={insets.bottom}
      >
        {/* Search row + account avatar. */}
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
          <View style={[styles.avatar, { backgroundColor: accent }]}>
            <Text style={styles.avatarText}>
              {(user?.name ?? '?').slice(0, 1).toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Group code + share / copy. */}
        <View style={styles.codeRow}>
          <View style={styles.grow}>
            <Text style={styles.sectionLabel}>{t('group.codeLabel')}</Text>
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

        {/* Flock. */}
        <Text style={styles.sectionLabel}>
          {t('map.flockLabel')} · {members.length}
        </Text>
        <View style={styles.list}>
          {flock.map((f, i) => (
            <View
              key={f.userId}
              style={[styles.flockRow, i === flock.length - 1 && styles.flockRowLast]}
            >
              <View
                style={[
                  styles.flockAvatar,
                  { backgroundColor: f.color, borderColor: f.isLeader ? accent : 'transparent' },
                ]}
              >
                <Text style={styles.flockInitial}>{f.name.slice(0, 1).toUpperCase()}</Text>
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
          ))}
        </View>

        {/* Gathering points → route overlay. */}
        <Pressable style={styles.rowButton} onPress={() => setOverlay('route')} accessibilityRole="button">
          <View style={[styles.rowIcon, { backgroundColor: accentMix(accent, 20) }]}>
            <CrookIcon size={22} color={accent} />
          </View>
          <View style={styles.grow}>
            <Text style={styles.rowTitle}>{t('map.gatheringPoints')}</Text>
            <Text style={styles.rowSub}>
              {t('map.stopsReorder', { count: destinations.length })}
            </Text>
          </View>
          <Text style={[styles.rowAction, { color: accent }]}>{t('map.edit')}</Text>
        </Pressable>

        {/* Quick commands. */}
        <Text style={styles.sectionLabel}>
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
          <Text style={styles.sectionLabel}>{t('settings.accountSection')}</Text>
          <View style={styles.settingsCard}>
            <View style={styles.settingsRow}>
              <Text style={styles.settingsRowLabel}>{t('settings.nickname')}</Text>
              {editingNickname ? (
                <View style={styles.editGroup}>
                  <TextInput
                    style={styles.nickInput}
                    value={nicknameDraft}
                    onChangeText={setNicknameDraft}
                    autoFocus
                    maxLength={24}
                    onSubmitEditing={saveNickname}
                    returnKeyType="done"
                    placeholderTextColor={glass.textTertiary}
                  />
                  <Pressable onPress={saveNickname} style={[styles.saveBtn, { backgroundColor: accent }]}>
                    <Text style={styles.saveText}>{t('settings.save')}</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.editGroup}>
                  <Text style={styles.settingsValue}>{user?.name ?? '—'}</Text>
                  <Pressable
                    onPress={() => {
                      setNicknameDraft(user?.name ?? '');
                      setEditingNickname(true);
                    }}
                  >
                    <Text style={[styles.rowAction, { color: accent }]}>{t('settings.edit')}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>

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
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      backgroundColor: glass.pill,
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
    },
    pillName: { fontSize: 15, fontWeight: '600', color: '#fff', flexShrink: 1 },
    pillCount: { fontSize: 14, color: glass.textSecondary },
    roleChip: {
      height: 44,
      paddingHorizontal: 16,
      borderRadius: 22,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: glass.pill,
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
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glass.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineStrong,
    },

    carouselWrap: { position: 'absolute', left: 0, right: 0, zIndex: 58 },
    card: {
      borderRadius: 22,
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
    dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 10 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
    dotActive: { width: 20, backgroundColor: accent },

    // Sheet content
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20, marginTop: 4 },
    searchField: {
      flex: 1,
      height: 46,
      borderRadius: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 14,
      backgroundColor: 'rgba(118,118,128,0.26)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.08)',
    },
    searchPlaceholder: { fontSize: 16, color: 'rgba(235,235,245,0.5)' },
    avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: 17, fontWeight: '700', color: '#fff' },

    codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
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
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    flockRowLast: { borderBottomWidth: 0 },
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
      marginTop: 8,
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

    settingsCard: {
      borderRadius: 18,
      paddingHorizontal: 16,
      marginBottom: 8,
      backgroundColor: glass.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairline,
    },
    settingsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
    },
    settingsRowLabel: { fontSize: 16, color: '#fff' },
    settingsValue: { fontSize: 16, color: glass.textSecondary },
    editGroup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    nickInput: {
      minWidth: 120,
      color: '#fff',
      fontSize: 16,
      textAlign: 'right',
      borderBottomWidth: 1,
      borderBottomColor: accent,
      paddingVertical: 2,
    },
    saveBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
    saveText: { color: '#1A1206', fontSize: 14, fontWeight: '700' },
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
