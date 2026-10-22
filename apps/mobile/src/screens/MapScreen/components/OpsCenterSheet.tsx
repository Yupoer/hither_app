import OverlaySheet from '../../../components/OverlaySheet';
import { accentMix } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import { CoordinationRequestsPanel } from './CoordinationRequestsPanel';
import React from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import type { MapStyles } from '../styles';
import type { UseCoordinationRequestsResult } from '../hooks/useCoordinationRequests';
import type { ExceptionAction, OrganizerExceptionItem } from '../../../utils/organizerExceptions';

export interface OpsCenterSheetProps {
  accent: string;
  coordination: UseCoordinationRequestsResult;
  exceptionPendingKeys: ReadonlySet<string>;
  isLeader: boolean;
  markExceptionHandled: (rootCauseKey: string, action: ExceptionAction) => Promise<boolean>;
  organizerExceptions: OrganizerExceptionItem[];
  overlay: "route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null;
  setOverlay: React.Dispatch<React.SetStateAction<"route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null>>;
  styles: MapStyles;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function OpsCenterSheet({
  accent,
  coordination,
  exceptionPendingKeys,
  isLeader,
  markExceptionHandled,
  organizerExceptions,
  overlay,
  setOverlay,
  styles,
  t,
}: OpsCenterSheetProps) {
  return (
    <OverlaySheet
      visible={overlay === 'ops'}
      onClose={() => setOverlay(null)}
      title={t('map.opsCenter')}
      accent={accent}
      doneLabel={t('map.done')}
      material="mapSheet"
      edgeToEdge
    >
      <ScrollView contentContainerStyle={styles.overlayBody}>
        <Text style={[styles.sheetHeading, styles.sheetHeadingFirst]}>
          {t('exception.centerTitle')}
        </Text>
        {organizerExceptions.length === 0 ? (
          <Text style={styles.overlayHint}>{t('exception.centerEmpty')}</Text>
        ) : (
          organizerExceptions.map((item) => {
            const typeKey = `exception.type.${item.type}` as TranslationKey;
            const statusKey = `exception.status.${item.status}` as TranslationKey;
            const typeLabel = t(typeKey);
            const statusLabel = t(statusKey);
            const lastSeenLabel = (() => {
              const ms = Date.parse(item.lastSeenAt);
              if (!Number.isFinite(ms)) return item.lastSeenAt;
              return new Date(ms).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
            })();
            const busy = exceptionPendingKeys.has(item.rootCauseKey);
            const muted = item.status === 'resolved';
            return (
              <View
                key={item.id}
                style={[styles.listGroup, muted && { opacity: 0.55 }]}
              >
                <View style={styles.listRow}>
                  <View style={styles.grow}>
                    <Text style={styles.listRowTitle} numberOfLines={1}>
                      {item.memberName} · {typeLabel}
                    </Text>
                    <Text style={styles.overlayHint} numberOfLines={3}>
                      {item.gatheringPointTitle
                        ? `${t('exception.gathering', { title: item.gatheringPointTitle })} · `
                        : ''}
                      {statusLabel}
                      {` · ${t('exception.lastSeen', { time: lastSeenLabel })}`}
                    </Text>
                  </View>
                </View>
                <View style={[styles.splitActions, { paddingHorizontal: 12, paddingBottom: 10 }]}>
                  {item.availableActions.includes('acknowledge') ? (
                    <Pressable
                      style={[
                        styles.chip,
                        { backgroundColor: accentMix(accent, 24), borderColor: accentMix(accent, 50) },
                        busy && { opacity: 0.5 },
                      ]}
                      onPress={() => {
                        if (busy) return;
                        void markExceptionHandled(item.rootCauseKey, 'acknowledge');
                      }}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.memberName}, ${typeLabel}, ${t('exception.acknowledge')}`}
                      accessibilityState={{ disabled: busy }}
                    >
                      <Text style={styles.chipText}>{t('exception.acknowledge')}</Text>
                    </Pressable>
                  ) : null}
                  {item.availableActions.includes('resolve') ? (
                    <Pressable
                      style={[
                        styles.chip,
                        { backgroundColor: accentMix(accent, 24), borderColor: accentMix(accent, 50) },
                        busy && { opacity: 0.5 },
                      ]}
                      onPress={() => {
                        if (busy) return;
                        void markExceptionHandled(item.rootCauseKey, 'resolve');
                      }}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.memberName}, ${typeLabel}, ${t('exception.resolve')}`}
                      accessibilityState={{ disabled: busy }}
                    >
                      <Text style={styles.chipText}>{t('exception.resolve')}</Text>
                    </Pressable>
                  ) : null}
                  {item.availableActions.includes('reopen') ? (
                    <Pressable
                      style={[styles.chipGhost, busy && { opacity: 0.5 }]}
                      onPress={() => {
                        if (busy) return;
                        void markExceptionHandled(item.rootCauseKey, 'reopen');
                      }}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.memberName}, ${typeLabel}, ${t('exception.reopen')}`}
                      accessibilityState={{ disabled: busy }}
                    >
                      <Text style={styles.chipText}>{t('exception.reopen')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
    
        <Text style={styles.sheetHeading}>{t('coordination.title')}</Text>
        <CoordinationRequestsPanel
          accent={accent}
          isLeader={!!isLeader}
          styles={styles}
          coordination={coordination}
        />
      </ScrollView>
    </OverlaySheet>
  );
}
