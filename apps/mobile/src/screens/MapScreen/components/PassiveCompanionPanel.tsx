import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sendCommand } from '../../../api/client';
import { glass } from '../../../glass';
import { useTranslation } from '../../../i18n';
import { mediumTap } from '../../../utils/haptics';
import type {
  CoarseProgressBucket,
  PassiveCompanionModel,
  TeamGatheringPhase,
} from '../../../utils/passiveCompanion';
import type { Destination } from '../../../types';
import type { CommandType } from '../../../types';
import { HitherText } from '../../../components/HitherText';
import { useFontLayout } from '../../../a11y/useFontScaleBucket';
import { spacing, radius } from '../../../theme';

const COMMAND_ICON: Record<Exclude<CommandType, 'custom'>, keyof typeof Ionicons.glyphMap> = {
  gather: 'people',
  find_gathering: 'location',
  depart: 'walk',
  rest: 'cafe',
  be_careful: 'warning',
  go_left: 'arrow-back',
  go_right: 'arrow-forward',
  stop: 'hand-left',
  hurry_up: 'flash',
  need_restroom: 'body',
  need_break: 'pause',
  need_help: 'help-buoy',
  found_something: 'search',
};

const COMMAND_DISABLED_COLOR = 'rgba(235, 235, 245, 0.35)';

function commandIcon(type: Exclude<CommandType, 'custom'>): keyof typeof Ionicons.glyphMap {
  return COMMAND_ICON[type];
}

function makePassiveStyles(scale: number) {
  const s = (value: number, min = 0) => Math.max(min, Math.round(value * scale));
  return StyleSheet.create({
    root: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(10, 16, 28, 0.94)',
      paddingHorizontal: spacing.lg,
      zIndex: 40,
      justifyContent: 'flex-start',
    },
    headerRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: spacing.lg, gap: spacing.md,
    },
    kicker: { color: glass.textSecondary, fontSize: 14, fontWeight: '700', letterSpacing: 0.5, flexShrink: 1 },
    switchBack: {
      minHeight: s(54, 48), paddingHorizontal: spacing.lg, borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    },
    switchBackLabel: { fontSize: 15, fontWeight: '800', color: '#111' },
    card: {
      backgroundColor: glass.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineSoft, padding: spacing.lg, minHeight: 220,
    },
    centerBlock: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: s(32, 28) },
    errorBanner: {
      flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md,
      backgroundColor: 'rgba(255, 107, 107, 0.12)', borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255, 107, 107, 0.35)',
    },
    errorBannerText: { flex: 1, color: glass.danger, fontSize: 14, fontWeight: '600', lineHeight: 20 },
    fieldLabel: { color: glass.textTertiary, fontSize: 13, fontWeight: '700', letterSpacing: 0.35, textTransform: 'uppercase' },
    fieldGap: { marginTop: spacing.lg },
    pointTitle: { color: glass.textPrimary, fontSize: 28, fontWeight: '800', marginTop: spacing.sm, marginBottom: spacing.md },
    primary: { color: glass.textPrimary, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    secondary: { color: glass.textSecondary, fontSize: 17, marginTop: spacing.xs },
    phasePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
    phaseDot: { width: 10, height: 10, borderRadius: 5 },
    phaseText: { fontSize: 15, fontWeight: '800' },
    progressTrack: { marginTop: spacing.sm, height: 8, borderRadius: 4, backgroundColor: glass.fillStrong, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 4 },
    actions: { marginTop: spacing.lg },
    actionBtn: { minHeight: s(58, 54), flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md },
    actionPrimary: {},
    actionPrimaryLabel: { color: '#111', fontSize: 17, fontWeight: '800' },
    quickLabel: { marginTop: spacing.xl, marginBottom: spacing.sm, color: glass.textSecondary },
    quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    quickChip: { width: '48%', minHeight: s(58, 52), flexGrow: 1, flexBasis: '46%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: glass.fillStrong, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.hairline },
    quickChipLabel: { color: glass.textPrimary, fontSize: 15, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
    footnote: { marginTop: spacing.lg, color: glass.textTertiary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
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

const LEADER_QUICK: Array<Exclude<CommandType, 'custom'>> = ['gather', 'depart', 'need_help'];
const MEMBER_QUICK: Array<Exclude<CommandType, 'custom'>> = [
  'need_help',
  'need_break',
  'found_something',
];

/**
 * Minimal passive-companion presentation: team gathering state + personal
 * progress, external nav, help / quick commands, and an always-available
 * switch-back button.
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
}: PassiveCompanionPanelProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const fontLayout = useFontLayout();
  const styles = useMemo(() => makePassiveStyles(fontLayout.scale), [fontLayout.scale]);
  const [busyType, setBusyType] = useState<string | null>(null);

  const handleSwitchBack = useCallback(() => {
    mediumTap();
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

  const handleCommand = useCallback(async (type: Exclude<CommandType, 'custom'>) => {
    if (!groupId || busyType) return;
    mediumTap();
    setBusyType(type);
    try {
      await sendCommand(groupId, type, t(`command.${type}` as const));
      Alert.alert(t('command.sent'));
    } catch {
      Alert.alert(t('command.sendFailed'));
    } finally {
      setBusyType(null);
    }
  }, [groupId, busyType, t]);

  const phaseKey = phaseLabelKey(model.teamPhase);
  const progressKey = progressLabelKey(model.coarseProgress);
  const quickTypes = isLeader ? LEADER_QUICK : MEMBER_QUICK;

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
        <Pressable
          onPress={handleSwitchBack}
          style={[styles.switchBack, { borderColor: accent, backgroundColor: accent }]}
          accessibilityRole="button"
          accessibilityLabel={t('passive.switchBack')}
          testID="passive-switch-back"
          // Always interactive — including loading / empty / error.
          disabled={false}
        >
          <Ionicons name="expand-outline" size={16} color="#111" />
          <HitherText typeRole="callout" style={styles.switchBackLabel}>
            {t('passive.switchBack')}
          </HitherText>
        </Pressable>
      </View>

      <View style={styles.card}>
        {model.contentStatus === 'loading' ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={accent} />
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

            <Text style={styles.fieldLabel}>{t('passive.currentPoint')}</Text>
            <HitherText typeRole="display" style={styles.pointTitle} numberOfLines={3}>
              {model.currentPoint?.title ?? t('passive.noCurrentPoint')}
            </HitherText>

            <View style={[styles.phasePill, { backgroundColor: accent + '33' }]}>
              <View style={[styles.phaseDot, { backgroundColor: accent }]} />
              <HitherText typeRole="callout" style={[styles.phaseText, { color: accent }]}>
                {t(phaseKey)}
              </HitherText>
            </View>

            <Text style={[styles.fieldLabel, styles.fieldGap]}>
              {t('passive.nextPoint')}
            </Text>
            <HitherText typeRole="body" style={styles.secondary} numberOfLines={2}>
              {model.nextPoint?.title ?? t('passive.noNextPoint')}
            </HitherText>

            <Text style={[styles.fieldLabel, styles.fieldGap]}>
              {t('passive.personalProgress')}
            </Text>
            <HitherText typeRole="body" style={styles.secondary}>{t(progressKey)}</HitherText>
            {model.personalProgress != null ? (
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.round(model.personalProgress * 100)}%`,
                      backgroundColor: accent,
                    },
                  ]}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.actionBtn, styles.actionPrimary, { backgroundColor: accent }]}
          onPress={handleExternalNav}
          accessibilityRole="button"
          accessibilityLabel={t('map.openExternalNavigation')}
          testID="passive-external-nav"
        >
          <Ionicons name="map" size={24} color="#111" />
          <HitherText typeRole="callout" style={styles.actionPrimaryLabel}>{t('passive.externalNav')}</HitherText>
        </Pressable>
      </View>

      <HitherText typeRole="callout" style={[styles.fieldLabel, styles.quickLabel]}>{t('passive.quickCommands')}</HitherText>
      <View style={styles.quickRow}>
        {quickTypes.map((type) => (
          <Pressable
            key={type}
            style={[styles.quickChip, busyType === type && { opacity: 0.5 }]}
            onPress={() => void handleCommand(type)}
            disabled={!groupId || busyType != null}
            accessibilityRole="button"
            accessibilityLabel={t(`command.${type}` as const)}
            testID={`passive-cmd-${type}`}
          >
            <Ionicons
              name={commandIcon(type)}
              size={24}
              color={busyType === type || !groupId ? COMMAND_DISABLED_COLOR : accent}
              accessibilityElementsHidden
            />
            <HitherText typeRole="callout" style={styles.quickChipLabel} numberOfLines={2}>
              {t(`command.${type}` as const)}
            </HitherText>
          </Pressable>
        ))}
      </View>

      <HitherText typeRole="caption" style={styles.footnote}>{t('passive.noAutoConsent')}</HitherText>
    </View>
  );
});

/* Styles are generated by makePassiveStyles so Dynamic Type also scales hit targets. */
