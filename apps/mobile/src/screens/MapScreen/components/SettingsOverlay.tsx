import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import SystemToggle from '../../../components/SystemToggle';
import PrefSlider from '../../../components/PrefSlider';
import NotificationPreferencesCard from '../../../components/NotificationPreferencesCard';
import PremiumBanner from '../../../components/PremiumBanner';
import { AccountSheetContent } from '../../../components/AccountSheet';
import SettingsChildSheet from './SettingsChildSheet';
import { AVATAR_COLORS, AVATAR_EMOJI, avatarColorForGroup, avatarForGroup } from '../../../constants/avatars';
import type { Group } from '../../../types';
import { useSession } from '../../../state/SessionContext';
import {
  usePreferences,
  useTheme,
  type TextScalePref,
} from '../../../state/PreferencesContext';
import { useTranslation } from '../../../i18n';
import { THEME_ORDER, themes } from '../../../theme';
import { glass } from '../../../glass';
import { applyOtaUpdate } from '../../../utils/otaUpdates';
import { premiumPlanForProduct } from '../../../premiumCatalog';

const MARQUEE_SPEED_MIN = 20;
const MARQUEE_SPEED_MAX = 80;

const OTA_UPDATES_USABLE = !__DEV__ && Updates.isEnabled;
interface SettingsOverlayProps {
  visible: boolean;
  onClose: () => void;
  onArchiveAllForTest: () => void;
  onOpenFeedback: () => void;
  onConfirmResetPrefs: () => void;
  /** End / leave group — list row only; red style only on confirm dialog. */
  onConfirmLeave: () => void;
  /** Sign out — list row only; red style only on confirm dialog. */
  onConfirmSignOut: () => void;
  onOpenPaywall: () => void;
  onDismissComplete?: () => void;
  onAccountDeleted: () => void;
  group?: Group | null;
  isLeader?: boolean;
  onUpdateGroupAvatar?: (avatar: string, avatarColor: string) => Promise<void>;
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
  onArchiveAllForTest,
  onOpenFeedback,
  onConfirmResetPrefs,
  onConfirmLeave,
  onConfirmSignOut,
  onOpenPaywall,
  onDismissComplete,
  onAccountDeleted,
  group,
  isLeader = false,
  onUpdateGroupAvatar,
  onGoHome,
  styles,
}: SettingsOverlayProps) {
  const { t } = useTranslation();
  const { isPro, premiumProjection } = useSession();
  const {
    language,
    themeName,
    textScale,
    obliqueLocate,
    gatherCardDefaultExpanded,
    gatherCardTitleMarquee,
    gatherCardMarqueeSpeed,
    setLanguage,
    setThemeName,
    setTextScale,
    setObliqueLocate,
    setGatherCardDefaultExpanded,
    setGatherCardTitleMarquee,
    setGatherCardMarqueeSpeed,
  } = usePreferences();
  const { colors } = useTheme();
  const accent = colors.accent;
  type SettingsChild =
    | 'root'
    | 'account'
    | 'language'
    | 'theme'
    | 'textSize'
    | 'groupAvatar'
    | 'notifications'
    | 'mapJourney'
    | 'support';
  const [page, setPage] = useState<SettingsChild>('root');
  const [groupAvatar, setGroupAvatar] = useState(group?.avatar ?? (group ? avatarForGroup(group.id) : AVATAR_EMOJI[0]));
  const [groupAvatarColor, setGroupAvatarColor] = useState(group?.avatarColor ?? (group ? avatarColorForGroup(group.id) : AVATAR_COLORS[0]));
  const [savingGroupAvatar, setSavingGroupAvatar] = useState(false);

  useEffect(() => {
    if (visible) {
      setPage('root');
      setGroupAvatar(group?.avatar ?? (group ? avatarForGroup(group.id) : AVATAR_EMOJI[0]));
      setGroupAvatarColor(group?.avatarColor ?? (group ? avatarColorForGroup(group.id) : AVATAR_COLORS[0]));
      return;
    }
    setPage('root');
  }, [visible, group, group?.id, group?.avatar, group?.avatarColor]);

  const saveGroupAvatar = useCallback(async () => {
    if (!group?.id || !onUpdateGroupAvatar || savingGroupAvatar) return;
    setSavingGroupAvatar(true);
    try {
      await onUpdateGroupAvatar(groupAvatar, groupAvatarColor);
      setPage('root');
    } catch {
      Alert.alert(t('settings.groupAvatar'), t('profile.saveFailed'));
    } finally {
      setSavingGroupAvatar(false);
    }
  }, [group?.id, onUpdateGroupAvatar, savingGroupAvatar, groupAvatar, groupAvatarColor, t]);

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

  const handleApplyOta = useCallback(async () => {
    if (!OTA_UPDATES_USABLE || applyingOta) return;
    setApplyingOta(true);
    try {
      // Shared single-flight with auto bootstrap — double-tap / concurrent
      // apply cannot stack reloads. skipCheck when Expo already has pending.
      const outcome = await applyOtaUpdate({
        manual: true,
        skipCheck: isUpdatePending,
      });
      if (outcome.reloading) {
        // Process will restart; keep applying state (no false failure toast).
        return;
      }
      setApplyingOta(false);
      if (outcome.status === 'no_update') {
        setOtaAvailable(false);
        return;
      }
      if (
        outcome.status === 'fetch_failed'
        || outcome.status === 'reload_failed'
      ) {
        Alert.alert(t('settings.otaApplyFailed'));
      }
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

  const pageTitle = t('map.overlaySettings');
  const closeChild = () => setPage('root');
  const handlePremiumPress = () => {
    if (!isPro) {
      onOpenPaywall();
      return;
    }
    const plan = premiumPlanForProduct(premiumProjection.productId ?? '');
    const planLabel = plan === 'monthly'
      ? t('settings.premiumMonthly')
      : plan === 'annual'
        ? t('settings.premiumAnnual')
        : t('settings.premiumEnabled');
    Alert.alert(
      t('paywall.title'),
      t('settings.premiumCurrentPlan', { plan: planLabel }),
      [{ text: t('common.ok') }],
    );
  };

  return (
    <View
      style={settingsSlideStyles.page}
      testID="settings-slide-page"
      pointerEvents="box-none"
    >
      <SettingsChildSheet
        visible={visible}
        onClose={onClose}
        onDismissComplete={onDismissComplete}
        title={pageTitle}
        zIndex={80}
        initialStage={1}
        stageTwoRatio={0.9}
        edgeToEdgeAtLast
      >
      <View style={styles.overlayBody}>
        {!isPro ? (
          <View testID="settings-subscribe-banner-hit-area">
            <PremiumBanner onPress={handlePremiumPress} testID="settings-subscribe-banner" />
          </View>
        ) : null}
        {/* ── 個人設定 ─────────────────────────────────────────── */}
        <SectionLabel label={t('settings.sectionPersonal')} styles={styles} />
        <View style={styles.settingsTopGroup}>
          <NavRow
            title={t('settings.account')}
            description={t('settings.accountDescription')}
            onPress={() => setPage('account')}
            styles={styles}
          />
          <NavRow
            title={t('paywall.title')}
            description={isPro ? t('paywall.active') : t('paywall.upgrade')}
            onPress={handlePremiumPress}
            styles={styles}
          />
          {isLeader && onUpdateGroupAvatar && group ? (
            <NavRow
              title={t('settings.groupAvatar')}
              description={group.name}
              onPress={() => setPage('groupAvatar')}
              styles={styles}
            />
          ) : null}
          {onGoHome ? (
            <NavRow
              title={t('map.backToHome')}
              description={t('settings.createOrJoinHint')}
              onPress={onGoHome}
              styles={styles}
            />
          ) : null}
          <NavRow
            title={t('group.leave')}
            onPress={onConfirmLeave}
            styles={styles}
          />
          <NavRow
            title={t('settings.signOut')}
            onPress={onConfirmSignOut}
            styles={styles}
          />
        </View>

        <SectionLabel label={t('settings.sectionLanguageAppearance')} styles={styles} />
        <View style={styles.settingsTopGroup}>
          <NavRow
            title={t('settings.language')}
            onPress={() => setPage('language')}
            styles={styles}
          />
          <NavRow
            title={t('settings.theme')}
            onPress={() => setPage('theme')}
            styles={styles}
          />
          <NavRow
            title={t('settings.textSize')}
            onPress={() => setPage('textSize')}
            styles={styles}
          />
        </View>

        <SectionLabel label={t('settings.notifSection')} styles={styles} />
        <View style={styles.settingsTopGroup}>
          <NavRow
            title={t('settings.notifSection')}
            onPress={() => setPage('notifications')}
            styles={styles}
          />
        </View>

        <SectionLabel label={t('settings.sectionMapJourney')} styles={styles} />
        <View style={styles.settingsTopGroup}>
          <NavRow
            title={t('settings.sectionMapJourney')}
            onPress={() => setPage('mapJourney')}
            styles={styles}
          />
        </View>

        <SectionLabel label={t('settings.sectionSupport')} styles={styles} />
        <View style={styles.settingsTopGroup}>
          <NavRow
            title={t('settings.sectionSupport')}
            onPress={() => setPage('support')}
            styles={styles}
          />
          <NavRow
            title={t('feedback.title')}
            onPress={onOpenFeedback}
            styles={styles}
            accessibilityLabel={t('feedback.title')}
          />
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

        <SectionLabel label={t('settings.sectionAdvanced')} styles={styles} />
        <View style={styles.settingsTopGroup}>
          <NavRow
            title={t('settings.resetAllPrefs')}
            onPress={onConfirmResetPrefs}
            styles={styles}
          />
        </View>
      </View>

      <SettingsChildSheet
        visible={page === 'account'}
        onClose={closeChild}
        title={t('settings.account')}
        initialStage={1}
        stageTwoRatio={0.9}
        wrapContentInScrollView={false}
      >
        <AccountSheetContent
          visible={page === 'account'}
          onClose={closeChild}
          accent={accent}
          contentTopPadding={12}
          onAccountDeleted={onAccountDeleted}
        />
      </SettingsChildSheet>

      <SettingsChildSheet
        visible={page === 'groupAvatar'}
        onClose={closeChild}
        title={t('settings.groupAvatar')}
        initialStage={1}
        stageTwoRatio={0.8}
      >
        <View style={styles.overlayBody}>
          <Text style={styles.settingsInlineLabel}>{t('settings.groupAvatarHint')}</Text>
          <View style={settingsSlideStyles.groupAvatarGrid}>
            {AVATAR_EMOJI.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => setGroupAvatar(emoji)}
                accessibilityRole="button"
                accessibilityState={{ selected: groupAvatar === emoji }}
                style={[
                  settingsSlideStyles.groupAvatarChoice,
                  { backgroundColor: groupAvatarColor },
                  groupAvatar === emoji && settingsSlideStyles.groupAvatarChoiceSelected,
                ]}
              >
                <Text style={settingsSlideStyles.groupAvatarEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={settingsSlideStyles.groupAvatarColors}
            contentContainerStyle={settingsSlideStyles.groupAvatarColorsContent}
          >
            {AVATAR_COLORS.map((color) => (
              <Pressable
                key={color}
                onPress={() => setGroupAvatarColor(color)}
                accessibilityRole="button"
                accessibilityState={{ selected: groupAvatarColor === color }}
                style={[
                  settingsSlideStyles.groupAvatarColor,
                  { backgroundColor: color },
                  groupAvatarColor === color && settingsSlideStyles.groupAvatarColorSelected,
                ]}
              />
            ))}
          </ScrollView>
          <TouchableOpacity
            onPress={() => { void saveGroupAvatar(); }}
            disabled={savingGroupAvatar}
            accessibilityRole="button"
            style={[styles.accountBtn, { backgroundColor: accent, borderColor: accent, opacity: savingGroupAvatar ? 0.6 : 1 }]}
          >
            {savingGroupAvatar ? <ActivityIndicator color="#fff" /> : <Text style={[styles.accountBtnText, { color: '#fff' }]}>{t('settings.customQuickCommandSave')}</Text>}
          </TouchableOpacity>
        </View>
      </SettingsChildSheet>

      <SettingsChildSheet
        visible={page === 'language'}
        onClose={closeChild}
        title={t('settings.language')}

      >
        <View style={styles.overlayBody}>
          {[
            { key: 'zh' as const, label: '中文' },
            { key: 'en' as const, label: 'English' },
          ].map((option) => (
            <Pressable
              key={option.key}
              style={styles.settingsTopRow}
              onPress={() => setLanguage(option.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: language === option.key }}
            >
              <Text style={styles.settingsTopTitle}>{option.label}</Text>
              {language === option.key ? (
                <Ionicons name="checkmark" size={18} color={accent} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </SettingsChildSheet>

      <SettingsChildSheet
        visible={page === 'theme'}
        onClose={closeChild}
        title={t('settings.theme')}

      >
        <View style={styles.overlayBody}>
          {THEME_ORDER.map((n) => (
            <Pressable
              key={n}
              style={styles.settingsTopRow}
              onPress={() => setThemeName(n)}
              accessibilityRole="button"
              accessibilityState={{ selected: themeName === n }}
            >
              <Text style={styles.settingsTopTitle}>
                {t(
                  n === 'night'
                    ? 'settings.themeNight'
                    : n === 'day'
                      ? 'settings.themeDay'
                      : n === 'dusk'
                        ? 'settings.themeDusk'
                        : 'settings.themeForest',
                )}
              </Text>
              {themeName === n ? (
                <Ionicons name="checkmark" size={18} color={accent} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </SettingsChildSheet>

      <SettingsChildSheet
        visible={page === 'textSize'}
        onClose={closeChild}
        title={t('settings.textSize')}

      >
        <View style={styles.overlayBody}>
          <View testID="settings-text-scale-slider">
            <PrefSlider
              accent={accent}
              values={[0.8, 0.9, 1.0, 1.1, 1.2]}
              value={textScale}
              onChange={(v) => setTextScale(v as TextScalePref)}
              accessibilityLabel={t('settings.textSize')}
            />
            <Text style={[styles.settingsInlineLabel, { marginTop: 4, opacity: 0.8 }]}>
              {textScale === 0.8
                ? t('settings.textSizeXs')
                : textScale === 0.9
                  ? t('settings.textSizeSm')
                  : textScale === 1.1
                    ? t('settings.textSizeLg')
                    : textScale === 1.2
                      ? t('settings.textSizeXl')
                      : t('settings.textSizeMd')}
            </Text>
          </View>
        </View>
      </SettingsChildSheet>

      <SettingsChildSheet
        visible={page === 'notifications'}
        onClose={closeChild}
        title={t('settings.notifSection')}

      >
        <View style={styles.overlayBody}>
          <NotificationPreferencesCard colors={{ ...themes.night, accent }} />
        </View>
      </SettingsChildSheet>

      <SettingsChildSheet
        visible={page === 'mapJourney'}
        onClose={closeChild}
        title={t('settings.sectionMapJourney')}

      >
        <View style={styles.overlayBody}>
          <View style={styles.accuracyRow}>
            <View style={styles.accuracyCopy}>
              <Text style={styles.accuracyLabel}>{t('settings.obliqueLocate')}</Text>
              <Text style={styles.accuracySubhint}>{t('settings.obliqueLocateHint')}</Text>
            </View>
            <SystemToggle
              value={obliqueLocate}
              onValueChange={setObliqueLocate}
              accessibilityLabel={t('settings.obliqueLocate')}
            />
          </View>
          <View style={styles.accuracyRow}>
            <View style={styles.accuracyCopy}>
              <Text style={styles.accuracyLabel}>{t('settings.gatherCardDefaultExpanded')}</Text>
              <Text style={styles.accuracySubhint}>{t('settings.gatherCardDefaultExpandedHint')}</Text>
            </View>
            <SystemToggle
              value={gatherCardDefaultExpanded}
              onValueChange={setGatherCardDefaultExpanded}
              accessibilityLabel={t('settings.gatherCardDefaultExpanded')}
            />
          </View>
          <View style={styles.accuracyRow} pointerEvents="box-none">
            <View style={styles.accuracyCopy} pointerEvents="none">
              <Text style={styles.accuracyLabel}>{t('settings.gatherCardTitleMarquee')}</Text>
              <Text style={styles.accuracySubhint}>{t('settings.gatherCardTitleMarqueeHint')}</Text>
            </View>
            <SystemToggle
              value={Boolean(gatherCardTitleMarquee)}
              onValueChange={(v) => setGatherCardTitleMarquee(Boolean(v))}
              accessibilityLabel={t('settings.gatherCardTitleMarquee')}
            />
          </View>
          {Boolean(gatherCardTitleMarquee) ? (
            <View style={styles.marqueeSpeedBlock} pointerEvents="box-none">
              <View style={styles.marqueeSpeedLabels} pointerEvents="none">
                <Text style={styles.accuracyLabel}>{t('settings.gatherCardMarqueeSpeed')}</Text>
                <View style={styles.marqueeSpeedEnds}>
                  <Text style={styles.accuracySubhint}>{t('settings.gatherCardMarqueeSpeedSlow')}</Text>
                  <Text style={styles.accuracySubhint}>{t('settings.gatherCardMarqueeSpeedFast')}</Text>
                </View>
              </View>
              <PrefSlider
                value={gatherCardMarqueeSpeed}
                min={MARQUEE_SPEED_MIN}
                max={MARQUEE_SPEED_MAX}
                onChange={setGatherCardMarqueeSpeed}
                accent={accent}
                accessibilityLabel={t('settings.gatherCardMarqueeSpeed')}
              />
            </View>
          ) : null}
        </View>
      </SettingsChildSheet>

      <SettingsChildSheet
        visible={page === 'support'}
        onClose={closeChild}
        title={t('settings.sectionSupport')}

      >
        <View style={styles.overlayBody}>
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
              onPress={handleApplyOta}
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
      </SettingsChildSheet>
      </SettingsChildSheet>
    </View>
  );
});

const settingsSlideStyles = StyleSheet.create({
  page: {
    ...StyleSheet.absoluteFill,
    // Above MapScreen sheetLayer (70). Sibling account/paywall/feedback/
    // diagnostics hosts use settingsChildLayer (90) so they overlay this page.
    zIndex: 80,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 10,
    minHeight: 44,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerSpacer: { width: 44, height: 44 },
  groupAvatarGrid: {
    width: 300,
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: 18,
  },
  groupAvatarChoice: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  groupAvatarChoiceSelected: { borderColor: '#fff' },
  groupAvatarEmoji: { fontSize: 26 },
  groupAvatarColors: {
    width: 300,
    alignSelf: 'center',
    paddingBottom: 18,
  },
  groupAvatarColorsContent: { flexDirection: 'row', gap: 10 },
  groupAvatarColor: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent' },
  groupAvatarColorSelected: { borderColor: '#fff' },
});
