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
  AccessibilityInfo,
  Animated as RNAnimated,
  AppState,
  type AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { AnimatedRegion, Marker, MarkerAnimated, Polyline } from 'react-native-maps';
import type { Coordinates, Destination, MemberLocation } from '../types';
import { displayMemberAvatar } from '../constants/avatars';
import { usePreferences, useTheme } from '../state/PreferencesContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { memberColor } from '../glass';
import type { Palette } from '../theme';
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
import {
  platformizedMapLifecycle,
  platformizedMapViewProps,
} from '../native/maps';
import { defaultMapTransitProps } from '../native/mapTransitDefaults';
import { energyObservability } from '../state/energyObservability';
import {
  displayRoutePoints,
  routeViewportFromRegion,
  type RouteViewport,
} from '../utils/routeLod';
import { advanceRouteToCoordinate } from '../utils/advanceRouteToCoordinate';
import {
  gatherCardHorizontalInset,
  mapKitChromeLayout,
  type MapChromeStage,
} from '../utils/mapChromeLayout';
import {
  pulsePeakScale,
  reduceMotionEmphasisScale,
  shouldPulseDestination,
  TARGET_PULSE_DURATION_MS,
  TARGET_PULSE_INTERVAL_MS,
} from '../utils/targetMarkerPulse';
import {
  destinationMarkerColor,
  destinationMarkerEmoji,
  getColorForDay,
  stayMarkerDescription,
  STAY_MARKER_EMOJI,
} from '../utils/destinationMarkerChrome';
import { mergeMapMarkers } from '../utils/mapMarkerMerge';

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
  /** Start navigation can snap to a newly selected point without camera travel. */
  animated?: boolean;
};

/** Imperative handle so the screen can drive the map camera. */
export interface GroupMapHandle {
  /** Frame the next gathering point (used on first data load). */
  recenter: () => void;
  /** Center the map on an arbitrary coordinate, e.g. the user's own position. */
  centerOn: (coordinates: Coordinates, options?: CenterOnOptions) => void;
  /** Zoom/pan so every member with a known location is visible at once. */
  fitToMembers: () => void;
  focusOblique: (coordinates: Coordinates, options?: CenterOnOptions) => void;
  fitRoute: (coordinates: Coordinates[]) => void;
}

export interface GroupMapProps {
  members: MemberLocation[];
  gathering?: Destination;
  destinations?: Destination[];
  /**
   * Team daily accommodations for the trip (all days). Bed markers win over
   * normal pins at the same place; multi-day same hotel → one bed per day.
   */
  dailyAccommodations?: ReadonlyArray<{
    id: string;
    title: string;
    coordinates: Coordinates;
    sourceDestinationId?: string | null;
    /** Trip day (1-based) for bed marker day-color + callout. */
    day?: number;
  }> | null;
  /** @deprecated Prefer dailyAccommodations. */
  dailyAccommodation?: {
    id: string;
    title: string;
    coordinates: Coordinates;
    sourceDestinationId?: string | null;
    day?: number;
  } | null;
  /** Localized label for stay callout (e.g. 住宿 / Stay). */
  stayCalloutLabel?: string;
  pendingPlace?: { coordinates: Coordinates; name: string } | null;
  currentUserId?: string;
  /** First available user location, used before a gathering point exists. */
  initialCenter?: Coordinates;
  routePoints?: Coordinates[];
  /** Latest self GPS sample used to trim the planned polyline locally. */
  selfCoordinates?: Coordinates | null;
  routeColor?: string;
  /** Active navigation / team target — receives 5s pulse only. */
  activeDestinationId?: string | null;
  /** Completed stop ids — no active glow / pulse. */
  completedDestinationIds?: ReadonlySet<string> | ReadonlyArray<string> | null;
  /** Top chrome overlapping the map (safe area + gathering-point carousel). */
  topOverlap?: number;
  /** Peek-only sheet height overlapping the map. Never a live detent. */
  bottomOverlap?: number;
  /** Settled sheet stage used to place/hide native compass chrome. */
  chromeStage?: MapChromeStage;
  /** Bottom offset of the floating recenter capsule for compass placement. */
  chromeBottomOffset?: number;
  /**
   * @deprecated MapView is edge-to-edge; peek translate/oversize is removed.
   * Kept so callers can pass 0 without a type break.
   */
  halfPeek?: number;
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
  /**
   * MapKit / Google Maps user location. Off when sharing is disabled or the
   * account has no memberships so Control Center does not list Hither.
   */
  showsUserLocation?: boolean;
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

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logError('map_surface_failure', error, {
      scope: 'map_subtree',
      subsystem: 'map',
      screen: 'Map',
      componentStack: info.componentStack,
      source: 'MapSubtreeBoundary',
    });
    logEvent('map_surface_failure', { scope: 'map_subtree', screen: 'Map' });
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

const DestinationMarker = React.memo(function DestinationMarker({
  dest,
  bgColor,
  styles,
  isActiveTarget,
  isCompleted,
  reduceMotion,
  appActive,
  calloutDescription,
}: {
  dest: Destination;
  bgColor: string;
  styles: ReturnType<typeof makeStyles>;
  isActiveTarget: boolean;
  isCompleted: boolean;
  reduceMotion: boolean;
  appActive: boolean;
  /** Override Marker description (stay: "Day N · 住宿"). */
  calloutDescription?: string;
}) {
  // Pulse briefly every 5s — never leave tracksViewChanges true continuously.
  const [pulseOn, setPulseOn] = useState(false);
  const scaleAnim = useRef(new RNAnimated.Value(1)).current;
  const canPulse = shouldPulseDestination({
    destId: dest.id,
    activeDestinationId: isActiveTarget ? dest.id : null,
    completedDestinationIds: isCompleted ? [dest.id] : null,
    appActive,
    reduceMotion,
  });

  useEffect(() => {
    energyObservability.event('marker_tracking');
  }, [bgColor, dest.emoji, dest.id, dest.markerColor, isActiveTarget, isCompleted]);

  useEffect(() => {
    if (!canPulse) {
      setPulseOn(false);
      scaleAnim.setValue(isActiveTarget && reduceMotion ? reduceMotionEmphasisScale() : 1);
      return;
    }
    let cancelled = false;
    const runPulse = () => {
      if (cancelled) return;
      setPulseOn(true);
      scaleAnim.setValue(1);
      RNAnimated.sequence([
        RNAnimated.timing(scaleAnim, {
          toValue: pulsePeakScale(),
          duration: TARGET_PULSE_DURATION_MS / 2,
          useNativeDriver: true,
        }),
        RNAnimated.timing(scaleAnim, {
          toValue: 1,
          duration: TARGET_PULSE_DURATION_MS / 2,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setPulseOn(false);
      });
    };
    runPulse();
    const interval = setInterval(runPulse, TARGET_PULSE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      setPulseOn(false);
      scaleAnim.stopAnimation();
      scaleAnim.setValue(1);
    };
  }, [canPulse, isActiveTarget, reduceMotion, scaleAnim]);

  const markerEmoji = destinationMarkerEmoji(dest);
  const description =
    calloutDescription
    ?? (dest.kind === 'accommodation'
      ? stayMarkerDescription(dest.day, 'Stay')
      : `Day ${dest.day || 1}`);

  // Capture bitmap only on appearance / pulse window / style change — never continuous.
  const tracksViewChanges = useTracksViewChanges([
    bgColor,
    dest.title,
    dest.emoji,
    dest.markerColor,
    dest.kind,
    markerEmoji,
    description,
    isActiveTarget,
    isCompleted,
    pulseOn,
  ]);

  const staticEmphasis = isActiveTarget && reduceMotion;
  const markerStyle = [
    styles.gatherMarker,
    { backgroundColor: bgColor },
    isCompleted ? styles.gatherMarkerCompleted : null,
    isActiveTarget && !isCompleted ? styles.gatherMarkerActive : null,
  ];

  return (
    <Marker
      coordinate={dest.coordinates}
      title={dest.title}
      description={description}
      anchor={{ x: 0.5, y: 0.5 }}
      style={{ zIndex: isActiveTarget ? 3 : 1 }}
      tracksViewChanges={tracksViewChanges}
    >
      <RNAnimated.View
        style={[
          markerStyle,
          {
            transform: [
              {
                scale: staticEmphasis
                  ? reduceMotionEmphasisScale()
                  : scaleAnim,
              },
            ],
          },
        ]}
      >
        <Text style={styles.gatherMarkerEmoji} allowFontScaling={false}>
          {markerEmoji}
        </Text>
      </RNAnimated.View>
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
  const displayAvatar = displayMemberAvatar(member.avatar, member.userId, member.avatarColor);
  const bgColor = displayAvatar.color ?? memberColor(member.userId);
  const lat = member.coordinates?.latitude;
  const lng = member.coordinates?.longitude;

  const tracksViewChanges = useTracksViewChanges([
    member.name,
    member.avatar,
    member.avatarColor,
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
          <HitherText typeRole="emoji" style={styles.memberEmoji}>
            {displayAvatar.emoji}
          </HitherText>
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
    dailyAccommodations = null,
    dailyAccommodation = null,
    stayCalloutLabel,
    pendingPlace,
    currentUserId,
    initialCenter,
    routePoints,
    selfCoordinates = null,
    routeColor,
    activeDestinationId = null,
    completedDestinationIds = null,
    topOverlap = 0,
    bottomOverlap = 0,
    chromeStage = 'peek',
    chromeBottomOffset = 0,
    halfPeek: _halfPeek = 0,
    onUserLocationSample,
    onLongPressCoordinate,
    onRequestGoHome,
    showsUserLocation = true,
  },
  ref,
) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView | null>(null);
  /**
   * Camera ownership:
   * - null: never framed
   * - fallback: GPS/default once
   * - gathering: auto-framed first gathering point
   * - user: imperative centerOn / fitRoute / focusOblique already ran
   *
   * First destination add used to stack: long-press centerOn + success fit +
   * auto gathering animateToRegion. Mark user-driven cameras so the first
   * gathering effect does not re-animate on top.
   */
  const centeredModeRef = useRef<'fallback' | 'gathering' | 'user' | null>(null);
  // Finite surface remount: user may retry once; no timer auto-remount.
  const [surfaceKey, setSurfaceKey] = useState(0);
  const [remountUsed, setRemountUsed] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const readyLoggedRef = useRef(false);
  const loadedLoggedRef = useRef(false);
  const readyAtRef = useRef<number | null>(null);
  const loadedTimeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors, themeName } = useTheme();
  const { dayColors } = usePreferences();
  const mergedMarkers = useMemo(
    () => mergeMapMarkers({
      destinations: destinations ?? [],
      dailyAccommodations: dailyAccommodations ?? undefined,
      dailyAccommodation: dailyAccommodation ?? null,
    }),
    [dailyAccommodation, dailyAccommodations, destinations],
  );

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const onApp = (next: AppStateStatus) => setAppActive(next === 'active');
    const sub = AppState.addEventListener('change', onApp);
    return () => sub.remove();
  }, []);
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    energyObservability.increment('render');
  });

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
  const mapInitialRegion = useMemo(
    () => initialRegionFor(gathering?.coordinates ?? fallbackCenter, latOffset),
    [fallbackCenter, gathering?.coordinates, latOffset],
  );
  const [settledRouteViewport, setSettledRouteViewport] = useState<RouteViewport>(() =>
    routeViewportFromRegion({
      latitude: mapInitialRegion.latitude,
      longitudeDelta: mapInitialRegion.longitudeDelta,
      widthPx: Math.max(1, windowWidth),
    }),
  );
  const displayRoute = useMemo(
    () => displayRoutePoints(
      selfCoordinates
        ? advanceRouteToCoordinate(routePoints ?? [], selfCoordinates)
        : (routePoints ?? []),
      settledRouteViewport,
    ),
    [routePoints, selfCoordinates, settledRouteViewport],
  );
  const mapChrome = useMemo(
    () => mapKitChromeLayout({
      safeArea: insets,
      topChrome: topOverlap,
      horizontalInset: gatherCardHorizontalInset(windowWidth),
      windowHeight,
      bottomChrome: chromeBottomOffset,
      stage: chromeStage,
    }),
    [chromeBottomOffset, chromeStage, insets, topOverlap, windowHeight, windowWidth],
  );

  useEffect(() => platformizedMapLifecycle({
    onAndroidMapMount: () => {
      androidMapMountCount += 1;
      // App lifecycle only — not Google Cloud Map Loads / billing.
      logEvent('android_map_mount', { mapMountCount: androidMapMountCount });
    },
    onAndroidMapUnmount: () => {
      if (loadedTimeoutTimerRef.current) {
        clearTimeout(loadedTimeoutTimerRef.current);
        loadedTimeoutTimerRef.current = null;
      }
      logEvent('android_map_unmount', { mapMountCount: androidMapMountCount });
    },
  }), []);

  const onMapReady = useCallback(() => {
    energyObservability.event('map_ready');
  }, []);

  const onAndroidMapReady = useCallback(() => {
    if (readyLoggedRef.current) return;
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

  const onAndroidMapLoaded = useCallback(() => {
    if (loadedLoggedRef.current) return;
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

  const mapBoundaryCallbacks = useMemo(() => ({
    onMapReady: () => onMapReady(),
    onAndroidMapReady: () => onAndroidMapReady(),
    onAndroidMapLoaded: () => onAndroidMapLoaded(),
    onUserLocationSample: onUserLocationSample
      ? (sample: Parameters<NonNullable<typeof onUserLocationSample>>[0]) =>
        onUserLocationSample(sample)
      : undefined,
  }), [onMapReady, onAndroidMapReady, onAndroidMapLoaded, onUserLocationSample]);

  // The native boundary owns provider selection and platform callback wiring;
  // GroupMap only supplies intent/diagnostic callbacks and spreads its result.
  const mapPlatformProps = useMemo(
    // The callbacks are stored by the boundary and invoked only by MapView
    // events; they are not executed while this render-time builder runs.
    // eslint-disable-next-line react-hooks/refs
    () => ({
      ...platformizedMapViewProps({
        chrome: mapChrome,
        headingEnabled: showsUserLocation && appActive,
        ...mapBoundaryCallbacks,
      }),
      ...defaultMapTransitProps(),
    }),
    [appActive, mapChrome, mapBoundaryCallbacks, showsUserLocation],
  );
  const mapViewProps = mapPlatformProps;

  useImperativeHandle(
    ref,
    () => ({
      recenter: () => {
        if (gathering && mapRef.current) {
          mapRef.current.animateToRegion(initialRegionFor(gathering.coordinates, latOffset), 400);
        }
      },
      centerOn: (coordinates, options) => {
        // User-driven framing — suppress subsequent auto first-gathering animate.
        centeredModeRef.current = 'user';
        // Flat top-down: animateCamera with pitch 0 so we leave any prior
        // oblique view cleanly (animateToRegion alone can leave pitch).
        // Place picks pass wider zoom/altitude; locate keeps street-level defaults.
        const camera = {
          center: {
            latitude: coordinates.latitude - latOffset,
            longitude: coordinates.longitude,
          },
          pitch: 0,
          heading: 0,
          zoom: options?.zoom ?? LOCATE_ZOOM,
          altitude: options?.altitude ?? LOCATE_ALTITUDE,
        };
        if (options?.animated === false) {
          mapRef.current?.setCamera(camera);
        } else {
          mapRef.current?.animateCamera(camera, { duration: 280 });
        }
      },
      focusOblique: (coordinates, options) => {
        centeredModeRef.current = 'user';
        // Same visible-band lat shift as centerOn so the pin sits in the
        // strip between carousel and sheet while pitched to 30°.
        // Set zoom (Android) + altitude (iOS); pitch needs pitchEnabled on MapView.
        mapRef.current?.animateCamera(
          {
            center: {
              latitude: coordinates.latitude - latOffset,
              longitude: coordinates.longitude,
            },
            pitch: 30,
            heading: 0,
            zoom: options?.zoom ?? LOCATE_ZOOM,
            altitude: options?.altitude ?? LOCATE_ALTITUDE,
          },
          { duration: 320 },
        );
      },
      fitRoute: (coordinates) => {
        if (coordinates.length > 1) {
          centeredModeRef.current = 'user';
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
          centeredModeRef.current = 'user';
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
  // Skip auto animate when the user already framed via long-press / add / fit.
  useEffect(() => {
    if (!mapRef.current) return;
    if (gathering) {
      if (centeredModeRef.current === 'user') {
        // Promote to gathering ownership without a second stacked animation.
        centeredModeRef.current = 'gathering';
        return;
      }
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
    // Sheet stage / detent must never re-run this effect.
  }, [fallbackCenter, gathering]);

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
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="box-none">
    <MapView
      // Remount when the theme's light/dark changes so Apple Maps picks up the
      // new `userInterfaceStyle` from a fresh mount (the prop alone is not
      // re-applied to an already-rendered map under the new architecture).
      // surfaceKey allows a single user-driven remount after map subtree failure.
      key={`${mapInterfaceStyle}-${surfaceKey}`}
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      // Provider, transit defaults, MapKit chrome, lifecycle callbacks and
      // platform-owned location callbacks come from the native boundary.
      {...(mapViewProps as Record<string, unknown>)}
      initialRegion={mapInitialRegion}
      userInterfaceStyle={mapInterfaceStyle}
      // Continuous local blue-dot from device GPS (offline). Self is not drawn
      // as a flock emoji pin — that would lag on cloud upload cadence.
      showsUserLocation={showsUserLocation}
      showsMyLocationButton={false}
      showsCompass={mapChrome.compassVisible ?? true}
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
      moveOnMarkerPress={false}
      onRegionChangeComplete={(region) => {
        const nextViewport = routeViewportFromRegion({
          latitude: region.latitude,
          longitudeDelta: region.longitudeDelta,
          widthPx: Math.max(1, windowWidth),
        });
        setSettledRouteViewport((current) => (
          current.latitude === nextViewport.latitude
          && current.longitudeDelta === nextViewport.longitudeDelta
          && current.widthPx === nextViewport.widthPx
            ? current
            : nextViewport
        ));
      }}
    >
      {displayRoute.length > 1 ? (
        <Polyline
          coordinates={displayRoute}
          strokeColor={routeColor ?? colors.accent}
          strokeWidth={5}
          lineCap="round"
          lineJoin="round"
        />
      ) : null}

      {mergedMarkers.map((marker) => {
        const stayLabel = stayCalloutLabel ?? 'Stay';
        if (marker.kind === 'daily_accommodation') {
          const dayNum = marker.day || 1;
          const fakeDest = {
            id: marker.id,
            title: marker.title,
            order: -1,
            day: dayNum,
            coordinates: marker.coordinates,
            emoji: STAY_MARKER_EMOJI,
            kind: 'accommodation' as const,
            markerColor: null,
          } as Destination;
          return (
            <DestinationMarker
              key={marker.id}
              dest={fakeDest}
              bgColor={getColorForDay(dayNum, dayColors)}
              styles={styles}
              isActiveTarget={false}
              isCompleted={false}
              reduceMotion={reduceMotion}
              appActive={appActive}
              calloutDescription={stayMarkerDescription(dayNum, stayLabel)}
            />
          );
        }
        const dest = (destinations ?? []).find((d) => d.id === marker.id);
        if (!dest) return null;
        // Stay cards use day color + bed; stops prefer per-stop color then day.
        const bgColor =
          dest.kind === 'accommodation'
            ? getColorForDay(dest.day, dayColors)
            : destinationMarkerColor(dest, dayColors);
        const isCompleted = completedDestinationIds instanceof Set
          ? completedDestinationIds.has(dest.id)
          : Boolean(
              completedDestinationIds
              && (completedDestinationIds as readonly string[]).includes(dest.id),
            );
        const isActiveTarget =
          !isCompleted && activeDestinationId != null && dest.id === activeDestinationId;
        return (
          <DestinationMarker
            key={dest.id}
            dest={dest}
            bgColor={bgColor}
            styles={styles}
            isActiveTarget={isActiveTarget}
            isCompleted={isCompleted}
            reduceMotion={reduceMotion}
            appActive={appActive}
            calloutDescription={
              dest.kind === 'accommodation'
                ? stayMarkerDescription(dest.day, stayLabel)
                : undefined
            }
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
    </View>
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
  gatherMarkerEmoji: {
    fontSize: 13,
    lineHeight: 16,
    textAlign: 'center',
  },
  // Active target only — soft glow between pulses (not continuous bitmap tracking).
  gatherMarkerActive: {
    shadowColor: colors.accent,
    shadowOpacity: 0.55,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  // Completed stops: strip active + base chrome — no glow/elevation/shadow.
  // Base gatherMarker still has shadow*; override every shadow field so iOS
  // does not keep residual shadow from the base style (field-test residual).
  gatherMarkerCompleted: {
    opacity: 0.72,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
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
