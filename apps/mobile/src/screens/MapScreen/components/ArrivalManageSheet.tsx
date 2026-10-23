import OverlaySheet from '../../../components/OverlaySheet';
import { glass } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import { type Destination, type MemberLocation } from '../../../types';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import type { MapStyles } from '../styles';
import type { DestinationArrival } from '../../../types';

export interface ArrivalManageSheetProps {
  accent: string;
  allScopedDestinations: Destination[];
  destinationArrivals: DestinationArrival[];
  handleArrival: (destination: Destination, targetUserId: string, arrived: boolean) => void;
  isLeader: boolean;
  members: MemberLocation[];
  overlay: "route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null;
  setOverlay: React.Dispatch<React.SetStateAction<"route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null>>;
  styles: MapStyles;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function ArrivalManageSheet({
  accent,
  allScopedDestinations,
  destinationArrivals,
  handleArrival,
  isLeader,
  members,
  overlay,
  setOverlay,
  styles,
  t,
}: ArrivalManageSheetProps) {
  return (
    <OverlaySheet
      visible={overlay === 'arrivalManage'}
      onClose={() => setOverlay(null)}
      title={t('arrival.manage')}
      accent={accent}
      doneLabel={t('map.done')}
      doneSystemImage="checkmark"
      material="mapSheet"
      edgeToEdge
    >
      <ScrollView contentContainerStyle={styles.overlayBody}>
        {allScopedDestinations.length === 0 ? (
          <Text style={styles.overlayHint}>{t('settings.noDestinations')}</Text>
        ) : (
          allScopedDestinations.map((destination) => {
            const scopedMembers = members.filter(
              (member) => member.subgroupId === destination.subgroupId,
            );
            const canCorrectHistory = isLeader
              && destination.subgroupId == null
              && destination.closedAt != null;
            const arrivedCount = destinationArrivals.filter(
              (entry) => entry.destinationId === destination.id,
            ).length;
            return (
              <View key={`arrival-manage-${destination.id}`} style={styles.listGroup}>
                <View style={styles.listRow}>
                  <Text style={[styles.listRowTitle, styles.grow]} numberOfLines={2}>
                    {destination.title}
                  </Text>
                  <Text style={styles.listRowTrailing}>
                    {arrivedCount}/{scopedMembers.length}
                  </Text>
                </View>
                {scopedMembers.map((member, index) => {
                  const arrived = destinationArrivals.some(
                    (entry) =>
                      entry.destinationId === destination.id && entry.userId === member.userId,
                  );
                  const memberStateKey = arrived
                    ? 'memberStatus.arrived'
                    : destination.closedAt
                      ? 'memberStatus.missed'
                      : 'memberStatus.pending';
                  return (
                    <View
                      key={`${destination.id}-${member.userId}`}
                      style={[
                        styles.flockRow,
                        styles.arrivalMemberRow,
                        index === scopedMembers.length - 1 && styles.flockRowLast,
                      ]}
                    >
                      <View style={styles.grow}>
                        <Text style={styles.flockName} numberOfLines={1}>{member.name}</Text>
                        <Text style={styles.overlayHint}>{t(memberStateKey)}</Text>
                      </View>
                      {canCorrectHistory ? (
                        <Pressable
                          style={styles.arrivalToggleBtn}
                          onPress={() => handleArrival(destination, member.userId, !arrived)}
                          testID={`history-arrival-${destination.id}-${member.userId}`}
                          accessibilityRole="button"
                          accessibilityLabel={t(arrived ? 'arrival.undo' : 'arrival.mark')}
                          accessibilityState={{ checked: arrived }}
                        >
                          <Ionicons
                            name={arrived ? 'checkmark-circle' : 'checkmark-circle-outline'}
                            size={36}
                            color={arrived ? glass.ok : glass.textTertiary}
                          />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            );
          })
        )}
      </ScrollView>
    </OverlaySheet>
  );
}
