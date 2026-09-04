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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import AuthField from '../components/AuthField';
import AuthModeSelector, { type AuthMode } from '../components/AuthModeSelector';
import CrookIcon from '../components/CrookIcon';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation, type TranslationKey } from '../i18n';
import { accentMix } from '../glass';
import { runUiAction } from '../utils/uiAction';
import SafePressable from '../components/SafePressable';
import NativeGlassButton from '../components/NativeGlassButton';
import LanguagePicker from '../components/LanguagePicker';
import MetalforgeBackground from '../components/MetalforgeBackground';
import BlockingAuthOverlay from '../components/BlockingAuthOverlay';
import GoogleGIcon from '../components/GoogleGIcon';
import SwiftUIGlassSurface from '../components/SwiftUIGlassSurface';
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
type FieldName = 'email' | 'password' | 'confirmPassword';
type AuthError = { field: keyof AuthFieldErrors; key: TranslationKey };

const MIN_PASSWORD = 6;
// The native account picker is interactive; the generic 15s action timeout
// must not expire while the user is still choosing an account.
const SOCIAL_AUTH_TIMEOUT_MS = 120_000;
const appVersion =
  Constants.expoConfig?.version ??
  Constants.nativeAppVersion ??
  '0.1.7';

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
  const isFocused = useIsFocused();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const accent = colors.accent;
  const styles = useMemo(() => makeStyles(accent), [accent]);

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busyAction, setBusyAction] = useState<AuthBusyAction>(null);
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [touched, setTouched] = useState<Record<FieldName, boolean>>({
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
  const formCanSubmit = emailOk
    && passwordOk
    && (!isSignUp || confirmPasswordOk);
  const blockingBusy = busyAction === 'email_sign_in'
    || busyAction === 'email_sign_up'
    || busyAction === 'google'
    || busyAction === 'apple';

  useEffect(() => {
    void AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, []);

  useEffect(() => {
    setTouched({ email: false, password: false, confirmPassword: false });
    setErrors({});
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
  }

  function validateAuthForm(nextMode: Mode): AuthFieldErrors {
    const next: AuthFieldErrors = {};
    if (!email.trim()) next.email = t('login.emailRequired');
    else if (!emailOk) next.email = t('login.emailFormatHint');
    if (!password) next.password = t('login.passwordRequired');
    else if (!passwordOk) next.password = t('login.passwordFormatHint');
    if (nextMode === 'signup') {
      if (!confirmPassword) next.confirmPassword = t('login.confirmPasswordRequired');
      else if (!confirmPasswordOk) next.confirmPassword = t('login.confirmPasswordMismatch');
    }
    setTouched({ email: true, password: true, confirmPassword: nextMode === 'signup' });
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
    setTouched({ email: false, password: false, confirmPassword: false });
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
    setTimeout(() => {
      navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
    }, 100);
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
        <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={24} color="#F4F7FC" />
      </Pressable>
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
    const panelCanSubmit = emailOk
      && passwordOk
      && (!panelSignUp || confirmPasswordOk);
    const panelAction: AuthBusyAction = panelSignUp ? 'email_sign_up' : 'email_sign_in';
    const emailError = errorFor('email', panelEmailError);
    const passwordError = errorFor('password', panelPasswordError);
    const confirmError = errorFor('confirmPassword', panelConfirmError);
    return (
      <View pointerEvents={active ? 'auto' : 'none'} style={styles.form}>
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
              {confirmPasswordOk ? (
                <Ionicons name="checkmark" size={24} color="#30d158" style={styles.revealButton} />
              ) : (
                <Pressable
                  onPress={() => {
                    if (!active || busy) return;
                    selectionTick();
                    setShowPassword((current) => !current);
                  }}
                  disabled={!active || busy}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                  testID={active ? 'login-confirm-password-toggle' : undefined}
                  style={styles.revealButton}
                >
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={24} color="#F4F7FC" />
                </Pressable>
              )}
            </View>
            {errorFor('confirmPassword', panelConfirmError) ? (
              <Text style={styles.fieldError}>{errorFor('confirmPassword', panelConfirmError)}</Text>
            ) : null}
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
          accessibilityLabel={panelSignUp ? t('login.ctaSignUp') : t('login.ctaSignIn')}
          style={[
            styles.cta,
            panelSignUp && styles.signupCta,
            (!panelCanSubmit || busy) && styles.ctaDisabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#060b14" />
          ) : (
            <Text style={styles.ctaText}>
              {panelSignUp ? t('login.ctaSignUp') : t('login.ctaSignIn')}
            </Text>
          )}
        </SafePressable>
        {panelSignUp ? (
          <View style={styles.signupLegal}>
            <Text style={styles.signupLegalText}>
              {t('login.signupAgreementPrefix')}{' '}
              <Text onPress={() => termsUrl && void Linking.openURL(termsUrl)} accessibilityRole="link" style={styles.legalText}>{t('login.terms')}</Text>
              {t('login.signupAgreementAnd')}
              <Text onPress={() => privacyUrl && void Linking.openURL(privacyUrl)} accessibilityRole="link" style={styles.legalText}>{t('login.privacy')}</Text>
              {t('login.signupAgreementSuffix')}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  function renderReset(): React.ReactNode {
    return (
      <View style={styles.resetCard}>
        <Text style={styles.resetHint}>{'請輸入你的註冊電子信箱，\n我們將發送密碼重設連結至你的信箱。'}</Text>
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
          accessibilityLabel={resetSent ? t('login.resetResend') : '發送重設連結'}
          style={[
            styles.cta,
            styles.resetAction,
            (!emailOk || busy || resetCooldown > 0) && styles.ctaDisabled,
          ]}
        >
          {busyAction === 'password_reset' ? (
            <ActivityIndicator color="#060b14" />
          ) : (
            <Text style={[styles.ctaText, { color: '#060b14', fontWeight: '800', fontSize: 16 }]} numberOfLines={1}>
              {resetSent ? t('login.resetResend') : '發送重設連結'}
            </Text>
          )}
        </SafePressable>
        {resetCooldown > 0 ? (
          <Text style={styles.cooldownText}>{t('login.resendIn', { seconds: resetCooldown })}</Text>
        ) : null}
      </View>
    );
  }

  function renderPending(): React.ReactNode {
    return (
      <View style={styles.pendingCard}>
              <Ionicons name="mail-outline" size={38} color={accent} />
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
          {busyAction === 'resend_confirmation' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>
              {resendCooldown > 0 ? `${t('login.resendConfirmation')} (${resendCooldown})` : t('login.resendConfirmation')}
            </Text>
          )}
        </SafePressable>
        <Pressable onPress={backToSignIn} accessibilityRole="button" style={styles.backLink}>
          <Text style={styles.backLinkText}>{t('login.backToSignIn')}</Text>
        </Pressable>
      </View>
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

  return (
    <View style={styles.fill}>
      <MetalforgeBackground active={isFocused} />
      {!resetMode ? (
        <View
          style={[styles.langChrome, { top: insets.top + 8 }]}
          importantForAccessibility={blockingBusy ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={blockingBusy}
        >
          <LanguagePicker variant="menu" />
        </View>
      ) : null}
      {!resetMode ? (
        <View
          style={[styles.versionChrome, { bottom: Math.max(insets.bottom, 10) }]}
          pointerEvents="none"
          importantForAccessibility={blockingBusy ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={blockingBusy}
        >
          <Text style={styles.versionText}>V{appVersion}</Text>
        </View>
      ) : null}
      {resetMode ? (
        <View
          style={[styles.resetBackChrome, { top: insets.top + 8 }]}
          importantForAccessibility={blockingBusy ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={blockingBusy}
        >
          <SafePressable
            actionId="login.reset_back"
            screen="Login"
            onPressAction={() => backToSignIn()}
            disableWhileBusy={false}
            native={{
              systemImage: 'chevron.left',
              shape: 'capsule',
              width: 45,
              height: 45,
              imageSize: 19.2,
              iconOffset: { x: 1.16 },
            }}
            accessibilityLabel={t('common.back')}
            testID="login-reset-back"
          />
        </View>
      ) : null}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        importantForAccessibility={blockingBusy ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={blockingBusy}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + (resetMode ? 112 : 24), paddingBottom: insets.bottom + 16 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <View>
            <View style={styles.header}>
              {resetMode ? (
                <View style={styles.resetHeaderRow}>
                  <View style={styles.resetIconSlot}>
                    <CrookIcon size={56} color={accent} />
                  </View>
                  <Text style={styles.title}>{t('login.resetTitle')}</Text>
                  <View style={styles.resetIconSlot} />
                </View>
              ) : (
                <View style={styles.brand}>
                  <CrookIcon size={56} color={accent} />
                  <Text style={styles.title}>Hither</Text>
                </View>
              )}
            </View>

            {content}

            {!pendingEmail && !resetMode && !isSignUp ? (
              <>
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>或使用其他方式</Text>
                  <View style={styles.dividerLine} />
                </View>
                <View style={styles.socialRow}>
                  <View style={[styles.socialIcon, busy && styles.ctaDisabled]}>
                    <NativeGlassButton
                      onPress={() => void runSocial('login.google', () => signInWithGoogle())}
                      disabled={busy}
                      accessibilityLabel={t('login.google')}
                      testID="login-google"
                      size={70}
                      shape="circle"
                      variant="glass"
                      style={StyleSheet.absoluteFill}
                    />
                    <View pointerEvents="none" style={styles.socialIconOverlay}>
                      <GoogleGIcon size={33} />
                    </View>
                  </View>
                  {appleAvailable ? (
                    <NativeGlassButton
                      systemImage="apple.logo"
                      onPress={() => void runSocial('login.apple', () => signInWithApple())}
                      disabled={busy}
                      accessibilityLabel={t('login.apple')}
                      testID="login-apple"
                      size={70}
                      imageSize={33}
                      shape="circle"
                      variant="glass"
                      foregroundColor="#fff"
                      iconOffset={{ y: -2 }}
                      style={[styles.socialIcon, busy && styles.ctaDisabled]}
                    />
                  ) : null}
                </View>
                <NativeGlassButton
                  label={t('login.guest')}
                  systemImage="person"
                  onPress={openGuestConfirm}
                  disabled={busy}
                  accessibilityLabel={t('login.guest')}
                  testID="login-guest"
                  shape="capsule"
                  layout="fit"
                  width={173}
                  height={50}
                  fontSize={15.5}
                  imageSize={16}
                  spacing={4}
                  variant="glass"
                  style={[styles.guestButton, busy && styles.ctaDisabled]}
                />
              </>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <BlockingAuthOverlay visible={blockingBusy} color={accent} />

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
              testID="guest-confirm-button"
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
    </View>
  );
}

const makeStyles = (accent: string) =>
  StyleSheet.create({
    fill: { flex: 1 },
    langChrome: { position: 'absolute', left: 20, zIndex: 10, width: 45, height: 45 },
    versionChrome: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
    versionText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.65)' },
    resetBackChrome: { position: 'absolute', left: 20, zIndex: 10, width: 45, height: 45 },
    content: { flexGrow: 1, paddingHorizontal: 24 },
    header: { alignItems: 'center', marginBottom: 22 },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    resetHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    resetIconSlot: { width: 50, alignItems: 'flex-start', justifyContent: 'center' },
    title: { fontSize: 34, fontWeight: '800', color: '#fff' },
    formViewport: { width: '100%' },
    form: { width: '100%' },
    label: { fontSize: 16, fontWeight: '600', letterSpacing: 0.4, color: 'rgba(235,235,245,0.65)', marginTop: 6, marginBottom: 4, marginLeft: 4 },
    field: { height: 50, borderRadius: 18, justifyContent: 'center', paddingHorizontal: 16, backgroundColor: 'rgba(10,16,28,0.65)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)', flexDirection: 'row', alignItems: 'center' },
    fieldErrorBorder: { borderColor: 'rgba(255,119,119,0.84)' },
    revealButton: { minWidth: 44, height: 50, alignItems: 'center', justifyContent: 'center' },
    fieldError: { marginTop: 6, marginLeft: 4, color: '#ff8f8f', fontSize: 13, lineHeight: 18 },
    formError: { marginTop: 10, marginBottom: 2, color: '#ff8f8f', fontSize: 13, lineHeight: 18, textAlign: 'center' },
    cta: { height: 52, borderRadius: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, backgroundColor: accent, borderWidth: StyleSheet.hairlineWidth, borderColor: accentMix(accent, 55), width: '100%' },
    signupCta: { marginTop: 24 },
    primaryAction: { width: '100%', alignSelf: 'center', marginTop: 18 },
    nativeCta: { minHeight: 52, borderRadius: 26, justifyContent: 'center' },
    resetAction: { width: '100%', alignSelf: 'center', marginTop: 24 },
    ctaDisabled: { opacity: 0.5 },
    pressed: { opacity: 0.85 },
    ctaText: { fontSize: 16, fontWeight: '800', color: '#060b14' },
    forgot: { alignSelf: 'flex-end', marginTop: 12, marginBottom: 14 },
    forgotText: { fontSize: 12.5, fontWeight: '600', color: 'rgba(235,235,245,0.72)' },
    divider: { width: 280, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, marginBottom: 14 },
    dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.18)' },
    dividerText: { fontSize: 16, fontWeight: '600', letterSpacing: 0.4, color: 'rgba(235,235,245,0.65)', textAlign: 'center' },
    socialIcon: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center' },
    socialIconOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    socialRow: { marginTop: 6, marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
    guestButton: { alignSelf: 'center', width: 173, height: 50, borderRadius: 25 },
    legalText: { fontSize: 12, color: 'rgba(235,235,245,0.6)', textDecorationLine: 'underline' },
    legalDot: { color: 'rgba(235,235,245,0.4)' },
    disabledText: { opacity: 0.5 },
    resetCard: { minHeight: 0 },
    sectionTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginTop: 22 },
    resetHint: { fontSize: 17, lineHeight: 25, color: 'rgba(235,235,245,0.72)', marginTop: 24, marginBottom: 20 },
    resetHelp: { fontSize: 13, lineHeight: 19, color: 'rgba(235,235,245,0.65)', marginTop: 8 },
    cooldownText: { fontSize: 12, color: 'rgba(235,235,245,0.55)', textAlign: 'center', marginTop: 6 },
    signupLegal: { marginTop: 10, paddingHorizontal: 8 },
    signupLegalText: { fontSize: 12, lineHeight: 18, textAlign: 'center', color: 'rgba(235,235,245,0.58)' },
    successText: { fontSize: 14, lineHeight: 20, color: '#9de7b5', marginTop: 14 },
    backLink: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: 10 },
    backLinkText: { fontSize: 14, color: 'rgba(235,235,245,0.72)', textDecorationLine: 'underline' },
    pendingCard: { minHeight: 0, alignItems: 'center', paddingTop: 20 },
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
