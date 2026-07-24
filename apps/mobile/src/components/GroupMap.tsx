import React, {
  Component,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import {
  Animated as RNAnimated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { AnimatedRegion, Marker, MarkerAnimated, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Coordinates, Destination, MemberLocation } from '../types';
import { usePreferences, useTheme } from '../state/PreferencesContext';
import { memberColor } from '../glass';
import { DAY_COLORS, type Palette } from '../theme';
import { HitherText } from './HitherText';
import {
  DEFAULT_LATITUDE_DELTA,
  LOCATE_ALTITUDE,
  LOCATE_ZOOM,
  initialRegionFor,
  latOffsetForVisibleBand,
} from './mapCameraMath';
import { logError, logEvent } from '../utils/activityLog';
import { useTranslation } from '../i18n';

export {
  DEFAULT_LATITUDE_DELTA,
  LOCATE_ALTITUDE,
  LOCATE_ZOOM,
  PLACE_ALTITUDE,
  PLACE_ZOOM,
  latOffsetForVisibleBand,
} from './mapCameraMath';

/** Session-scoped Android map mount counter (theme remount increments). Not Google billing Map Loads. */
let androidMapMountCount = 0;
/** Diagnostic window after ready without loaded — log only, never auto-remount. */
const MAP_LOADED_TIMEOUT_MS = 10_000;

/** Optional camera framing for centerOn (defaults = locate-me street level). */
export type CenterOnOptions = {
  zoom?: number;
  altitude?: number;
};

/** Imperative handle so the screen can drive the map camera. */
export interface GroupMapHandle {
  /** Frame the next gathering point (used on first data load). */
  recenter: () => void;
  /** Center the map on an arbitrary coordinate, e.g. the user's own position. */
  centerOn: (coordinates: Coordinates, options?: CenterOnOptions) => void;
  /** Zoom/pan so every member with a known location is visible at once. */
  fitToMembers: () => void;
  focusOblique: (coordinates: Coordinates) => void;
  fitRoute: (coordinates: Coordinates[]) => void;
}

export interface GroupMapProps {
  members: MemberLocation[];
  gathering?: Destination;
  destinations?: Destination[];
  pendingPlace?: { coordinates: Coordinates; name: string } | null;
  currentUserId?: string;
  /** First available user location, used before a gathering point exists. */
  initialCenter?: Coordinates;
  routePoints?: Coordinates[];
  routeColor?: string;
  /** Top chrome overlapping the map (safe area + gathering-point carousel). */
  topOverlap?: number;
  /** Sheet height overlapping the map — with topOverlap, shifts the camera
   *  center into the exposed strip between carousel and sheet. */
  bottomOverlap?: number;
  /**
   * MapKit user-location samples for the single foreground owner path.
   * Does not redraw the self marker — native blue dot stays system-owned.
   */
  onUserLocationSample?: (sample: {
    coordinates: Coordinates;
    accuracy: number | null;
    timestamp: number;
  }) => void;
  /** Long-press map coordinate (shared with manual lat/lng destination sheet). */
  onLongPressCoordinate?: (coordinates: Coordinates) => void;
  /**
   * Called from map surface fallback when the user chooses “back to home”.
   * Parent should run the go-home reset action; this component never leaves groups.
   */
  onRequestGoHome?: () => void;
}

/**
 * Local boundary so a Map React subtree failure does not blank the whole app.
 * Parent owns fallback visibility (`showFallback`); this boundary only reports
 * errors and never auto-clears on ordinary parent re-renders (children identity
 * changes every render and must not dismiss recovery UI).
 * `resetKey` clears the error only on intentional surface remount.
 */
class MapSubtreeBoundary extends Component<
  {
    children: ReactNode;
    onError: () => void;
    fallback: ReactNode;
    /** Bumped only on user remount; clears hasError so a fresh Map can mount. */
    resetKey: number;
  },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    logError('map_surface_failure', error, { scope: 'map_subtree' });
    logEvent('map_surface_failure', { scope: 'map_subtree' });
    this.props.onError();
  }

  componentDidUpdate(prevProps: { resetKey: number }): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/**
 * Native (iOS / Android) map: member pins + the lantern gathering point.
 *
 * This is the only module that imports `react-native-maps`, which is
 * native-only. The `.web.tsx` sibling provides a web-safe fallback so Metro
 * never tries to bundle the native component for web.
 */
function getColorForDay(day: number | undefined, dayColors: Record<number, string>) {
  if (!day) return dayColors[1] || DAY_COLORS[0];
  return dayColors[day] || DAY_COLORS[(day - 1) % DAY_COLORS.length];
}

/**
 * Hook to manage `tracksViewChanges` for custom map markers.
 * react-native-maps has a massive performance penalty if tracksViewChanges
 * is left as true (the default) for custom views, dropping fps drastically.
 * We set it to true briefly when dependencies change (so it captures the view),
 * then switch to false so it doesn't continuously re-render bitmaps.
 */
function useTracksViewChanges(deps: any[]) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return tracksViewChanges;
}

const DestinationMarker = React.memo(function DestinationMarker({ dest, bgColor, styles }: any) {
  const tracksViewChanges = useTracksViewChanges([bgColor, dest.title]);

  return (
    <Marker
      coordinate={dest.coordinates}
      title={dest.title}
      description={`Day ${dest.day || 1}`}
      anchor={{ x: 0.5, y: 0.5 }}
      style={{ zIndex: 1 }}
      tracksViewChanges={tracksViewChanges}
    >
      <View
        style={[
          styles.gatherMarker,
          { backgroundColor: bgColor },
        ]}
      >
        <Ionicons name="flag" size={14} color="#fff" />
      </View>
    </Marker>
  );
});

const PendingPlaceMarker = React.memo(function PendingPlaceMarker({ pendingPlace, accent, styles }: any) {
  const tracksViewChanges = useTracksViewChanges([pendingPlace.name, accent]);

  return (
    <Marker
      coordinate={pendingPlace.coordinates}
      title={pendingPlace.name}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
    >
      <View style={[styles.gatherMarker, { backgroundColor: accent }]}>
        <Ionicons name="flag" size={17} color="#fff" />
      </View>
    </Marker>
  );
});

const MemberMarker = React.memo(function MemberMarker({ member, accent, styles }: any) {
  const isLeader = member.role === 'leader';
  const ringColor = isLeader ? accent : '#FFFFFF';
  const bgColor = memberColor(member.userId);
  const lat = member.coordinates?.latitude;
  const lng = member.coordinates?.longitude;

  const tracksViewChanges = useTracksViewChanges([
    member.name,
    member.avatar,
    isLeader,
    ringColor,
    bgColor,
  ]);

  // Display-only interpolation between real GPS fixes (no extrapolation past latest).
  const regionRef = useRef(
    new AnimatedRegion({
      latitude: lat ?? 0,
      longitude: lng ?? 0,
      latitudeDelta: 0,
      longitudeDelta: 0,
    }),
  );
  const lastCoordRef = useRef<{ latitude: number; longitude: number } | null>(
    lat != null && lng != null ? { latitude: lat, longitude: lng } : null,
  );

  useEffect(() => {
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const prev = lastCoordRef.current;
    lastCoordRef.current = { latitude: lat, longitude: lng };
    if (!prev) {
      regionRef.current.setValue({
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0,
        longitudeDelta: 0,
      });
      return;
    }
    if (prev.latitude === lat && prev.longitude === lng) return;
    // Clamp duration: short hops snappy, longer moves smoother — never invent a next point.
    const approxM =
      Math.hypot((lat - prev.latitude) * 111_000, (lng - prev.longitude) * 85_000);
    const duration = Math.min(800, Math.max(280, approxM * 4));
    regionRef.current
      .timing({
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0,
        longitudeDelta: 0,
        duration,
        useNativeDriver: false,
        // RN Animated types require these for composite configs on some versions.
        toValue: 0 as unknown as number,
        isInteraction: false,
      } as RNAnimated.TimingAnimationConfig & {
        latitude: number;
        longitude: number;
        latitudeDelta: number;
        longitudeDelta: number;
      })
      .start();
  }, [lat, lng]);

  if (lat == null || lng == null) return null;

  return (
    <MarkerAnimated
      coordinate={regionRef.current as unknown as { latitude: number; longitude: number }}
      title={member.name}
      description={isLeader ? 'Leader' : 'Follower'}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracksViewChanges}
    >
      <View style={styles.pinWrap}>
        <View style={styles.pinLabel}>
          <Text style={styles.pinLabelText} numberOfLines={1}>
            {member.name}
          </Text>
        </View>
        <View
          style={[
            styles.memberPin,
            {
              backgroundColor: bgColor,
              borderColor: ringColor,
              borderWidth: isLeader ? 3 : 2.5,
            },
            isLeader && styles.memberPinLeader,
          ]}
        >
          {member.avatar ? (
            <HitherText typeRole="emoji" style={styles.memberEmoji}>
              {member.avatar}
            </HitherText>
          ) : (
            <Text style={styles.memberInitial} allowFontScaling={false}>
              {member.name.slice(0, 1).toUpperCase()}
            </Text>
          )}
        </View>
      </View>
    </MarkerAnimated>
  );
});

const EDGE_BUFFER = 16;

const GroupMap = forwardRef<GroupMapHandle, GroupMapProps>(function GroupMap(
  {
    members,
    gathering,
    destinations,
    pendingPlace,
    currentUserId,
    initialCenter,
    routePoints,
    routeColor,
    topOverlap = 0,
    bottomOverlap = 0,
    onUserLocationSample,
    onLongPressCoordinate,
    onRequestGoHome,
  },
  ref,
) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView | null>(null);
  const centeredModeRef = useRef<'fallback' | 'gathering' | null>(null);
  // Finite surface remount: user may retry once; no timer auto-remount.
  const [surfaceKey, setSurfaceKey] = useState(0);
  const [remountUsed, setRemountUsed] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const readyLoggedRef = useRef(false);
  const loadedLoggedRef = useRef(false);
  const readyAtRef = useRef<number | null>(null);
  const loadedTimeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { height: windowHeight } = useWindowDimensions();
  const { colors, themeName } = useTheme();
  const { dayColors } = usePreferences();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Shift camera so the pin sits in the midpoint of the strip between the
  // gathering-point carousel (top) and the bottom sheet (bottom).
  const latOffset = latOffsetForVisibleBand(
    DEFAULT_LATITUDE_DELTA,
    topOverlap,
    bottomOverlap,
    windowHeight,
  );

  // Match the map chrome to the app theme: the light "day" palette gets the
  // light Apple Maps style; the dark "night"/"dusk" palettes get the dark one.
  const mapInterfaceStyle: 'light' | 'dark' = themeName === 'day' ? 'light' : 'dark';
  const memberCenter = members.find((member) => member.coordinates)?.coordinates;
  const fallbackCenter = initialCenter ?? memberCenter;
  const mapInitialRegion = initialRegionFor(gathering?.coordinates ?? fallbackCenter, latOffset);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    androidMapMountCount += 1;
    // App lifecycle only — not Google Cloud Map Loads / billing.
    logEvent('android_map_mount', { mapMountCount: androidMapMountCount });
    return () => {
      if (loadedTimeoutTimerRef.current) {
        clearTimeout(loadedTimeoutTimerRef.current);
        loadedTimeoutTimerRef.current = null;
      }
      logEvent('android_map_unmount', { mapMountCount: androidMapMountCount });
    };
  }, []);

  const onMapReady = useCallback(() => {
    if (Platform.OS !== 'android' || readyLoggedRef.current) return;
    readyLoggedRef.current = true;
    readyAtRef.current = Date.now();
    logEvent('android_map_ready');
    if (loadedTimeoutTimerRef.current) clearTimeout(loadedTimeoutTimerRef.current);
    // Spec §5.3: ready without loaded → diagnostic event only; no auto remount.
    loadedTimeoutTimerRef.current = setTimeout(() => {
      if (loadedLoggedRef.current) return;
      logError('map_loaded_timeout', new Error('map_loaded_timeout'), {
        mapLoadedTimeout: true,
        mapMountCount: androidMapMountCount,
        durationMs: MAP_LOADED_TIMEOUT_MS,
      });
      logEvent('map_loaded_timeout', {
        mapMountCount: androidMapMountCount,
        durationMs: MAP_LOADED_TIMEOUT_MS,
      });
    }, MAP_LOADED_TIMEOUT_MS);
  }, []);

  const onMapLoaded = useCallback(() => {
    if (Platform.OS !== 'android' || loadedLoggedRef.current) return;
    loadedLoggedRef.current = true;
    if (loadedTimeoutTimerRef.current) {
      clearTimeout(loadedTimeoutTimerRef.current);
      loadedTimeoutTimerRef.current = null;
    }
    const readyAt = readyAtRef.current;
    const mapReadyToLoadedMs =
      readyAt != null ? Math.max(0, Date.now() - readyAt) : null;
    logEvent('android_map_loaded', {
      durationMs: mapReadyToLoadedMs,
      mapReadyToLoadedMs,
      mapMountCount: androidMapMountCount,
    });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      recenter: () => {
        if (gathering && mapRef.current) {
          mapRef.current.animateToRegion(initialRegionFor(gathering.coordinates, latOffset), 400);
        }
      },
      centerOn: (coordinates, options) => {
        // Flat top-down: animateCamera with pitch 0 so we leave any prior
        // 45° oblique view cleanly (animateToRegion alone can leave pitch).
        // Place picks pass wider zoom/altitude; locate keeps street-level defaults.
        mapRef.current?.animateCamera(
          {
            center: {
              latitude: coordinates.latitude - latOffset,
              longitude: coordinates.longitude,
            },
            pitch: 0,
            heading: 0,
            zoom: options?.zoom ?? LOCATE_ZOOM,
            altitude: options?.altitude ?? LOCATE_ALTITUDE,
          },
          { duration: 280 },
        );
      },
      focusOblique: (coordinates) => {
        // Same visible-band lat shift as centerOn so the pin sits in the
        // strip between carousel and sheet while pitched to 45°.
        // Set zoom (Android) + altitude (iOS); pitch needs pitchEnabled on MapView.
        mapRef.current?.animateCamera(
          {
            center: {
              latitude: coordinates.latitude - latOffset,
              longitude: coordinates.longitude,
            },
            pitch: 45,
            heading: 0,
            zoom: LOCATE_ZOOM,
            altitude: LOCATE_ALTITUDE,
          },
          { duration: 320 },
        );
      },
      fitRoute: (coordinates) => {
        if (coordinates.length > 1) {
          mapRef.current?.fitToCoordinates(coordinates, {
            edgePadding: {
              top: Math.max(120, topOverlap + EDGE_BUFFER),
              right: 60,
              bottom: Math.max(240, bottomOverlap + EDGE_BUFFER),
              left: 60,
            },
            animated: true,
          });
        }
      },
      fitToMembers: () => {
        const coords = members.filter((m) => m.coordinates).map((m) => m.coordinates!);
        if (mapRef.current && coords.length > 0) {
          mapRef.current.fitToCoordinates(coords, {
            edgePadding: {
              top: Math.max(80, topOverlap + EDGE_BUFFER),
              right: 60,
              bottom: Math.max(220, bottomOverlap + EDGE_BUFFER),
              left: 60,
            },
            animated: true,
          });
        }
      },
    }),
    [gathering, members, latOffset, topOverlap, bottomOverlap],
  );

  // A fresh group has neither a gathering point nor a member location yet.
  // Mount it with a valid fallback camera, then center once when GPS or the
  // first gathering point becomes available. Never follow every GPS tick.
  useEffect(() => {
    if (!mapRef.current) return;
    if (gathering) {
      if (centeredModeRef.current !== 'gathering') {
        mapRef.current.animateToRegion(initialRegionFor(gathering.coordinates, latOffset), 600);
        centeredModeRef.current = 'gathering';
      }
      return;
    }
    if (fallbackCenter && centeredModeRef.current === null) {
      mapRef.current.animateToRegion(initialRegionFor(fallbackCenter, latOffset), 600);
      centeredModeRef.current = 'fallback';
    }
  }, [fallbackCenter, gathering, latOffset]);

  const handleMapSubtreeError = useCallback(() => {
    // Parent-owned: survives ordinary re-renders; not cleared by children identity.
    setShowFallback(true);
  }, []);

  const handleReloadMap = useCallback(() => {
    if (remountUsed) return;
    setRemountUsed(true);
    setShowFallback(false);
    // Allow ready/loaded lifecycle events on the rebuilt surface.
    readyLoggedRef.current = false;
    loadedLoggedRef.current = false;
    readyAtRef.current = null;
    if (loadedTimeoutTimerRef.current) {
      clearTimeout(loadedTimeoutTimerRef.current);
      loadedTimeoutTimerRef.current = null;
    }
    setSurfaceKey((k) => k + 1);
    logEvent('map_surface_retry', { remountUsed: true });
  }, [remountUsed]);

  const mapFallback = (
    <View style={styles.mapFallback} accessibilityRole="alert">
      <Text style={styles.mapFallbackTitle}>{t('interaction.mapFailed')}</Text>
      {!remountUsed ? (
        <Pressable
          onPress={handleReloadMap}
          style={({ pressed }) => [styles.mapFallbackBtn, pressed && styles.mapFallbackBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={t('interaction.mapReload')}
        >
          <Text style={styles.mapFallbackBtnText}>{t('interaction.mapReload')}</Text>
        </Pressable>
      ) : null}
      {onRequestGoHome ? (
        <Pressable
          onPress={onRequestGoHome}
          style={({ pressed }) => [
            styles.mapFallbackBtn,
            styles.mapFallbackBtnSecondary,
            pressed && styles.mapFallbackBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('interaction.mapGoHome')}
        >
          <Text style={styles.mapFallbackBtnTextSecondary}>{t('interaction.mapGoHome')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  // Parent-owned fallback: first and second failure both stay here so a parent
  // re-render cannot re-mount a broken MapView underneath the recovery UI.
  if (showFallback) {
    return mapFallback;
  }

  return (
    <MapSubtreeBoundary
      resetKey={surfaceKey}
      onError={handleMapSubtreeError}
      fallback={mapFallback}
    >
    <MapView
      // Remount when the theme's light/dark changes so Apple Maps picks up the
      // new `userInterfaceStyle` from a fresh mount (the prop alone is not
      // re-applied to an already-rendered map under the new architecture).
      // surfaceKey allows a single user-driven remount after map subtree failure.
      key={`${mapInterfaceStyle}-${surfaceKey}`}
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      // Android uses Google Maps; iOS keeps the default MapKit provider.
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      initialRegion={mapInitialRegion}
      userInterfaceStyle={mapInterfaceStyle}
      mapPadding={{ top: 42, left: 32, right: 32, bottom: 42 }}
      // Continuous local blue-dot from device GPS (offline). Self is not drawn
      // as a flock emoji pin — that would lag on cloud upload cadence.
      showsUserLocation
      showsMyLocationButton={false}
      showsCompass
      pitchEnabled
      rotateEnabled
      // iOS MapKit + Android Google Maps share this path. Callers stage the
      // search-style confirm card (name only) — keep this handler lean.
      onLongPress={(event) => {
        const coordinate = event.nativeEvent.coordinate;
        if (!coordinate) return;
        const { latitude, longitude } = coordinate;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        onLongPressCoordinate?.({ latitude, longitude });
      }}
      // Help long-press win over pan on both platforms (esp. iOS MapKit).
      // iOS: disable POI taps so long-press is not stolen by MapKit callouts.
      moveOnMarkerPress={false}
      {...(Platform.OS === 'ios'
        ? { showsPointsOfInterest: false, showsBuildings: false }
        : {})}
      onMapReady={onMapReady}
      onMapLoaded={onMapLoaded}
      // MapKit is the iOS foreground location owner. Android keeps Expo watcher
      // only — do not bridge discarded Google Maps location callbacks.
      {...(Platform.OS === 'ios' && onUserLocationSample
        ? {
            onUserLocationChange: (event: {
              nativeEvent: {
                coordinate?: {
                  latitude: number;
                  longitude: number;
                  accuracy?: number;
                  timestamp?: number;
                };
              };
            }) => {
              const coordinate = event.nativeEvent.coordinate;
              if (!coordinate) return;
              const { latitude, longitude, accuracy, timestamp } = coordinate;
              if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
              onUserLocationSample({
                coordinates: { latitude, longitude },
                accuracy: accuracy != null && Number.isFinite(accuracy) ? accuracy : null,
                timestamp: timestamp != null && Number.isFinite(timestamp) ? timestamp : Date.now(),
              });
            },
          }
        : {})}
    >
      {routePoints && routePoints.length > 1 ? (
        <Polyline
          coordinates={routePoints}
          strokeColor={routeColor ?? colors.accent}
          strokeWidth={5}
          lineCap="round"
          lineJoin="round"
        />
      ) : null}

      {destinations?.map((dest) => {
        const bgColor = getColorForDay(dest.day, dayColors);
        return (
          <DestinationMarker 
            key={dest.id}
            dest={dest}
            bgColor={bgColor}
            styles={styles}
          />
        );
      })}

      {pendingPlace && (
        <PendingPlaceMarker
          pendingPlace={pendingPlace}
          accent={colors.accent}
          styles={styles}
        />
      )}

      {members.map((m) => {
        if (!m.coordinates) return null;
        // Self uses native showsUserLocation — no avatar pin.
        if (currentUserId && m.userId === currentUserId) return null;
        return (
          <MemberMarker
            key={m.userId}
            member={m}
            accent={colors.accent}
            styles={styles}
          />
        );
      })}
    </MapView>
    </MapSubtreeBoundary>
  );
});

const makeStyles = (colors: Palette) => StyleSheet.create({
  // Small Apple-Maps-style place disc — accent circle, white ring, flag glyph.
  gatherMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  pinWrap: { alignItems: 'center', gap: 4 },
  pinLabel: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(16,20,28,0.6)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  pinLabelText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  memberPin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  memberPinLeader: {
    shadowColor: colors.accent,
    shadowOpacity: 0.7,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  memberInitial: { color: '#fff', fontWeight: '600', fontSize: 16 },
  // Fixed glyph size — HitherText typeRole="emoji" disables Dynamic Type.
  memberEmoji: { fontSize: 20 },
  mapFallback: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#0E1320',
    gap: 12,
  },
  mapFallbackTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FB',
    marginBottom: 8,
    textAlign: 'center',
  },
  mapFallbackBtn: {
    minWidth: 180,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  mapFallbackBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  mapFallbackBtnPressed: {
    opacity: 0.85,
  },
  mapFallbackBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1206',
  },
  mapFallbackBtnTextSecondary: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F5F7FB',
  },
});

export default React.memo(GroupMap);
