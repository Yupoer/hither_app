import OverlaySheet from '../../../components/OverlaySheet';
import { glass } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import { type VisitedWaypoint } from '../../../types';
import { type HistoryDayGroup } from '../../../utils/history';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import type { MapStyles } from '../styles';
import type { User } from '../../../types';

export interface HistorySheetProps {
  accent: string;
  handleDeleteHistory: (item: VisitedWaypoint) => void;
  historyGroups: HistoryDayGroup[];
  isLeader: boolean;
  overlay: "route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null;
  setOverlay: React.Dispatch<React.SetStateAction<"route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null>>;
  styles: MapStyles;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  user: User | null;
}

export function HistorySheet({
  accent,
  handleDeleteHistory,
  historyGroups,
  isLeader,
  overlay,
  setOverlay,
  styles,
  t,
  user,
}: HistorySheetProps) {
  return (
    <OverlaySheet
      visible={overlay === 'history'}
      onClose={() => setOverlay(null)}
      title={t('history.title')}
      accent={accent}
      doneLabel={t('map.done')}
      material="mapSheet"
      edgeToEdge
    >
      <ScrollView contentContainerStyle={styles.overlayBody}>
        {historyGroups.length === 0 ? (
          <Text style={styles.overlayHint}>{t('history.empty')}</Text>
        ) : (
          historyGroups.map((group) => {
            const [y, m, dNum] = group.day.split('-').map(Number);
            const dayLabel = group.day === 'unknown'
              ? t('history.timeUnknown')
              : new Date(y, m - 1, dNum).toLocaleDateString();
            return (
              <View key={group.day} style={styles.historyDayBlock}>
                <Text style={styles.sectionLabel}>{dayLabel}</Text>
                <View style={styles.list}>
                  {group.items.map((item, i) => {
                    const status = item.status ?? 'arrived';
                    const statusLabel =
                      status === 'missed'
                        ? t('history.statusMissed')
                        : status === 'incomplete'
                          ? t('history.statusIncomplete')
                          : null;
                    return (
                    <View
                      key={item.id}
                      style={[
                        styles.flockRow,
                        i === group.items.length - 1 && styles.flockRowLast,
                      ]}
                    >
                      <View style={styles.flockRowMain}>
                        <View style={styles.grow}>
                          <Text style={styles.flockName}>{item.name}</Text>
                          {item.userName ? (
                            <Text style={styles.overlayHint}>{item.userName}</Text>
                          ) : null}
                        </View>
                        {item.pendingSync ? <Text style={styles.historyTime}>{t('history.pendingSync')}</Text> : statusLabel ? (
                          <Text style={[styles.historyTime, { color: glass.textTertiary }]}>
                            {statusLabel}
                          </Text>
                        ) : item.timeUnknown || !item.arrivedAt ? (
                          <Text style={styles.historyTime}>{t('history.timeUnknown')}</Text>
                        ) : (
                          <Text style={styles.historyTime}>
                            {new Date(item.arrivedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </Text>
                        )}
                        {!item.synthetic && !item.pendingSync && (item.userId === user?.id || isLeader) ? (
                          <Pressable
                            style={styles.cmdSquare}
                            onPress={() => handleDeleteHistory(item)}
                            testID={`history-delete-${item.id}`}
                            accessibilityRole="button"
                            accessibilityLabel={t('common.delete')}
                          >
                            <Ionicons name="trash-outline" size={18} color={glass.danger} />
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                    );
                  })}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </OverlaySheet>
  );
}
