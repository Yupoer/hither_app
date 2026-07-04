import React, { useMemo, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import CrookIcon from '../components/CrookIcon';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { accentMix } from '../glass';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;
type Mode = 'signin' | 'signup';

const MIN_PASSWORD = 6;

/**
 * Login gate shown when there is no session. Offers email + password
 * (sign in / sign up), Google OAuth, and a "continue as guest" link that
 * falls through to the existing anonymous flow (nickname collected later in
 * AuthScreen). On success every path lands on RoleSelect.
 */
export default function LoginScreen({ navigation }: Props) {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useSession();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const accent = colors.accent;
  const styles = useMemo(() => makeStyles(accent), [accent]);

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === 'signup';
  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const passwordOk = password.length >= MIN_PASSWORD;
  const nicknameOk = !isSignUp || nickname.trim().length >= 1;
  const canSubmit = emailOk && passwordOk && nicknameOk && !busy;

  function goToApp() {
    navigation.replace('RoleSelect');
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (isSignUp) {
        await signUpWithEmail({ email, password, nickname });
      } else {
        await signInWithEmail({ email, password });
      }
      goToApp();
    } catch (e) {
      const fallback = isSignUp ? t('login.signUpFailed') : t('login.signInFailed');
      Alert.alert(
        isSignUp ? t('login.tabSignUp') : t('login.tabSignIn'),
        e instanceof Error ? e.message : fallback,
      );
      setBusy(false);
    }
  }

  async function handleGoogle() {
    if (busy) return;
    setBusy(true);
    try {
      const user = await signInWithGoogle();
      if (!user) {
        setBusy(false); // user dismissed the Google browser
        return;
      }
      goToApp();
    } catch (e) {
      Alert.alert(
        'Google',
        e instanceof Error ? e.message : t('login.signInFailed'),
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
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 28 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <CrookIcon size={64} color={accent} glow />
            <Text style={styles.title}>{t('login.welcomeTitle')}</Text>
            <Text style={styles.sub}>{t('login.welcomeSub')}</Text>
          </View>

          {/* Sign in / sign up toggle */}
          <View style={styles.tabs}>
            {(['signin', 'signup'] as Mode[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                accessibilityRole="button"
                style={[styles.tab, mode === m && styles.tabActive]}
              >
                <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                  {m === 'signin' ? t('login.tabSignIn') : t('login.tabSignUp')}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>{t('login.email')}</Text>
          <View style={styles.field}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder={t('login.emailPlaceholder')}
              placeholderTextColor="rgba(235,235,245,0.4)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              accessibilityLabel={t('login.email')}
            />
          </View>

          <Text style={styles.label}>{t('login.password')}</Text>
          <View style={styles.field}>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={t('login.passwordPlaceholder')}
              placeholderTextColor="rgba(235,235,245,0.4)"
              autoCapitalize="none"
              secureTextEntry
              textContentType={isSignUp ? 'newPassword' : 'password'}
              accessibilityLabel={t('login.password')}
            />
          </View>

          {isSignUp && (
            <>
              <Text style={styles.label}>{t('login.nickname')}</Text>
              <View style={styles.field}>
                <TextInput
                  style={styles.input}
                  value={nickname}
                  onChangeText={setNickname}
                  placeholder={t('login.nicknamePlaceholder')}
                  placeholderTextColor="rgba(235,235,245,0.4)"
                  autoCapitalize="none"
                  accessibilityLabel={t('login.nickname')}
                />
              </View>
            </>
          )}

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
              <Text style={styles.ctaText}>
                {isSignUp ? t('login.ctaSignUp') : t('login.ctaSignIn')}
              </Text>
            )}
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t('common.or')}</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Google logo "ball" */}
          <Pressable
            onPress={handleGoogle}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('login.google')}
            style={({ pressed }) => [
              styles.googleBall,
              busy && styles.ctaDisabled,
              pressed && !busy && styles.pressed,
            ]}
          >
            <Ionicons name="logo-google" size={26} color="#fff" />
          </Pressable>
          <Text style={styles.googleCaption}>{t('login.google')}</Text>

          <Pressable
            onPress={goToApp}
            disabled={busy}
            accessibilityRole="button"
            style={styles.guest}
          >
            <Text style={styles.guestText}>{t('login.guest')}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const makeStyles = (accent: string) =>
  StyleSheet.create({
    fill: { flex: 1 },
    content: { flexGrow: 1, paddingHorizontal: 24 },
    header: { alignItems: 'center', marginBottom: 28 },
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: '#fff',
      marginTop: 14,
    },
    sub: {
      fontSize: 14,
      lineHeight: 20,
      color: 'rgba(235,235,245,0.6)',
      marginTop: 8,
      textAlign: 'center',
      maxWidth: 300,
    },
    tabs: {
      flexDirection: 'row',
      backgroundColor: 'rgba(255,255,255,0.06)',
      borderRadius: 14,
      padding: 4,
      marginBottom: 8,
    },
    tab: {
      flex: 1,
      height: 42,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabActive: {
      backgroundColor: accentMix(accent, 24),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accentMix(accent, 55),
    },
    tabText: {
      fontSize: 15,
      fontWeight: '600',
      color: 'rgba(235,235,245,0.6)',
    },
    tabTextActive: { color: '#fff' },
    label: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: 'rgba(235,235,245,0.45)',
      marginTop: 18,
      marginBottom: 8,
      marginLeft: 4,
    },
    field: {
      height: 56,
      borderRadius: 16,
      justifyContent: 'center',
      paddingHorizontal: 18,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.2)',
    },
    input: { fontSize: 18, color: '#fff' },
    cta: {
      height: 56,
      borderRadius: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 24,
      backgroundColor: accentMix(accent, 24),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accentMix(accent, 55),
    },
    ctaDisabled: { opacity: 0.4 },
    pressed: { opacity: 0.85 },
    ctaText: { fontSize: 17, fontWeight: '600', color: '#fff' },
    divider: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 22,
    },
    dividerLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: 'rgba(255,255,255,0.18)',
    },
    dividerText: {
      fontSize: 12,
      letterSpacing: 1,
      color: 'rgba(235,235,245,0.4)',
    },
    googleBall: {
      alignSelf: 'center',
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 18,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.22)',
    },
    googleCaption: {
      textAlign: 'center',
      fontSize: 12,
      color: 'rgba(235,235,245,0.45)',
      marginTop: 8,
    },
    guest: { alignSelf: 'center', marginTop: 28, padding: 8 },
    guestText: {
      fontSize: 14,
      color: 'rgba(235,235,245,0.55)',
      textDecorationLine: 'underline',
    },
  });
