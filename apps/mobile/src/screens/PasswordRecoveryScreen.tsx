import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import AuthField from '../components/AuthField';
import SafePressable from '../components/SafePressable';
import CrookIcon from '../components/CrookIcon';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { errorTap, mediumTap, selectionTick, successTap } from '../utils/haptics';

export default function PasswordRecoveryScreen() {
  const {
    isPasswordRecovery,
    passwordRecoverySuccess,
    completePasswordRecovery,
    clearPasswordRecovery,
  } = useSession();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!passwordRecoverySuccess) return;
    const timer = setTimeout(clearPasswordRecovery, 1200);
    return () => clearTimeout(timer);
  }, [clearPasswordRecovery, passwordRecoverySuccess]);

  if (passwordRecoverySuccess) {
    return (
      <View style={styles.screen}>
        <CrookIcon size={64} color={colors.accent} glow />
        <Text style={styles.title}>{t('login.recoveryComplete')}</Text>
      </View>
    );
  }
  if (!isPasswordRecovery) return null;

  const passwordOk = password.replace(/\s/g, '').length >= 6;
  const canSubmit = passwordOk && password === confirmPassword && !busy;

  async function submit(token: { isCurrent: () => boolean }) {
    if (!canSubmit) {
      setError(passwordOk ? t('login.confirmPasswordMismatch') : t('login.passwordFormatHint'));
      errorTap();
      return;
    }
    mediumTap();
    try {
      await completePasswordRecovery(password);
      if (token.isCurrent()) successTap();
    } catch (error) {
      if (token.isCurrent()) {
        setError(t('login.authUnavailable'));
        errorTap();
      }
      throw error;
    }
  }

  return (
    <View style={styles.screen}>
      <CrookIcon size={64} color={colors.accent} glow />
      <Text style={styles.title}>{t('login.forgotPassword')}</Text>
      <Text style={styles.hint}>{t('login.recoveryHint')}</Text>
      <View style={styles.field}>
        <AuthField
          value={password}
          onChangeText={(value) => { setPassword(value); setError(''); }}
          placeholder={t('login.newPasswordPlaceholder')}
          placeholderTextColor="rgba(235,235,245,0.4)"
          secureTextEntry={!showPassword}
          textContentType="newPassword"
          accessibilityLabel={t('login.newPassword')}
          testID="recovery-password"
        />
        <Pressable
          onPress={() => { selectionTick(); setShowPassword((value) => !value); }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={showPassword ? t('login.hidePassword') : t('login.showPassword')}
          testID="recovery-password-toggle"
          style={styles.revealButton}
        >
          <Text style={styles.revealText}>{showPassword ? '○' : '●'}</Text>
        </Pressable>
      </View>
      <View style={styles.field}>
        <AuthField
          value={confirmPassword}
          onChangeText={(value) => { setConfirmPassword(value); setError(''); }}
          placeholder={t('login.confirmPasswordPlaceholder')}
          placeholderTextColor="rgba(235,235,245,0.4)"
          secureTextEntry={!showPassword}
          textContentType="newPassword"
          accessibilityLabel={t('login.confirmPassword')}
          testID="recovery-confirm-password"
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <SafePressable
        actionId="login.complete_recovery"
        screen="PasswordRecovery"
        onPressAction={submit}
        onBusyChange={setBusy}
        suppressBanner
        disabled={!canSubmit}
        accessibilityRole="button"
        testID="recovery-submit"
        style={[styles.cta, !canSubmit && styles.disabled]}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>{t('login.completeRecovery')}</Text>}
      </SafePressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080b12', padding: 24, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center', marginTop: 18 },
  hint: { color: 'rgba(235,235,245,0.68)', fontSize: 14, lineHeight: 20, marginTop: 10, marginBottom: 16, textAlign: 'center' },
  field: { minHeight: 52, height: 52, borderRadius: 26, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)', marginTop: 12 },
  revealButton: { minWidth: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
  revealText: { color: '#fff', fontSize: 15 },
  error: { color: '#ff8f8f', fontSize: 13, marginTop: 8 },
  cta: { height: 52, borderRadius: 26, backgroundColor: '#ff9f0a', alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  disabled: { opacity: 0.4 },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
