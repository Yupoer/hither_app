import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useSession } from '../state/SessionContext';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Auth'>;

/**
 * Entry point. The user types a nickname (the anonymous in-group identity from
 * the design). "Continue" signs in anonymously via Supabase and records the
 * nickname; an optional email is accepted but unused in the anonymous flow.
 *
 * If a persisted session is restored on launch (supabase-js + AsyncStorage),
 * the user is already signed in — we skip straight to the Group screen rather
 * than letting them sign in again (which would mint a fresh, orphaned anon user).
 */
export default function AuthScreen({ navigation }: Props) {
  const { signIn, user, initializing } = useSession();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length >= 1 && !submitting;

  // Once a user exists (restored session or fresh sign-in), advance to Group.
  useEffect(() => {
    if (!initializing && user) {
      navigation.replace('Group');
    }
  }, [initializing, user, navigation]);

  async function handleSignIn() {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn({ name, email });
      // Navigation handled by the effect above once `user` is set.
    } catch (e) {
      setError(e instanceof Error ? e.message : '登入失敗，請再試一次');
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top + spacing.xl }]}>
        <View style={styles.header}>
          <Text style={styles.lantern}>🏮</Text>
          <Text style={styles.title}>Hither</Text>
          <Text style={styles.subtitle}>
            一個暱稱，就能和大家一起出發{'\n'}A nickname is all you need.
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>YOUR NAME · 暱稱</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="例如：迷路的貓"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            returnKeyType="next"
            accessibilityLabel="暱稱"
          />

          <Text style={styles.label}>EMAIL · 選填</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="go"
            onSubmitEditing={handleSignIn}
            accessibilityLabel="Email（選填）"
          />

          <Pressable
            style={({ pressed }) => [
              styles.cta,
              !canSubmit && styles.ctaDisabled,
              pressed && canSubmit && styles.ctaPressed,
            ]}
            onPress={handleSignIn}
            disabled={!canSubmit}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>
              {submitting ? '登入中…' : '登入 · Continue'}
            </Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    gap: spacing.xl,
  },
  header: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  lantern: { fontSize: 56 },
  title: { fontSize: 40, fontWeight: '800', color: colors.textPrimary },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  form: { gap: spacing.sm },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.textSecondary,
    marginTop: spacing.md,
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
  cta: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaPressed: { opacity: 0.85 },
  ctaText: { fontSize: 17, fontWeight: '700', color: colors.accentText },
  error: {
    marginTop: spacing.md,
    fontSize: 14,
    color: '#d9534f',
    textAlign: 'center',
  },
});
