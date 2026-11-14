import { glass } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import { type Destination } from '../../../types';
import { lightTap } from '../../../utils/haptics';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../../../components/AppText';
import Pressable from '../../../components/MotionPressable';
import type { MapStyles } from '../styles';
import type { Subgroup } from '../../../types';

export interface RoutePaneProps {
  canEditItinerary: boolean;
  destinations: Destination[];
  extraPointCredits: number;
  isLeader: boolean;
  isMySubgroupLeader: boolean;
  myScopeId: string | undefined;
  nextStopDistLabel: string | null;
  nextStopTitle: string | undefined;
  openHistoryOverlay: () => void;
  renderRouteScope: (args: { scopeKey: "main" | "subgroup"; title: string; destinations: Destination[]; canEdit: boolean; scopeId?: string; }) => React.JSX.Element;
  routeMainDestinations: Destination[];
  routeSubgroupDestinations: Destination[];
  setOverlay: React.Dispatch<React.SetStateAction<"route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "coordination" | null>>;
  styles: MapStyles;
  subgroups: Subgroup[];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function RoutePane({
  canEditItinerary,
  destinations,
  extraPointCredits,
  isLeader,
  isMySubgroupLeader,
  myScopeId,
  nextStopDistLabel,
  nextStopTitle,
  openHistoryOverlay,
  renderRouteScope,
  routeMainDestinations,
  routeSubgroupDestinations,
  setOverlay,
  styles,
  subgroups,
  t,
}: RoutePaneProps) {
  return (
    <>
      <Text style={[styles.sheetHeading, styles.sheetHeadingFirst]}>
        {t('map.gatheringPoints')}
      </Text>
      {extraPointCredits > 0 ? (
        <Text
          style={styles.extraCreditsHint}
          testID="route-extra-point-credits"
          accessibilityRole="text"
          accessibilityLabel={t('store.extraCreditsRemaining', { count: extraPointCredits })}
        >
          {t('store.extraCreditsRemaining', { count: extraPointCredits })}
        </Text>
      ) : null}
      {nextStopTitle ? (
        <View style={styles.tripSummaryCard}>
          <Text style={styles.tripCardKicker}>{t('map.nextTag')}</Text>
          <Text style={styles.tripCardTitle} numberOfLines={2}>{nextStopTitle}</Text>
          {nextStopDistLabel ? (
            <Text style={styles.tripCardMeta}>{nextStopDistLabel}</Text>
          ) : null}
        </View>
      ) : null}
      {renderRouteScope({
        scopeKey: 'main',
        title: t('map.mainTeamLabel'),
        destinations: routeMainDestinations,
        canEdit: isLeader,
      })}
      {myScopeId
        ? renderRouteScope({
            scopeKey: 'subgroup',
            title: subgroups.find((subgroup) => subgroup.id === myScopeId)?.name
              ?? t('map.subgroupLabel'),
            destinations: routeSubgroupDestinations,
            canEdit: isMySubgroupLeader,
            scopeId: myScopeId,
          })
        : null}
      <View style={styles.listGroup}>
        {canEditItinerary && destinations.length > 0 ? (
          <Pressable
            style={styles.listRow}
            onPress={() => { lightTap(); setOverlay('arrivalManage'); }}
            accessibilityRole="button"
            accessibilityLabel={t('arrival.manage')}
            testID="map-arrival-manage"
          >
            <Text style={styles.listRowTitle}>{t('arrival.manage')}</Text>
            <Ionicons name="chevron-forward" size={16} color={glass.textTertiary} />
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.listRow, styles.listRowLast]}
          onPress={() => { lightTap(); openHistoryOverlay(); }}
          testID="map-history"
          accessibilityRole="button"
        >
          <Text style={styles.listRowTitle}>{t('history.title')}</Text>
          <Ionicons name="chevron-forward" size={16} color={glass.textTertiary} />
        </Pressable>
      </View>
    </>
  );
}
