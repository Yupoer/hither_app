import React, { useCallback, useState } from 'react';
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
        <Text style={styles.kicker} accessibilityRole="header">
          {t('passive.title')}
        </Text>
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
          <Text style={styles.switchBackLabel}>
            {t('passive.switchBack')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        {model.contentStatus === 'loading' ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={accent} />
            <Text style={styles.secondary}>{t('passive.loading')}</Text>
          </View>
        ) : null}

        {/* Exclusive error only when there is no cached companion content. */}
        {model.contentStatus === 'error' ? (
          <View style={styles.centerBlock}>
            <Ionicons name="warning-outline" size={28} color={glass.danger} />
            <Text style={styles.primary}>
              {model.errorMessage?.trim() || t('passive.error')}
            </Text>
          </View>
        ) : null}

        {model.contentStatus === 'empty' ? (
          <View style={styles.centerBlock}>
            <Text style={styles.primary}>{t('passive.empty')}</Text>
            <Text style={styles.secondary}>{t('passive.emptyHint')}</Text>
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
                <Ionicons name="warning-outline" size={16} color={glass.danger} />
                <Text style={styles.errorBannerText} numberOfLines={3}>
                  {model.errorMessage.trim() || t('passive.error')}
                </Text>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>{t('passive.currentPoint')}</Text>
            <Text style={styles.pointTitle} numberOfLines={3}>
              {model.currentPoint?.title ?? t('passive.noCurrentPoint')}
            </Text>

            <View style={[styles.phasePill, { backgroundColor: accent + '33' }]}>
              <View style={[styles.phaseDot, { backgroundColor: accent }]} />
              <Text style={[styles.phaseText, { color: accent }]}>
                {t(phaseKey)}
              </Text>
            </View>

            <Text style={[styles.fieldLabel, styles.fieldGap]}>
              {t('passive.nextPoint')}
            </Text>
            <Text style={styles.secondary} numberOfLines={2}>
              {model.nextPoint?.title ?? t('passive.noNextPoint')}
            </Text>

            <Text style={[styles.fieldLabel, styles.fieldGap]}>
              {t('passive.personalProgress')}
            </Text>
            <Text style={styles.secondary}>{t(progressKey)}</Text>
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
          <Ionicons name="map" size={20} color="#111" />
          <Text style={styles.actionPrimaryLabel}>{t('passive.externalNav')}</Text>
        </Pressable>
      </View>

      <Text style={[styles.fieldLabel, styles.quickLabel]}>{t('passive.quickCommands')}</Text>
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
            <Text style={styles.quickChipLabel} numberOfLines={1}>
              {t(`command.${type}` as const)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.footnote}>{t('passive.noAutoConsent')}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(12, 14, 18, 0.92)',
    paddingHorizontal: 20,
    zIndex: 40,
    justifyContent: 'flex-start',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  kicker: {
    color: glass.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  switchBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  switchBackLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
  },
  card: {
    backgroundColor: glass.card,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairlineSoft,
    padding: 18,
    minHeight: 200,
  },
  centerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 28,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 107, 107, 0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 107, 107, 0.35)',
  },
  errorBannerText: {
    flex: 1,
    color: glass.danger,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  fieldLabel: {
    color: glass.textTertiary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  fieldGap: {
    marginTop: 16,
  },
  pointTitle: {
    color: glass.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 12,
  },
  primary: {
    color: glass.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  secondary: {
    color: glass.textSecondary,
    fontSize: 16,
    marginTop: 4,
  },
  phasePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  phaseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  phaseText: {
    fontSize: 14,
    fontWeight: '700',
  },
  progressTrack: {
    marginTop: 10,
    height: 6,
    borderRadius: 3,
    backgroundColor: glass.fillStrong,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  actionPrimary: {
    // backgroundColor set inline from accent
  },
  actionPrimaryLabel: {
    color: '#111',
    fontSize: 15,
    fontWeight: '700',
  },
  quickLabel: {
    marginTop: 18,
    marginBottom: 8,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: glass.fillStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
  },
  quickChipLabel: {
    color: glass.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  footnote: {
    marginTop: 14,
    color: glass.textTertiary,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
});
