import OverlaySheet from '../../../components/OverlaySheet';
import { glass } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import { type Destination, type MemberLocation } from '../../../types';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, View, Text, Pressable } from 'react-native';
import type { MapStyles } from '../styles';
import type { DestinationArrival } from '../../../types';

export interface ArrivalTimeSheetProps {
  accent: string;
  activeDestinationArrivals: DestinationArrival[];
  arrivalDestination: Destination | null;
  handleArrival: (destination: Destination, targetUserId: string, arrived: boolean) => void;
  isLeader: boolean;
  members: MemberLocation[];
  overlay: "route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null;
  setArrivalDestination: React.Dispatch<React.SetStateAction<Destination | null>>;
  setOverlay: React.Dispatch<React.SetStateAction<"route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null>>;
  styles: MapStyles;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function ArrivalTimeSheet({
  accent,
  activeDestinationArrivals,
  arrivalDestination,
  handleArrival,
  isLeader,
  members,
  overlay,
  setArrivalDestination,
  setOverlay,
  styles,
  t,
}: ArrivalTimeSheetProps) {
  return (
    <OverlaySheet
      visible={overlay === 'arrival'}
      onClose={() => {
        setArrivalDestination(null);
        setOverlay(null);
      }}
      title={arrivalDestination?.title ?? t('map.arrivalProgress')}
      accent={accent}
      doneLabel={t('map.done')}
      doneSystemImage="checkmark"
      material="mapSheet"
      edgeToEdge
    >
      <ScrollView contentContainerStyle={styles.overlayBody}>
        {arrivalDestination ? members
          .filter((member) => member.subgroupId === arrivalDestination.subgroupId)
          .map((member) => {
            const arrived = activeDestinationArrivals.some(
              (entry) => entry.destinationId === arrivalDestination.id && entry.userId === member.userId,
            );
            const memberStateKey = arrived
              ? 'memberStatus.arrived'
              : arrivalDestination.closedAt
                ? 'memberStatus.missed'
                : 'memberStatus.pending';
            return (
              <View key={member.userId} style={[styles.flockRow, styles.arrivalMemberRow]}>
                <View style={styles.grow}>
                  <Text style={styles.flockName} numberOfLines={1}>{member.name}</Text>
                  <Text style={styles.overlayHint}>{t(memberStateKey)}</Text>
                </View>
                {isLeader && arrivalDestination.subgroupId == null && arrivalDestination.closedAt != null ? (
                  <Pressable
                    style={styles.arrivalToggleBtn}
                    onPress={() => handleArrival(arrivalDestination, member.userId, !arrived)}
                    testID={`history-arrival-${arrivalDestination.id}-${member.userId}`}
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
          }) : null}
      </ScrollView>
    </OverlaySheet>
  );
}
