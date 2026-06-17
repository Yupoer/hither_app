import React, { useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import GroupMap, { type GroupMapHandle } from '../components/GroupMap';
import { useSession } from '../state/SessionContext';
import { useGroupState } from '../state/useGroupState';
import { distanceEtaLabel } from '../utils/geo';
import type { MemberLocation } from '../types';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

/**
 * Main screen. A live map of group members (pins) and the next gathering
 * point (lantern), with a frosted card at the bottom showing the gathering
 * point name, distance and ETA. Group state refreshes every 5 seconds via
 * `useGroupState`. The map itself lives in the platform-split `GroupMap`
 * component (native MapView / web fallback).
 */
export default function MapScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const { membership, user } = useSession();

  // Prefer the route param; fall back to the session's current group.
  const groupId = route.params?.groupId ?? membership?.group.id ?? null;
  const { state, loading, refresh } = useGroupState(groupId);

  const mapRef = useRef<GroupMapHandle | null>(null);

  const gathering = state?.nextDestination;
  const members = state?.members ?? [];

  // Distance/ETA is measured from "you" to the gathering point. We don't have
  // the device GPS in this MVP, so we use the matching member, else the leader.
  const reference = useMemo<MemberLocation | undefined>(() => {
    return (
      members.find((m) => m.userId === user?.id) ??
      members.find((m) => m.role === 'leader') ??
      members[0]
    );
  }, [members, user?.id]);

  const distanceLabel =
    gathering && reference?.coordinates
      ? distanceEtaLabel(reference.coordinates, gathering.coordinates)
      : null;

  function recenter() {
    mapRef.current?.recenter();
    refresh();
  }

  if (loading && !state) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>載入群組位置中…</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <GroupMap
        ref={mapRef}
        members={members}
        gathering={gathering}
        currentUserId={user?.id}
      />

      {/* Top pill: group code + member count. */}
      <View style={[styles.topPill, { top: insets.top + spacing.sm }]}>
        <Text style={styles.pillCode}>
          {state?.group.inviteCode ?? '------'}
        </Text>
        <View style={styles.pillDot} />
        <Text style={styles.pillCount}>{members.length} 人</Text>
      </View>

      {/* Recenter button. */}
      <Pressable
        style={[styles.recenter, { top: insets.top + spacing.sm }]}
        onPress={recenter}
        accessibilityRole="button"
        accessibilityLabel="重新置中並更新"
      >
        <Text style={styles.recenterIcon}>◎</Text>
      </Pressable>

      {/* Bottom glass card: NEXT GATHERING POINT. */}
      <View
        style={[styles.card, { paddingBottom: insets.bottom + spacing.lg }]}
      >
        <Text style={styles.cardLabel}>NEXT GATHERING POINT · 下一集合點</Text>
        {gathering ? (
          <>
            <Text style={styles.cardTitle}>{gathering.title}</Text>
            <Text style={styles.cardMeta}>
              {distanceLabel ?? '計算距離中…'}
            </Text>
          </>
        ) : (
          <Text style={styles.cardMeta}>尚未設定集合點</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  loadingText: { color: colors.textSecondary, fontSize: 15 },
  topPill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.glass,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pillCode: {
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: 3,
    fontSize: 15,
  },
  pillDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textSecondary,
  },
  pillCount: { color: colors.textSecondary, fontSize: 14 },
  recenter: {
    position: 'absolute',
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recenterIcon: { color: colors.accent, fontSize: 22 },
  card: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 0,
    marginBottom: spacing.lg,
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
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
});
