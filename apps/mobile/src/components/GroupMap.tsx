import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import type { Coordinates, Destination, MemberLocation } from '../types';
import { usePreferences, useTheme } from '../state/PreferencesContext';
import { memberColor } from '../glass';
import { DAY_COLORS, type Palette } from '../theme';
import {
  DEFAULT_LATITUDE_DELTA,
  latOffsetForVisibleBand,
} from './mapCameraMath';

export { DEFAULT_LATITUDE_DELTA, latOffsetForVisibleBand } from './mapCameraMath';

/** Imperative handle so the screen can drive the map camera. */
export interface GroupMapHandle {
  /** Frame the next gathering point (used on first data load). */
  recenter: () => void;
  /** Center the map on an arbitrary coordinate, e.g. the user's own position. */
  centerOn: (coordinates: Coordinates) => void;
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
  routePoints?: Coordinates[];
  routeColor?: string;
  /** Secondary routes (other travel modes) drawn thinner under the primary. */
  alternateRoutes?: { points: Coordinates[]; color: string }[];
  /** Top chrome overlapping the map (safe area + gathering-point carousel). */
  topOverlap?: number;
  /** Sheet height overlapping the map — with topOverlap, shifts the camera
   *  center into the exposed strip between carousel and sheet. */
  bottomOverlap?: number;
}

/** Region that comfortably frames a single gathering point. */
function regionFor(center: Coordinates, latOffset: number = 0): Region {
  return {
    latitude: center.latitude - latOffset,
    longitude: center.longitude,
    latitudeDelta: DEFAULT_LATITUDE_DELTA,
    longitudeDelta: DEFAULT_LATITUDE_DELTA,
  };
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

const DestinationMarker = React.memo(({ dest, bgColor, styles }: any) => {
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

const PendingPlaceMarker = React.memo(({ pendingPlace, accent, styles }: any) => {
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

const MemberMarker = React.memo(({ member, accent, styles }: any) => {
  const isLeader = member.role === 'leader';
  const ringColor = isLeader ? accent : '#FFFFFF';
  const bgColor = memberColor(member.userId);
  
  const tracksViewChanges = useTracksViewChanges([
    member.name,
    member.avatar,
    isLeader,
    ringColor,
    bgColor
  ]);

  return (
    <Marker
      coordinate={member.coordinates}
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
            <Text style={styles.memberEmoji}>{member.avatar}</Text>
          ) : (
            <Text style={styles.memberInitial}>
              {member.name.slice(0, 1).toUpperCase()}
            </Text>
          )}
        </View>
      </View>
    </Marker>
  );
});

const EDGE_BUFFER = 16;

const GroupMap = forwardRef<GroupMapHandle, GroupMapProps>(function GroupMap(
  {
    members,
    gathering,
    destinations,
    pendingPlace,
    routePoints,
    routeColor,
    alternateRoutes,
    topOverlap = 0,
    bottomOverlap = 0,
  },
  ref,
) {
  const mapRef = useRef<MapView | null>(null);
  const centeredRef = useRef(false);
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

  useImperativeHandle(
    ref,
    () => ({
      recenter: () => {
        if (gathering && mapRef.current) {
          mapRef.current.animateToRegion(regionFor(gathering.coordinates, latOffset), 400);
        }
      },
      centerOn: (coordinates) => {
        mapRef.current?.animateToRegion(regionFor(coordinates, latOffset), 400);
      },
      focusOblique: (coordinates) => {
        // Same visible-band lat shift as centerOn so the pin sits in the
        // strip between carousel and sheet while pitched to 45°.
        mapRef.current?.animateCamera(
          {
            center: {
              latitude: coordinates.latitude - latOffset,
              longitude: coordinates.longitude,
            },
            pitch: 45,
            heading: 0,
            altitude: 1200,
          },
          { duration: 500 },
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

  // Center on the gathering point the first time data arrives.
  useEffect(() => {
    if (!centeredRef.current && gathering && mapRef.current) {
      mapRef.current.animateToRegion(regionFor(gathering.coordinates, latOffset), 600);
      centeredRef.current = true;
    }
  }, [gathering, latOffset]);

  return (
    <MapView
      // Remount when the theme's light/dark changes so Apple Maps picks up the
      // new `userInterfaceStyle` from a fresh mount (the prop alone is not
      // re-applied to an already-rendered map under the new architecture).
      key={mapInterfaceStyle}
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={gathering ? regionFor(gathering.coordinates, latOffset) : undefined}
      userInterfaceStyle={mapInterfaceStyle}
      mapPadding={{ top: 42, left: 32, right: 32, bottom: 42 }}
      showsCompass
    >
      {alternateRoutes?.map((alt, i) =>
        alt.points.length > 1 ? (
          <Polyline
            key={`alt-route-${i}`}
            coordinates={alt.points}
            strokeColor={alt.color}
            strokeWidth={3}
            lineCap="round"
            lineJoin="round"
            lineDashPattern={[8, 6]}
          />
        ) : null,
      )}
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
  },
  memberPinLeader: {
    shadowColor: colors.accent,
    shadowOpacity: 0.7,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  memberInitial: { color: '#fff', fontWeight: '600', fontSize: 16 },
  memberEmoji: { fontSize: 20 },
});

export default React.memo(GroupMap);
