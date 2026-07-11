import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, type Region } from 'react-native-maps';
import type { Coordinates, Destination, MemberLocation } from '../types';
import { useTheme } from '../state/PreferencesContext';
import { memberColor } from '../glass';
import type { Palette } from '../theme';

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
function regionFor(center: Coordinates): Region {
  return {
    latitude: center.latitude,
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
const GroupMap = forwardRef<GroupMapHandle, GroupMapProps>(function GroupMap(
  { members, gathering, currentUserId, bottomOverlap },
  ref,
) {
  const mapRef = useRef<MapView | null>(null);
  const centeredRef = useRef(false);
  const { colors, themeName } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Match the map chrome to the app theme: the light "day" palette gets the
  // light Apple Maps style; the dark "night"/"dusk" palettes get the dark one.
  const mapInterfaceStyle: 'light' | 'dark' = themeName === 'day' ? 'light' : 'dark';

  useImperativeHandle(
    ref,
    () => ({
      recenter: () => {
        if (gathering && mapRef.current) {
          mapRef.current.animateToRegion(regionFor(gathering.coordinates), 400);
        }
      },
      centerOn: (coordinates) => {
        mapRef.current?.animateToRegion(regionFor(coordinates), 400);
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
    [gathering, members],
  );

  // Center on the gathering point the first time data arrives.
  useEffect(() => {
    if (!centeredRef.current && gathering && mapRef.current) {
      mapRef.current.animateToRegion(regionFor(gathering.coordinates), 600);
      centeredRef.current = true;
    }
  }, [gathering]);

  return (
    <MapView
      // Remount when the theme's light/dark changes so Apple Maps picks up the
      // new `userInterfaceStyle` from a fresh mount (the prop alone is not
      // re-applied to an already-rendered map under the new architecture).
      key={mapInterfaceStyle}
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={gathering ? regionFor(gathering.coordinates) : undefined}
      userInterfaceStyle={mapInterfaceStyle}
      mapPadding={{ top: 0, left: 0, right: 0, bottom: bottomOverlap ?? 0 }}
      showsUserLocation
      showsCompass
    >
      {gathering && (
        <Marker
          coordinate={gathering.coordinates}
          title={gathering.title}
          description="下一個集合點 · gathering point"
          anchor={{ x: 0.5, y: 0.5 }}
        >
          {/* Apple-Maps-style place marker: a small accent disc with a white
              ring holding a flag glyph — pops on the basemap, no huge halo. */}
          <View style={[styles.gatherMarker, { backgroundColor: colors.accent }]}>
            <Ionicons name="flag" size={17} color="#fff" />
          </View>
        </Marker>
      )}

      {members.map((m) => {
        if (!m.coordinates) return null;
        // Own avatar is shown by the OS blue dot (showsUserLocation) — don't
        // double it up with a member pin. Only teammates get a pin.
        if (m.userId === currentUserId) return null;
        const isSelf = false;
        const isLeader = m.role === 'leader';
        const ringColor = isLeader ? colors.accent : '#FFFFFF';
        return (
          <Marker
            key={m.userId}
            coordinate={m.coordinates}
            title={`${m.name}${isSelf ? ' · you' : ''}`}
            description={isLeader ? 'Leader' : 'Follower'}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.pinWrap}>
              <View style={styles.pinLabel}>
                <Text style={styles.pinLabelText} numberOfLines={1}>
                  {isSelf ? `${m.name} · you` : m.name}
                </Text>
              </View>
              <View
                style={[
                  styles.memberPin,
                  {
                    backgroundColor: memberColor(m.userId),
                    borderColor: ringColor,
                    borderWidth: isLeader ? 3 : 2.5,
                  },
                  isLeader && styles.memberPinLeader,
                ]}
              >
                {m.avatar ? (
                  <Text style={styles.memberEmoji}>{m.avatar}</Text>
                ) : (
                  <Text style={styles.memberInitial}>
                    {m.name.slice(0, 1).toUpperCase()}
                  </Text>
                )}
              </View>
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
});

const makeStyles = (colors: Palette) => StyleSheet.create({
  // Small Apple-Maps-style place disc — accent circle, white ring, flag glyph.
  gatherMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
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
