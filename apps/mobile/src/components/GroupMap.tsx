import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import type { Coordinates, Destination, MemberLocation } from '../types';
import { colors } from '../theme';

/** Imperative handle so the screen can recenter the map. */
export interface GroupMapHandle {
  recenter: () => void;
}

export interface GroupMapProps {
  members: MemberLocation[];
  gathering?: Destination;
  currentUserId?: string;
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
  { members, gathering, currentUserId },
  ref,
) {
  const mapRef = useRef<MapView | null>(null);
  const centeredRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      recenter: () => {
        if (gathering && mapRef.current) {
          mapRef.current.animateToRegion(regionFor(gathering.coordinates), 400);
        }
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
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={gathering ? regionFor(gathering.coordinates) : undefined}
      showsUserLocation
      showsCompass
    >
      {gathering && (
        <Marker
          coordinate={gathering.coordinates}
          title={gathering.title}
          description="下一個集合點 · gathering point"
        >
          <View style={styles.lanternMarker}>
            <Text style={styles.lanternEmoji}>🏮</Text>
          </View>
        </Marker>
      )}

      {members.map((m) =>
        m.coordinates ? (
          <Marker
            key={m.userId}
            coordinate={m.coordinates}
            title={`${m.name}${m.userId === currentUserId ? ' · you' : ''}`}
            description={m.role === 'leader' ? 'Leader' : 'Follower'}
          >
            <View
              style={[
                styles.memberPin,
                {
                  borderColor:
                    m.role === 'leader' ? colors.leader : colors.follower,
                },
              ]}
            >
              <Text style={styles.memberInitial}>{m.name.slice(0, 1)}</Text>
            </View>
          </Marker>
        ) : null,
      )}
    </MapView>
  );
});

const styles = StyleSheet.create({
  lanternMarker: { alignItems: 'center', justifyContent: 'center' },
  lanternEmoji: { fontSize: 34 },
  memberPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitial: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
});

export default GroupMap;
