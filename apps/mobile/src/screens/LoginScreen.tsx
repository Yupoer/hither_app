import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import * as AppleAuthentication from 'expo-apple-authentication';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import CrookIcon from '../components/CrookIcon';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { accentMix } from '../glass';
import { runUiAction } from '../utils/uiAction';
import SafePressable from '../components/SafePressable';

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
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, signInWithApple } = useSession();
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
  const [guestConfirmVisible, setGuestConfirmVisible] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  const isSignUp = mode === 'signup';
  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const passwordOk = password.length >= MIN_PASSWORD;
  const nicknameOk = !isSignUp || nickname.trim().length >= 1;
  const canSubmit = emailOk && passwordOk && nicknameOk && !busy;

  function goToApp() {
    navigation.replace('RoleSelect');
  }

  // Guest keeps Login on the stack (navigate, not replace) so RoleSelect's
  // back button can return here to register — a guest isn't signed in yet.
  // Gated behind a confirm modal (anon.*) that discloses the 3-day data
  // retention limit before committing to the anonymous flow.
  function continueAsGuest() {
    setGuestConfirmVisible(false);
    navigation.navigate('RoleSelect');
  }

  /** Body for SafePressable / runUiAction — token already provided by runner. */
  async function submitEmail(token: { isCurrent: () => boolean }) {
    if (!canSubmit && !busy) return;
    try {
      if (isSignUp) {
        await signUpWithEmail({ email, password, nickname });
      } else {
        await signInWithEmail({ email, password });
      }
      if (!token.isCurrent()) return;
      goToApp();
    } catch (e) {
      if (token.isCurrent()) {
        const fallback = isSignUp ? t('login.signUpFailed') : t('login.signInFailed');
        Alert.alert(
          isSignUp ? t('login.tabSignUp') : t('login.tabSignIn'),
          e instanceof Error ? e.message : fallback,
        );
      }
      throw e;
    }
  }

  async function handleGoogle() {
    if (busy) return;
    await runUiAction(
      'login.google',
      async (token) => {
        try {
          const user = await signInWithGoogle();
          if (!token.isCurrent()) return;
          if (!user) {
            // User dismissed the Google browser — not an error.
            return;
          }
          goToApp();
        } catch (e) {
          if (token.isCurrent()) {
            Alert.alert(
              'Google',
              e instanceof Error ? e.message : t('login.signInFailed'),
            );
          }
          throw e;
        }
      },
      {
        screen: 'Login',
        suppressBanner: true,
        onBusyChange: setBusy,
        onError: (kind) => {
          if (kind === 'timeout') {
            Alert.alert('Google', t('interaction.timeout'));
          }
        },
      },
    );
  }

  async function handleApple() {
    if (busy) return;
    await runUiAction(
      'login.apple',
      async (token) => {
        try {
          const user = await signInWithApple();
          if (!token.isCurrent()) return;
          if (!user) return;
          goToApp();
        } catch (e) {
          if (token.isCurrent()) {
            Alert.alert('Apple', e instanceof Error ? e.message : t('login.signInFailed'));
          }
          throw e;
        }
      },
      {
        screen: 'Login',
        suppressBanner: true,
        onBusyChange: setBusy,
        onError: (kind) => {
          if (kind === 'timeout') {
            Alert.alert('Apple', t('interaction.timeout'));
          }
        },
      },
    );
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
              keyboardAppearance="dark"
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
              keyboardAppearance="dark"
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
                  keyboardAppearance="dark"
                  autoCapitalize="none"
                  accessibilityLabel={t('login.nickname')}
                />
              </View>
            </>
          )}

          <SafePressable
            actionId={isSignUp ? 'login.sign_up' : 'login.sign_in'}
            screen="Login"
            onPressAction={submitEmail}
            onBusyChange={setBusy}
            suppressBanner
            onActionError={(kind) => {
              if (kind === 'timeout') {
                Alert.alert(
                  isSignUp ? t('login.tabSignUp') : t('login.tabSignIn'),
                  t('interaction.timeout'),
                );
              }
            }}
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
          </SafePressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t('common.or')}</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.socialRow}>
            <View style={styles.socialColumn}>
              <Pressable
                onPress={handleGoogle}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('login.google')}
                style={({ pressed }) => [
                  styles.socialIcon,
                  busy && styles.ctaDisabled,
                  pressed && !busy && styles.pressed,
                ]}
              >
                <Ionicons name="logo-google" size={26} color="#fff" />
              </Pressable>
              <Text style={styles.socialCaption}>{t('login.google')}</Text>
            </View>
            {appleAvailable ? (
              <View style={styles.socialColumn}>
                <Pressable
                  onPress={handleApple}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={t('login.apple')}
                  style={({ pressed }) => [
                    styles.socialIcon,
                    busy && styles.ctaDisabled,
                    pressed && !busy && styles.pressed,
                  ]}
                >
                  <Ionicons name="logo-apple" size={26} color="#fff" />
                </Pressable>
                <Text style={styles.socialCaption}>{t('login.apple')}</Text>
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={() => setGuestConfirmVisible(true)}
            disabled={busy}
            accessibilityRole="button"
            style={styles.guest}
          >
            <Text style={styles.guestText}>{t('login.guest')}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={guestConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGuestConfirmVisible(false)}
      >
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('anon.confirmTitle')}</Text>
            <View style={styles.modalList}>
              <Text style={styles.modalListItem}>{'• ' + t('anon.limit1')}</Text>
              <Text style={styles.modalListItem}>{'• ' + t('anon.limit2')}</Text>
              <Text style={styles.modalListItem}>{'• ' + t('anon.limit3')}</Text>
            </View>
            <View style={styles.modalWarning}>
              <Text style={styles.modalWarningText}>{t('anon.expiryWarning')}</Text>
            </View>
            <Pressable
              onPress={continueAsGuest}
              accessibilityRole="button"
              style={[styles.cta, styles.modalCta]}
            >
              <Text style={styles.ctaText}>{t('anon.continue')}</Text>
            </Pressable>
            <Pressable
              onPress={() => setGuestConfirmVisible(false)}
              accessibilityRole="button"
              style={styles.modalSecondary}
            >
              <Text style={styles.modalSecondaryText}>{t('anon.goRegister')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
    socialIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.22)',
    },
    socialCaption: {
      textAlign: 'center',
      fontSize: 12,
      color: 'rgba(235,235,245,0.45)',
      marginTop: 8,
    },
    socialRow: {
      minHeight: 72,
      marginTop: 18,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'center',
      gap: 16,
    },
    socialColumn: { alignItems: 'center' },
    guest: { alignSelf: 'center', marginTop: 28, padding: 8 },
    guestText: {
      fontSize: 14,
      color: 'rgba(235,235,245,0.55)',
      textDecorationLine: 'underline',
    },
    modalScrim: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    modalCard: {
      width: '100%',
      maxWidth: 380,
      borderRadius: 22,
      padding: 22,
      backgroundColor: '#182131',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.14)',
    },
    modalTitle: {
      fontSize: 19,
      fontWeight: '700',
      color: '#fff',
      marginBottom: 14,
    },
    modalList: { marginBottom: 14, gap: 6 },
    modalListItem: {
      fontSize: 14,
      lineHeight: 20,
      color: 'rgba(235,235,245,0.75)',
    },
    modalWarning: {
      borderRadius: 14,
      padding: 14,
      marginBottom: 18,
      backgroundColor: 'rgba(255,107,107,0.1)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,107,107,0.4)',
    },
    modalWarningText: {
      fontSize: 13,
      lineHeight: 19,
      color: '#ffb3b3',
    },
    modalCta: { marginTop: 0 },
    modalSecondary: { alignSelf: 'center', marginTop: 14, padding: 6 },
    modalSecondaryText: {
      fontSize: 14,
      color: 'rgba(235,235,245,0.55)',
      textDecorationLine: 'underline',
    },
  });
