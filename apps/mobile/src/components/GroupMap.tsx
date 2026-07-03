import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import type { Coordinates, Destination, MemberLocation } from '../types';
import { useTheme } from '../state/PreferencesContext';
import { accentMix, memberColor } from '../glass';
import CrookIcon from './CrookIcon';
import type { Palette } from '../theme';

/** Imperative handle so the screen can drive the map camera. */
export interface GroupMapHandle {
  /** Frame the next gathering point (used on first data load). */
  recenter: () => void;
  /** Center the map on an arbitrary coordinate, e.g. the user's own position. */
  centerOn: (coordinates: Coordinates) => void;
}

export interface GroupMapProps {
  members: MemberLocation[];
  gathering?: Destination;
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
    }),
    [gathering],
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
          anchor={{ x: 0.5, y: 0.9 }}
        >
          <View style={styles.crookMarker}>
            {/* Pulse ring + soft glow behind the active gathering crook. */}
            <View style={[styles.crookRing, { borderColor: accentMix(colors.accent, 50) }]} />
            <View style={[styles.crookGlow, { backgroundColor: accentMix(colors.accent, 30) }]} />
            <CrookIcon size={40} color={colors.accent} glow />
          </View>
        </Marker>
      )}

      {members.map((m) => {
        if (!m.coordinates) return null;
        const isSelf = m.userId === currentUserId;
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
  crookMarker: { width: 138, height: 138, alignItems: 'center', justifyContent: 'center' },
  crookRing: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  crookGlow: {
    position: 'absolute',
    width: 62,
    height: 62,
    borderRadius: 31,
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

export default GroupMap;
