import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import AuthField from '../components/AuthField';
import AuthModeSelector, { type AuthMode } from '../components/AuthModeSelector';
import CrookIcon from '../components/CrookIcon';
import GoogleGIcon from '../components/GoogleGIcon';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation, type TranslationKey } from '../i18n';
import { accentMix, shade } from '../glass';
import { runUiAction } from '../utils/uiAction';
import SafePressable from '../components/SafePressable';
import LanguagePicker from '../components/LanguagePicker';
import {
  errorTap,
  lightTap,
  mediumTap,
  selectionTick,
  successTap,
} from '../utils/haptics';
import { getLegalUrl } from '../config/legal';
import type { AuthBusyAction, AuthFieldErrors } from '../auth/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;
type Mode = AuthMode;
type FieldName = 'nickname' | 'email' | 'password' | 'confirmPassword';
type AuthError = { field: keyof AuthFieldErrors; key: TranslationKey };

const MIN_PASSWORD = 6;
// The native account picker is interactive; the generic 15s action timeout
// must not expire while the user is still choosing an account.
const SOCIAL_AUTH_TIMEOUT_MS = 120_000;
const AUTH_GRADIENT = ['#20385D', '#132744', '#0A172B', '#071225'] as const;

function mapAuthError(error: unknown): AuthError {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === 'string' ? candidate.code.toLowerCase() : '';
  if (['user_already_exists', 'user_exists', 'email_exists'].includes(code)) {
    return { field: 'email', key: 'login.emailAlreadyRegistered' };
  }
  if (['invalid_login_credentials', 'invalid_credentials'].includes(code)) {
    return { field: 'password', key: 'login.credentialsInvalid' };
  }
  if (['email_not_confirmed', 'email_unconfirmed'].includes(code)) {
    return { field: 'email', key: 'login.emailNotConfirmed' };
  }
  if (['email_address_invalid', 'validation_failed'].includes(code)) {
    return { field: 'email', key: 'login.emailFormatHint' };
  }
  if (['weak_password', 'password_too_short'].includes(code)) {
    return { field: 'password', key: 'login.passwordFormatHint' };
  }
  if (code === 'google_token_exchange_timeout') {
    return { field: 'form', key: 'login.googleVerificationTimeout' };
  }
  if (code === 'google_token_exchange_network') {
    return { field: 'form', key: 'login.googleVerificationNetwork' };
  }
  if (code === 'google_token_exchange_failed') {
    return { field: 'form', key: 'login.googleVerificationFailed' };
  }
  if (['google_not_configured', 'google_native_sign_in_failed', 'google_native_configure_failed', 'google_native_unavailable', 'google_access_token_missing', 'google_token_missing'].includes(code)) {
    return { field: 'form', key: 'login.googleVerificationFailed' };
  }
  if (code === 'google_profile_bootstrap_timeout') {
    return { field: 'form', key: 'login.googleProfileTimeout' };
  }
  if (code === 'google_profile_bootstrap_network') {
    return { field: 'form', key: 'login.googleProfileNetwork' };
  }
  if (code === 'google_profile_bootstrap_failed') {
    return { field: 'form', key: 'login.googleProfileFailed' };
  }

  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : '';
  if (/invalid login credentials|invalid credentials|email or password/.test(message)) {
    return { field: 'password', key: 'login.credentialsInvalid' };
  }
  if (/already registered|already been registered|user already exists|email.*taken/.test(message)) {
    return { field: 'email', key: 'login.emailAlreadyRegistered' };
  }
  if (/invalid email|email.*valid|email_address_invalid/.test(message)) {
    return { field: 'email', key: 'login.emailFormatHint' };
  }
  if (/weak password|weak_password|password.*(character|length|short|weak)/.test(message)) {
    return { field: 'password', key: 'login.passwordFormatHint' };
  }
  return { field: 'form', key: 'login.authUnavailable' };
}

/**
 * The pre-session auth gate. All three states (sign in, sign up, reset) share
 * one scroll surface so the iOS and Android layouts remain usable on small
 * screens and while the keyboard is open.
 */
export default function LoginScreen({ navigation }: Props) {
  const {
    user,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signInWithApple,
    requestPasswordReset,
    resendSignupConfirmation,
  } = useSession();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const accent = colors.accent;
  const compact = windowHeight < 900;
  const styles = useMemo(() => makeStyles(accent, compact), [accent, compact]);

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busyAction, setBusyAction] = useState<AuthBusyAction>(null);
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [touched, setTouched] = useState<Record<FieldName, boolean>>({
    nickname: false,
    email: false,
    password: false,
    confirmPassword: false,
  });
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [guestConfirmVisible, setGuestConfirmVisible] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  const privacyUrl = getLegalUrl('privacy');
  const termsUrl = getLegalUrl('terms');
  const isSignUp = mode === 'signup';
  const busy = busyAction !== null;
  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const passwordOk = password.replace(/\s/g, '').length >= MIN_PASSWORD;
  const confirmPasswordOk = password.length > 0 && password === confirmPassword;
  const nicknameOk = !isSignUp || nickname.trim().length > 0;
  const formCanSubmit = emailOk
    && passwordOk
    && nicknameOk
    && (!isSignUp || (confirmPasswordOk && termsAccepted));

  useEffect(() => {
    void AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, []);

  useEffect(() => {
    setTouched({ nickname: false, email: false, password: false, confirmPassword: false });
    setErrors({});
    setTermsAccepted(false);
  }, [mode]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = setInterval(() => setResetCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [resetCooldown]);

  useEffect(() => {
    if (user && pendingEmail) navigation.replace('RoleSelect');
  }, [navigation, pendingEmail, user]);

  function clearFieldError(field: FieldName): void {
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function changeField(field: FieldName, value: string): void {
    clearFieldError(field);
    if (field === 'email') setEmail(value);
    if (field === 'password') setPassword(value);
    if (field === 'confirmPassword') setConfirmPassword(value);
    if (field === 'nickname') setNickname(value);
  }

  function validateAuthForm(nextMode: Mode): AuthFieldErrors {
    const next: AuthFieldErrors = {};
    if (!email.trim()) next.email = t('login.emailRequired');
    else if (!emailOk) next.email = t('login.emailFormatHint');
    if (!password) next.password = t('login.passwordRequired');
    else if (!passwordOk) next.password = t('login.passwordFormatHint');
    if (nextMode === 'signup') {
      if (!nickname.trim()) next.nickname = t('login.nicknameRequired');
      if (!confirmPassword) next.confirmPassword = t('login.confirmPasswordRequired');
      else if (!confirmPasswordOk) next.confirmPassword = t('login.confirmPasswordMismatch');
    }
    setTouched({
      nickname: nextMode === 'signup',
      email: true,
      password: true,
      confirmPassword: nextMode === 'signup',
    });
    setErrors(next);
    return next;
  }

  function applyAuthError(error: unknown): void {
    const mapped = mapAuthError(error);
    setErrors((current) => ({ ...current, [mapped.field]: t(mapped.key) }));
  }

  function goToApp(): void {
    successTap();
    navigation.replace('RoleSelect');
  }

  async function submitEmail(token: { isCurrent: () => boolean }): Promise<void> {
    if (busyAction || !formCanSubmit) {
      validateAuthForm(mode);
      return;
    }
    mediumTap();
    try {
      if (isSignUp) {
        const result = await signUpWithEmail({
          email: email.trim(),
          password,
          nickname: nickname.trim(),
        });
        if (!token.isCurrent()) return;
        if (result?.status === 'verification_required') {
          successTap();
          setPendingEmail(result.email);
          return;
        }
      } else {
        await signInWithEmail({ email: email.trim(), password });
        if (!token.isCurrent()) return;
      }
      goToApp();
    } catch (error) {
      if (token.isCurrent()) {
        applyAuthError(error);
        errorTap();
      }
      throw error;
    }
  }

  async function runSocial(
    actionId: 'login.google' | 'login.apple',
    action: () => Promise<unknown>,
  ): Promise<void> {
    if (busyAction) return;
    mediumTap();
    await runUiAction(
      actionId,
      async (token) => {
        try {
          const result = await action();
          if (!token.isCurrent() || !result) return;
          goToApp();
        } catch (error) {
          if (token.isCurrent()) {
            applyAuthError(error);
            errorTap();
          }
          throw error;
        }
      },
      {
        screen: 'Login',
        timeoutMs: SOCIAL_AUTH_TIMEOUT_MS,
        suppressBanner: true,
        onBusyChange: (next) => setBusyAction(next ? (actionId === 'login.google' ? 'google' : 'apple') : null),
        onError: (kind) => {
          if (kind === 'timeout') {
            setErrors((current) => ({ ...current, form: t('interaction.timeout') }));
            errorTap();
          }
        },
      },
    );
  }

  async function submitReset(token: { isCurrent: () => boolean }): Promise<void> {
    if (!emailOk || busyAction) return;
    mediumTap();
    try {
      await requestPasswordReset(email.trim());
      if (!token.isCurrent()) return;
      successTap();
      setResetSent(true);
      setResetCooldown(60);
    } catch (error) {
      if (token.isCurrent()) {
        setErrors((current) => ({ ...current, form: t('login.authUnavailable') }));
        errorTap();
      }
      throw error;
    }
  }

  async function resendConfirmation(token: { isCurrent: () => boolean }): Promise<void> {
    if (!pendingEmail || resendCooldown > 0 || busyAction) return;
    mediumTap();
    try {
      await resendSignupConfirmation(pendingEmail);
      if (!token.isCurrent()) return;
      setResendCooldown(60);
      successTap();
    } catch (error) {
      if (token.isCurrent()) {
        setErrors((current) => ({ ...current, form: t('login.authUnavailable') }));
        errorTap();
      }
      throw error;
    }
  }

  function openPasswordReset(): void {
    if (busy) return;
    lightTap();
    setResetMode(true);
    setResetSent(false);
    setResetCooldown(0);
    setErrors({});
    setTouched({ nickname: false, email: false, password: false, confirmPassword: false });
  }

  function backToSignIn(): void {
    selectionTick();
    setResetMode(false);
    setPendingEmail(null);
    setResetSent(false);
    setResendCooldown(0);
    setResetCooldown(0);
    setMode('signin');
    setErrors({});
  }

  function setAuthMode(next: Mode): void {
    if (next === mode || busy) return;
    selectionTick();
    setMode(next);
  }

  function openGuestConfirm(): void {
    if (busy) return;
    lightTap();
    setGuestConfirmVisible(true);
  }

  function continueAsGuest(): void {
    mediumTap();
    setGuestConfirmVisible(false);
    navigation.navigate('RoleSelect');
  }

  function cancelGuest(): void {
    selectionTick();
    setGuestConfirmVisible(false);
  }

  function errorFor(field: FieldName, local: string | null): string | undefined {
    return (touched[field] && local) || errors[field];
  }

  function renderPasswordToggle(active: boolean, testID: string): React.ReactNode {
    return (
      <Pressable
        onPress={() => {
          if (!active || busy) return;
          selectionTick();
          setShowPassword((current) => !current);
        }}
        disabled={!active || busy}
        accessibilityRole="button"
        accessibilityLabel={showPassword ? t('login.hidePassword') : t('login.showPassword')}
        testID={testID}
        hitSlop={8}
        style={styles.revealButton}
      >
        <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={26} color="#F4F7FC" />
      </Pressable>
    );
  }

  function renderCtaSurface(children: React.ReactNode): React.ReactNode {
    return (
      <LinearGradient
        colors={[shade(accent, 0.2), accent]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.92, y: 1 }}
        style={styles.ctaGradient}
      >
        {children}
      </LinearGradient>
    );
  }

  function renderAuthPanel(panelMode: Mode, active: boolean): React.ReactNode {
    const panelSignUp = panelMode === 'signup';
    const panelEmailError = !email.trim()
      ? t('login.emailRequired')
      : !emailOk
        ? t('login.emailFormatHint')
        : null;
    const panelPasswordError = !password
      ? t('login.passwordRequired')
      : !passwordOk
        ? t('login.passwordFormatHint')
        : null;
    const panelConfirmError = !confirmPassword
      ? t('login.confirmPasswordRequired')
      : !confirmPasswordOk
        ? t('login.confirmPasswordMismatch')
        : null;
    const panelNicknameError = !nickname.trim() ? t('login.nicknameRequired') : null;
    const panelCanSubmit = emailOk
      && passwordOk
      && (!panelSignUp || (nicknameOk && confirmPasswordOk && termsAccepted));
    const panelAction: AuthBusyAction = panelSignUp ? 'email_sign_up' : 'email_sign_in';
    const emailError = errorFor('email', panelEmailError);
    const passwordError = errorFor('password', panelPasswordError);
    const confirmError = errorFor('confirmPassword', panelConfirmError);
    const nicknameError = errorFor('nickname', panelNicknameError);

    return (
      <View pointerEvents={active ? 'auto' : 'none'} style={styles.form}>
        {panelSignUp ? (
          <>
            <Text style={styles.label}>{t('login.nickname')}</Text>
            <View style={[styles.field, nicknameError && styles.fieldErrorBorder]}>
              <AuthField
                value={nickname}
                onChangeText={(value) => changeField('nickname', value)}
                onBlur={() => setTouched((current) => ({ ...current, nickname: true }))}
                placeholder={t('login.nicknamePlaceholder')}
                placeholderTextColor="rgba(235,235,245,0.46)"
                keyboardAppearance="dark"
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={t('login.nickname')}
                testID={active ? 'login-nickname' : undefined}
              />
            </View>
            {nicknameError ? <Text style={styles.fieldError}>{nicknameError}</Text> : null}
          </>
        ) : null}

        <Text style={styles.label}>{t('login.email')}</Text>
        <View style={[styles.field, emailError && styles.fieldErrorBorder]}>
          <AuthField
            value={email}
            onChangeText={(value) => changeField('email', value)}
            onBlur={() => setTouched((current) => ({ ...current, email: true }))}
            placeholder={t('login.emailPlaceholder')}
            placeholderTextColor="rgba(235,235,245,0.46)"
            keyboardAppearance="dark"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            accessibilityLabel={t('login.email')}
            testID={active ? 'login-email' : undefined}
          />
        </View>
        {emailError ? <Text style={styles.fieldError}>{emailError}</Text> : null}

        <Text style={styles.label}>{t('login.password')}</Text>
        <View style={[styles.field, passwordError && styles.fieldErrorBorder]}>
          <AuthField
            value={password}
            onChangeText={(value) => changeField('password', value)}
            onBlur={() => setTouched((current) => ({ ...current, password: true }))}
            placeholder={t('login.passwordPlaceholder')}
            placeholderTextColor="rgba(235,235,245,0.46)"
            keyboardAppearance="dark"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showPassword}
            textContentType={panelSignUp ? 'newPassword' : 'password'}
            accessibilityLabel={t('login.password')}
            testID={active ? 'login-password' : undefined}
          />
          {renderPasswordToggle(active, active ? 'login-password-toggle' : 'login-password-toggle-inactive')}
        </View>
        {passwordError ? <Text style={styles.fieldError}>{passwordError}</Text> : null}

        {panelSignUp ? (
          <>
            <Text style={styles.label}>{t('login.confirmPassword')}</Text>
            <View style={[styles.field, confirmError && styles.fieldErrorBorder]}>
              <AuthField
                value={confirmPassword}
                onChangeText={(value) => changeField('confirmPassword', value)}
                onBlur={() => setTouched((current) => ({ ...current, confirmPassword: true }))}
                placeholder={t('login.confirmPasswordPlaceholder')}
                placeholderTextColor="rgba(235,235,245,0.46)"
                keyboardAppearance="dark"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPassword}
                textContentType="newPassword"
                accessibilityLabel={t('login.confirmPassword')}
                testID={active ? 'login-confirm-password' : undefined}
              />
              {renderPasswordToggle(active, active ? 'login-confirm-password-toggle' : 'login-confirm-password-toggle-inactive')}
            </View>
            {confirmError ? <Text style={styles.fieldError}>{confirmError}</Text> : null}
            <Pressable
              onPress={() => {
                selectionTick();
                setTermsAccepted((current) => !current);
              }}
              accessibilityRole="checkbox"
              accessibilityLabel={t('login.signupAgreementA11y')}
              accessibilityState={{ checked: termsAccepted }}
              testID="login-signup-terms"
              style={styles.signupAgreement}
            >
              <Ionicons
                name={termsAccepted ? 'checkbox' : 'square-outline'}
                size={25}
                color={termsAccepted ? accent : 'rgba(235,235,245,0.72)'}
                style={styles.signupAgreementIcon}
              />
              <Text style={styles.signupAgreementText}>
                {t('login.signupAgreementPrefix')}
                <Text
                  onPress={() => termsUrl && void Linking.openURL(termsUrl)}
                  accessibilityRole="link"
                  style={styles.legalText}
                >
                  {t('login.terms')}
                </Text>
                {t('login.signupAgreementAnd')}
                <Text
                  onPress={() => privacyUrl && void Linking.openURL(privacyUrl)}
                  accessibilityRole="link"
                  style={styles.legalText}
                >
                  {t('login.privacy')}
                </Text>
                {t('login.signupAgreementSuffix')}
              </Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={openPasswordReset}
            disabled={busy}
            accessibilityRole="button"
            style={styles.forgot}
            testID={active ? 'login-forgot-password' : undefined}
          >
            <Text style={styles.forgotText}>{t('login.forgotPassword')}</Text>
          </Pressable>
        )}

        <SafePressable
          actionId={panelSignUp ? 'login.sign_up' : 'login.sign_in'}
          screen="Login"
          onPressAction={submitEmail}
          onBusyChange={(next) => setBusyAction(next ? panelAction : null)}
          suppressBanner
          onActionError={(kind) => {
            if (kind === 'timeout') {
              setErrors((current) => ({ ...current, form: t('interaction.timeout') }));
              errorTap();
            }
          }}
          disabled={!active || !panelCanSubmit || busy}
          testID={active ? 'login-submit' : undefined}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.cta,
            styles.primaryAction,
            (!panelCanSubmit || busy) && styles.ctaDisabled,
            pressed && panelCanSubmit && styles.pressed,
          ]}
        >
          {renderCtaSurface(
            busyAction === panelAction ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text style={styles.ctaText}>
                {panelSignUp ? t('login.ctaSignUp') : t('login.ctaSignIn')}
              </Text>
            ),
          )}
        </SafePressable>
      </View>
    );
  }

  function renderReset(): React.ReactNode {
    return (
      <View style={styles.resetCard}>
        <Text style={styles.resetTitle}>{t('login.resetTitle')}</Text>
        <Text style={styles.resetHint}>{t('login.resetHint')}</Text>
        <Text style={styles.label}>{t('login.email')}</Text>
        <View style={[styles.field, touched.email && !emailOk && styles.fieldErrorBorder]}>
          <AuthField
            value={email}
            onChangeText={(value) => changeField('email', value)}
            onBlur={() => setTouched((current) => ({ ...current, email: true }))}
            placeholder={t('login.emailPlaceholder')}
            placeholderTextColor="rgba(235,235,245,0.46)"
            keyboardAppearance="dark"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            accessibilityLabel={t('login.email')}
            testID="login-reset-email"
          />
        </View>
        {touched.email && !emailOk && !resetSent ? (
          <Text style={styles.fieldError}>{email ? t('login.emailFormatHint') : t('login.emailRequired')}</Text>
        ) : null}
        {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}
        {resetSent ? (
          <>
            <Text style={styles.successText}>{t('login.resetSent')}</Text>
            <Text style={styles.resetHelp}>{t('login.resetHelp')}</Text>
          </>
        ) : null}
        <SafePressable
          actionId="login.password_reset"
          screen="Login"
          onPressAction={submitReset}
          onBusyChange={(next) => setBusyAction(next ? 'password_reset' : null)}
          suppressBanner
          disabled={!emailOk || busy || resetCooldown > 0}
          testID="login-reset-submit"
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.cta,
            styles.resetAction,
            (!emailOk || busy || resetCooldown > 0) && styles.ctaDisabled,
            pressed && emailOk && !busy && resetCooldown <= 0 && styles.pressed,
          ]}
        >
          {renderCtaSurface(
            busyAction === 'password_reset' ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text style={styles.ctaText} numberOfLines={2} adjustsFontSizeToFit>
                {resetSent ? t('login.resetResend') : t('login.resetSubmit')}
              </Text>
            ),
          )}
        </SafePressable>
        {resetCooldown > 0 ? (
          <Text style={styles.cooldownText}>{t('login.resendIn', { seconds: resetCooldown })}</Text>
        ) : null}
        <Pressable
          onPress={backToSignIn}
          accessibilityRole="button"
          testID="login-back-to-sign-in"
          style={styles.backLink}
        >
          <Text style={styles.backLinkText}>{t('login.backToSignIn')}</Text>
        </Pressable>
      </View>
    );
  }

  function renderPending(): React.ReactNode {
    return (
      <View style={styles.pendingCard}>
              <Ionicons name="mail-outline" size={compact ? 36 : 42} color={accent} />
        <Text style={styles.sectionTitle}>{t('login.verificationTitle')}</Text>
        <Text style={styles.pendingEmail}>{pendingEmail}</Text>
        <Text style={styles.resetHint}>{t('login.verificationPending')}</Text>
        {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}
        <SafePressable
          actionId="login.resend_confirmation"
          screen="Login"
          onPressAction={resendConfirmation}
          onBusyChange={(next) => setBusyAction(next ? 'resend_confirmation' : null)}
          suppressBanner
          disabled={busy || resendCooldown > 0}
          testID="login-resend-confirmation"
          accessibilityRole="button"
          style={[styles.cta, (busy || resendCooldown > 0) && styles.ctaDisabled]}
        >
          {renderCtaSurface(
            busyAction === 'resend_confirmation' ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text style={styles.ctaText}>
                {resendCooldown > 0
                  ? `${t('login.resendConfirmation')} (${resendCooldown})`
                  : t('login.resendConfirmation')}
              </Text>
            ),
          )}
        </SafePressable>
        <Pressable onPress={backToSignIn} accessibilityRole="button" style={styles.backLink}>
          <Text style={styles.backLinkText}>{t('login.backToSignIn')}</Text>
        </Pressable>
      </View>
    );
  }

  function renderLegalLinks(): React.ReactNode {
    return (
      <View style={styles.legalRow}>
        <Pressable
          onPress={() => privacyUrl && void Linking.openURL(privacyUrl)}
          disabled={!privacyUrl}
          accessibilityRole="link"
          testID="login-privacy"
        >
          <Text style={[styles.legalText, !privacyUrl && styles.disabledText]}>{t('login.privacy')}</Text>
        </Pressable>
        <Text style={styles.legalDot}>·</Text>
        <Pressable
          onPress={() => termsUrl && void Linking.openURL(termsUrl)}
          disabled={!termsUrl}
          accessibilityRole="link"
          testID="login-terms"
        >
          <Text style={[styles.legalText, !termsUrl && styles.disabledText]}>{t('login.terms')}</Text>
        </Pressable>
      </View>
    );
  }

  function renderSocialOptions(): React.ReactNode {
    return (
      <>
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{t('common.or')}</Text>
          <View style={styles.dividerLine} />
        </View>
        <View style={styles.socialRow}>
          <View style={styles.socialColumn}>
            <Pressable
              onPress={() => void runSocial('login.google', () => signInWithGoogle())}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('login.google')}
              testID="login-google"
              style={({ pressed }) => [styles.socialIcon, busy && styles.ctaDisabled, pressed && !busy && styles.pressed]}
            >
              <GoogleGIcon size={34} />
            </Pressable>
            <Text style={styles.socialCaption}>{t('login.googleLabel')}</Text>
          </View>
          {appleAvailable ? (
            <View style={styles.socialColumn}>
              <Pressable
                onPress={() => void runSocial('login.apple', () => signInWithApple())}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('login.apple')}
                testID="login-apple"
                style={({ pressed }) => [styles.socialIcon, busy && styles.ctaDisabled, pressed && !busy && styles.pressed]}
              >
                <Ionicons name="logo-apple" size={34} color="#F5F7FB" />
              </Pressable>
              <Text style={styles.socialCaption}>{t('login.appleLabel')}</Text>
            </View>
          ) : null}
        </View>
        <Pressable
          onPress={openGuestConfirm}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('login.guest')}
          testID="login-guest"
          style={({ pressed }) => [styles.guestButton, busy && styles.ctaDisabled, pressed && styles.pressed]}
        >
          <Ionicons name="people-outline" size={29} color={accent} />
          <Text style={styles.guestText}>{t('login.guest')}</Text>
        </Pressable>
      </>
    );
  }

  const content = pendingEmail ? renderPending() : resetMode ? renderReset() : (
    <>
      <AuthModeSelector
        mode={mode}
        onChange={setAuthMode}
        labels={{ signin: t('login.tabSignIn'), signup: t('login.tabSignUp') }}
        disabled={busy}
        wide
      />
      <View style={styles.formViewport}>{renderAuthPanel(mode, true)}</View>
      {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}
    </>
  );

  const showBackChrome = resetMode || Boolean(pendingEmail);

  return (
    <LinearGradient colors={[...AUTH_GRADIENT]} locations={[0, 0.35, 0.72, 1]} style={styles.fill}>
      <View pointerEvents="none" style={styles.glowTop} />
      <View pointerEvents="none" style={styles.glowBottom} />
      <View style={[styles.langChrome, { top: insets.top + 12 }]}>
        {showBackChrome ? (
          <Pressable
            onPress={backToSignIn}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            testID="login-back"
            hitSlop={8}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={24} color="#F3F6FC" />
            <Text style={styles.backButtonText}>{t('common.back')}</Text>
          </Pressable>
        ) : (
          <LanguagePicker variant="menu" />
        )}
      </View>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + (compact ? 16 : 24), paddingBottom: insets.bottom + (compact ? 16 : 28) }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.screenColumn}>
            <View style={[styles.brand, resetMode && styles.resetBrand]}>
              <CrookIcon size={compact ? 44 : 64} color={accent} glow />
              <Text style={styles.brandText}>{t('login.welcomeTitle')}</Text>
            </View>

            <View style={styles.mainPanel}>{content}</View>

            {!pendingEmail && !resetMode ? renderSocialOptions() : null}
            {resetMode ? <View style={styles.resetFooter}>{renderLegalLinks()}</View> : null}
            {pendingEmail ? <View style={styles.pendingFooter}>{renderLegalLinks()}</View> : null}
            {!pendingEmail && !resetMode ? <View style={styles.normalFooter}>{renderLegalLinks()}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={guestConfirmVisible} transparent animationType="fade" onRequestClose={cancelGuest}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('anon.confirmTitle')}</Text>
            <Text style={styles.modalWarningText}>{t('anon.warning')}</Text>
            <Text style={styles.modalWarningText}>{t('anon.expiryWarning')}</Text>
            <Pressable
              onPress={continueAsGuest}
              accessibilityRole="button"
              accessibilityLabel={t('anon.continue')}
              style={({ pressed }) => [styles.modalCta, pressed && styles.pressed]}
            >
              <Text style={styles.ctaText}>{t('anon.continue')}</Text>
            </Pressable>
            <Pressable onPress={cancelGuest} accessibilityRole="button" style={styles.modalSecondary}>
              <Text style={styles.modalSecondaryText}>{t('common.cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const makeStyles = (accent: string, compact = false) =>
  StyleSheet.create({
    fill: { flex: 1 },
    glowTop: {
      position: 'absolute',
      width: 330,
      height: 330,
      borderRadius: 165,
      top: -210,
      right: -100,
      backgroundColor: 'rgba(66, 116, 181, 0.13)',
    },
    glowBottom: {
      position: 'absolute',
      width: 280,
      height: 280,
      borderRadius: 140,
      bottom: -170,
      left: -130,
      backgroundColor: 'rgba(37, 77, 132, 0.12)',
    },
    langChrome: { position: 'absolute', left: 20, zIndex: 10 },
    content: { flexGrow: 1, paddingHorizontal: 24 },
    screenColumn: { width: '100%', maxWidth: 680, alignSelf: 'center', flexGrow: 1 },
    brand: {
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: compact ? 12 : 68,
      marginBottom: compact ? 12 : 44,
    },
    resetBrand: { marginTop: compact ? 12 : 84, marginBottom: compact ? 12 : 42 },
    brandText: { color: '#F4F7FC', fontSize: compact ? 30 : 37, fontWeight: '700', letterSpacing: -0.8 },
    mainPanel: { width: '100%' },
    formViewport: { width: '100%' },
    form: { width: '100%' },
    label: {
      fontSize: compact ? 14 : 16,
      lineHeight: compact ? 18 : 22,
      fontWeight: '500',
      color: 'rgba(226, 233, 245, 0.72)',
      marginTop: compact ? 4 : 20,
      marginBottom: compact ? 2 : 9,
      marginLeft: 2,
    },
    field: {
      minHeight: compact ? 52 : 62,
      borderRadius: compact ? 15 : 18,
      justifyContent: 'center',
      paddingHorizontal: 6,
      backgroundColor: 'rgba(255,255,255,0.075)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(220, 230, 246, 0.22)',
      flexDirection: 'row',
      alignItems: 'center',
    },
    fieldErrorBorder: { borderColor: 'rgba(255, 119, 119, 0.84)' },
    revealButton: { minWidth: 48, minHeight: compact ? 44 : 52, alignItems: 'center', justifyContent: 'center' },
    fieldError: { marginTop: 6, marginLeft: 3, color: '#FF9B9B', fontSize: 13, lineHeight: 18 },
    formError: { marginTop: 12, color: '#FF9B9B', fontSize: 13, lineHeight: 18, textAlign: 'center' },
    cta: {
      minHeight: compact ? 52 : 62,
      borderRadius: compact ? 26 : 31,
      marginTop: compact ? 10 : 24,
      backgroundColor: 'transparent',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accentMix(accent, 55),
      width: '100%',
      overflow: 'hidden',
    },
    ctaGradient: {
      width: '100%',
      minHeight: compact ? 52 : 62,
      borderRadius: compact ? 26 : 31,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    primaryAction: { width: '100%', alignSelf: 'center' },
    resetAction: { width: '100%', alignSelf: 'center', marginTop: compact ? 24 : 42 },
    // Disabled is enforced by Pressable/accessibilityState; keep the amber
    // surface bright so validation does not turn the CTA into muddy brown.
    ctaDisabled: { opacity: 1 },
    pressed: { opacity: 0.82 },
    ctaText: { fontSize: compact ? 17 : 19, fontWeight: '700', color: '#10213A' },
    forgot: { alignSelf: 'flex-end', minHeight: compact ? 32 : 44, justifyContent: 'center', paddingLeft: 16 },
    forgotText: { fontSize: compact ? 14 : 16, color: 'rgba(232,238,248,0.78)', textDecorationLine: 'underline' },
    divider: { flexDirection: 'row', alignItems: 'center', gap: compact ? 12 : 14, marginTop: compact ? 12 : 36 },
    dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(224,232,246,0.27)' },
    dividerText: { fontSize: compact ? 14 : 17, color: 'rgba(224,232,246,0.72)' },
    socialIcon: {
      width: compact ? 56 : 72,
      height: compact ? 56 : 72,
      borderRadius: compact ? 28 : 36,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.055)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(220,230,246,0.36)',
    },
    socialCaption: { textAlign: 'center', fontSize: compact ? 14 : 16, color: 'rgba(232,238,248,0.82)', marginTop: compact ? 4 : 11 },
    socialRow: { minHeight: compact ? 84 : 112, marginTop: compact ? 6 : 22, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: compact ? 28 : 40 },
    socialColumn: { alignItems: 'center', minWidth: 86 },
    guestButton: {
      alignSelf: 'center',
      width: '100%',
      minHeight: compact ? 52 : 62,
      borderRadius: compact ? 26 : 31,
      flexDirection: 'row',
      gap: compact ? 10 : 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: compact ? 8 : 25,
      backgroundColor: 'rgba(255,255,255,0.065)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(220,230,246,0.3)',
      paddingHorizontal: 12,
    },
    guestText: { fontSize: compact ? 17 : 19, fontWeight: '600', color: '#F0F4FB' },
    legalRow: {
      minHeight: compact ? 40 : 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: compact ? 14 : 18,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(224,232,246,0.18)',
      paddingTop: compact ? 6 : 18,
    },
    normalFooter: { marginTop: compact ? 4 : 26, marginBottom: 4 },
    resetFooter: { marginTop: compact ? 14 : 116, marginBottom: 6 },
    pendingFooter: { marginTop: compact ? 20 : 48, marginBottom: 8 },
    legalText: { fontSize: compact ? 13 : 15, color: 'rgba(224,232,246,0.68)', textDecorationLine: 'underline' },
    legalDot: { color: 'rgba(224,232,246,0.56)', fontSize: compact ? 13 : 15 },
    disabledText: { opacity: 0.5 },
    resetCard: { width: '100%' },
    resetTitle: { fontSize: compact ? 32 : 39, lineHeight: compact ? 39 : 47, fontWeight: '700', color: '#F4F7FC', textAlign: 'center' },
    resetHint: { fontSize: compact ? 16 : 18, lineHeight: compact ? 23 : 28, color: 'rgba(226,233,245,0.72)', marginTop: compact ? 10 : 17, textAlign: 'center' },
    resetHelp: { fontSize: 14, lineHeight: 21, color: 'rgba(226,233,245,0.64)', marginTop: 12, textAlign: 'center' },
    cooldownText: { fontSize: 13, color: 'rgba(226,233,245,0.6)', textAlign: 'center', marginTop: 8 },
    successText: { fontSize: 15, lineHeight: 22, color: '#A2E7B8', marginTop: 18, textAlign: 'center' },
    backLink: { alignSelf: 'center', minHeight: compact ? 44 : 50, justifyContent: 'center', paddingHorizontal: 16, marginTop: compact ? 8 : 16 },
    backLinkText: { fontSize: compact ? 17 : 18, color: 'rgba(241,245,252,0.9)', textDecorationLine: 'underline' },
    signupAgreement: { flexDirection: 'row', alignItems: 'flex-start', marginTop: compact ? 6 : 17, paddingHorizontal: 3 },
    signupAgreementIcon: { width: compact ? 26 : 32, marginTop: -2 },
    signupAgreementText: { flex: 1, fontSize: compact ? 13 : 14, lineHeight: compact ? 17 : 21, color: 'rgba(226,233,245,0.69)' },
    pendingCard: { minHeight: 0, alignItems: 'center', paddingTop: 20 },
    sectionTitle: { fontSize: 28, lineHeight: 35, fontWeight: '700', color: '#F4F7FC', marginTop: 21, textAlign: 'center' },
    pendingEmail: { fontSize: 17, fontWeight: '600', color: '#F4F7FC', marginTop: 12 },
    backButton: {
      minHeight: 46,
      paddingHorizontal: 16,
      borderRadius: 23,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: 'rgba(255,255,255,0.07)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(220,230,246,0.3)',
    },
    backButtonText: { color: '#F4F7FC', fontSize: 17, fontWeight: '600' },
    modalScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.58)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    modalCard: { width: '100%', maxWidth: 420, borderRadius: 24, padding: 24, backgroundColor: '#15243A', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(220,230,246,0.22)' },
    modalTitle: { fontSize: 21, fontWeight: '700', color: '#F4F7FC', marginBottom: 14 },
    modalWarningText: { fontSize: 15, lineHeight: 23, color: 'rgba(232,238,248,0.82)', marginBottom: 5 },
    modalCta: { alignSelf: 'center', width: '100%', minHeight: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginTop: 20, backgroundColor: accent },
    modalSecondary: { alignSelf: 'center', minHeight: 46, justifyContent: 'center', paddingHorizontal: 14, marginTop: 8 },
    modalSecondaryText: { fontSize: 15, color: 'rgba(226,233,245,0.72)', textDecorationLine: 'underline' },
  });
