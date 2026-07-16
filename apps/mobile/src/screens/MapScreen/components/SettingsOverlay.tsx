import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import OverlaySheet from '../../../components/OverlaySheet';
import { Segmented } from './Segmented';
import NotificationPreferencesCard from '../../../components/NotificationPreferencesCard';
import { useSession } from '../../../state/SessionContext';
import {
  usePreferences,
  useTheme,
  type Language,
  type TextScalePref,
} from '../../../state/PreferencesContext';
import { useTranslation } from '../../../i18n';
import { THEME_ORDER, type ThemeName, themes } from '../../../theme';
import { glass } from '../../../glass';

const OTA_UPDATES_USABLE = !__DEV__ && Updates.isEnabled;
const diagnosticsEnabled =
  __DEV__ || process.env.EXPO_PUBLIC_DIAGNOSTICS_ENABLED === 'true';

interface SettingsOverlayProps {
  visible: boolean;
  onClose: () => void;
  isLeader: boolean;
  onArchiveAllForTest: () => void;
  onOpenFeedback: () => void;
  onConfirmResetPrefs: () => void;
  /** End / leave group — list row only; red style only on confirm dialog. */
  onConfirmLeave: () => void;
  /** Sign out — list row only; red style only on confirm dialog. */
  onConfirmSignOut: () => void;
  onOpenPaywall: () => void;
  onOpenAccount: () => void;
  onOpenCustomQuickCommand: () => void;
  onSharingEnabledChange: (enabled: boolean) => void;
  onOpenDiagnostics: () => void;
  /** Group-scoped straggler lives under tools; settings only deep-links there. */
  onOpenStraggler?: () => void;
  /** Switch active group (MyTeams) — not on the map sheet header. */
  onSwitchGroup?: () => void;
  /**
   * Return to RoleSelect (create / join) without leaving the current group.
   * Membership stays so MyTeams and the back stack can re-enter the map.
   */
  onGoHome?: () => void;
  styles: any;
}

function SectionLabel({
  label,
  styles,
}: {
  label: string;
  styles: any;
}) {
  return <Text style={styles.sectionLabel}>{label}</Text>;
}

function NavRow({
  title,
  description,
  onPress,
  styles,
  accessibilityLabel,
}: {
  title: string;
  description?: string;
  onPress: () => void;
  styles: any;
  accessibilityLabel?: string;
}) {
  return (
    <TouchableOpacity
      style={styles.settingsTopRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      activeOpacity={0.7}
    >
      <View style={styles.settingsTopCopy}>
        <Text style={styles.settingsTopTitle}>{title}</Text>
        {description ? (
          <Text style={styles.settingsTopDescription}>{description}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={glass.textTertiary} />
    </TouchableOpacity>
  );
}

export const SettingsOverlay = React.memo(function SettingsOverlay({
  visible,
  onClose,
  isLeader,
  onArchiveAllForTest,
  onOpenFeedback,
  onConfirmResetPrefs,
  onConfirmLeave,
  onConfirmSignOut,
  onOpenPaywall,
  onOpenAccount,
  onOpenCustomQuickCommand,
  onSharingEnabledChange,
  onOpenDiagnostics,
  onOpenStraggler,
  onSwitchGroup,
  onGoHome,
  styles,
}: SettingsOverlayProps) {
  const { t } = useTranslation();
  const { isPro, customQuickCommands } = useSession();
  const configuredCustomCount = customQuickCommands.filter(Boolean).length;
  const customSummary = configuredCustomCount
    ? t('settings.customQuickCommandConfiguredCount', {
        count: String(configuredCustomCount),
        total: String(customQuickCommands.length),
      })
    : t('settings.customQuickCommandEmpty');
  const {
    language,
    themeName,
    textScale,
    sharingEnabled,
    obliqueLocate,
    liveActivityEnabled,
    gatherCardDefaultExpanded,
    setLanguage,
    setThemeName,
    setTextScale,
    setObliqueLocate,
    setLiveActivityEnabled,
    setGatherCardDefaultExpanded,
  } = usePreferences();
  const { colors } = useTheme();
  const accent = colors.accent;

  const appVersion =
    Constants.expoConfig?.version ??
    Constants.nativeAppVersion ??
    '—';

  const { isUpdateAvailable, isUpdatePending } = Updates.useUpdates();
  const [otaAvailable, setOtaAvailable] = useState(false);
  const [applyingOta, setApplyingOta] = useState(false);

  // Manual check when settings opens; useUpdates also reflects background downloads.
  useEffect(() => {
    if (!visible || !OTA_UPDATES_USABLE) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!cancelled) setOtaAvailable(result.isAvailable);
      } catch {
        // Network / rate-limit: keep prior state from useUpdates.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const showOtaApply =
    OTA_UPDATES_USABLE &&
    (otaAvailable || isUpdateAvailable || isUpdatePending);

  const applyOtaUpdate = useCallback(async () => {
    if (!OTA_UPDATES_USABLE || applyingOta) return;
    setApplyingOta(true);
    try {
      if (!isUpdatePending) {
        await Updates.fetchUpdateAsync();
      }
      await Updates.reloadAsync();
    } catch {
      setApplyingOta(false);
      Alert.alert(t('settings.otaApplyFailed'));
    }
  }, [applyingOta, isUpdatePending, t]);

  const otaSummary = useMemo(() => {
    // Expo Go / dev client: Updates may be disabled — still show a clear label.
    if (__DEV__ || !Updates.isEnabled) {
      return t('settings.otaDev');
    }
    if (Updates.isEmbeddedLaunch || !Updates.updateId) {
      return t('settings.otaEmbedded');
    }
    const shortId = Updates.updateId.replace(/-/g, '').slice(0, 8);
    return t('settings.otaUpdate', { id: shortId });
  }, [t]);

  return (
    <OverlaySheet
      visible={visible}
      onClose={onClose}
      title={t('map.overlaySettings')}
      accent={accent}
      doneLabel={t('map.done')}
    >
      <ScrollView contentContainerStyle={styles.overlayBody}>
        {/* ── 個人設定 ─────────────────────────────────────────── */}
        <SectionLabel label={t('settings.sectionPersonal')} styles={styles} />
        <View style={styles.settingsTopGroup}>
          <NavRow
            title={t('settings.account')}
            description={t('settings.accountDescription')}
            onPress={onOpenAccount}
            styles={styles}
          />
          <NavRow
            title={t('paywall.title')}
            description={isPro ? t('paywall.active') : t('paywall.upgrade')}
            onPress={onOpenPaywall}
            styles={styles}
          />
          {onSwitchGroup ? (
            <NavRow
              title={t('map.switchGroup')}
              description={t('settings.switchGroupHint')}
              onPress={onSwitchGroup}
              styles={styles}
            />
          ) : null}
          {onGoHome ? (
            <NavRow
              title={t('settings.createOrJoin')}
              description={t('settings.createOrJoinHint')}
              onPress={onGoHome}
              styles={styles}
            />
          ) : null}
          <NavRow
            title={t('settings.signOut')}
            onPress={onConfirmSignOut}
            styles={styles}
          />
        </View>

        <SectionLabel label={t('settings.sectionLanguageAppearance')} styles={styles} />
        <Text style={[styles.settingsInlineLabel, { marginTop: 4 }]}>{t('settings.language')}</Text>
        <Segmented
          accent={accent}
          options={[
            { key: 'zh', label: '中文' },
            { key: 'en', label: 'English' },
          ]}
          value={language}
          onChange={(v) => setLanguage(v as Language)}
        />
        <Text style={styles.settingsInlineLabel}>{t('settings.theme')}</Text>
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
        <Text style={styles.settingsInlineLabel}>{t('settings.textSize')}</Text>
        <Segmented
          accent={accent}
          options={[
            { key: '0.8', label: t('settings.textSizeXs') },
            { key: '0.9', label: t('settings.textSizeSm') },
            { key: '1', label: t('settings.textSizeMd') },
            { key: '1.1', label: t('settings.textSizeLg') },
            { key: '1.2', label: t('settings.textSizeXl') },
          ]}
          value={String(textScale)}
          onChange={(v) => setTextScale(Number(v) as TextScalePref)}
        />

        <SectionLabel label={t('settings.notifSection')} styles={styles} />
        <NotificationPreferencesCard colors={{ ...themes.night, accent }} />

        {/* ── 地圖與旅程 ───────────────────────────────────────── */}
        <SectionLabel label={t('settings.sectionMapJourney')} styles={styles} />
        <View style={styles.accuracyRow}>
          <View style={styles.accuracyCopy}>
            <Text style={styles.accuracyLabel}>{t('settings.locationSharing')}</Text>
            <Text style={styles.accuracySubhint}>{t('settings.locationSharingHint')}</Text>
          </View>
          <Switch
            style={styles.accuracySwitch}
            value={sharingEnabled}
            onValueChange={onSharingEnabledChange}
            trackColor={{ true: accent, false: 'rgba(120,120,128,0.32)' }}
            thumbColor="#fff"
            ios_backgroundColor="rgba(120,120,128,0.32)"
            accessibilityLabel={t('settings.locationSharing')}
          />
        </View>
        <View style={styles.accuracyRow}>
          <View style={styles.accuracyCopy}>
            <Text style={styles.accuracyLabel}>{t('settings.obliqueLocate')}</Text>
            <Text style={styles.accuracySubhint}>{t('settings.obliqueLocateHint')}</Text>
          </View>
          <Switch
            style={styles.accuracySwitch}
            value={obliqueLocate}
            onValueChange={setObliqueLocate}
            trackColor={{ true: accent, false: 'rgba(120,120,128,0.32)' }}
            thumbColor="#fff"
            ios_backgroundColor="rgba(120,120,128,0.32)"
            accessibilityLabel={t('settings.obliqueLocate')}
          />
        </View>
        <View style={styles.accuracyRow}>
          <View style={styles.accuracyCopy}>
            <Text style={styles.accuracyLabel}>{t('settings.liveActivity')}</Text>
            <Text style={styles.accuracySubhint}>{t('settings.liveActivityHint')}</Text>
          </View>
          <Switch
            style={styles.accuracySwitch}
            value={liveActivityEnabled}
            onValueChange={setLiveActivityEnabled}
            trackColor={{ true: accent, false: 'rgba(120,120,128,0.32)' }}
            thumbColor="#fff"
            ios_backgroundColor="rgba(120,120,128,0.32)"
            accessibilityLabel={t('settings.liveActivity')}
          />
        </View>
        <View style={styles.accuracyRow}>
          <View style={styles.accuracyCopy}>
            <Text style={styles.accuracyLabel}>
              {t('settings.gatherCardDefaultExpanded')}
            </Text>
            <Text style={styles.accuracySubhint}>
              {t('settings.gatherCardDefaultExpandedHint')}
            </Text>
          </View>
          <Switch
            style={styles.accuracySwitch}
            value={gatherCardDefaultExpanded}
            onValueChange={setGatherCardDefaultExpanded}
            trackColor={{ true: accent, false: 'rgba(120,120,128,0.32)' }}
            thumbColor="#fff"
            ios_backgroundColor="rgba(120,120,128,0.32)"
            accessibilityLabel={t('settings.gatherCardDefaultExpanded')}
          />
        </View>
        {isLeader && onOpenStraggler ? (
          <View style={styles.settingsTopGroup}>
            <NavRow
              title={t('straggler.section')}
              description={t('settings.stragglerInGroupHint')}
              onPress={onOpenStraggler}
              styles={styles}
            />
          </View>
        ) : null}

        <SectionLabel label={t('map.cmdTitle')} styles={styles} />
        <View style={styles.settingsTopGroup}>
          <NavRow
            title={t('settings.customQuickCommand')}
            description={customSummary}
            onPress={onOpenCustomQuickCommand}
            styles={styles}
            accessibilityLabel={t('settings.customQuickCommand')}
          />
        </View>

        {/* ── 支援 ─────────────────────────────────────────────── */}
        <SectionLabel label={t('settings.sectionSupport')} styles={styles} />
        {showOtaApply ? (
          <TouchableOpacity
            style={[
              styles.accountBtn,
              {
                backgroundColor: accent,
                borderColor: accent,
                opacity: applyingOta ? 0.7 : 1,
                marginBottom: 8,
              },
            ]}
            onPress={applyOtaUpdate}
            disabled={applyingOta}
            accessibilityRole="button"
            accessibilityLabel={t('settings.applyOta')}
            activeOpacity={0.85}
          >
            {applyingOta ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color="#fff" />
                <Text style={[styles.accountBtnText, { color: '#fff' }]}>
                  {t('settings.applyingOta')}
                </Text>
              </View>
            ) : (
              <Text style={[styles.accountBtnText, { color: '#fff' }]}>
                {t('settings.applyOta')}
              </Text>
            )}
          </TouchableOpacity>
        ) : null}
        <View style={styles.settingsTopGroup}>
          <NavRow
            title={t('feedback.title')}
            onPress={onOpenFeedback}
            styles={styles}
            accessibilityLabel={t('feedback.title')}
          />
          {diagnosticsEnabled ? (
            <NavRow
              title={t('diagnostics.title')}
              description={t('diagnostics.settingsHint')}
              onPress={onOpenDiagnostics}
              styles={styles}
            />
          ) : null}
          <View style={styles.settingsTopRow}>
            <View style={styles.settingsTopCopy}>
              <Text style={styles.settingsTopTitle}>{t('settings.aboutHither')}</Text>
              <Text style={styles.settingsTopDescription}>
                {t('settings.version', { version: appVersion })}
              </Text>
              <Text style={styles.settingsTopDescription}>
                {t('settings.otaLabel', { detail: otaSummary })}
              </Text>
            </View>
          </View>
        </View>

        {__DEV__ ? (
          <TouchableOpacity
            style={styles.accountBtn}
            onPress={onArchiveAllForTest}
            accessibilityRole="button"
            activeOpacity={0.7}
          >
            <Text style={[styles.accountBtnText, { color: glass.textTertiary }]}>
              🧪 全部集合點標記為已完成（測試）
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* ── 群組管理 / 進階：一般列表列，紅色只在確認對話框 ─── */}
        <SectionLabel label={t('settings.sectionGroupAdmin')} styles={styles} />
        <View style={styles.settingsTopGroup}>
          <NavRow
            title={isLeader ? t('map.endGroupCurrent') : t('group.leave')}
            onPress={onConfirmLeave}
            styles={styles}
          />
        </View>

        <SectionLabel label={t('settings.sectionAdvanced')} styles={styles} />
        <View style={styles.settingsTopGroup}>
          <NavRow
            title={t('settings.resetAllPrefs')}
            onPress={onConfirmResetPrefs}
            styles={styles}
          />
        </View>
      </ScrollView>
    </OverlaySheet>
  );
});
