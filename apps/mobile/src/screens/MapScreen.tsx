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
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import GroupMap, { type GroupMapHandle } from '../components/GroupMap';
import DestinationSearch from '../components/DestinationSearch';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { useGroupState } from '../state/useGroupState';
import { useLiveActivity } from '../state/useLiveActivity';
import {
  distanceEtaLabel,
  distanceMeters,
  walkingEtaSeconds,
} from '../utils/geo';
import { location, liquidGlass, type MapRegion, type PlaceResult } from '../native';
import {
  addDestination,
  reorderDestinations,
  setJourneyStatus,
  updateMyLocation,
} from '../api/client';
import { confirmAction } from '../utils/confirm';
import JourneyBanner from '../components/JourneyBanner';
import type { Coordinates, Destination, MemberLocation } from '../types';
import { radius, spacing, type Palette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

// Dark, semi-transparent veil for the on-map glass banners so they stay
// dark-toned and readable over a bright map (instead of washing out to white).
// Still translucent → keeps the frosted-glass feel.
const GLASS_DARK_VEIL = 'rgba(18, 22, 38, 0.55)';

/**
 * Main screen. A live map of group members (pins) and the gathering points
 * (lantern). The bottom card is a horizontally swipeable carousel of every
 * gathering point: swipe right for the next stop, left for the previous (and it
 * stops at both ends). Swiping moves the lantern and recenters the map on the
 * selected point. Group state refreshes via `useGroupState`; the map itself
 * lives in the platform-split `GroupMap` component.
 *
 * Group code / member count moved into Settings (the gear in the header).
 */
export default function MapScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  // The header is transparent (floats over the map), so its height is NOT
  // subtracted from the content area — offset the FAB column past it manually,
  // otherwise the search FAB sits under the header and taps hit the gear.
  const headerHeight = useHeaderHeight();
  const { width: windowWidth } = useWindowDimensions();
  const { membership, user } = useSession();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Prefer the route param; fall back to the session's current group.
  const groupId = route.params?.groupId ?? membership?.group.id ?? null;
  const { state, loading, refresh } = useGroupState(groupId);

  const mapRef = useRef<GroupMapHandle | null>(null);
  const carouselRef = useRef<ScrollView | null>(null);

  // Only the leader can set the group's next gathering point.
  const isLeader = membership?.role === 'leader';
  const [searchVisible, setSearchVisible] = useState(false);

  // Real device GPS, via the native boundary (Expo Go: expo-location).
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);

  const refreshDeviceLocation = useCallback(async (): Promise<Coordinates | null> => {
    const fix = await location.getCurrentLocation();
    if (fix) {
      setDeviceCoords(fix.coordinates);
      // Push our position so the rest of the group can see it, backed by the
      // Supabase `member_locations` table (Phase S). Needs an active group.
      if (groupId) {
        void updateMyLocation(fix.coordinates, groupId);
      }
      return fix.coordinates;
    }
    return null;
  }, [groupId]);

  useEffect(() => {
    void refreshDeviceLocation();
  }, [refreshDeviceLocation]);

  const members = state?.members ?? [];
  const destinations: Destination[] = state?.destinations ?? [];

  // Which gathering point the carousel is showing (and where the lantern is).
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Keep the selection valid as the itinerary changes (stops added/removed) and
  // keep the carousel scrolled to the selected page.
  useEffect(() => {
    const clamped =
      destinations.length === 0
        ? 0
        : Math.min(selectedIndex, destinations.length - 1);
    if (clamped !== selectedIndex) {
      setSelectedIndex(clamped);
    }
    carouselRef.current?.scrollTo({ x: clamped * windowWidth, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinations.length, windowWidth]);

  const selectedDestination: Destination | undefined = destinations[selectedIndex];

  // Move the lantern / map camera onto the selected gathering point.
  useEffect(() => {
    if (selectedDestination) {
      mapRef.current?.centerOn(selectedDestination.coordinates);
    }
  }, [selectedDestination?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Measure distance/ETA from the real device position when we have it,
  // else fall back to the matching member, then the leader.
  const reference = useMemo<MemberLocation | undefined>(() => {
    return (
      members.find((m) => m.userId === user?.id) ??
      members.find((m) => m.role === 'leader') ??
      members[0]
    );
  }, [members, user?.id]);

  const fromCoords = deviceCoords ?? reference?.coordinates;

  const distanceFor = useCallback(
    (dest: Destination): string | null =>
      fromCoords ? distanceEtaLabel(fromCoords, dest.coordinates) : null,
    [fromCoords],
  );

  // --- Journey navigation (Google-Maps-style) + Live Activity --------------
  // A journey targets ONE locked gathering point: starting navigation pins the
  // current selection as `navTargetId`. Browsing the carousel afterwards only
  // pans the map — it does NOT re-route the journey (that was the old jarring
  // "instantly heading to stop 2" behaviour). Navigation ends explicitly
  // (cancel) or automatically on arrival.
  const journeyStatus = state?.group.journeyStatus ?? 'paused';
  const journeyGoing = journeyStatus === 'going';

  const [navTargetId, setNavTargetId] = useState<string | null>(null);
  const navTarget = useMemo<Destination | undefined>(
    () => destinations.find((d) => d.id === navTargetId),
    [destinations, navTargetId],
  );

  // Reconcile the local lock with the synced group status: if the journey is
  // "going" but we have no locked target yet (e.g. after a relaunch), lock onto
  // the current selection once. When the journey stops, drop the lock.
  useEffect(() => {
    if (journeyGoing && !navTargetId && selectedDestination) {
      setNavTargetId(selectedDestination.id);
    } else if (!journeyGoing && navTargetId) {
      setNavTargetId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyGoing]);

  // The journey is "live" (banner + Live Activity) only while going AND a
  // locked gathering point exists.
  const journeyActive = journeyGoing && !!navTarget;

  // Numeric distance/ETA to the LOCKED target, for the Live Activity + arrival.
  const numericDistance =
    fromCoords && navTarget
      ? distanceMeters(fromCoords, navTarget.coordinates)
      : undefined;

  useLiveActivity(journeyActive, {
    groupName: membership?.group.name ?? '',
    gatheringTitle: navTarget?.title,
    distanceMeters: numericDistance,
    etaSeconds:
      numericDistance != null ? walkingEtaSeconds(numericDistance) : undefined,
    gatheringCoordinates: navTarget?.coordinates,
  });

  const [journeyBusy, setJourneyBusy] = useState(false);

  // Start navigating to the currently-selected gathering point (leader only).
  async function startNavigation() {
    if (!groupId || journeyBusy || !selectedDestination) return;
    setJourneyBusy(true);
    setNavTargetId(selectedDestination.id);
    try {
      // Promote the chosen stop to the front of the itinerary: the stops that
      // were ahead of it shift back by one to fill the gap (no order break).
      // e.g. picking stop 2 makes it stop 1 and pushes the old stop 1 to 2.
      if (selectedIndex > 0) {
        const ids = destinations.map((d) => d.id);
        const [moved] = ids.splice(selectedIndex, 1);
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
  }

  // Stop the journey (manual cancel or automatic arrival).
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

  // Auto-arrival: once the leader gets within ~30 m of the locked target, end
  // the journey automatically and announce arrival.
  const ARRIVAL_RADIUS_M = 30;
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
      const title = navTarget?.title ?? '';
      // Near the target: ask whether to end this destination trip instead of
      // silently auto-ending. "繼續前往" leaves the journey running.
      confirmAction(
        {
          title: t('map.arriveTitle'),
          message: t('map.arriveBody', { title }),
          confirmLabel: t('map.arriveConfirm'),
          cancelLabel: t('map.arriveDismiss'),
        },
        () => void stopNavigation(),
      );
    }
  }, [journeyActive, isLeader, numericDistance, navTarget?.title, stopNavigation, t]);

  // "Locate me": pull a fresh fix and center the map on the user's own
  // position (falling back to the last known one if GPS is unavailable).
  async function locateMe() {
    refresh();
    const coords = (await refreshDeviceLocation()) ?? deviceCoords;
    if (coords) {
      mapRef.current?.centerOn(coords);
    }
  }

  // Bias place search toward what the user is looking at, when we know it.
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
    if (!groupId) {
      return;
    }
    try {
      await addDestination(groupId, {
        title: place.name,
        address: place.address,
        coordinates: place.coordinates,
      });
      // The new stop is appended to the end of the trip — jump to it. Setting
      // the index to the (pre-refresh) length targets the about-to-arrive last
      // stop; the clamp effect snaps it to the real last index once data lands.
      setSelectedIndex(destinations.length);
      refresh();
    } catch {
      Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
    }
  }

  function handleMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (destinations.length === 0) {
      return;
    }
    const index = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
    const clamped = Math.max(0, Math.min(index, destinations.length - 1));
    if (clamped !== selectedIndex) {
      setSelectedIndex(clamped);
    }
  }

  if (loading && !state) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>{t('map.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <GroupMap
        ref={mapRef}
        members={members}
        gathering={selectedDestination}
        currentUserId={user?.id}
      />

      {/* Right-side action column. */}
      <View style={[styles.fabColumn, { top: headerHeight + spacing.sm }]}>
        {/* Search a place to set the next gathering point (leader only). */}
        {isLeader && (
          <liquidGlass.GlassView style={styles.fab}>
            <Pressable
              style={styles.fabPressable}
              onPress={() => setSearchVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={t('map.searchA11y')}
            >
              <Ionicons name="search" size={20} color={colors.textPrimary} />
            </Pressable>
          </liquidGlass.GlassView>
        )}

        {/* Center the map on my own location. */}
        <liquidGlass.GlassView style={styles.fab}>
          <Pressable
            style={styles.fabPressable}
            onPress={locateMe}
            accessibilityRole="button"
            accessibilityLabel={t('map.locateA11y')}
          >
            <Ionicons name="locate" size={20} color={colors.textPrimary} />
          </Pressable>
        </liquidGlass.GlassView>
      </View>

      {/* Bottom: swipeable carousel of gathering points (lantern follows). */}
      <View style={[styles.carouselWrap, { bottom: insets.bottom + spacing.lg }]}>
        {/* Journey banner mirrors the iOS Live Activity while going. Shows the
            LOCKED target (not the browsed carousel page) and a cancel button. */}
        {journeyActive && navTarget && (
          <View style={{ width: windowWidth - spacing.lg * 2 }}>
            <JourneyBanner
              gatheringTitle={navTarget.title}
              distanceEta={distanceFor(navTarget)}
              colors={colors}
              tintColor={GLASS_DARK_VEIL}
              onCancel={isLeader ? stopNavigation : undefined}
              cancelLabel={t('map.navCancel')}
            />
          </View>
        )}
        {destinations.length === 0 ? (
          <liquidGlass.GlassView
            tintColor={GLASS_DARK_VEIL}
            style={[styles.card, { width: windowWidth - spacing.lg * 2 }]}
          >
            <Text style={styles.cardLabel}>{t('map.nextLabel')}</Text>
            <Text style={styles.cardMeta}>
              {isLeader ? t('map.noDestinationLeader') : t('map.noDestination')}
            </Text>
          </liquidGlass.GlassView>
        ) : (
          <>
            <ScrollView
              ref={carouselRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handleMomentumEnd}
              scrollEventThrottle={16}
            >
              {destinations.map((dest, index) => (
                <View
                  key={dest.id}
                  style={[styles.page, { width: windowWidth }]}
                >
                  <liquidGlass.GlassView tintColor={GLASS_DARK_VEIL} style={styles.card}>
                    <Text style={styles.cardLabel}>
                      {t('map.nextLabel')} ·{' '}
                      {t('map.destinationCounter', {
                        index: index + 1,
                        total: destinations.length,
                      })}
                    </Text>
                    <Text style={styles.cardTitle}>{dest.title}</Text>
                    <Text style={styles.cardMeta}>
                      {distanceFor(dest) ?? t('map.calcDistance')}
                    </Text>
                  </liquidGlass.GlassView>
                </View>
              ))}
            </ScrollView>

            {/* Page dots. */}
            {destinations.length > 1 && (
              <View style={styles.dots}>
                {destinations.map((dest, index) => (
                  <View
                    key={dest.id}
                    style={[
                      styles.dot,
                      index === selectedIndex && styles.dotActive,
                    ]}
                  />
                ))}
              </View>
            )}

            {/* Start navigating to the selected stop (leader only, when idle).
                Moved here from the top-right FAB column. */}
            {isLeader && !journeyActive && selectedDestination && (
              <Pressable
                style={[
                  styles.startButton,
                  { width: windowWidth - spacing.lg * 2 },
                  journeyBusy && styles.startButtonBusy,
                ]}
                onPress={startNavigation}
                disabled={journeyBusy}
                accessibilityRole="button"
                accessibilityLabel={t('map.navStartA11y')}
              >
                <Text style={styles.startButtonText}>{t('map.navStart')}</Text>
              </Pressable>
            )}
          </>
        )}
      </View>

      <DestinationSearch
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        biasRegion={biasRegion}
        onPick={handlePickDestination}
      />
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  loadingText: { color: colors.textSecondary, fontSize: 15 },
  fabColumn: {
    position: 'absolute',
    right: spacing.lg,
    gap: spacing.sm,
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
  },
  fabActive: {
    borderColor: colors.accent,
    borderWidth: 2,
  },
  fabPressable: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabIcon: { fontSize: 20 },
  carouselWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: spacing.sm,
  },
  page: {
    paddingHorizontal: spacing.lg,
  },
  card: {
    overflow: 'hidden',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.accent,
  },
  // Light text: the card sits on the forced-dark glass veil (GLASS_DARK_VEIL)
  // regardless of theme, so it must read against a dark surface.
  cardTitle: { fontSize: 20, fontWeight: '700', color: '#F5F7FC' },
  cardMeta: { fontSize: 15, color: 'rgba(255,255,255,0.72)' },
  dots: {
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.accent,
    width: 18,
  },
  startButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonBusy: { opacity: 0.6 },
  startButtonText: {
    color: colors.accentText,
    fontSize: 16,
    fontWeight: '700',
  },
});
