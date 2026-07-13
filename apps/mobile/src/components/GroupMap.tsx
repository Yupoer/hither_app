import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, type Region } from 'react-native-maps';
import type { Coordinates, Destination, MemberLocation } from '../types';
import { usePreferences, useTheme } from '../state/PreferencesContext';
import { memberColor } from '../glass';
import { DAY_COLORS, type Palette } from '../theme';

/** Imperative handle so the screen can drive the map camera. */
export interface GroupMapHandle {
  /** Frame the next gathering point (used on first data load). */
  recenter: () => void;
  /** Center the map on an arbitrary coordinate, e.g. the user's own position. */
  centerOn: (coordinates: Coordinates) => void;
  /** Zoom/pan so every member with a known location is visible at once. */
  fitToMembers: () => void;
}

export interface GroupMapProps {
  members: MemberLocation[];
  gathering?: Destination;
  destinations?: Destination[];
  pendingPlace?: { coordinates: Coordinates; name: string } | null;
  currentUserId?: string;
  /** Sheet height overlapping the map — shifts the camera center up so
   *  markers stay inside the exposed strip, like Apple Maps. */
  bottomOverlap?: number;
}

/** Region that comfortably frames a single gathering point. */
function regionFor(center: Coordinates, latOffset: number = 0): Region {
  return {
    latitude: center.latitude - latOffset,
    longitude: center.longitude,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
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

const GroupMap = forwardRef<GroupMapHandle, GroupMapProps>(function GroupMap(
  { members, gathering, destinations, pendingPlace, bottomOverlap },
  ref,
) {
  const mapRef = useRef<MapView | null>(null);
  const centeredRef = useRef(false);
  const { colors, themeName } = useTheme();
  const { dayColors } = usePreferences();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Shift the camera center up by moving the target coordinate down (subtracting from latitude).
  // 0.01 is the latitudeDelta. We shift by half the overlap ratio so the point centers in the visible area.
  const latOffset = 0; // Removed offset to keep targets perfectly centered at 1/2 height.

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
      fitToMembers: () => {
        const coords = members.filter((m) => m.coordinates).map((m) => m.coordinates!);
        if (mapRef.current && coords.length > 0) {
          // ponytail: fixed edge padding tuned for the peek/mid sheet height;
          // revisit if a taller sheet ever covers markers this should frame.
          mapRef.current.fitToCoordinates(coords, {
            edgePadding: { top: 80, right: 60, bottom: 220, left: 60 },
            animated: true,
          });
        }
      },
    }),
    [gathering, members, latOffset],
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
