import WaveLoading from '../../../components/WaveLoading';
import React, { useCallback, useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { accentMix, glass } from '../../../glass';
import { useTranslation } from '../../../i18n';
import { mediumTap } from '../../../utils/haptics';
import type {
  CoarseProgressBucket,
  PassiveCompanionModel,
  TeamGatheringPhase,
} from '../../../utils/passiveCompanion';
import type { Destination } from '../../../types';
import { HitherText } from '../../../components/HitherText';
import QuickCommandsCard from '../../../components/QuickCommandsCard';
import NativeGlassButton from '../../../components/NativeGlassButton';
import SwiftUIGlassSurface from '../../../components/SwiftUIGlassSurface';
import { useFontLayout } from '../../../a11y/useFontScaleBucket';
import { spacing, radius, themes, type Palette } from '../../../theme';
import { TYPE_BASE } from '../../../theme/typeScale';

function makePassiveStyles(scale: number) {
  const s = (value: number, min = 0) => Math.max(min, Math.round(value * scale));
  return StyleSheet.create({
    root: {
      ...StyleSheet.absoluteFill,
      backgroundColor: themes.night.background,
      paddingHorizontal: spacing.lg,
      zIndex: 40,
      justifyContent: 'flex-start',
    },
    headerRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: spacing.lg, gap: spacing.md,
    },
    kicker: {
      color: glass.textPrimary,
      fontSize: TYPE_BASE.title,
      fontWeight: '600',
      flexShrink: 1,
    },
    card: {
      borderRadius: radius.lg, padding: spacing.lg, minHeight: 220,
    },
    progressCard: { borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    infoContent: { flex: 1, minWidth: 0 },
    infoIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: glass.fillStrong },
    nextPoint: { marginTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.hairlineSoft, paddingTop: spacing.lg },
    centerBlock: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: s(32, 28) },
    errorBanner: {
      flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md,
      backgroundColor: 'rgba(255, 107, 107, 0.12)', borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255, 107, 107, 0.35)',
    },
    errorBannerText: {
      flex: 1,
      color: glass.danger,
      fontSize: TYPE_BASE.callout,
      fontWeight: '500',
      lineHeight: 20,
    },
    fieldLabel: {
      color: glass.textTertiary,
      fontSize: TYPE_BASE.caption,
      fontWeight: '600',
      letterSpacing: 0.35,
      textTransform: 'uppercase',
    },
    pointTitle: {
      color: glass.textPrimary,
      fontSize: TYPE_BASE.title,
      fontWeight: '600',
      fontFamily: 'Fredoka_600SemiBold',
      marginTop: spacing.sm,
      marginBottom: spacing.md,
    },
    primary: {
      color: glass.textPrimary,
      fontSize: TYPE_BASE.body,
      fontWeight: '600',
      textAlign: 'center',
    },
    secondary: {
      color: glass.textSecondary,
      fontSize: TYPE_BASE.body,
      fontWeight: '400',
      marginTop: spacing.xs,
    },
    phasePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
    phaseDot: { width: 10, height: 10, borderRadius: 5 },
    phaseText: { fontSize: TYPE_BASE.callout, fontWeight: '600' },
    progressTrack: { marginTop: spacing.sm, height: 8, borderRadius: 4, backgroundColor: glass.fillStrong, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 4 },
    actions: { marginTop: spacing.lg },
    quickLabel: { marginTop: spacing.xl, marginBottom: spacing.sm, color: glass.textSecondary },
    quickWrap: { marginTop: spacing.sm },
    footnote: {
      marginTop: spacing.lg,
      color: glass.textTertiary,
      fontSize: TYPE_BASE.footnote,
      fontWeight: '400',
      lineHeight: 18,
      textAlign: 'center',
    },
  });
}

export interface PassiveCompanionPanelProps {
  model: PassiveCompanionModel;
  accent: string;
  groupId: string | null;
  isLeader?: boolean;
  /** Destination used for external maps (current point when coordinates known). */
  navigationDestination?: Destination | null;
  onSwitchBack: () => void;
  onOpenExternalNavigation: (dest: Destination) => void;
  /** Same custom-command editor as full-mode「全部快捷指令」. */
  onConfigureCustom?: (slot: number) => void;
}

function phaseLabelKey(phase: TeamGatheringPhase): 'passive.phaseStaying' | 'passive.phaseEnRoute' {
  return phase === 'en_route' ? 'passive.phaseEnRoute' : 'passive.phaseStaying';
}

function progressLabelKey(
  bucket: CoarseProgressBucket,
):
  | 'passive.progressUnknown'
  | 'passive.progressNotStarted'
  | 'passive.progressEarly'
  | 'passive.progressMid'
  | 'passive.progressLate'
  | 'passive.progressArrived' {
  switch (bucket) {
    case 'not_started':
      return 'passive.progressNotStarted';
    case 'early':
      return 'passive.progressEarly';
    case 'mid':
      return 'passive.progressMid';
    case 'late':
      return 'passive.progressLate';
    case 'arrived':
      return 'passive.progressArrived';
    case 'unknown':
    default:
      return 'passive.progressUnknown';
  }
}

/**
 * Minimal passive-companion presentation: team gathering state + personal
 * progress, external nav, full quick-command catalogue (same as「全部快捷指令」),
 * and an always-available switch-back button.
 *
 * Does not open paywall, vote, or safety flows. Commands are explicit taps only.
 */
export const PassiveCompanionPanel = React.memo(function PassiveCompanionPanel({
  model,
  accent,
  groupId,
  isLeader = false,
  navigationDestination,
  onSwitchBack,
  onOpenExternalNavigation,
  onConfigureCustom,
}: PassiveCompanionPanelProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const fontLayout = useFontLayout();
  const styles = useMemo(() => makePassiveStyles(fontLayout.scale), [fontLayout.scale]);
  // Reuse the night palette so QuickCommandsCard matches full-mode sheet.
  const commandColors: Palette = themes.night;

  const handleSwitchBack = useCallback(() => {
    onSwitchBack();
  }, [onSwitchBack]);

  const handleExternalNav = useCallback(() => {
    if (!navigationDestination) {
      Alert.alert(t('passive.noPointTitle'), t('passive.noPointBody'));
      return;
    }
    mediumTap();
    onOpenExternalNavigation(navigationDestination);
  }, [navigationDestination, onOpenExternalNavigation, t]);

  const handleConfigureCustom = useCallback(
    (slot: number) => {
      onConfigureCustom?.(slot);
    },
    [onConfigureCustom],
  );

  const phaseKey = phaseLabelKey(model.teamPhase);
  const progressKey = progressLabelKey(model.coarseProgress);

  return (
    <View
      style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}
      accessibilityViewIsModal
      testID="passive-companion-panel"
    >
      <View style={styles.headerRow}>
        <HitherText typeRole="title" style={styles.kicker} accessibilityRole="header">
          {t('passive.title')}
        </HitherText>
        <NativeGlassButton
          systemImage="arrow.up.left.and.arrow.down.right"
          foregroundColor="#fff"
          size={46}
          onPress={() => { mediumTap(); handleSwitchBack(); }}
          accessibilityLabel={t('passive.switchBack')}
          testID="passive-switch-back"
        />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.card}>
        <SwiftUIGlassSurface shape="roundedRectangle" cornerRadius={radius.lg} style={StyleSheet.absoluteFill} />
        {model.contentStatus === 'loading' ? (
          <View style={styles.centerBlock}>
            <WaveLoading color={accent} size="large" />
            <HitherText typeRole="body" style={styles.secondary}>{t('passive.loading')}</HitherText>
          </View>
        ) : null}

        {/* Exclusive error only when there is no cached companion content. */}
        {model.contentStatus === 'error' ? (
          <View style={styles.centerBlock}>
            <Ionicons name="warning-outline" size={28} color={glass.danger} />
            <HitherText typeRole="body" style={styles.primary}>
              {model.errorMessage?.trim() || t('passive.error')}
            </HitherText>
          </View>
        ) : null}

        {model.contentStatus === 'empty' ? (
          <View style={styles.centerBlock}>
            <HitherText typeRole="body" style={styles.primary}>{t('passive.empty')}</HitherText>
            <HitherText typeRole="body" style={styles.secondary}>{t('passive.emptyHint')}</HitherText>
          </View>
        ) : null}

        {/* Ready (incl. error-with-cache): always show required companion fields. */}
        {model.contentStatus === 'ready' ? (
          <>
            {model.errorMessage ? (
              <View
                style={styles.errorBanner}
                accessibilityRole="text"
                testID="passive-error-banner"
              >
                <Ionicons name="warning-outline" size={18} color={glass.danger} />
                <HitherText typeRole="callout" style={styles.errorBannerText} numberOfLines={3}>
                  {model.errorMessage.trim() || t('passive.error')}
                </HitherText>
              </View>
            ) : null}

            <View style={styles.infoRow}>
              <Text style={[styles.fieldLabel, styles.infoContent]}>{t('passive.currentPoint')}</Text>
              <View style={[styles.phasePill, { backgroundColor: accentMix(accent, 16) }]}>
                <View style={[styles.phaseDot, { backgroundColor: accent }]} />
                <HitherText typeRole="callout" style={[styles.phaseText, { color: accent }]}>
                  {t(phaseKey)}
                </HitherText>
              </View>
            </View>
            <HitherText typeRole="title" style={styles.pointTitle} numberOfLines={3}>
              {model.currentPoint?.title ?? t('passive.noCurrentPoint')}
            </HitherText>
            <View style={[styles.infoRow, styles.nextPoint]}>
              <View style={styles.infoIcon}><Ionicons name="arrow-forward" size={20} color={accent} /></View>
              <View style={styles.infoContent}>
                <Text style={styles.fieldLabel}>{t('passive.nextPoint')}</Text>
                <HitherText typeRole="body" style={styles.secondary} numberOfLines={2}>
                  {model.nextPoint?.title ?? t('passive.noNextPoint')}
                </HitherText>
              </View>
            </View>
          </>
        ) : null}
      </View>

      {model.contentStatus === 'ready' ? (
        <View style={styles.progressCard}>
          <SwiftUIGlassSurface shape="roundedRectangle" cornerRadius={radius.lg} style={StyleSheet.absoluteFill} />
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}><Ionicons name="walk-outline" size={20} color={accent} /></View>
            <View style={styles.infoContent}>
              <Text style={styles.fieldLabel}>{t('passive.personalProgress')}</Text>
              <HitherText typeRole="body" style={styles.secondary}>{t(progressKey)}</HitherText>
            </View>
          </View>
          {model.personalProgress != null ? (
            <View style={styles.progressTrack} accessibilityRole="progressbar"
              accessibilityLabel={t('passive.personalProgress')}
              accessibilityValue={{ min: 0, max: 100, now: Math.round(model.personalProgress * 100) }}>
              <View style={[styles.progressFill, {
                width: `${Math.round(model.personalProgress * 100)}%`, backgroundColor: accent,
              }]} />
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <NativeGlassButton
          label={t('passive.externalNav')}
          systemImage="map"
          imageSize={21}
          layout="fill"
          height={56}
          shape="roundedRectangle"
          variant="glassProminent"
          tintColor={accent}
          foregroundColor="#111"
          onPress={handleExternalNav}
          accessibilityLabel={t('map.openExternalNavigation')}
          testID="passive-external-nav"
        />
      </View>

      <HitherText typeRole="callout" style={[styles.fieldLabel, styles.quickLabel]}>
        {t('passive.quickCommands')}
      </HitherText>
      {/* Same catalogue + role gating + custom slots as full-mode「全部快捷指令」. */}
      <View style={styles.quickWrap} testID="passive-quick-commands">
        {groupId ? (
          <QuickCommandsCard
            groupId={groupId}
            isLeader={isLeader}
            colors={commandColors}
            onConfigureCustom={handleConfigureCustom}
            variant="full"
          />
        ) : null}
      </View>

      <HitherText typeRole="caption" style={styles.footnote}>{t('passive.noAutoConsent')}</HitherText>
      </ScrollView>
    </View>
  );
});
