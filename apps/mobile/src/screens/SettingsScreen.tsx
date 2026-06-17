import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useSession } from '../state/SessionContext';
import { confirmAction } from '../utils/confirm';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

/**
 * Profile + group settings: shows the anonymous nickname, the current group
 * and role, and lets the user leave the group or sign out.
 */
export default function SettingsScreen({ navigation }: Props) {
  const { user, membership, leaveGroup, signOut } = useSession();
  const insets = useSafeAreaInsets();

  function confirmLeave() {
    confirmAction(
      {
        title: '離開群組',
        message: '確定要離開目前的群組嗎？',
        confirmLabel: '離開',
        destructive: true,
      },
      () => {
        leaveGroup();
        navigation.navigate('Group');
      },
    );
  }

  function confirmSignOut() {
    confirmAction(
      {
        title: '登出',
        message: '登出後會回到登入畫面。',
        confirmLabel: '登出',
        destructive: true,
      },
      () => {
        signOut();
        navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
      },
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <View style={styles.card}>
        <Row label="暱稱 · Nickname" value={user?.name ?? '—'} />
        {user?.email ? <Row label="Email" value={user.email} /> : null}
      </View>

      <View style={styles.card}>
        <Row label="群組 · Group" value={membership?.group.name ?? '尚未加入'} />
        <Row
          label="代碼 · Code"
          value={membership?.group.inviteCode ?? '—'}
        />
        <Row
          label="角色 · Role"
          value={
            membership
              ? membership.role === 'leader'
                ? 'Leader 隊長'
                : 'Follower 成員'
              : '—'
          }
        />
      </View>

      {membership && (
        <Pressable style={styles.dangerBtn} onPress={confirmLeave}>
          <Text style={styles.dangerText}>離開群組 · Leave group</Text>
        </Pressable>
      )}

      <Pressable style={styles.dangerBtn} onPress={confirmSignOut}>
        <Text style={styles.dangerText}>登出 · Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.xl, gap: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { color: colors.textSecondary, fontSize: 14 },
  rowValue: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  dangerBtn: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  dangerText: { color: colors.danger, fontSize: 16, fontWeight: '700' },
});
