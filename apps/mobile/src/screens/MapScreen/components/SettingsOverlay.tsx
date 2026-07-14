import React from 'react';
import { ScrollView, Switch, Text, View, TouchableOpacity } from 'react-native';
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
  const { isPro } = useSession();
  const {
    language,
    themeName,
    obliqueLocate,
    setLanguage,
    setThemeName,
    setObliqueLocate,
  } = usePreferences();
  const { colors } = useTheme();
  const accent = colors.accent;

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
          <View style={styles.settingsTopGroup}>
            <TouchableOpacity
              style={styles.settingsTopRow}
              onPress={onOpenAccount}
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <View style={styles.settingsTopCopy}>
                <Text style={styles.settingsTopTitle}>{t('settings.account')}</Text>
                <Text style={styles.settingsTopDescription}>{t('settings.accountDescription')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={glass.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsTopRow}
              onPress={onOpenPaywall}
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <View style={styles.settingsTopCopy}>
                <Text style={styles.settingsTopTitle}>{t('paywall.title')}</Text>
                <Text style={styles.settingsTopDescription}>
                  {isPro ? t('paywall.active') : t('paywall.upgrade')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={glass.textTertiary} />
            </TouchableOpacity>
          </View>

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

          <Text style={styles.sectionLabel}>{t('settings.mapSection')}</Text>
          <View style={styles.accuracyRow}>
            <View style={styles.accuracyCopy}>
              <View style={styles.accuracyTitleRow}>
                <Ionicons name="cube-outline" size={18} color={obliqueLocate ? accent : glass.textTertiary} />
                <Text style={styles.accuracyLabel}>
                  {t('settings.obliqueLocate')}
                </Text>
              </View>
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

          <Text style={styles.sectionLabel}>{t('settings.notifSection')}</Text>
          <NotificationPreferencesCard colors={{ ...themes.night, accent }} />

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

          <TouchableOpacity
            style={styles.reportButton}
            onPress={onOpenFeedback}
            accessibilityRole="button"
            accessibilityLabel={t('feedback.title')}
            activeOpacity={0.7}
          >
            <Ionicons name="warning-outline" size={20} color={accent} />
            <Text style={styles.reportButtonText}>{t('feedback.title')}</Text>
            <Ionicons name="chevron-forward" size={18} color={glass.textTertiary} />
          </TouchableOpacity>
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

    </>
  );
});
