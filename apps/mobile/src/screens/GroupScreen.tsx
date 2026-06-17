import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { createGroup, joinGroup } from '../api/client';
import { useSession } from '../state/SessionContext';
import type { Group } from '../types';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Group'>;

type Mode = 'choose' | 'create' | 'join';

/**
 * Create a group (becoming leader) or join one with a code (becoming
 * follower). On success the group is stored in the session and the user can
 * "Enter group" to open the map.
 */
export default function GroupScreen({ navigation }: Props) {
  const { user, membership, setMembership, leaveGroup } = useSession();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('choose');
  const [groupName, setGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);

  const group: Group | null = membership?.group ?? null;

  async function handleCreate() {
    const name = groupName.trim() || `${user?.name ?? ''} 的團`;
    setBusy(true);
    try {
      const created = await createGroup(name);
      setMembership({ group: created, role: 'leader' });
    } catch {
      Alert.alert('建立失敗', '無法建立群組，請再試一次。');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    const code = joinCode.trim();
    if (code.length < 4) {
      Alert.alert('代碼不正確', '請輸入群組代碼或 ID。');
      return;
    }
    setBusy(true);
    try {
      const joined = await joinGroup(code);
      setMembership({ group: joined, role: 'follower' });
    } catch {
      Alert.alert('加入失敗', '找不到這個群組，請確認代碼。');
    } finally {
      setBusy(false);
    }
  }

  function enterGroup() {
    if (group) {
      navigation.navigate('Map', { groupId: group.id });
    }
  }

  function confirmLeave() {
    Alert.alert('離開群組', '確定要離開目前的群組嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '離開',
        style: 'destructive',
        // Clearing the membership drops us back to the role picker below
        // (建立 / 加入) — i.e. the identity-choosing screen.
        onPress: () => leaveGroup(),
      },
    ]);
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.greeting}>
          嗨，{user?.name ?? '旅人'} 👋
        </Text>

        {/* Once in a group, show the code hero + Enter map (LOBBY screen). */}
        {group ? (
          <View style={styles.lobby}>
            <Text style={styles.label}>GROUP CODE · 群組代碼</Text>
            <View style={styles.codeHero}>
              <Text style={styles.codeText}>{group.inviteCode}</Text>
            </View>
            <Text style={styles.roleLine}>
              {membership?.role === 'leader' ? 'Leader · you 你是隊長' : 'Follower 你是成員'}
            </Text>
            <Text style={styles.hint}>
              把代碼分享給夥伴，他們用「加入群組」輸入即可。
            </Text>

            <Pressable
              style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              onPress={enterGroup}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>進入地圖 · Enter group</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.leaveBtn,
                pressed && styles.ctaPressed,
              ]}
              onPress={confirmLeave}
              accessibilityRole="button"
            >
              <Text style={styles.leaveText}>離開群組 · Leave group</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Role / action picker. */}
            <View style={styles.segment}>
              <SegmentButton
                label="建立群組"
                sub="Leader"
                active={mode === 'create'}
                onPress={() => setMode('create')}
              />
              <SegmentButton
                label="加入群組"
                sub="Follower"
                active={mode === 'join'}
                onPress={() => setMode('join')}
              />
            </View>

            {mode === 'create' && (
              <View style={styles.form}>
                <Text style={styles.label}>GROUP NAME · 團名（選填）</Text>
                <TextInput
                  style={styles.input}
                  value={groupName}
                  onChangeText={setGroupName}
                  placeholder="例如：信義區週末小隊"
                  placeholderTextColor={colors.textSecondary}
                  accessibilityLabel="團名"
                />
                <PrimaryButton
                  label="建立並取得代碼 · Create group"
                  busy={busy}
                  onPress={handleCreate}
                />
              </View>
            )}

            {mode === 'join' && (
              <View style={styles.form}>
                <Text style={styles.label}>GROUP CODE · 群組代碼或 ID</Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={joinCode}
                  onChangeText={(t) => setJoinCode(t.toUpperCase())}
                  placeholder="WND482"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  accessibilityLabel="群組代碼"
                />
                <PrimaryButton
                  label="加入 · Join group"
                  busy={busy}
                  onPress={handleJoin}
                />
              </View>
            )}

            {mode === 'choose' && (
              <Text style={styles.hint}>
                選擇「建立群組」當隊長，或用代碼「加入群組」當成員。
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SegmentButton({
  label,
  sub,
  active,
  onPress,
}: {
  label: string;
  sub: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
        {label}
      </Text>
      <Text style={[styles.segmentSub, active && styles.segmentSubActive]}>
        {sub}
      </Text>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  busy,
  onPress,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.cta,
        busy && styles.ctaDisabled,
        pressed && !busy && styles.ctaPressed,
      ]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
    >
      {busy ? (
        <ActivityIndicator color={colors.accentText} />
      ) : (
        <Text style={styles.ctaText}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  greeting: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  segment: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  segmentBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: 2,
  },
  segmentBtnActive: {
    borderColor: colors.accent,
    backgroundColor: '#231C0E',
  },
  segmentLabel: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  segmentLabelActive: { color: colors.accent },
  segmentSub: { fontSize: 12, color: colors.textSecondary },
  segmentSubActive: { color: colors.accent },
  form: { gap: spacing.sm },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.textSecondary,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 17,
    color: colors.textPrimary,
  },
  codeInput: {
    fontSize: 24,
    letterSpacing: 6,
    fontWeight: '700',
    textAlign: 'center',
  },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaPressed: { opacity: 0.85 },
  ctaText: { fontSize: 17, fontWeight: '700', color: colors.accentText },
  leaveBtn: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  leaveText: { fontSize: 15, fontWeight: '700', color: colors.danger },
  lobby: { gap: spacing.md },
  codeHero: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  codeText: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 10,
    color: colors.accent,
  },
  roleLine: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  hint: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
});
