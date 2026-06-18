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
import { addDestination, setJourneyStatus, updateMyLocation } from '../api/client';
import JourneyBanner from '../components/JourneyBanner';
import type { Coordinates, Destination, MemberLocation } from '../types';
import { radius, spacing, type Palette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

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

  // --- Journey (leader start/pause) + Live Activity ------------------------
  const journeyStatus = state?.group.journeyStatus ?? 'paused';
  const journeyGoing = journeyStatus === 'going';
  // The journey is "live" (banner + Live Activity) only when started AND there
  // is a gathering point to head toward.
  const journeyActive = journeyGoing && !!selectedDestination;

  // Numeric distance/ETA to the selected gathering point, for the Live Activity.
  const numericDistance =
    fromCoords && selectedDestination
      ? distanceMeters(fromCoords, selectedDestination.coordinates)
      : undefined;

  useLiveActivity(journeyActive, {
    groupName: membership?.group.name ?? '',
    gatheringTitle: selectedDestination?.title,
    distanceMeters: numericDistance,
    etaSeconds:
      numericDistance != null ? walkingEtaSeconds(numericDistance) : undefined,
    gatheringCoordinates: selectedDestination?.coordinates,
  });

  const [journeyBusy, setJourneyBusy] = useState(false);
  // Leader toggles start/pause; followers follow along via realtime.
  async function toggleJourney() {
    if (!groupId || journeyBusy) return;
    setJourneyBusy(true);
    try {
      await setJourneyStatus(groupId, journeyGoing ? 'paused' : 'going');
      refresh();
    } catch {
      Alert.alert(t('map.setFailedTitle'), t('map.journeyFailed'));
    } finally {
      setJourneyBusy(false);
    }
  }

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
      <View style={[styles.fabColumn, { top: insets.top + spacing.sm }]}>
        {/* Search a place to set the next gathering point (leader only). */}
        {isLeader && (
          <liquidGlass.GlassView style={styles.fab}>
            <Pressable
              style={styles.fabPressable}
              onPress={() => setSearchVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={t('map.searchA11y')}
            >
              <Text style={styles.fabIcon}>🔍</Text>
            </Pressable>
          </liquidGlass.GlassView>
        )}

        {/* Start / pause heading to the gathering point (leader only). */}
        {isLeader && (
          <liquidGlass.GlassView
            style={[styles.fab, journeyGoing && styles.fabActive]}
          >
            <Pressable
              style={styles.fabPressable}
              onPress={toggleJourney}
              disabled={journeyBusy}
              accessibilityRole="button"
              accessibilityLabel={
                journeyGoing ? t('map.pauseA11y') : t('map.startA11y')
              }
            >
              <Text style={styles.fabIcon}>{journeyGoing ? '⏸️' : '▶️'}</Text>
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
            <Text style={styles.fabIcon}>📍</Text>
          </Pressable>
        </liquidGlass.GlassView>
      </View>

      {/* Bottom: swipeable carousel of gathering points (lantern follows). */}
      <View style={[styles.carouselWrap, { bottom: insets.bottom + spacing.lg }]}>
        {/* Journey banner mirrors the iOS Live Activity while going. */}
        {journeyActive && selectedDestination && (
          <View style={{ width: windowWidth - spacing.lg * 2 }}>
            <JourneyBanner
              gatheringTitle={selectedDestination.title}
              distanceEta={distanceFor(selectedDestination)}
              colors={colors}
            />
          </View>
        )}
        {destinations.length === 0 ? (
          <liquidGlass.GlassView style={[styles.card, { width: windowWidth - spacing.lg * 2 }]}>
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
                  <liquidGlass.GlassView style={styles.card}>
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
    borderWidth: 1,
    borderColor: colors.border,
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
    borderWidth: 1,
    borderColor: colors.border,
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
  cardTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  cardMeta: { fontSize: 15, color: colors.textSecondary },
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
});
