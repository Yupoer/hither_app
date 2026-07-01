import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { createGroup, joinGroup } from '../api/client';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { accentMix } from '../glass';

type Props = NativeStackScreenProps<RootStackParamList, 'Auth'>;

/**
 * Nickname (+ group code for followers) entry. From here the leader creates a
 * group and the follower joins one by code, then both drop straight onto the
 * map — the old separate "Group lobby" screen is gone (design: no lobby).
 *
 * Anonymous Supabase sign-in happens lazily on the first submit; a restored
 * session skips it and just reuses / renames the existing anon user.
 */
export default function AuthScreen({ navigation, route }: Props) {
  const role = route.params?.role ?? 'leader';
  const isLeader = role === 'leader';
  const { signIn, user, updateNickname, setMembership } = useSession();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const accent = colors.accent;
  const styles = useMemo(() => makeStyles(accent), [accent]);

  const [name, setName] = useState(user?.name ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const canSubmit =
    name.trim().length >= 1 && (isLeader || code.trim().length >= 4) && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    const nickname = name.trim();
    try {
      // Ensure we have an anonymous user, then keep the nickname current.
      if (!user) {
        await signIn({ name: nickname });
      } else if (nickname !== user.name) {
        await updateNickname(nickname);
      }

      const group = isLeader
        ? await createGroup(t('group.defaultName', { name: nickname }))
        : await joinGroup(code.trim());
      setMembership({ group, role });
      navigation.replace('Map', { groupId: group.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('auth.signInFailed');
      Alert.alert(
        isLeader ? t('group.createFailedTitle') : t('group.joinFailedTitle'),
        msg,
      );
      setBusy(false);
    }
  }

  return (
    <LinearGradient
      colors={['#1f3050', '#0e1622', '#080b12']}
      locations={[0, 0.52, 1]}
      style={styles.fill}
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            styles.content,
            { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 28 },
          ]}
        >
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.back}
          >
            <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.7)" />
          </Pressable>

          <Text style={styles.kicker}>
            {isLeader ? t('auth.leaderKicker') : t('auth.followerKicker')}
          </Text>
          <Text style={styles.title}>
            {isLeader ? t('auth.leaderTitle') : t('auth.followerTitle')}
          </Text>
          <Text style={styles.sub}>
            {isLeader ? t('auth.leaderSub') : t('auth.followerSub')}
          </Text>

          <Text style={styles.label}>{t('auth.nameLabel')}</Text>
          <View style={styles.field}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('auth.namePlaceholder')}
              placeholderTextColor="rgba(235,235,245,0.4)"
              autoCapitalize="none"
              autoFocus
              returnKeyType={isLeader ? 'go' : 'next'}
              onSubmitEditing={isLeader ? handleSubmit : undefined}
              accessibilityLabel={t('auth.nameLabel')}
            />
          </View>

          {!isLeader && (
            <>
              <Text style={styles.label}>{t('group.codeLabel')}</Text>
              <View style={styles.field}>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  onChangeText={(v) => setCode(v.toUpperCase())}
                  placeholder="WND482"
                  placeholderTextColor="rgba(235,235,245,0.3)"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={8}
                  returnKeyType="go"
                  onSubmitEditing={handleSubmit}
                  accessibilityLabel={t('group.codeLabel')}
                />
              </View>
            </>
          )}

          <View style={styles.spacer} />

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.cta,
              !canSubmit && styles.ctaDisabled,
              pressed && canSubmit && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.ctaText}>
                  {isLeader ? t('auth.leaderCta') : t('auth.followerCta')}
                </Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
            )}
          </Pressable>

          <Text style={styles.footer}>
            {isLeader ? t('auth.leaderFoot') : t('auth.followerFoot')}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const makeStyles = (accent: string) =>
  StyleSheet.create({
    fill: { flex: 1 },
    content: { flex: 1, paddingHorizontal: 24 },
    back: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.18)',
    },
    kicker: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: accent,
      marginTop: 26,
    },
    title: { fontSize: 34, fontWeight: '700', color: '#fff', marginTop: 6 },
    sub: {
      fontSize: 15,
      lineHeight: 21,
      color: 'rgba(235,235,245,0.6)',
      marginTop: 8,
      maxWidth: 300,
    },
    label: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: 'rgba(235,235,245,0.45)',
      marginTop: 26,
      marginBottom: 8,
      marginLeft: 4,
    },
    field: {
      height: 58,
      borderRadius: 16,
      justifyContent: 'center',
      paddingHorizontal: 18,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.2)',
    },
    input: { fontSize: 19, color: '#fff' },
    codeInput: { fontSize: 24, fontWeight: '600', letterSpacing: 6 },
    spacer: { flex: 1, minHeight: 24 },
    cta: {
      height: 56,
      borderRadius: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: accentMix(accent, 24),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accentMix(accent, 55),
    },
    ctaDisabled: { opacity: 0.4 },
    pressed: { opacity: 0.85 },
    ctaText: { fontSize: 17, fontWeight: '600', color: '#fff' },
    footer: {
      textAlign: 'center',
      fontSize: 13,
      color: 'rgba(235,235,245,0.4)',
      marginTop: 14,
    },
  });
