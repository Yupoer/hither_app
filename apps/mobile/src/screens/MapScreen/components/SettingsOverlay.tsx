import React from 'react';
import { ScrollView, Switch, Text, View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
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
  /** Group-scoped straggler lives under tools; settings only deep-links there. */
  onOpenStraggler?: () => void;
  /** Switch active group (MyTeams) — not on the map sheet header. */
  onSwitchGroup?: () => void;
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
  onOpenStraggler,
  onSwitchGroup,
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
    obliqueLocate,
    liveActivityEnabled,
    setLanguage,
    setThemeName,
    setTextScale,
    setObliqueLocate,
    setLiveActivityEnabled,
  } = usePreferences();
  const { colors } = useTheme();
  const accent = colors.accent;

  const appVersion =
    Constants.expoConfig?.version ??
    Constants.nativeAppVersion ??
    '—';

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
        <View style={styles.settingsTopGroup}>
          <NavRow
            title={t('feedback.title')}
            onPress={onOpenFeedback}
            styles={styles}
            accessibilityLabel={t('feedback.title')}
          />
          <View style={styles.settingsTopRow}>
            <View style={styles.settingsTopCopy}>
              <Text style={styles.settingsTopTitle}>{t('settings.aboutHither')}</Text>
              <Text style={styles.settingsTopDescription}>
                {t('settings.version', { version: appVersion })}
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
