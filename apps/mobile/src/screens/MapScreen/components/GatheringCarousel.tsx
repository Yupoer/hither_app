import MetalforgeStarfield from '../../../components/MetalforgeStarfield';
import OverflowMarquee from '../../../components/OverflowMarquee';
import SwiftUIGlassSurface from '../../../components/SwiftUIGlassSurface';
import { type TourTargetId } from '../../../featureTour';
import { glass } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import { DEFAULT_MEET_RED_MIN } from '../../../state/PreferencesContext';
import { type Coordinates, type Destination, type MemberLocation } from '../../../types';
import { logEvent } from '../../../utils/activityLog';
import { type ArrivalCardExitRecord } from '../../../utils/arrivalCardExit';
import { canMarkDestinationArrival } from '../../../utils/arrivalMarking';
import { deriveCardNavFlags, deriveScopedArrivalCounts, arrivalControlJustSplit, resolveNavCommand } from '../../../utils/gatherCommand';
import { ARRIVED_FADE_MS, ARRIVED_SPLIT_MS } from '../../../utils/gatherCommandLayout';
import { distanceMeters, etaSecondsFor, formatDistance, type TravelMode } from '../../../utils/geo';
import { mediumTap, lightTap } from '../../../utils/haptics';
import { shortEta, splitDistanceParts, splitEtaParts, navCommandDisplayLabel, formatTripDayLine } from '../../../utils/mapFormatters';
import { minutesUntil } from '../../../utils/meetTime';
import { ArrivalCardExitShell } from './ArrivalCardExitShell';
import { CarouselDots } from './CarouselDots';
import { GatheringCardPressable } from './GatheringCardPressable';
import { MeetTimeChip } from './MeetTimeChip';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, View, Platform, StyleSheet, Text, Pressable, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut, FadeInRight, FadeOutRight } from 'react-native-reanimated';
import type { MapStyles } from '../styles';
import type { DestinationArrival, User } from '../../../types';
import type { AppStateStatus } from 'react-native';
import type { Palette } from '../../../theme';
import type { FontScaleBucket } from '../../../theme/typeScale';
import type { EdgeInsets } from 'react-native-safe-area-context';
import type { RuntimePowerState } from '../../../state/runtimePowerState';
import type { DirectionsResult } from '../../../native';

// Cap on gathering-point pagination dots shown at once (see utils/pagination.ts).
const DOTS_MAX_VISIBLE = 5;

export interface GatheringCarouselProps {
  accent: string;
  activeDestinationArrivals: DestinationArrival[];
  activePoint: Destination | undefined;
  appState: AppStateStatus;
  arrivalCelebrateDestId: string | null;
  arrivalExitRecords: Map<string, ArrivalCardExitRecord>;
  arrivalSplitSeenRef: React.RefObject<Set<string>>;
  atFull: boolean;
  canEditItinerary: boolean;
  carouselMaxHeight: number;
  carouselRef: React.RefObject<ScrollView | null>;
  colors: Palette;
  destinationIds: string[];
  destinations: Destination[];
  fontBucket: FontScaleBucket;
  fromCoords: Coordinates | undefined;
  gatherCardMarqueeSpeed: number;
  gatherCardRadius: number;
  gatherCardTitleMarquee: boolean;
  handleArrival: (destination: Destination, targetUserId: string, arrived: boolean) => void;
  handleMomentumEnd: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  handleScrollBeginDrag: () => void;
  handleSelfArrival: (destination: Destination, targetUserId: string) => void;
  insets: EdgeInsets;
  isCardExpanded: (id: string) => boolean;
  isLeader: boolean;
  journeyActive: boolean;
  journeyBusy: boolean;
  localActionError: { title: string; message: string; destinationId?: string; } | null;
  mapFocused: boolean;
  meetRedMin: number;
  members: MemberLocation[];
  myCompletedDestinationIds: Set<string>;
  myScopeId: string | undefined;
  narrowScreen: boolean;
  navTarget: Destination | undefined;
  navTargetId: string | null;
  openExternalNavigation: (dest: Destination) => void;
  openMeetTimePicker: (dest: Destination) => void;
  pendingLeaderTargetId: string | null;
  personalDistanceM: number | null;
  personalEtaSeconds: number | null;
  powerState: RuntimePowerState;
  promptCompleteAfterArrival: (destination: Destination, opts?: { includeSelf?: boolean; }) => void;
  registerCardActivity: (id: string) => void;
  requestingStartDestId: string | null;
  requestLeaderStart: (destination: Destination) => void;
  requestTeamEnd: (dest: Destination, index: number) => Promise<boolean>;
  routeDepartureDate: string | undefined;
  selectedIndex: number;
  selfRoute: DirectionsResult | null;
  sessionEligibleMembers: MemberLocation[];
  setArrivalDestination: React.Dispatch<React.SetStateAction<Destination | null>>;
  setCarouselHeight: React.Dispatch<React.SetStateAction<number>>;
  setOverlay: React.Dispatch<React.SetStateAction<"route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null>>;
  setTourTargetRef: (id: TourTargetId, node: View | null) => void;
  setTravelMode: (mode: TravelMode) => void;
  sharedTargetId: string | null;
  showDenseChrome: boolean;
  startNavigation: (dest: Destination, index: number) => Promise<void>;
  styles: MapStyles;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  toggleGatheringCard: (id: string) => void;
  tourReduceMotion: boolean;
  travelMode: TravelMode;
  uiVisible: boolean;
  user: User | null;
  windowWidth: number;
}

export function GatheringCarousel({
  accent,
  activeDestinationArrivals,
  activePoint,
  appState,
  arrivalCelebrateDestId,
  arrivalExitRecords,
  arrivalSplitSeenRef,
  atFull,
  canEditItinerary,
  carouselMaxHeight,
  carouselRef,
  colors,
  destinationIds,
  destinations,
  fontBucket,
  fromCoords,
  gatherCardMarqueeSpeed,
  gatherCardRadius,
  gatherCardTitleMarquee,
  handleArrival,
  handleMomentumEnd,
  handleScrollBeginDrag,
  handleSelfArrival,
  insets,
  isCardExpanded,
  isLeader,
  journeyActive,
  journeyBusy,
  localActionError,
  mapFocused,
  meetRedMin,
  members,
  myCompletedDestinationIds,
  myScopeId,
  narrowScreen,
  navTarget,
  navTargetId,
  openExternalNavigation,
  openMeetTimePicker,
  pendingLeaderTargetId,
  personalDistanceM,
  personalEtaSeconds,
  powerState,
  promptCompleteAfterArrival,
  registerCardActivity,
  requestLeaderStart,
  requestTeamEnd,
  requestingStartDestId,
  routeDepartureDate,
  selectedIndex,
  selfRoute,
  sessionEligibleMembers,
  setArrivalDestination,
  setCarouselHeight,
  setOverlay,
  setTourTargetRef,
  setTravelMode,
  sharedTargetId,
  showDenseChrome,
  startNavigation,
  styles,
  t,
  toggleGatheringCard,
  tourReduceMotion,
  travelMode,
  uiVisible,
  user,
  windowWidth,
}: GatheringCarouselProps) {
  return (
    <>{uiVisible && showDenseChrome && destinations.length > 0 && !atFull && (
      <Animated.View
        // a11y-layout:carouselCapsuleClearance
        style={[
          styles.carouselWrap,
          { top: insets.top + 8, maxHeight: carouselMaxHeight },
        ]}
        pointerEvents={atFull ? 'none' : 'box-none'}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0) setCarouselHeight(h);
        }}
      >
        <ScrollView
          ref={carouselRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={handleScrollBeginDrag}
          onMomentumScrollEnd={handleMomentumEnd}
            testID="map-carousel"
          scrollEventThrottle={16}
        >
          {destinations.map((dest, index) => {
            const active = index === selectedIndex;
            const routeForDestination = activePoint?.id === dest.id ? selfRoute : null;
            // Active nav target: shared personal progress (local GPS, no backend wait).
            // Other cards: one-shot straight/route distance from last known fix.
            const d = (navTarget?.id === dest.id && personalDistanceM != null)
              ? personalDistanceM
              : routeForDestination?.distanceMeters
                ?? (fromCoords ? distanceMeters(fromCoords, dest.coordinates) : null);
            // Shared navigation is distinct from any member-only route preview.
            const { flockNavigatingThis } = deriveCardNavFlags({
              destId: dest.id,
              isLeader,
              sharedTargetId,
              pendingLeaderTargetId,
              journeyBusy,
            });
            // Live countdown UI is MeetCountdown (own 1s timer). a11y uses
            // a one-shot label on each parent render — no MapScreen clock.
            const meetLabel = dest.meetAt
              ? (() => {
                  const mins = minutesUntil(dest.meetAt as string, new Date());
                  if (mins >= 0) {
                    return t('meetTime.countdown', { minutes: mins });
                  }
                  const clock = new Date(dest.meetAt as string).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  });
                  // a11y: "{time} 集合"
                  return t('map.meetAtClock', { time: clock });
                })()
              : null;
            // Team arrival toward THIS stop — scoped to destination subgroup.
            const cardArrival = deriveScopedArrivalCounts({
              members: dest.id === navTargetId ? sessionEligibleMembers : members,
              destinationSubgroupId: dest.subgroupId,
              arrivedUserIds: activeDestinationArrivals
                .filter((arrival) => arrival.destinationId === dest.id)
                .map((arrival) => arrival.userId),
            });
            const arrivedHere = cardArrival.arrivedCount;
            const totalMembers = cardArrival.totalCount;
            const modeIconName =
              travelMode === 'walk'
                ? 'walk-outline'
                : travelMode === 'drive'
                  ? 'car-outline'
                  : travelMode === 'bicycle'
                    ? 'bicycle-outline'
                    : 'bus-outline';
            // Route ETA/distance — always visible; expand only scales layout.
            const etaSeconds = (navTarget?.id === dest.id && personalEtaSeconds != null)
              ? personalEtaSeconds
              : routeForDestination
                ? routeForDestination.expectedTravelTimeSeconds
                : d != null
                  ? etaSecondsFor(d, travelMode)
                  : null;
            const etaLabel = etaSeconds != null ? shortEta(etaSeconds) : '—';
            // Retain the last useful distance/ETA without a generic stale
            // warning; freshness still drives internal navigation safety.
            const distLabel = d != null ? formatDistance(d) : '';
            const distParts = splitDistanceParts(d);
            const etaParts = splitEtaParts(etaSeconds);
            const cardExpanded = isCardExpanded(dest.id);
            // Progressive density (single row always):
            // - compact: narrow phone OR large Dynamic Type → smaller squares
            // - tight: xl OR (narrow + large) → nav icon-only, smaller countdown
            // Never multi-row. Not tied to sheet stage.
            // a11y-layout:commandRowCompact
            const chromeCompact =
              narrowScreen || fontBucket === 'large' || fontBucket === 'xl';
            const chromeTight = fontBucket === 'xl' || (narrowScreen && fontBucket === 'large');
            // Use active itinerary (carousel list), not raw history-inclusive
            // scope — past-day open rows must not hide the arrive control.
            const canMarkArrival = canMarkDestinationArrival({
              destId: dest.id,
              destOrder: dest.order,
              destSubgroupId: dest.subgroupId,
              scopedDestinations: destinations,
              myArrivedDestinationIds: myCompletedDestinationIds,
    activeDestinationId: sharedTargetId,
            });
            // Product: only show 「已抵達」while this card's team nav is active.
            // Pre-start: Start occupies the arrived slot (3 controls).
            // Post-start: Arrived splits out. Post-end: Start swallows it again.
            const showArrivalControl =
              Boolean(user?.id)
              && canMarkArrival
              && !dest.closedAt
              && flockNavigatingThis;
            const arrivalJustSplit = arrivalControlJustSplit(
              dest.id,
              showArrivalControl,
              arrivalSplitSeenRef.current,
            );
            // #176: icon-only Start only when Arrived is also present under tight
            // density. When Arrived is absent, Start fills that slot (not square).
            const navIconOnly = chromeTight && showArrivalControl;
            const personallyArrived = myCompletedDestinationIds.has(dest.id);
            const navCmd = resolveNavCommand({
              isLeader,
              personallyArrived,
              flockNavigatingThis,
              isNextTeamPending: true,
              teamStartBlocked: false,
            });
            const navLabel = navCommandDisplayLabel(navCmd.kind, t);
            const startAccessibilityHint = isLeader
              ? navCmd.kind === 'leader_stop'
                ? t('nav.a11yEndHint')
                : navCmd.kind === 'leader_mark_complete'
                  ? t('nav.a11yCompleteHint')
                  : t('nav.a11yStartHint')
              : undefined;
            const commandDisabled = !isLeader && (
              journeyBusy
              || navCmd.disabled
              || Boolean(requestingStartDestId)
            );
            const exitPhase = arrivalExitRecords.get(dest.id)?.phase ?? null;
            return (
              <View
                key={`carousel-dest-${dest.id}`}
                style={{ width: windowWidth, paddingHorizontal: narrowScreen ? 10 : 14 }}
              >
                <View
                  ref={active ? (n) => setTourTargetRef('gatherCard', n) : undefined}
                  collapsable={false}
                >
                <ArrivalCardExitShell exiting={exitPhase === 'exit'}>
                <SwiftUIGlassSurface
                  shape="roundedRectangle"
                  cornerRadius={gatherCardRadius}
                  fallbackTintColor={Platform.OS === 'android'
                    ? active ? glass.cardActive : glass.card
                    : undefined}
                  style={[
                    styles.card,
                    // Active state uses fill only — no theme-color rim
                    // (Android hairline + accent reads as a harsh outline).
                    active ? styles.cardActiveBorder : null,
                  ]}
                >
                  {/* Celebrate flash only (1.6s): full-card dim + center check.
                      Must NOT key off personallyArrived or dim stays forever.
                      Siblings of padded content so absolute fill covers padding
                      + expanded command row (expanded and collapsed). */}
                  <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: gatherCardRadius, overflow: 'hidden', zIndex: 0 }]}>
                    <MetalforgeStarfield emitting={journeyActive && navTarget?.id === dest.id}
                      active={active && mapFocused && appState === 'active'} color="#FFFFFF"
                      lowPowerMode={powerState.lowPowerMode} thermalState={powerState.thermalState} />
                  </View>
                  {arrivalCelebrateDestId === dest.id ? (
                    <View pointerEvents="none" style={styles.arrivalDimOverlay} />
                  ) : null}
                  {arrivalCelebrateDestId === dest.id ? (
                    <Animated.View
                      pointerEvents="none"
                      entering={FadeIn.duration(220)}
                      exiting={FadeOut.duration(220)}
                      style={styles.arrivalCenterCheckLayer}
                    >
                      <Animated.View
                        // No springify — ease-in only, no bounce/overshoot.
                        entering={ZoomIn.duration(240)}
                        exiting={ZoomOut.duration(200)}
                        style={[
                          styles.arrivalCenterCheckBox,
                          cardExpanded
                            ? styles.arrivalCenterCheckBoxExpanded
                            : styles.arrivalCenterCheckBoxCollapsed,
                        ]}
                      >
                        <Ionicons
                          name="checkmark"
                          size={cardExpanded ? 32 : 20}
                          color="#fff"
                        />
                      </Animated.View>
                    </Animated.View>
                  ) : null}
                  <View style={[styles.cardInner, { zIndex: 1 }]}>
                  {localActionError && (!localActionError.destinationId || localActionError.destinationId === dest.id) ? (
                    <Text testID="local-arrival-write-error" accessibilityLiveRegion="polite" style={{ color: glass.danger, marginBottom: 8 }}>
                      {localActionError.title}{'：'}{localActionError.message}
                    </Text>
                  ) : null}
                  <GatheringCardPressable
                    testID={`gather-card-${dest.id}`}
                    onToggle={() => toggleGatheringCard(dest.id)}
                    accessibilityLabel={dest.title}
                    accessibilityHint={
                      cardExpanded ? t('gather.cardCollapseHint') : t('gather.cardExpandHint')
                    }
                  >
                  {/* Layout (expanded):
                      kicker · dots
                      title full-width
                      day line ····· people N/M
                      小隊行程 badge (subgroup only)
                      📍 dist | 🚗 eta | map
                      [導航] [移動] [抵達?] [交通] [集合倒數]
                     Collapsed: title marquee + compact ETA·dist only. */}
                  <View style={styles.cardHead}>
                    <View style={styles.grow}>
                      <View style={styles.cardKickerRow}>
                        <Text
                          style={[styles.cardKicker, { color: accent }]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {(() => {
                            // Counter is day-scoped: "stop N of M" among that day's stops only.
                            const dayNum = dest.day || 1;
                            let dayIndex = 0;
                            let dayTotal = 0;
                            for (const d of destinations) {
                              if ((d.day || 1) !== dayNum) continue;
                              dayTotal += 1;
                              if (d.id === dest.id) dayIndex = dayTotal;
                            }
                            return t('map.destinationCounter', {
                              index: dayIndex || 1,
                              total: dayTotal || 1,
                            });
                          })()}
                        </Text>
                        {destinations.length > 1 && (
                          <CarouselDots
                            total={destinations.length}
                            active={selectedIndex}
                            maxVisible={DOTS_MAX_VISIBLE}
                            destinationIds={destinationIds}
                            styles={styles}
                            reduceMotion={tourReduceMotion}
                          />
                        )}
                      </View>
                      {/* Collapsed / expanded swap in-tree — one shot, no Zoom / layout morph. */}
                      {cardExpanded ? (
                        <View>
                          <Text
                            style={[styles.cardTitle, styles.cardTitleExpanded]}
                            numberOfLines={3}
                            ellipsizeMode="tail"
                          >
                            {dest.title}
                          </Text>
                          <View style={styles.cardSubRow}>
                            <Text style={styles.cardDayLine} numberOfLines={1}>
                              {formatTripDayLine(
                                dest.day || 1,
                                routeDepartureDate,
                                t,
                              )}
                            </Text>
                            <Pressable
                              ref={active ? (n) => setTourTargetRef('arrivalProgress', n) : undefined}
                              collapsable={false}
                              style={styles.arrivalPeopleChip}
                              disabled={!isLeader || !flockNavigatingThis}
                              onPress={(event) => {
                                event.stopPropagation();
                                registerCardActivity(dest.id);
                                setArrivalDestination(dest);
                                setOverlay('arrival');
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={`${t('map.arrivalProgress')} ${arrivedHere}/${totalMembers}`}
                            >
                              <Ionicons name="people-outline" size={16} color={accent} />
                              <Text style={[styles.arrivalPeopleValue, { color: accent }]}>
                                {flockNavigatingThis ? <>{arrivedHere}/{totalMembers}</> : '—'}
                              </Text>
                            </Pressable>
                          </View>
                          {myScopeId != null && (
                            <Text style={styles.cardBadge}>{t('subgroup.itineraryBadge')}</Text>
                          )}
                          <View style={styles.metricsRow}>
                            <View style={styles.metricCol}>
                              <View style={styles.metricValueRow}>
                                <Ionicons name="location" size={chromeCompact ? 16 : 18} color={accent} />
                                <View style={styles.metricNumUnit}>
                                  <Text
                                    style={[styles.metricValue, { color: accent }]}
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.85}
                                    maxFontSizeMultiplier={1.15}
                                  >
                                    {distParts.value}
                                  </Text>
                                  {distParts.unit ? (
                                    <Text
                                      style={[styles.metricUnit, { color: accent }]}
                                      numberOfLines={1}
                                      maxFontSizeMultiplier={1.15}
                                    >
                                      {distParts.unit}
                                    </Text>
                                  ) : null}
                                </View>
                              </View>
                              <Text
                                style={styles.metricCaption}
                                numberOfLines={2}
                                maxFontSizeMultiplier={1.15}
                              >
                                {t('map.distanceToGather')}
                              </Text>
                            </View>
                            <View style={styles.metricDivider} />
                            <View style={styles.metricCol}>
                              <View style={styles.metricValueRow}>
                                <Ionicons
                                  name={
                                    travelMode === 'walk'
                                      ? 'walk'
                                      : travelMode === 'drive'
                                        ? 'car'
                                        : travelMode === 'bicycle'
                                          ? 'bicycle'
                                          : 'bus'
                                  }
                                  size={chromeCompact ? 14 : 16}
                                  color={accent}
                                />
                                <View style={styles.metricNumUnit}>
                                  <Text
                                    style={[styles.metricValue, { color: accent }]}
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.85}
                                    maxFontSizeMultiplier={1.15}
                                  >
                                    {etaParts.value}
                                  </Text>
                                  {etaParts.unit ? (
                                    <Text
                                      style={[styles.metricUnit, { color: accent }]}
                                      numberOfLines={1}
                                      maxFontSizeMultiplier={1.15}
                                    >
                                      {etaParts.unit}
                                    </Text>
                                  ) : null}
                                </View>
                              </View>
                              <Text
                                style={styles.metricCaption}
                                numberOfLines={2}
                                maxFontSizeMultiplier={1.15}
                              >
                                {routeForDestination
                                  ? t('map.routeEstimate')
                                  : t('map.localEstimate')}
                              </Text>
                            </View>
                            <View style={styles.metricDivider} />
                            <Pressable
                              ref={active ? (n) => setTourTargetRef('externalMaps', n) : undefined}
                              collapsable={false}
                              style={styles.mapsChip}
                              onPress={(event) => {
                                event.stopPropagation();
                                registerCardActivity(dest.id);
                                openExternalNavigation(dest);
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={t('map.openExternalNavigation')}
                              testID={`gather-external-${dest.id}`}
                            >
                              <Ionicons name="map" size={22} color="#fff" />
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <View style={styles.cardDenseBody}>
                          <OverflowMarquee
                            text={dest.title}
                            enabled={gatherCardTitleMarquee}
                            active={active}
                            activationDelayMs={1600}
                            pixelsPerSecond={gatherCardMarqueeSpeed}
                            startPauseMs={1000}
                            endPauseMs={1500}
                            // Single stable style object (not an inline array) so
                            // MapScreen re-renders do not thrash marquee measure.
                            style={styles.cardTitleCollapsed}
                          />
                          <View style={styles.cardCollapsedMetrics}>
                            {etaLabel ? (
                              <Text
                                style={[styles.cardRouteMetaEta, { color: glass.textSecondary }]}
                                numberOfLines={1}
                              >
                                {etaLabel}
                              </Text>
                            ) : null}
                            {etaLabel && distLabel ? (
                              <Text style={styles.cardRouteMetaDotExpanded}>·</Text>
                            ) : null}
                            {distLabel ? (
                              <Text
                                style={[styles.cardRouteMetaDist, { color: accent }]}
                                numberOfLines={1}
                              >
                                {distLabel}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      )}
                    </View>
                  </View>
    
                  </GatheringCardPressable>
                  {/* a11y-layout:commandRow — always one row.
                      Order (#148): [Start/End | Arrived] [Countdown] [Transport]
                      Outside expand Pressable so Start never toggles the card.
                      Density tracks narrow + Dynamic Type. */}
                  {cardExpanded && (
                  <View style={styles.commandRow} pointerEvents="box-none">
                    {cardExpanded && navCmd.kind !== 'hidden' ? (
                      <Pressable
                        ref={active ? (n) => setTourTargetRef('navCommand', n) : undefined}
                        collapsable={false}
                        style={[
                          styles.navBtn,
                          navCmd.kind === 'member_waiting_complete'
                            || navCmd.kind === 'member_request_start'
                            ? styles.navBtnWide
                            : navIconOnly
                              ? styles.navBtnIconOnly
                              : null,
                          navCmd.kind === 'leader_stop'
                            ? styles.navBtnEnd
                            : commandDisabled
                              ? styles.navBtnDisabled
                              : { backgroundColor: accent },
                        ]}
                        hitSlop={8}
                        testID={`gather-nav-${dest.id}`}
                        onPress={() => {
                          registerCardActivity(dest.id);
                          mediumTap();
                          if (navCmd.action === 'start_nav') {
                            void startNavigation(dest, index);
                          } else if (navCmd.action === 'request_start') {
                            requestLeaderStart(dest);
                          } else if (navCmd.action === 'end_point') {
                            void requestTeamEnd(dest, index);
                          } else if (navCmd.action === 'mark_complete') {
                            // Leader manual complete while personally arrived
                            // (someone still missing → confirm; all arrived → auto).
                            promptCompleteAfterArrival(dest);
                          } else if (navCmd.disabled) {
                            logEvent('nav_command_ignored', {
                              reason: navCmd.kind,
                              destId: dest.id,
                            });
                          }
                        }}
                        disabled={commandDisabled}
                        accessibilityRole="button"
                        accessibilityLabel={navLabel}
                        accessibilityHint={startAccessibilityHint}
                        accessibilityState={{ disabled: commandDisabled }}
                      >
                        <Ionicons
                          name={
                            navCmd.kind === 'leader_stop'
                              ? 'stop'
                              : navCmd.kind === 'leader_mark_complete'
                                ? 'checkmark-done'
                                : navCmd.kind === 'member_waiting_complete'
                                  ? 'hourglass-outline'
                                  : navCmd.kind === 'member_navigating'
                                    ? 'navigate'
                                    : navCmd.kind === 'member_request_start'
                                      ? 'paper-plane-outline'
                                    : isLeader
                                      ? 'play'
                                      : 'navigate'
                          }
                          size={chromeCompact ? 16 : 15}
                          color={
                            navCmd.kind === 'leader_stop'
                              ? glass.danger
                              : navCmd.kind === 'member_navigating' || navCmd.kind === 'member_waiting_complete'
                                ? glass.textSecondary
                                : isLeader
                                  ? colors.accentText
                                  : '#0c1a12'
                          }
                        />
                        {navCmd.kind === 'member_waiting_complete'
                          || navCmd.kind === 'member_request_start'
                          || !navIconOnly ? (
                          <Text
                            style={[
                              styles.navBtnText,
                              {
                                color:
                                  navCmd.kind === 'leader_stop'
                                    ? glass.danger
                                    : navCmd.kind === 'member_navigating' || navCmd.kind === 'member_waiting_complete'
                                      ? glass.textSecondary
                                      : isLeader
                                        ? colors.accentText
                                        : '#0c1a12',
                                flexShrink: 1,
                              },
                            ]}
                            numberOfLines={
                              navCmd.kind === 'member_waiting_complete'
                                || navCmd.kind === 'member_request_start'
                                ? 2
                                : 1
                            }
                            ellipsizeMode="tail"
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
                          >
                            {navLabel}
                          </Text>
                        ) : null}
                      </Pressable>
                    ) : null}
    
                    {/* Personal check-in splits from Start/End right (#148). */}
                    {showArrivalControl ? (
                      <Animated.View
                        entering={
                          arrivalJustSplit
                            ? (tourReduceMotion
                              ? FadeIn.duration(ARRIVED_FADE_MS)
                              : FadeInRight.duration(ARRIVED_SPLIT_MS))
                            : undefined
                        }
                        exiting={
                          tourReduceMotion
                            ? FadeOut.duration(ARRIVED_FADE_MS)
                            : FadeOutRight.duration(ARRIVED_SPLIT_MS)
                        }
                        collapsable={false}
                      >
                        {personallyArrived ? (
                          <Pressable
                            ref={active ? (n) => setTourTargetRef('personalArrive', n) : undefined}
                            collapsable={false}
                            style={[
                              styles.cmdSquare,
                              styles.arrivalCmdSquare,
                              styles.arrivalCmdArrived,
                            ]}
                            onPress={() => {
                              registerCardActivity(dest.id);
                              lightTap();
                              if (user?.id) handleArrival(dest, user.id, false);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={t('arrival.undo')}
                            testID={`gather-arrival-undo-${dest.id}`}
                          >
                            <Ionicons
                              name="checkmark-circle"
                              size={chromeTight ? 18 : 20}
                              color={glass.ok}
                            />
                          </Pressable>
                        ) : (
                          <Pressable
                            ref={active ? (n) => setTourTargetRef('personalArrive', n) : undefined}
                            collapsable={false}
                            style={[
                              styles.cmdSquare,
                              styles.arrivalCmdSquare,
                            ]}
                            onPress={() => {
                              registerCardActivity(dest.id);
                              lightTap();
                              if (user?.id) handleSelfArrival(dest, user.id);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={t('arrival.mark')}
                            testID={`gather-arrival-${dest.id}`}
                          >
                            <Ionicons
                              name="checkmark-circle-outline"
                              size={chromeTight ? 18 : 20}
                              color={accent}
                            />
                          </Pressable>
                        )}
                      </Animated.View>
                    ) : null}
    
                    {/* Transport before meet countdown (product: swap order). */}
                    {cardExpanded ? (
                    <>
                    <Pressable
                      ref={active ? (n) => setTourTargetRef('transport', n) : undefined}
                      collapsable={false}
                      style={styles.cmdSquare}
                      onPress={() => {
                        registerCardActivity(dest.id);
                        lightTap();
                        const order = ['walk', 'bicycle', 'transit', 'drive'] as const;
                        setTravelMode(order[(order.indexOf(travelMode) + 1) % order.length]);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${t(`map.travelMode.${travelMode}`)} ${etaLabel} ${distLabel}`.trim()}
                      testID={`gather-travel-mode-${dest.id}`}
                    >
                      <Ionicons
                        name={modeIconName}
                        size={chromeTight ? 18 : 20}
                        color={accent}
                      />
                    </Pressable>
    
                    <View
                      ref={active ? (n) => setTourTargetRef('meetTime', n) : undefined}
                      collapsable={false}
                      style={styles.meetBtnSlot}
                    >
                    <MeetTimeChip
                      testID={`gather-meet-time-${dest.id}`}
                      meetAtIso={dest.meetAt as string | null | undefined}
                      meetRedMinutes={
                        dest.meetRedMinutes ?? meetRedMin ?? DEFAULT_MEET_RED_MIN
                      }
                      accent={accent}
                      chromeTight={chromeTight}
                      chromeCompact={chromeCompact}
                      expanded={!showArrivalControl}
                      styles={styles}
                      canEdit={canEditItinerary}
                      a11yLabel={
                        meetLabel
                          ? `${t('meetTime.set')} ${meetLabel}`
                          : t('meetTime.set')
                      }
                      onPress={() => {
                        registerCardActivity(dest.id);
                        openMeetTimePicker(dest);
                      }}
                      formatMinutes={(minutes) => t('map.meetMinutes', { minutes })}
                      formatDue={(time) => t('map.meetAtClock', { time })}
                      captionLive={t('map.meetCountdown')}
                      captionDue={t('map.meetTimeCaption')}
                    />
                    </View>
                    </>
                    ) : null}
                  </View>
                  )}
                  {cardExpanded && isLeader && canEditItinerary && !dest.closedAt
                    && sharedTargetId === dest.id ? (
                    <Pressable
                      style={[styles.navBtn, { flexGrow: 0, flexBasis: 'auto', minHeight: 44,
                        marginTop: 8, paddingVertical: 10, backgroundColor: accent }]}
                      onPress={() => {
                        registerCardActivity(dest.id);
                        mediumTap();
                        promptCompleteAfterArrival(dest);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t('gathering.completeMissingTitle')}
                      accessibilityHint={t('nav.a11yCompleteHint')}
                      testID={`gather-complete-${dest.id}`}
                    >
                      <Ionicons name="checkmark-done" size={18} color={colors.accentText} />
                      <Text style={[styles.navBtnText, { color: colors.accentText }]}>
                        {t('gathering.completeMissingTitle')}
                      </Text>
                    </Pressable>
                  ) : null}
                  </View>
                </SwiftUIGlassSurface>
                </ArrivalCardExitShell>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </Animated.View>
    )}</>
  );
}
