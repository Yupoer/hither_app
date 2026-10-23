import { accentMix, glass } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import { type Destination, type MemberLocation } from '../../../types';
import { gatherRequestPageIndex } from '../../../utils/gatherRequestInbox';
import { lightTap } from '../../../utils/haptics';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import type { MapStyles } from '../styles';
import type { GatherPointRequest, Subgroup } from '../../../types';

export interface RoutePaneProps {
  accent: string;
  canEditItinerary: boolean;
  destinations: Destination[];
  extraPointCredits: number;
  gatherRequestPagerRef: React.RefObject<ScrollView | null>;
  gatherRequestPageW: number;
  handleGatherPointRequest: (requestId: string, approve: boolean) => Promise<void>;
  isLeader: boolean;
  isMySubgroupLeader: boolean;
  members: MemberLocation[];
  myScopeId: string | undefined;
  nextStopDistLabel: string | null;
  nextStopTitle: string | undefined;
  openHistoryOverlay: () => void;
  opsOpenCount: number;
  renderRouteScope: (args: { scopeKey: "main" | "subgroup"; title: string; destinations: Destination[]; canEdit: boolean; scopeId?: string; }) => React.JSX.Element;
  resolvingGatherRequestId: string | null;
  routeMainDestinations: Destination[];
  routeSubgroupDestinations: Destination[];
  selectedGatherRequestId: string | null;
  setOverlay: React.Dispatch<React.SetStateAction<"route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null>>;
  setSelectedGatherRequestId: React.Dispatch<React.SetStateAction<string | null>>;
  sortedGatherRequestIds: string[];
  sortedGatherRequests: GatherPointRequest[];
  styles: MapStyles;
  subgroups: Subgroup[];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function RoutePane({
  accent,
  canEditItinerary,
  destinations,
  extraPointCredits,
  gatherRequestPageW,
  gatherRequestPagerRef,
  handleGatherPointRequest,
  isLeader,
  isMySubgroupLeader,
  members,
  myScopeId,
  nextStopDistLabel,
  nextStopTitle,
  openHistoryOverlay,
  opsOpenCount,
  renderRouteScope,
  resolvingGatherRequestId,
  routeMainDestinations,
  routeSubgroupDestinations,
  selectedGatherRequestId,
  setOverlay,
  setSelectedGatherRequestId,
  sortedGatherRequestIds,
  sortedGatherRequests,
  styles,
  subgroups,
  t,
}: RoutePaneProps) {
  return (
    <>
      {/* #173: leader pending gather requests — FIFO horizontal cards at Route top. */}
      {canEditItinerary && sortedGatherRequests.length > 0 ? (
        <View testID="route-gather-request-inbox" style={{ marginBottom: 12 }}>
          <Text style={[styles.sheetHeading, styles.sheetHeadingFirst]}>
            {t('gatherRequest.pending')}
          </Text>
          <ScrollView
            ref={gatherRequestPagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            style={{ marginHorizontal: -4 }}
            onMomentumScrollEnd={(e) => {
              const page = Math.round(
                e.nativeEvent.contentOffset.x / Math.max(1, gatherRequestPageW),
              );
              const id = sortedGatherRequestIds[page];
              if (id) setSelectedGatherRequestId(id);
            }}
            onLayout={() => {
              const page = gatherRequestPageIndex(
                sortedGatherRequestIds,
                selectedGatherRequestId,
              );
              gatherRequestPagerRef.current?.scrollTo({
                x: page * gatherRequestPageW,
                animated: false,
              });
            }}
          >
            {sortedGatherRequests.map((request) => (
              <View
                key={request.id}
                style={{
                  width: gatherRequestPageW,
                  paddingHorizontal: 4,
                }}
              >
                <View style={[styles.tripSummaryCard, { marginBottom: 0 }]}>
                  <Text style={styles.tripCardKicker} numberOfLines={1}>
                    {members.find((member) => member.userId === request.requesterId)?.name
                      ?? t('map.memberFallback')}
                  </Text>
                  <Text style={styles.tripCardTitle} numberOfLines={2}>
                    {request.items.map((item) => item.title).join('、')}
                  </Text>
                  <Text style={styles.tripCardMeta} numberOfLines={1}>
                    {t('gatherRequest.target', {
                      team: request.subgroupId
                        ? subgroups.find((item) => item.id === request.subgroupId)?.name
                          ?? t('gatherRequest.unknownTeam')
                        : t('gatherRequest.mainTeam'),
                    })}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <Pressable
                      style={[
                        styles.chip,
                        { flex: 1, minHeight: 44 },
                        resolvingGatherRequestId === request.id ? { opacity: 0.5 } : null,
                      ]}
                      onPress={() => void handleGatherPointRequest(request.id, false)}
                      disabled={!!resolvingGatherRequestId}
                      accessibilityRole="button"
                      accessibilityLabel={t('gatherRequest.reject')}
                      testID={`gather-request-reject-${request.id}`}
                    >
                      <Text style={styles.chipText}>{t('gatherRequest.reject')}</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.chip,
                        {
                          flex: 1,
                          minHeight: 44,
                          backgroundColor: accentMix(accent, 24),
                        },
                        resolvingGatherRequestId === request.id ? { opacity: 0.5 } : null,
                      ]}
                      onPress={() => void handleGatherPointRequest(request.id, true)}
                      disabled={!!resolvingGatherRequestId}
                      accessibilityRole="button"
                      accessibilityLabel={t('gatherRequest.approve')}
                      testID={`gather-request-approve-${request.id}`}
                    >
                      <Text style={styles.chipText}>{t('gatherRequest.approve')}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
          {sortedGatherRequests.length > 1 ? (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
                marginTop: 8,
              }}
              accessibilityRole="adjustable"
            >
              {sortedGatherRequestIds.map((id) => (
                <View
                  key={id}
                  style={{
                    width: id === selectedGatherRequestId ? 14 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor:
                      id === selectedGatherRequestId ? accent : glass.textTertiary,
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <Text
        style={[
          styles.sheetHeading,
          !(canEditItinerary && sortedGatherRequests.length > 0) && styles.sheetHeadingFirst,
        ]}
      >
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
      {/* 下一站 — 唯一完整卡片；底部只顯示距離 */}
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
      {/* 導航入口 = 普通 List Row，無圖示色塊 */}
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
          style={styles.listRow}
          onPress={() => { lightTap(); setOverlay('ops'); }}
          accessibilityRole="button"
          accessibilityLabel={t('map.opsCenter')}
          testID="map-open-ops"
        >
          <Text style={styles.listRowTitle}>{t('map.opsCenter')}</Text>
          {opsOpenCount > 0 ? (
            <Text style={[styles.listRowTrailing, { color: glass.warn }]}>
              {t('map.opsOpenCount', { count: opsOpenCount })}
            </Text>
          ) : null}
          <Ionicons name="chevron-forward" size={16} color={glass.textTertiary} />
        </Pressable>
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
