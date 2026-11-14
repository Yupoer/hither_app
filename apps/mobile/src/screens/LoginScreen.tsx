import { APP_TEXT_SIZE, APP_TEXT_LINE_HEIGHT } from '../theme/typeScale';
import React, { useCallback, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { AppText as Text } from '../components/AppText';
import Pressable from '../components/MotionPressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useMountEffect } from '../hooks/useMountEffect';
import { useForegroundClock } from '../state/foregroundUi';
import { useSession } from '../state/SessionContext';
import { useTranslation, type TranslationKey } from '../i18n';
import { runUiAction } from '../utils/uiAction';
import { errorTap, mediumTap, successTap } from '../utils/haptics';
import { getLegalUrl } from '../config/legal';
import AuthField from '../components/AuthField';
import BlockingAuthOverlay from '../components/BlockingAuthOverlay';
import { AppleContinueButton, AuthProviderButton } from '../components/AuthProviderButtons';
import SheetHeaderAction from '../components/SheetHeaderAction';
import { MAP_SHEET_ACTION_HIT_SIZE, SHEET_CORNER_ACTION_INSET } from '../components/mapSheetChrome';
import { ENTRY_ACCENT, ENTRY_BACKGROUND, EntryBackdrop, EntryPrimaryButton } from './entry/EntryVisuals';
import type { AuthBusyAction, AuthFieldErrors } from '../auth/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;
type AuthError = { field: keyof AuthFieldErrors; key: TranslationKey };
type Step = { kind: 'options' | 'email' | 'signin' | 'signup' | 'reset' }
  | { kind: 'verification'; email: string };

const SOCIAL_AUTH_TIMEOUT_MS = 120_000;
const COOLDOWN_MS = 60_000;
const actionIds = {
  email_sign_in: 'login.sign_in',
  email_sign_up: 'login.sign_up',
  apple: 'login.apple',
  google: 'login.google',
  password_reset: 'login.password_reset',
  resend_confirmation: 'login.resend_confirmation',
} satisfies Partial<Record<Exclude<AuthBusyAction, null>, string>>;
type LoginAction = keyof typeof actionIds;
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

export default function LoginScreen({ navigation }: Props) {
  const { user, isAnonymous, signInWithEmail, signUpWithEmail, signInWithGoogle, signInWithApple,
    linkWithGoogle, linkWithApple, upgradeToEmailAccount, requestPasswordReset, resendSignupConfirmation } = useSession();
  const [mountIdentity] = useState(() => ({ id: user?.id, anonymous: isAnonymous }));
  const guest = Boolean(user && isAnonymous);
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { t } = useTranslation();

  const [step, setStep] = useState<Step>({ kind: 'options' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<AuthBusyAction>(null);
  const [error, setError] = useState<AuthError | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resendUntil, setResendUntil] = useState(0);
  const [resetUntil, setResetUntil] = useState(0);
  const cooldownUntil = step.kind === 'reset' ? resetUntil : resendUntil;
  const { now, lifecycle } = useForegroundClock(1000, cooldownUntil !== 0);
  const cooldown = Math.min(60, Math.max(0, Math.ceil((cooldownUntil - now) / 1000)));
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordOk = step.kind === 'signup'
    ? password.replace(/\s/g, '').length >= 8
    : password.length > 0;
  const blocking = busy === 'apple' || busy === 'google' || busy === 'email_sign_in' || busy === 'email_sign_up';
  const identityConfirmed = (busy === 'apple' || step.kind === 'verification') && Boolean(user && !isAnonymous
    && (mountIdentity.id !== user.id || mountIdentity.anonymous));
  const close = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace('RoleSelect');
  }, [navigation]);
  const finished = useRef(false);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    successTap();
    close();
  }, [close]);

  useMountEffect(() => {
    let mounted = true;
    if (Platform.OS === 'ios') {
      void AppleAuthentication.isAvailableAsync().then(available => {
        if (mounted) setAppleAvailable(available);
      }).catch(() => undefined);
    }
    return () => { mounted = false; };
  });

  function go(next: Exclude<Step['kind'], 'verification'>) {
    setError(null);
    setPassword('');
    setShowPassword(false);
    setStep({ kind: next });
  }

  function run(action: LoginAction, perform: (isCurrent: () => boolean) => Promise<void>) {
    if (busy) return;
    setError(null);
    Keyboard.dismiss();
    mediumTap();
    void runUiAction(actionIds[action], async (token) => {
      try {
        await perform(token.isCurrent);
      } catch (cause) {
        if (token.isCurrent()) {
          setError(mapAuthError(cause));
          errorTap();
        }
        throw cause;
      }
    }, {
      screen: 'Login',
      timeoutMs: action === 'apple' || action === 'google' ? SOCIAL_AUTH_TIMEOUT_MS : undefined,
      onBusyChange: next => setBusy(next ? action : null),
      suppressBanner: true,
      onError: kind => {
        if (kind === 'timeout') setError({ field: 'form', key: 'interaction.timeout' });
      },
    });
  }

  function runSocial(provider: 'apple' | 'google') {
    run(provider, async isCurrent => {
      const authenticate = provider === 'apple'
        ? guest ? linkWithApple : signInWithApple
        : guest ? linkWithGoogle : signInWithGoogle;
      if (await authenticate() && isCurrent()) finish();
    });
  }

  function submitEmail() {
    if (!emailOk || !passwordOk) return;
    const address = email.trim();
    const signup = step.kind === 'signup';
    run(signup ? 'email_sign_up' : 'email_sign_in', async isCurrent => {
      if (signup && guest) {
        await upgradeToEmailAccount(address, password);
        if (isCurrent()) {
          setResendUntil(Date.now() + COOLDOWN_MS);
          setStep({ kind: 'verification', email: address });
        }
        return;
      }
      if (signup) {
        const result = await signUpWithEmail({ email: address, password });
        if (!isCurrent()) return;
        if (result.status === 'verification_required') {
          setResendUntil(0);
          setStep({ kind: 'verification', email: result.email });
          return;
        }
      } else {
        await signInWithEmail({ email: address, password });
      }
      if (isCurrent()) finish();
    });
  }

  function submitReset() {
    if (!emailOk || cooldown > 0) return;
    run('password_reset', async isCurrent => {
      await requestPasswordReset(email.trim());
      if (!isCurrent()) return;
      successTap();
      setResetSent(true);
      setResetUntil(Date.now() + COOLDOWN_MS);
    });
  }

  function resendConfirmation(address: string) {
    if (cooldown > 0) return;
    run('resend_confirmation', async isCurrent => {
      await resendSignupConfirmation(address);
      if (!isCurrent()) return;
      successTap();
      setResendUntil(Date.now() + COOLDOWN_MS);
    });
  }

  function back() {
    if (step.kind === 'reset') go('signin');
    else if (step.kind === 'signin' || step.kind === 'signup') go('email');
    else go('options');
  }

  const titles = {
    options: 'entry.saveTeams',
    email: 'entry.emailTitle',
    signin: 'entry.passwordTitle',
    signup: 'entry.createPassword',
    reset: 'login.resetTitle',
    verification: 'login.verificationTitle',
  } satisfies Record<Step['kind'], TranslationKey>;

  return (
    <View style={styles.fill}>
      <EntryBackdrop active={focused} allowInactive={busy === 'apple' || busy === 'google'} />
      {lifecycle}
      {identityConfirmed ? <FinishOnIdentity onFinish={finish} /> : null}
      <KeyboardAvoidingView
        style={styles.transparent}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        accessibilityElementsHidden={blocking}
        importantForAccessibility={blocking ? 'no-hide-descendants' : 'auto'}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + SHEET_CORNER_ACTION_INSET, paddingBottom: Math.max(18, insets.bottom) }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            {step.kind === 'options' ? <Text style={styles.brand}>Hither</Text> : (
              <SheetHeaderAction
                accessibilityLabel={t('common.back')} action="back"
                onPress={back} disabled={Boolean(busy)} testID={step.kind === 'reset' ? 'login-reset-back' : 'login-step-back'}
              />
            )}
            <SheetHeaderAction
              accessibilityLabel={t('common.close')} action="close"
              onPress={close} disabled={Boolean(busy)} testID="login-close"
            />
          </View>
          <Text accessibilityRole="header" style={styles.title}>{t(titles[step.kind])}</Text>

          {step.kind === 'options' ? (
            <>
              <Text style={styles.sub}>{t('entry.saveTeamsDescription')}</Text>
              <View style={styles.providers}>
                {appleAvailable ? (
                  <AppleContinueButton disabled={Boolean(busy)} testID="login-apple" onPress={() => runSocial('apple')} />
                ) : null}
                <AuthProviderButton provider="google" disabled={Boolean(busy)} testID="login-google"
                  label={t('entry.continueGoogle')} onPress={() => runSocial('google')} />
                <AuthProviderButton provider="email" disabled={Boolean(busy)} testID="login-use-email"
                  label={t('entry.continueEmail')} onPress={() => go('email')} />
              </View>
            </>
          ) : null}

          {step.kind === 'reset' ? <Text style={styles.sub}>{t('login.resetHint')}</Text> : null}
          {step.kind === 'email' || step.kind === 'reset' ? (
            <>
              <View style={styles.field}>
                <AuthField
                  value={email}
                  onChangeText={next => { setEmail(next); setError(null); }}
                  placeholder="name@example.com"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  keyboardAppearance="dark"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                  accessibilityLabel={t('login.email')}
                  testID={step.kind === 'email' ? 'login-email' : 'login-reset-email'}
                />
              </View>
              {step.kind === 'email' ? (
                <EntryPrimaryButton
                  label={t('entry.continue')} accent={ENTRY_ACCENT} disabled={!emailOk || Boolean(busy)}
                  testID="login-email-next" onPress={() => { Keyboard.dismiss(); go(guest ? 'signup' : 'signin'); }} style={styles.next}
                />
              ) : (
                <>
                  {resetSent ? <Text accessibilityRole="alert" style={styles.sub}>{t('login.resetSent')}</Text> : null}
                  <EntryPrimaryButton
                    label={cooldown ? t('login.resendIn', { seconds: cooldown }) : t(resetSent ? 'login.resetResend' : 'login.resetSubmit')}
                    accent={ENTRY_ACCENT} disabled={!emailOk || cooldown > 0 || Boolean(busy)}
                    testID="login-reset-submit" onPress={submitReset} style={styles.next}
                  />
                  {resetSent ? <Text style={styles.sub}>{t('login.resetHelp')}</Text> : null}
                </>
              )}
            </>
          ) : null}

          {step.kind === 'signin' || step.kind === 'signup' ? (
            <>
              <Text style={styles.sub}>{email.trim()}</Text>
              <View style={styles.field}>
                <AuthField
                  value={password}
                  onChangeText={next => { setPassword(next); setError(null); }}
                  placeholder={t(step.kind === 'signup' ? 'entry.passwordMinimum' : 'login.password')}
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  keyboardAppearance="dark"
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!showPassword}
                  textContentType={step.kind === 'signup' ? 'newPassword' : 'password'}
                  accessibilityLabel={t('login.password')}
                  testID="login-password"
                />
                <Pressable accessibilityRole="button" disabled={Boolean(busy)}
                  accessibilityLabel={t(showPassword ? 'login.hidePassword' : 'login.showPassword')}
                  testID="login-password-toggle" onPress={() => setShowPassword(value => !value)} style={styles.reveal}
                >
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} color="#fff" size={22} />
                </Pressable>
              </View>
              <EntryPrimaryButton
                label={t(step.kind === 'signup' ? 'entry.createAccount' : 'login.ctaSignIn')} accent={ENTRY_ACCENT}
                disabled={!passwordOk || Boolean(busy)} testID="login-submit" onPress={submitEmail} style={styles.next}
              />
              {step.kind === 'signin' ? (
                <>
                  <AuthLink label={t('login.forgotPassword')} onPress={() => go('reset')} disabled={Boolean(busy)} testID="login-forgot-password" />
                  <AuthLink label={t('entry.createAccount')} onPress={() => go('signup')} disabled={Boolean(busy)} testID="login-create-account" />
                </>
              ) : !guest ? (
                <AuthLink label={t('login.backToSignIn')} onPress={() => go('signin')} disabled={Boolean(busy)} testID="login-back-to-signin" />
              ) : null}
            </>
          ) : null}

          {step.kind === 'verification' ? (
            <>
              <Text style={styles.sub}>{step.email}</Text>
              <Text style={styles.sub}>{t('login.verificationPending')}</Text>
              {!guest ? <EntryPrimaryButton
                label={cooldown ? t('login.resendIn', { seconds: cooldown }) : t('login.resendConfirmation')}
                accent={ENTRY_ACCENT} disabled={cooldown > 0 || Boolean(busy)} testID="login-resend-confirmation"
                onPress={() => resendConfirmation(step.email)} style={styles.next}
              /> : null}
            </>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error.key)}</Text> : null}

          {step.kind === 'options' ? (
            <View style={styles.legalWrap}>
              <Text style={styles.legal}>
                {t('entry.legalPrefix')} <LegalLink document="terms" label={t('login.terms')} /> {t('login.signupAgreementAnd')} <LegalLink document="privacy" label={t('login.privacy')} />
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <BlockingAuthOverlay visible={blocking} color={ENTRY_ACCENT} />
    </View>
  );
}

function FinishOnIdentity({ onFinish }: { onFinish: () => void }) {
  useMountEffect(onFinish);
  return null;
}

function AuthLink({ label, testID, onPress, disabled }: {
  label: string;
  testID: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} testID={testID} style={styles.link}>
      <Text style={styles.linkLabel}>{label}</Text>
    </Pressable>
  );
}

function LegalLink({ document, label }: { document: 'privacy' | 'terms'; label: string }) {
  const url = getLegalUrl(document);
  return (
    <Text
      style={styles.legalLink}
      accessibilityRole={url ? 'link' : undefined}
      testID={`login-${document}`}
      onPress={() => { if (url) void Linking.openURL(url).catch(() => undefined); }}
    >{label}</Text>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: ENTRY_BACKGROUND },
  transparent: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: SHEET_CORNER_ACTION_INSET },
  header: { minHeight: MAP_SHEET_ACTION_HIT_SIZE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: '#DCE5FF', fontSize: APP_TEXT_SIZE.title, fontWeight: '800', letterSpacing: 0.2 },
  title: { color: '#fff', fontSize: APP_TEXT_SIZE.heading, fontFamily: 'BricolageGrotesque', fontWeight: '800', letterSpacing: -0.51, marginTop: 26 },
  sub: { color: '#D9DDF0', fontSize: APP_TEXT_SIZE.body, lineHeight: 25, marginTop: 12 },
  providers: { gap: 10, marginTop: 27 },
  legalWrap: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: 36 },
  legal: { color: 'rgba(255,255,255,0.55)', fontSize: APP_TEXT_SIZE.caption, lineHeight: APP_TEXT_LINE_HEIGHT.caption, textAlign: 'center' },
  legalLink: { color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  field: {
    minHeight: 54, marginTop: 18, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center',
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  next: { marginTop: 12 },
  reveal: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  link: { marginTop: 5, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { color: '#fff', fontSize: APP_TEXT_SIZE.caption, fontWeight: '500' },
  error: { color: '#FF9F95', fontSize: APP_TEXT_SIZE.caption, marginTop: 14 },
});
