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
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import AuthField from '../components/AuthField';
import AuthModeSelector, { type AuthMode } from '../components/AuthModeSelector';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation, type TranslationKey } from '../i18n';
import { accentMix } from '../glass';
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

/** Login gate. Keep the form geometry stable across mode and language changes. */
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
  const { colors } = useTheme();
  const { t } = useTranslation();
  const accent = colors.accent;
  const styles = useMemo(() => makeStyles(accent), [accent]);

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState('');
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
  const formCanSubmit = emailOk && passwordOk && nicknameOk && (!isSignUp || confirmPasswordOk);

  useEffect(() => {
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  useEffect(() => {
    setTouched({ nickname: false, email: false, password: false, confirmPassword: false });
    setErrors({});
  }, [mode]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

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
    setTouched({ nickname: nextMode === 'signup', email: true, password: true, confirmPassword: nextMode === 'signup' });
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
    setErrors({});
    setTouched({ nickname: false, email: false, password: false, confirmPassword: false });
  }

  function backToSignIn(): void {
    selectionTick();
    setResetMode(false);
    setPendingEmail(null);
    setResetSent(false);
    setResendCooldown(0);
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
    const panelCanSubmit = emailOk && passwordOk && (!panelSignUp || (nicknameOk && confirmPasswordOk));
    const panelAction: AuthBusyAction = panelSignUp ? 'email_sign_up' : 'email_sign_in';
    return (
      <View pointerEvents={active ? 'auto' : 'none'} style={styles.form}>
        {panelSignUp ? (
          <>
            <Text style={styles.label}>{t('login.nickname')}</Text>
            <View style={styles.field}>
              <AuthField
                value={nickname}
                onChangeText={(value) => changeField('nickname', value)}
                onBlur={() => setTouched((current) => ({ ...current, nickname: true }))}
                placeholder={t('login.nicknamePlaceholder')}
                placeholderTextColor="rgba(235,235,245,0.4)"
                keyboardAppearance="dark"
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={t('login.nickname')}
                testID={active ? 'login-nickname' : undefined}
              />
            </View>
            {errorFor('nickname', panelNicknameError) ? (
              <Text style={styles.fieldError}>{errorFor('nickname', panelNicknameError)}</Text>
            ) : null}
          </>
        ) : null}

        <Text style={styles.label}>{t('login.email')}</Text>
        <View style={styles.field}>
          <AuthField
            value={email}
            onChangeText={(value) => changeField('email', value)}
            onBlur={() => setTouched((current) => ({ ...current, email: true }))}
            placeholder={t('login.emailPlaceholder')}
            placeholderTextColor="rgba(235,235,245,0.4)"
            keyboardAppearance="dark"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            accessibilityLabel={t('login.email')}
            testID={active ? 'login-email' : undefined}
          />
        </View>
        {errorFor('email', panelEmailError) ? (
          <Text style={styles.fieldError}>{errorFor('email', panelEmailError)}</Text>
        ) : null}

        <Text style={styles.label}>{t('login.password')}</Text>
        <View style={styles.field}>
          <AuthField
            value={password}
            onChangeText={(value) => changeField('password', value)}
            onBlur={() => setTouched((current) => ({ ...current, password: true }))}
            placeholder={t('login.passwordPlaceholder')}
            placeholderTextColor="rgba(235,235,245,0.4)"
            keyboardAppearance="dark"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showPassword}
            textContentType={panelSignUp ? 'newPassword' : 'password'}
            accessibilityLabel={t('login.password')}
            testID={active ? 'login-password' : undefined}
          />
          <Pressable
            onPress={() => {
              if (!active || busy) return;
              selectionTick();
              setShowPassword((current) => !current);
            }}
            disabled={!active || busy}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? t('login.hidePassword') : t('login.showPassword')}
            testID={active ? 'login-password-toggle' : undefined}
            style={styles.revealButton}
          >
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color="#fff" />
          </Pressable>
        </View>
        {errorFor('password', panelPasswordError) ? (
          <Text style={styles.fieldError}>{errorFor('password', panelPasswordError)}</Text>
        ) : null}

        {panelSignUp ? (
          <>
            <Text style={styles.label}>{t('login.confirmPassword')}</Text>
            <View style={styles.field}>
              <AuthField
                value={confirmPassword}
                onChangeText={(value) => changeField('confirmPassword', value)}
                onBlur={() => setTouched((current) => ({ ...current, confirmPassword: true }))}
                placeholder={t('login.confirmPasswordPlaceholder')}
                placeholderTextColor="rgba(235,235,245,0.4)"
                keyboardAppearance="dark"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPassword}
                textContentType="newPassword"
                accessibilityLabel={t('login.confirmPassword')}
                testID={active ? 'login-confirm-password' : undefined}
              />
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
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color="#fff" />
              </Pressable>
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
          style={({ pressed }) => [
            styles.cta,
            (!panelCanSubmit || busy) && styles.ctaDisabled,
            pressed && panelCanSubmit && styles.pressed,
          ]}
        >
          {busyAction === panelAction ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>
              {panelSignUp ? t('login.ctaSignUp') : t('login.ctaSignIn')}
            </Text>
          )}
        </SafePressable>
      </View>
    );
  }

  function renderReset(): React.ReactNode {
    return (
      <View style={styles.resetCard}>
        <Text style={styles.sectionTitle}>{t('login.forgotPassword')}</Text>
        <Text style={styles.resetHint}>{t('login.resetHint')}</Text>
        <Text style={styles.label}>{t('login.email')}</Text>
        <View style={styles.field}>
          <AuthField
            value={email}
            onChangeText={(value) => changeField('email', value)}
            onBlur={() => setTouched((current) => ({ ...current, email: true }))}
            placeholder={t('login.emailPlaceholder')}
            placeholderTextColor="rgba(235,235,245,0.4)"
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
        {resetSent ? <Text style={styles.successText}>{t('login.resetSent')}</Text> : null}
        <SafePressable
          actionId="login.password_reset"
          screen="Login"
          onPressAction={submitReset}
          onBusyChange={(next) => setBusyAction(next ? 'password_reset' : null)}
          suppressBanner
          disabled={!emailOk || busy || resetSent}
          testID="login-reset-submit"
          accessibilityRole="button"
          style={[styles.cta, (!emailOk || busy || resetSent) && styles.ctaDisabled]}
        >
          {busyAction === 'password_reset' ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>{t('login.resetSubmit')}</Text>}
        </SafePressable>
        <Pressable onPress={backToSignIn} accessibilityRole="button" style={styles.backLink}>
          <Text style={styles.backLinkText}>{t('login.backToSignIn')}</Text>
        </Pressable>
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
      />
      <View style={styles.formViewport}>{renderAuthPanel(mode, true)}</View>
      {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}
    </>
  );

  return (
    <LinearGradient colors={['#1f3050', '#0e1622', '#080b12']} locations={[0, 0.52, 1]} style={styles.fill}>
      <View style={[styles.langChrome, { top: insets.top + 12 }]}>
        <LanguagePicker />
      </View>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View>
            <View style={styles.header}>
              <Text style={styles.title}>{t('login.welcomeTitle')}</Text>
            </View>

            {content}

            {!pendingEmail && !resetMode ? (
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
                      style={({ pressed }) => [styles.socialIcon, busy && styles.ctaDisabled, pressed && !busy && styles.pressed]}
                    >
                      <Ionicons name="logo-google" size={24} color="#fff" />
                    </Pressable>
                    <Text style={styles.socialCaption}>{t('login.google')}</Text>
                  </View>
                  {appleAvailable ? (
                    <View style={styles.socialColumn}>
                      <Pressable
                        onPress={() => void runSocial('login.apple', () => signInWithApple())}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={t('login.apple')}
                        style={({ pressed }) => [styles.socialIcon, busy && styles.ctaDisabled, pressed && !busy && styles.pressed]}
                      >
                        <Ionicons name="logo-apple" size={24} color="#fff" />
                      </Pressable>
                      <Text style={styles.socialCaption}>{t('login.apple')}</Text>
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
                  <Text style={styles.ctaText}>{t('login.guest')}</Text>
                </Pressable>
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
              </>
            ) : null}
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

const makeStyles = (accent: string) =>
  StyleSheet.create({
    fill: { flex: 1 },
    langChrome: { position: 'absolute', right: 20, zIndex: 10 },
    content: { flexGrow: 1, paddingHorizontal: 24 },
    header: { alignItems: 'center', marginBottom: 4 },
    title: { fontSize: 24, fontWeight: '700', color: '#fff' },
    formViewport: { width: '100%' },
    form: { width: '100%' },
    label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, color: 'rgba(235,235,245,0.45)', marginTop: 6, marginBottom: 4, marginLeft: 4 },
    field: { height: 52, borderRadius: 26, justifyContent: 'center', paddingHorizontal: 2, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)', flexDirection: 'row', alignItems: 'center' },
    revealButton: { minWidth: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
    fieldError: { marginTop: 6, marginLeft: 4, color: '#ff8f8f', fontSize: 13, lineHeight: 18 },
    formError: { marginTop: 10, marginBottom: 2, color: '#ff8f8f', fontSize: 13, lineHeight: 18, textAlign: 'center' },
    cta: { height: 52, borderRadius: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, backgroundColor: accent, borderWidth: StyleSheet.hairlineWidth, borderColor: accentMix(accent, 55), width: '100%' },
    ctaDisabled: { opacity: 0.4 },
    pressed: { opacity: 0.85 },
    ctaText: { fontSize: 17, fontWeight: '600', color: '#fff' },
    forgot: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
    forgotText: { fontSize: 13, color: 'rgba(235,235,245,0.72)', textDecorationLine: 'underline' },
    divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
    dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.18)' },
    dividerText: { fontSize: 12, letterSpacing: 1, color: 'rgba(235,235,245,0.4)' },
    socialIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)' },
    socialCaption: { textAlign: 'center', fontSize: 12, color: 'rgba(235,235,245,0.45)', marginTop: 8, maxWidth: 125 },
    socialRow: { minHeight: 64, marginTop: 10, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 16 },
    socialColumn: { alignItems: 'center' },
    guestButton: { alignSelf: 'center', width: '100%', minHeight: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', marginTop: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)' },
    legalRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 4 },
    legalText: { fontSize: 12, color: 'rgba(235,235,245,0.6)', textDecorationLine: 'underline' },
    legalDot: { color: 'rgba(235,235,245,0.4)' },
    disabledText: { opacity: 0.5 },
    resetCard: { minHeight: 0 },
    sectionTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginTop: 22 },
    resetHint: { fontSize: 14, lineHeight: 20, color: 'rgba(235,235,245,0.65)', marginTop: 10 },
    successText: { fontSize: 14, lineHeight: 20, color: '#9de7b5', marginTop: 14 },
    backLink: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: 10 },
    backLinkText: { fontSize: 14, color: 'rgba(235,235,245,0.72)', textDecorationLine: 'underline' },
    pendingCard: { minHeight: 0, alignItems: 'center', paddingTop: 20 },
    pendingEmail: { fontSize: 16, fontWeight: '600', color: '#fff', marginTop: 12 },
    modalScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    modalCard: { width: '100%', maxWidth: 380, borderRadius: 22, padding: 22, backgroundColor: '#182131', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
    modalTitle: { fontSize: 19, fontWeight: '700', color: '#fff', marginBottom: 14 },
    modalWarningText: { fontSize: 14, lineHeight: 21, color: 'rgba(235,235,245,0.78)' },
    modalCta: { alignSelf: 'center', width: '100%', minHeight: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', marginTop: 20, backgroundColor: accent },
    modalSecondary: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: 8 },
    modalSecondaryText: { fontSize: 14, color: 'rgba(235,235,245,0.65)', textDecorationLine: 'underline' },
  });
