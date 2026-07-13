import React, { useState, useCallback } from 'react';
import { ScrollView, Text, View, Switch, ActivityIndicator, TextInput, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import OverlaySheet from '../../../components/OverlaySheet';
import { Segmented } from './Segmented';
import NotificationPreferencesCard from '../../../components/NotificationPreferencesCard';
import { useSession } from '../../../state/SessionContext';
import { usePreferences, useTheme, type Language } from '../../../state/PreferencesContext';
import { useTranslation } from '../../../i18n';
import { THEME_ORDER, type ThemeName, themes } from '../../../theme';
import { glass } from '../../../glass';

interface SettingsOverlayProps {
  visible: boolean;
  onClose: () => void;
  isLeader: boolean;
  onOpenHistory: () => void;
  onArchiveAllForTest: () => void;
  onOpenFeedback: () => void;
  onConfirmResetPrefs: () => void;
  onConfirmLeave: () => void;
  onConfirmSignOut: () => void;
  onOpenPaywall: () => void;
  onOpenAccount: () => void;
  styles: any;
}

export const SettingsOverlay = React.memo(function SettingsOverlay({
  visible,
  onClose,
  isLeader,
  onOpenHistory,
  onArchiveAllForTest,
  onOpenFeedback,
  onConfirmResetPrefs,
  onConfirmLeave,
  onConfirmSignOut,
  onOpenPaywall,
  onOpenAccount,
  styles,
}: SettingsOverlayProps) {
  const { t } = useTranslation();
  const { user, isAnonymous, isPro, upgradeToEmailAccount } = useSession();
  const {
    language,
    themeName,
    highAccuracy,
    setLanguage,
    setThemeName,
    setHighAccuracy,
  } = usePreferences();
  const { colors } = useTheme();
  const accent = colors.accent;

  // --- Account upgrade state ------------------------------------------------
  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [upgradeEmail, setUpgradeEmail] = useState('');
  const [upgradePassword, setUpgradePassword] = useState('');
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [upgradeBusy, setUpgradeBusy] = useState(false);

  const upgradeCanSubmit =
    /\S+@\S+\.\S+/.test(upgradeEmail.trim()) && upgradePassword.length >= 6 && !upgradeBusy;

  const closeUpgrade = useCallback(() => {
    setUpgradeVisible(false);
    setUpgradeEmail('');
    setUpgradePassword('');
    setUpgradeError(null);
  }, []);

  const submitUpgrade = useCallback(async () => {
    if (!upgradeCanSubmit) return;
    setUpgradeBusy(true);
    setUpgradeError(null);
    try {
      await upgradeToEmailAccount(upgradeEmail.trim(), upgradePassword);
      Alert.alert(t('account.section'), t('account.upgradeSent'));
      closeUpgrade();
    } catch (e) {
      setUpgradeError(e instanceof Error ? e.message : t('account.upgradeSent'));
      setUpgradeBusy(false);
    }
  }, [upgradeCanSubmit, upgradeEmail, upgradePassword, upgradeToEmailAccount, t, closeUpgrade]);

  return (
    <>
      <OverlaySheet
        visible={visible}
        onClose={onClose}
        title={t('map.overlaySettings')}
        accent={accent}
        doneLabel={t('map.done')}
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          <TouchableOpacity
            style={[styles.accountBtn, { marginBottom: 24 }]}
            onPress={onOpenAccount}
            accessibilityRole="button"
            activeOpacity={0.7}
          >
            <Text style={[styles.accountBtnText, { color: accent }]}>{t('settings.account') || '帳號設定'}</Text>
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>{t('settings.language')}</Text>
          <Segmented
            accent={accent}
            options={[
              { key: 'zh', label: '中文' },
              { key: 'en', label: 'English' },
            ]}
            value={language}
            onChange={(v) => setLanguage(v as Language)}
          />

          <Text style={styles.sectionLabel}>{t('settings.theme')}</Text>
          <Segmented
            accent={accent}
            options={THEME_ORDER.map((n) => ({
              key: n,
              label: t(
                n === 'night'
                  ? 'settings.themeNight'
                  : n === 'day'
                    ? 'settings.themeDay'
                    : n === 'dusk'
                      ? 'settings.themeDusk'
                      : 'settings.themeForest',
              ),
            }))}
            value={themeName}
            onChange={(v) => setThemeName(v as ThemeName)}
          />

          <Text style={styles.sectionLabel}>{t('settings.locationSection')}</Text>
          <View style={styles.settingSwitchRow}>
            <View style={styles.settingSwitchText}>
              <Text style={styles.settingSwitchLabel}>{t('settings.highAccuracy')}</Text>
              <Text style={styles.settingSwitchHint}>{t('settings.highAccuracyHint')}</Text>
            </View>
            <Switch
              value={highAccuracy}
              onValueChange={setHighAccuracy}
              trackColor={{ true: accent, false: 'rgba(120,120,128,0.32)' }}
              thumbColor="#fff"
            />
          </View>

          <Text style={styles.sectionLabel}>{t('settings.notifSection')}</Text>
          <NotificationPreferencesCard colors={{ ...themes.night, accent }} />


          <Text style={styles.sectionLabel}>{t('history.title')}</Text>
          <TouchableOpacity
            style={styles.accountBtn}
            onPress={onOpenHistory}
            accessibilityRole="button"
            activeOpacity={0.7}
          >
            <Text style={[styles.accountBtnText, { color: accent }]}>{t('history.open')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.accountBtn}
            onPress={onArchiveAllForTest}
            accessibilityRole="button"
            activeOpacity={0.7}
          >
            <Text style={[styles.accountBtnText, { color: glass.warn }]}>
              🧪 全部集合點標記為已完成（測試）
            </Text>
          </TouchableOpacity>

          <View style={styles.settingsSectionHeaderRow}>
            <Text style={styles.sectionLabel}>{t('account.section')}</Text>
            <TouchableOpacity
              style={styles.feedbackEntry}
              onPress={onOpenFeedback}
              accessibilityRole="button"
              accessibilityLabel={t('feedback.title')}
              hitSlop={8}
              activeOpacity={0.7}
            >
              <Ionicons name="warning-outline" size={17} color={glass.textSecondary} />
            </TouchableOpacity>
          </View>
          {isAnonymous ? (
            <>
              <Text style={styles.overlayHint}>{t('anon.expiryWarning')}</Text>
              <TouchableOpacity
                style={styles.accountBtn}
                onPress={() => setUpgradeVisible(true)}
                accessibilityRole="button"
                activeOpacity={0.7}
              >
                <Text style={[styles.accountBtnText, { color: accent }]}>
                  {t('account.upgradeButton')}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.overlayHint}>
              {t('account.signedInAs', { email: user?.email ?? '' })}
            </Text>
          )}

          <Text style={styles.sectionLabel}>{t('paywall.title')}</Text>
          {isPro ? (
            <Text style={styles.overlayHint}>{t('paywall.active')}</Text>
          ) : (
            <TouchableOpacity
              style={styles.accountBtn}
              onPress={onOpenPaywall}
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Text style={[styles.accountBtnText, { color: accent }]}>
                {t('paywall.upgrade')}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.dangerBtn} onPress={onConfirmResetPrefs} accessibilityRole="button" activeOpacity={0.7}>
            <Text style={styles.dangerText}>{t('settings.resetPrefs')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dangerBtn} onPress={onConfirmLeave} accessibilityRole="button" activeOpacity={0.7}>
            <Text style={styles.dangerText}>
              {isLeader ? t('map.endGroup') : t('group.leave')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dangerBtn} onPress={onConfirmSignOut} accessibilityRole="button" activeOpacity={0.7}>
            <Text style={styles.dangerText}>{t('settings.signOut')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </OverlaySheet>

      <OverlaySheet
        visible={upgradeVisible}
        onClose={closeUpgrade}
        title={t('account.upgradeButton')}
        accent={accent}
        doneLabel={t('map.done')}
      >
        <ScrollView contentContainerStyle={styles.overlayBody}>
          <Text style={styles.sectionLabel}>{t('account.email')}</Text>
          <View style={styles.profileRow}>
            <TextInput
              style={styles.profileInput}
              value={upgradeEmail}
              onChangeText={setUpgradeEmail}
              placeholder="you@example.com"
              placeholderTextColor={glass.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
          </View>
          <Text style={styles.sectionLabel}>{t('account.password')}</Text>
          <View style={styles.profileRow}>
            <TextInput
              style={styles.profileInput}
              value={upgradePassword}
              onChangeText={setUpgradePassword}
              placeholder={t('account.password')}
              placeholderTextColor={glass.textTertiary}
              autoCapitalize="none"
              secureTextEntry
            />
          </View>
          {upgradeError && <Text style={styles.upgradeError}>{upgradeError}</Text>}
          <TouchableOpacity
            style={[styles.accountBtn, !upgradeCanSubmit && { opacity: 0.4 }]}
            onPress={submitUpgrade}
            disabled={!upgradeCanSubmit}
            accessibilityRole="button"
            activeOpacity={0.7}
          >
            {upgradeBusy ? (
              <ActivityIndicator color={accent} />
            ) : (
              <Text style={[styles.accountBtnText, { color: accent }]}>
                {t('account.submit')}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </OverlaySheet>
    </>
  );
});
