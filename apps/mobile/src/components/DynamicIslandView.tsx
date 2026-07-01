import React from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import CrookIcon from './CrookIcon';
import { accentMix } from '../glass';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * In-app Dynamic Island mock, mirroring the real ActivityKit Live Activity
 * (Phase C). Tapping expands it from a compact "crook + ETA" pill to the full
 * gathering-point card (name, ETA, distance, flock progress and avatars) — the
 * same source of truth the lock-screen activity reads. Purely presentational.
 */
export default function DynamicIslandView({
  expanded,
  onToggle,
  accent,
  gatheringName,
  eta,
  dist,
  progress,
  avatarColors,
  statusText,
}: {
  expanded: boolean;
  onToggle: () => void;
  accent: string;
  gatheringName: string;
  eta: string;
  dist?: string;
  /** 0..1 flock progress toward the point. */
  progress: number;
  avatarColors: string[];
  statusText?: string;
}) {
  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  }

  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel="Live Activity"
      style={[styles.island, expanded ? styles.islandOpen : styles.islandClosed]}
    >
      {expanded ? (
        <View style={styles.expanded}>
          <View style={styles.row}>
            <View style={[styles.iconBox, { backgroundColor: accentMix(accent, 22) }]}>
              <CrookIcon size={25} color={accent} />
            </View>
            <View style={styles.grow}>
              <Text style={[styles.kicker, { color: accent }]}>GATHERING AT</Text>
              <Text style={styles.name} numberOfLines={1}>
                {gatheringName}
              </Text>
            </View>
            <View style={styles.etaBlock}>
              <Text style={styles.etaBig}>{eta}</Text>
              {dist ? <Text style={styles.dist}>{dist}</Text> : null}
            </View>
          </View>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`, backgroundColor: accent },
              ]}
            />
          </View>
          <View style={styles.footer}>
            <View style={styles.avatars}>
              {avatarColors.slice(0, 3).map((c, i) => (
                <View
                  key={i}
                  style={[styles.avatar, { backgroundColor: c, marginLeft: i ? -8 : 0 }]}
                />
              ))}
            </View>
            {statusText ? <Text style={styles.status}>{statusText}</Text> : null}
          </View>
        </View>
      ) : (
        <View style={styles.compact}>
          <CrookIcon size={18} color={accent} />
          <Text style={[styles.compactEta, { color: accent }]}>{eta}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  island: {
    backgroundColor: '#000',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  islandClosed: { borderRadius: 22, width: 126 },
  islandOpen: { borderRadius: 30, width: 340 },
  compact: {
    height: 37,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  compactEta: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  expanded: { padding: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  name: { fontSize: 16, fontWeight: '600', color: '#fff' },
  etaBlock: { alignItems: 'flex-end' },
  etaBig: { fontSize: 22, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums'] },
  dist: { fontSize: 12, color: 'rgba(235,235,245,0.55)' },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginTop: 16,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  avatars: { flexDirection: 'row' },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#000',
  },
  status: { fontSize: 12.5, color: 'rgba(235,235,245,0.6)' },
});
