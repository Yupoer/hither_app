import { APP_TEXT_SIZE, APP_TEXT_LINE_HEIGHT } from '../../../theme/typeScale';
import React, { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  processColor,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { AppText as Text } from '../../../components/AppText';
import MotionPressable from '../../../components/MotionPressable';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { Easing, Extrapolation, FadeIn, FadeInDown, FadeOut, FadeOutUp, LinearTransition, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useD6PaneDrag } from './useD6PaneDrag';
import { D6PaneFrame } from './D6PaneFrame';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SwiftUIGlassSurface from '../../../components/SwiftUIGlassSurface';
import GatheringCardParticles from '../../../components/GatheringCardParticles';
import OverflowMarquee from '../../../components/OverflowMarquee';
import { HitherText } from '../../../components/HitherText';
import { MAP_FLOATING_EDGE_INSET, MAP_FLOATING_GRABBER_HEIGHT, MAP_GATHERING_CORNER_RADIUS, MAP_ISLAND_ACTION_HEIGHT,
  MAP_ISLAND_BOTTOM_INSET, MAP_ISLAND_HEIGHT, MAP_SHEET_CORNER_RADIUS,
  SHEET_CORNER_ACTION_INSET, D6_SURFACE_COLORS, D6_SURFACE_BORDER_COLOR, D6_SURFACE_SOLID_COLOR } from '../../../components/mapSheetChrome';
import MapRecenterControl from '../../../components/MapRecenterControl';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useForegroundUi, useVisibleUi } from '../../../state/foregroundUi';
import { liquidGlass } from '../../../native';
import { NativeD6GradientView } from '../../../native/d6Pane';
import { formatDistance, type TravelMode } from '../../../utils/geo';
import { D6_DAY_PALETTE } from '../d6Itinerary';
import type { Destination } from '../../../types';
import { d6MeetingDisplay, d6TravelTime } from '../d6GatheringHeader';
export { d6MeetingDisplay } from '../d6GatheringHeader';

export const D6_ACCENT = '#4C6FFF';
export type D6Pane = 'itinerary' | 'team';
export type D6Journey = 'empty' | 'ready' | 'going' | 'arrived';
const FONT = 'BarlowCondensed-ExtraBoldItalic';
const D6_COUNTDOWN_COLOR = '#7993FF';
const END_HOLD_MS = 1500;
const HOLD_FEEDBACK_MS = [380, 820, 1210];
const FACT_TINT = { travel: '#AAC0FF', location: '#F9D48F', people: '#9CE6C7' };
const JOURNEY_BUTTON_DEPTH = 4;
const FONTS = { [FONT]: require('../../../../targets/live-activity/BarlowCondensed-ExtraBoldItalic.ttf') };
const MODE_ICON: Record<TravelMode, React.ComponentProps<typeof Ionicons>['name']> = {
  walk: 'walk-outline',
  transit: 'train-outline',
  drive: 'car-outline',
  bicycle: 'bicycle-outline',
};

export function useD6Numbers(enabled: boolean) {
  const [loaded] = useFonts(FONTS);
  return enabled && loaded ? FONT : undefined;
}

export function d6DayColor(day: number | null, colors: Readonly<Record<number, string>>) {
  return day == null || day < 1 ? '#64716E' : colors[day] ?? D6_DAY_PALETTE[(day - 1) % D6_DAY_PALETTE.length];
}

export const D6Surface = React.memo(function D6Surface({ radius, thick = false }: { radius: number; thick?: boolean }) {
  const visible = useVisibleUi();
  const [reduced, setReduced] = useState(false);
  useMountEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled?.().then(value => {
      if (mounted) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener?.('reduceTransparencyChanged', setReduced);
    return () => { mounted = false; subscription?.remove(); };
  });
  if (!visible) return null;
  if (reduced) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: D6_SURFACE_SOLID_COLOR }]} />;
  const native = liquidGlass.isLiquidGlassAvailable();
  const colors = D6_SURFACE_COLORS[thick ? 'thick' : 'thin'];
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      {native ? (
        <SwiftUIGlassSurface style={StyleSheet.absoluteFill} cornerRadius={radius} />
      ) : (
        <BlurView style={StyleSheet.absoluteFill} intensity={thick ? 72 : 48} tint="dark" />
      )}
      {NativeD6GradientView ? <NativeD6GradientView colors={colors.map(processColor)} cornerRadius={radius}
        borderWidth={StyleSheet.hairlineWidth} borderColor={D6_SURFACE_BORDER_COLOR} style={StyleSheet.absoluteFill} /> : <LinearGradient
        colors={colors}
        style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: D6_SURFACE_BORDER_COLOR }]}
      />}
    </View>
  );
});

export function D6IconButton({ name, label, onPress, style, testID }: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <MotionPressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.iconButton, style]}>
      <Ionicons name={name} size={23} color="#fff" />
    </MotionPressable>
  );
}

const Grabber = React.memo(function Grabber({ gesture, detent, snapTo, label, testID, height = MAP_FLOATING_GRABBER_HEIGHT }: Pick<ReturnType<typeof useD6PaneDrag>, 'gesture' | 'detent' | 'snapTo'> & {
  label: string;
  testID: string;
  height?: number;
}) {
  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} style={[styles.grabArea, { height }]}>
        <MotionPressable testID={testID} accessibilityRole="adjustable" accessibilityLabel={label}
          accessibilityValue={{ min: 0, max: 2, now: detent === 'closed' ? 0 : detent === 'half' ? 1 : 2 }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={({ nativeEvent: { actionName } }) => {
            if (actionName === 'increment') snapTo(detent === 'closed' ? 'half' : 'full');
            if (actionName === 'decrement') snapTo(detent === 'full' ? 'half' : 'closed');
          }}
          onPress={() => snapTo(detent === 'closed' || detent === 'full' ? 'half' : 'closed')}
          style={[styles.grabTarget, { height }]} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
          <View style={styles.grab} />
        </MotionPressable>
      </View>
    </GestureDetector>
  );
});

type HeaderProps = {
  stop: Destination | null;
  phase: D6Journey;
  canLead: boolean;
  travelMode: TravelMode;
  distance: number | null;
  eta: number | null;
  arrived: number;
  total: number;
  displayFont?: string;
  marqueeEnabled: boolean;
  marqueeSpeed: number;
  zh: boolean;
};

const HEADER_LAYOUT = LinearTransition.duration(420).easing(Easing.inOut(Easing.cubic));
const HEADER_ENTER = FadeIn.duration(320);
const HEADER_EXIT = FadeOut.duration(180);

const Header = React.memo(function Header({ stop, phase, canLead, travelMode, distance, eta, arrived, total, displayFont, marqueeEnabled, marqueeSpeed, zh }: HeaderProps) {
  const { fontScale, width } = useWindowDimensions();
  const visible = useVisibleUi();
  const [now, setNow] = useState(Date.now);
  const largeText = fontScale > 1.45;
  const unit = zh ? '分' : 'min';
  const time = d6MeetingDisplay(stop, phase, eta, now, zh ? 'zh-TW' : 'en-GB');
  const hasTime = time.kind !== 'none';
  const titleMaxWidth = width / 2 + 64 - MAP_FLOATING_EDGE_INSET - SHEET_CORNER_ACTION_INSET - 1;
  const metricFont = displayFont ? { fontFamily: displayFont, fontStyle: 'normal' as const, fontWeight: '400' as const } : undefined;
  const label = stop?.title ?? (canLead ? (zh ? '新增第一個集合點' : 'Add your first stop') : (zh ? '等待隊長' : 'Waiting for leader'));
  return (
    <Reanimated.View layout={HEADER_LAYOUT} style={[styles.headerRow, largeText && styles.headerRowLarge]}>
      {visible && stop?.meetAt && phase === 'ready' ? <MeetingClock key={stop.meetAt} onTick={setNow} /> : null}
      <Reanimated.View layout={HEADER_LAYOUT} style={[styles.headerMain, !largeText && hasTime && { maxWidth: titleMaxWidth }, largeText && styles.headerMainLarge]}>
        {!largeText && marqueeEnabled && stop ? (
          <OverflowMarquee text={label} style={styles.title} active={visible} pixelsPerSecond={marqueeSpeed} />
        ) : <HitherText typeRole="title" allowFontScaling={!largeText} style={[styles.title, largeText && styles.titleLarge]}
          numberOfLines={largeText ? 2 : 1}>{label}</HitherText>}
        {stop ? (
          <Reanimated.View key={phase} layout={HEADER_LAYOUT} entering={HEADER_ENTER} exiting={HEADER_EXIT} style={styles.facts}>
            {phase === 'arrived' ? <View style={styles.fact}>
              <FactIcon name="people-outline" color={FACT_TINT.people} />
              <GatheringFact largeText={largeText}>{zh ? '全員到齊' : 'Everyone arrived'}</GatheringFact>
            </View> : (
              <>
                {phase === 'ready' ? <View style={styles.fact}>
                  <FactIcon name={MODE_ICON[travelMode]} color={FACT_TINT.travel} />
                  <GatheringFact largeText={largeText}>{d6TravelTime(eta, zh)}</GatheringFact>
                </View> : null}
                <View style={styles.fact}>
                  <FactIcon name="location-outline" color={FACT_TINT.location} />
                  <GatheringFact largeText={largeText}>{distance == null ? '—' : formatDistance(distance)}</GatheringFact>
                </View>
                {phase === 'going' && total > 0 ? (
                  <View style={styles.fact}>
                    <FactIcon name="people-outline" color={FACT_TINT.people} />
                    <GatheringFact largeText={largeText}>{`${arrived}/${total} ${zh ? '已到' : 'arrived'}`}</GatheringFact>
                  </View>
                ) : null}
              </>
            )}
          </Reanimated.View>
        ) : null}
      </Reanimated.View>
      {stop && hasTime ? (
        <Reanimated.View key={`${phase}:${time.kind}`} layout={HEADER_LAYOUT} entering={HEADER_ENTER} exiting={HEADER_EXIT}
          style={[time.kind === 'status' ? styles.timeStatus : styles.timeRow, largeText && styles.timeRowLarge]}>
          {time.kind === 'status' ? <>
            <Ionicons name="navigate-outline" size={17} color={FACT_TINT.travel} />
            <HitherText testID="d6-home-meeting-time" style={styles.timeStatusText}>{zh ? '估算中' : 'Calculating'}</HitherText>
          </> : time.kind === 'duration' ? (
            <View accessible accessibilityLabel={zh ? `${time.hours} 小時 ${time.minutes} 分鐘` : `${time.hours} hours ${time.minutes} minutes`}
              testID="d6-home-meeting-time" style={styles.durationRow}>
              <HitherText typeRole="metric" allowFontScaling={!largeText} style={[styles.time, styles.durationNumber, metricFont, styles.hot]}>{time.hours}</HitherText>
              <HitherText allowFontScaling={!largeText} style={[styles.timeUnit, styles.durationUnit, styles.hot]}>{zh ? '時' : 'h'}</HitherText>
              <HitherText typeRole="metric" allowFontScaling={!largeText} style={[styles.time, styles.durationNumber, metricFont, styles.hot]}>{time.minutes}</HitherText>
              <HitherText allowFontScaling={!largeText} style={[styles.timeUnit, styles.durationUnit, styles.hot]}>{zh ? '分' : 'm'}</HitherText>
            </View>
          ) : <>
            <HitherText typeRole="metric" allowFontScaling={!largeText} testID="d6-home-meeting-time" numberOfLines={1} style={[
              styles.time, largeText && styles.timeLarge, metricFont, time.hot && styles.hot,
            ]}>{time.value}</HitherText>
            {time.unit ? <HitherText allowFontScaling={!largeText} style={[styles.timeUnit, largeText && styles.timeUnitLarge, time.hot && styles.hot]}>{unit}</HitherText> : null}
          </>}
        </Reanimated.View>
      ) : !stop && canLead ? <Ionicons name="add" size={23} color="#fff" /> : null}
    </Reanimated.View>
  );
});

function GatheringFact({ largeText, children }: { largeText: boolean; children: string }) {
  return <HitherText allowFontScaling={!largeText} style={[styles.factText, largeText && styles.factTextLarge]}>{children}</HitherText>;
}

function FactIcon({ name, color }: { name: React.ComponentProps<typeof Ionicons>['name']; color: string }) {
  return <View style={styles.factIcon} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Ionicons name={name} size={18} color={color} />
  </View>;
}

function MeetingClock({ onTick }: { onTick: (time: number) => void }) {
  useMountEffect(() => {
    const tick = () => onTick(Date.now());
    const initial = setTimeout(tick, 0);
    const timer = setInterval(tick, 5000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  });
  return null;
}

type CtaProps = {
  phase: D6Journey;
  canLead: boolean;
  asked: boolean;
  busy: boolean;
  progress: number | null;
  reduceMotion: boolean;
  zh: boolean;
  onAction: () => void;
  onStop: () => Promise<boolean>;
};

const JourneyButton = React.memo(function JourneyButton({ phase, canLead, asked, busy, progress, reduceMotion, zh, onAction, onStop }: CtaProps) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.45;
  const base = Math.max(0, Math.min(1, progress ?? 0));
  const [fill] = useState(() => new Animated.Value(base));
  const [buttonDepth] = useState(() => new Animated.Value(0));
  const holdFeedback = useRef<ReturnType<typeof setTimeout>[]>([]);
  const visible = useForegroundUi();
  const clearHoldFeedback = () => {
    holdFeedback.current.forEach(timer => clearTimeout(timer));
    holdFeedback.current = [];
  };
  const [pressed, setPressed] = useState(false);
  const holding = useRef(false);
  const stoppedTouch = useRef(false);
  const [screenReader, setScreenReader] = useState(false);
  useMountEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled?.().then(value => { if (mounted) setScreenReader(value); });
    const subscription = AccessibilityInfo.addEventListener?.('screenReaderChanged', setScreenReader);
    return () => {
      mounted = false;
      subscription?.remove();
      holdFeedback.current.forEach(timer => clearTimeout(timer));
      fill.stopAnimation();
      buttonDepth.stopAnimation();
    };
  });
  const animate = (target: number, duration: number) => Animated.timing(fill, { toValue: target, duration, useNativeDriver: true });
  const stopNavigation = async () => {
    if (await onStop()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  };
  const endWithConfirmation = () => Alert.alert(zh ? '結束導航？' : 'End navigation?', undefined, [
    { text: zh ? '取消' : 'Cancel', style: 'cancel' },
    { text: zh ? '結束導航' : 'End navigation', onPress: () => void stopNavigation() },
  ]);
  const going = phase === 'going';
  const canHold = going && canLead && !screenReader && !busy && visible;
  const unavailable = busy || (canLead ? false : going || phase === 'arrived' || phase === 'empty' || asked);
  const quiet = !canLead && (phase === 'empty' || phase === 'arrived' || asked);
  const elevated = !going && !quiet;
  const depressed = pressed && !unavailable;
  function moveFace(toValue: number) {
    if (reduceMotion) buttonDepth.setValue(0);
    else Animated.timing(buttonDepth, { toValue, duration: toValue > 0 ? 90 : 150, useNativeDriver: true }).start();
  }
  function runAction() {
    if (phase !== 'empty') {
      void Haptics.impactAsync(canLead ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    onAction();
  }
  const label = phase === 'empty'
    ? canLead ? (zh ? '新增集合點' : 'Add a stop') : (zh ? '等待隊長' : 'Waiting for leader')
    : going ? (zh ? '前往中' : 'On the way')
      : phase === 'arrived' ? canLead ? (zh ? '完成' : 'Finish') : (zh ? '已抵達' : 'Arrived')
        : canLead ? (zh ? '出發' : 'Start')
          : asked ? (zh ? '已通知隊長' : 'Leader notified') : (zh ? '請隊長出發' : 'Ask leader to start');
  return (
    <Pressable
      testID="home-journey-action"
      accessibilityRole="button"
      accessibilityLabel={going && canLead ? (zh ? '前往中，按住結束導航' : 'On the way, hold to end navigation') : label}
      accessibilityHint={canHold ? (zh ? '按住 1.5 秒' : 'Hold for 1.5 seconds') : undefined}
      accessibilityState={{ disabled: unavailable, busy }}
      disabled={unavailable}
      delayLongPress={END_HOLD_MS}
      onLongPress={canHold ? () => {
        if (!holding.current || stoppedTouch.current) return;
        stoppedTouch.current = true;
        clearHoldFeedback();
        fill.stopAnimation();
        fill.setValue(1);
        void stopNavigation();
      } : undefined}
      style={[styles.cta, elevated && styles.ctaBase, busy && styles.busy]}
      onPressIn={() => {
        if (unavailable) return;
        stoppedTouch.current = false;
        setPressed(true);
        moveFace(JOURNEY_BUTTON_DEPTH);
        if (!canHold) return;
        holding.current = true;
        clearHoldFeedback();
        holdFeedback.current = HOLD_FEEDBACK_MS.map((delay, index) => setTimeout(() => {
          if (holding.current) {
            void Haptics.impactAsync(index === 0 ? Haptics.ImpactFeedbackStyle.Soft : Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          }
        }, delay));
        if (!reduceMotion) animate(1, END_HOLD_MS).start();
      }}
      onPressOut={() => {
        setPressed(false);
        moveFace(0);
        clearHoldFeedback();
        if (!holding.current) return;
        holding.current = false;
        fill.stopAnimation();
        if (stoppedTouch.current || reduceMotion) fill.setValue(base);
        else animate(base, 160).start();
      }}
      onPress={() => {
        if (stoppedTouch.current) {
          stoppedTouch.current = false;
          return;
        }
        if (!going) return runAction();
        if (screenReader) return endWithConfirmation();
        if (!reduceMotion) Animated.sequence([animate(Math.max(base, .62), 240), animate(base, 430)]).start();
      }}
      onAccessibilityTap={() => {
        if (unavailable) return;
        if (going) endWithConfirmation();
        else runAction();
      }}
    >
      {!canHold ? <StopHoldCancellation cancel={() => {
        clearHoldFeedback();
        if (!holding.current) return;
        holding.current = false;
        fill.stopAnimation();
        if (!stoppedTouch.current) fill.setValue(base);
        setPressed(false);
      }} /> : null}
      <Animated.View pointerEvents="none" style={[
        styles.ctaFace,
        elevated && styles.ctaRaisedFace,
        depressed && (!elevated || reduceMotion) && styles.ctaSoftPressed,
        elevated && { transform: [{ translateY: buttonDepth }] },
        largeText && styles.ctaFaceLarge,
      ]}>
        {going ? <ProgressFill key={base} base={base} fill={fill} holding={holding} /> : null}
        {going ? <Animated.View style={[styles.ctaFill, { transform: [{ scaleX: fill }] }]} /> : null}
        {asked && !canLead ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
        <HitherText allowFontScaling={!largeText} numberOfLines={2} style={[styles.ctaText, largeText && styles.ctaTextLarge]}>{label}</HitherText>
      </Animated.View>
    </Pressable>
  );
});

function StopHoldCancellation({ cancel }: { cancel: () => void }) {
  useMountEffect(cancel);
  return null;
}

function ProgressFill({ base, fill, holding }: { base: number; fill: Animated.Value; holding: React.RefObject<boolean> }) {
  useMountEffect(() => {
    if (!holding.current) fill.setValue(base);
  });
  return null;
}

type HomeChromeProps = HeaderProps & CtaProps & {
  pane: D6Pane | null;
  onPaneChange: (pane: D6Pane | null) => void;
  itinerary: ReactNode;
  team: ReactNode;
  teamHeader?: ReactNode;
  footer?: ReactNode;
  selfEmoji: string;
  selfColor: string;
  statusColor: string;
  onProfile: () => void;
  onCommands: () => void;
  onAdd: () => void;
  onFit: () => void;
  onLocate: () => void;
  hideIsland: boolean;
  hideHeader?: boolean;
  onTopHeight: (height: number) => void;
  lowPowerMode?: boolean | null;
  thermalState?: string | null;
  error?: string | null;
};

export function D6HomeChrome(props: HomeChromeProps) {
  const { pane, onPaneChange, itinerary, team, teamHeader, footer, selfEmoji, selfColor, statusColor, onProfile, onCommands,
    onAdd, onFit, onLocate, hideIsland, hideHeader = false, onTopHeight, stop, canLead, zh, error, phase, lowPowerMode, thermalState } = props;
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const [headerHeight, setHeaderHeight] = useState(82);
  const [islandControlsHeight, setIslandControlsHeight] = useState(MAP_ISLAND_HEIGHT - MAP_ISLAND_BOTTOM_INSET);
  const topOpen = pane === 'itinerary';
  const teamOpen = pane === 'team';
  const topEdge = Math.max(56, insets.top - 3);
  const bottom = Math.max(24, insets.bottom - 8);
  const topClosed = headerHeight + MAP_FLOATING_GRABBER_HEIGHT;
  const islandClosed = islandControlsHeight + MAP_ISLAND_BOTTOM_INSET;
  const changeItinerary = useCallback((open: boolean) => onPaneChange(open ? 'itinerary' : null), [onPaneChange]);
  const changeTeam = useCallback((open: boolean) => onPaneChange(open ? 'team' : null), [onPaneChange]);
  const closeTeamBeforeDrag = useCallback(() => { if (teamOpen) changeTeam(false); }, [teamOpen, changeTeam]);
  const closeItineraryBeforeDrag = useCallback(() => { if (topOpen) changeItinerary(false); }, [topOpen, changeItinerary]);
  const top = useD6PaneDrag({
    closed: topClosed,
    full: Math.max(topClosed, screenHeight - topEdge - bottom - islandClosed - MAP_FLOATING_EDGE_INSET),
    direction: 1, open: topOpen, reduceMotion: props.reduceMotion,
    onOpenChange: changeItinerary, onDragBegin: closeTeamBeforeDrag,
  });
  const island = useD6PaneDrag({
    closed: islandClosed,
    full: Math.max(islandClosed, screenHeight - bottom - topEdge - topClosed - MAP_FLOATING_EDGE_INSET),
    direction: -1, open: teamOpen, reduceMotion: props.reduceMotion,
    onOpenChange: changeTeam, onDragBegin: closeItineraryBeforeDrag,
  });
  const islandHeight = island.height;
  const teamHeaderMotion = useAnimatedStyle(() => ({
    opacity: interpolate(islandHeight.value, [islandClosed, islandClosed + 76], [0, 1], Extrapolation.CLAMP),
    bottom: bottom + islandHeight.value - SHEET_CORNER_ACTION_INSET - 48,
  }));
  const topLabel = topOpen ? (zh ? '收合行程' : 'Close itinerary') : (zh ? '展開行程' : 'Open itinerary');
  const goRoute = () => {
    top.snapTo(top.detent === 'closed' || top.detent === 'full' ? 'half' : 'closed');
  };
  const showItinerary = topOpen || top.preview;
  const showTeam = teamOpen || island.preview;
  return (
    <View pointerEvents="box-none" style={styles.layer}>
      {top.lifecycle}
      {island.lifecycle}
      {!hideHeader ? <Reanimated.View entering={FadeInDown.duration(300)} exiting={FadeOutUp.duration(220)} style={StyleSheet.absoluteFill} pointerEvents="box-none"><D6PaneFrame panel={top} direction={1} cornerRadius={MAP_GATHERING_CORNER_RADIUS}
        style={[styles.top, { top: topEdge }]} open={topOpen}
        surface={<D6Surface radius={MAP_GATHERING_CORNER_RADIUS} />}
        decoration={<View style={[styles.particleField, { height: topClosed }]} pointerEvents="none">
          {stop ? <GatheringCardParticles running={phase === 'going'}
            lowPowerMode={lowPowerMode} thermalState={thermalState} /> : null}
        </View>}
        header={<MotionPressable testID="home-itinerary-toggle" accessibilityRole="button" accessibilityLabel={!stop && !topOpen && canLead ? (zh ? '新增第一個集合點' : 'Add your first stop') : undefined} accessibilityHint={topLabel}
          onPress={!stop && !topOpen && canLead ? onAdd : goRoute} style={styles.headingButton}
          onLayout={({ nativeEvent: { layout: { height } } }) => {
            setHeaderHeight(height);
            onTopHeight(height + MAP_FLOATING_GRABBER_HEIGHT);
          }}>
          <Header stop={stop} phase={phase} canLead={canLead} travelMode={props.travelMode}
            distance={props.distance} eta={props.eta} arrived={props.arrived} total={props.total}
            displayFont={props.displayFont} marqueeEnabled={props.marqueeEnabled} marqueeSpeed={props.marqueeSpeed} zh={zh} />
        </MotionPressable>}
        body={showItinerary ? <View collapsable={false} testID="d6-route-viewport" onLayout={top.contentDidLayout} style={styles.topBody}>{itinerary}</View> : null}
        grabber={<Grabber gesture={top.gesture} detent={top.detent} snapTo={top.snapTo} label={topLabel} testID="home-itinerary-grabber" />}
      /></Reanimated.View> : null}
      {!pane && !top.preview && !island.preview && !hideIsland ? <MapRecenterControl style={[styles.controls, { bottom: bottom + islandClosed + 16 }]}
        onFitAll={onFit} onLocate={onLocate} fitAllLabel={zh ? '縮放到全隊' : 'Fit team on map'}
        locateLabel={zh ? '回到我的位置' : 'Show my location'} /> : null}
      {!hideIsland ? <D6PaneFrame panel={island} direction={-1} cornerRadius={MAP_SHEET_CORNER_RADIUS}
        style={[styles.island, { bottom }]} open={teamOpen}
        surface={<D6Surface radius={MAP_SHEET_CORNER_RADIUS} thick />}
        body={showTeam ? <View collapsable={false} testID="d6-team-viewport" onLayout={island.contentDidLayout} style={[styles.teamBody, teamHeader != null && styles.teamBodyWithHeader]}>{team}</View> : null}
        grabber={<Grabber gesture={island.gesture} detent={island.detent} snapTo={island.snapTo}
          label={teamOpen ? (zh ? '收合隊伍' : 'Close team') : (zh ? '展開隊伍' : 'Open team')}
          testID="home-team-toggle" />}
        footer={<View style={styles.islandControls} onLayout={({ nativeEvent: { layout: { height } } }) => {
          if (!footer) setIslandControlsHeight(height);
        }}>
        {error && !topOpen ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {footer ?? <View style={styles.islandRow}>
          <MotionPressable motion="depth" testID="home-profile" accessibilityRole="button" accessibilityLabel={zh ? '你' : 'You'} onPress={onProfile} style={[styles.avatar, { backgroundColor: selfColor }]}>
            <Text allowFontScaling={false} style={styles.avatarEmoji}>{selfEmoji}</Text>
            <View style={[styles.status, { backgroundColor: statusColor }]} />
          </MotionPressable>
          <JourneyButton phase={phase} canLead={canLead} asked={props.asked} busy={props.busy}
            progress={props.progress} reduceMotion={props.reduceMotion} zh={zh} onAction={props.onAction} onStop={props.onStop} />
          <MotionPressable motion="depth" testID="home-commands" accessibilityRole="button" accessibilityLabel={zh ? '快捷指令' : 'Quick commands'} onPress={onCommands} style={styles.commands}>
            <View>
              <Ionicons name="chatbubble-outline" size={27} color="#fff" />
              <Ionicons name="flash" size={13} color="#fff" style={styles.commandBolt} />
            </View>
          </MotionPressable>
        </View>}
        </View>}
      /> : null}
      {!hideIsland && showTeam && teamHeader != null ? <Reanimated.View pointerEvents={teamOpen ? 'box-none' : 'none'}
        accessibilityElementsHidden={!teamOpen} entering={HEADER_ENTER} exiting={HEADER_EXIT}
        style={[styles.teamHeader, { top: 'auto', left: MAP_FLOATING_EDGE_INSET + SHEET_CORNER_ACTION_INSET,
          right: MAP_FLOATING_EDGE_INSET + SHEET_CORNER_ACTION_INSET, height: 48 }, teamHeaderMotion]}>
        {teamHeader}
      </Reanimated.View> : null}
    </View>
  );
}

export const d6ChromeStyles = StyleSheet.create({
  text: { color: '#fff', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  muted: { color: '#ffffff99', fontSize: APP_TEXT_SIZE.caption, fontVariant: ['tabular-nums'] },
  primary: { minHeight: 56, borderRadius: 28, backgroundColor: D6_ACCENT, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  softButton: { minHeight: 44, borderRadius: 999, backgroundColor: '#ffffff1f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  bottomCard: { position: 'absolute', left: MAP_FLOATING_EDGE_INSET, right: MAP_FLOATING_EDGE_INSET,
    borderRadius: MAP_SHEET_CORNER_RADIUS, padding: SHEET_CORNER_ACTION_INSET, zIndex: 89 },
});

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, zIndex: 55 },
  top: { position: 'absolute', left: MAP_FLOATING_EDGE_INSET, right: MAP_FLOATING_EDGE_INSET, borderRadius: MAP_GATHERING_CORNER_RADIUS, overflow: 'hidden' },
  headingButton: { flexShrink: 0, paddingHorizontal: SHEET_CORNER_ACTION_INSET, paddingTop: 20, paddingBottom: 4 },
  particleField: { position: 'absolute', left: 0, right: 0, top: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60 },
  headerRowLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 4 },
  headerMain: { flex: 1, minWidth: 0, gap: 4, justifyContent: 'center', paddingStart: 1 },
  headerMainLarge: { flex: 0 },
  title: { color: '#fff', fontSize: APP_TEXT_SIZE.title, lineHeight: APP_TEXT_LINE_HEIGHT.title, fontWeight: '800' },
  titleLarge: { fontSize: APP_TEXT_SIZE.heading, lineHeight: 37 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 14, rowGap: 4 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 22 },
  factIcon: { width: 18, height: 22, alignItems: 'center', justifyContent: 'center' },
  factText: { color: '#ffffffe8', fontSize: APP_TEXT_SIZE.body, lineHeight: APP_TEXT_LINE_HEIGHT.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  factTextLarge: { fontSize: APP_TEXT_SIZE.title, lineHeight: 29 },
  timeRow: { marginLeft: 'auto', flexShrink: 0, flexDirection: 'row', alignItems: 'baseline', gap: 4, marginRight: 2, transform: [{ translateY: 5 }] },
  timeRowLarge: { alignSelf: 'flex-end' },
  durationRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  durationNumber: { fontSize: APP_TEXT_SIZE.metric, lineHeight: APP_TEXT_LINE_HEIGHT.metric },
  durationUnit: { fontSize: APP_TEXT_SIZE.caption },
  timeStatus: { marginLeft: 'auto', flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 16, backgroundColor: '#B4C7FF1F' },
  timeStatusText: { color: '#E0E9FF', fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
  time: { color: '#fff', fontSize: APP_TEXT_SIZE.metric, lineHeight: APP_TEXT_LINE_HEIGHT.metric, letterSpacing: 0.25, fontStyle: 'italic', fontWeight: '800', fontVariant: ['tabular-nums'] },
  timeLarge: { fontSize: APP_TEXT_SIZE.metric, lineHeight: 72 },
  timeUnit: { color: '#ffffffd0', fontSize: APP_TEXT_SIZE.body, fontWeight: '700' },
  timeUnitLarge: { fontSize: APP_TEXT_SIZE.title },
  hot: { color: D6_COUNTDOWN_COLOR },
  topBody: { flex: 1, minHeight: 0, paddingHorizontal: SHEET_CORNER_ACTION_INSET, marginTop: 6 },
  teamBody: { flex: 1, minHeight: 0, paddingHorizontal: SHEET_CORNER_ACTION_INSET, marginBottom: 6 },
  teamHeader: { position: 'absolute', top: SHEET_CORNER_ACTION_INSET, left: SHEET_CORNER_ACTION_INSET, right: SHEET_CORNER_ACTION_INSET, zIndex: 2 },
  teamBodyWithHeader: { paddingTop: SHEET_CORNER_ACTION_INSET - MAP_ISLAND_BOTTOM_INSET + 56 },
  islandControls: { flexShrink: 0, paddingHorizontal: MAP_ISLAND_BOTTOM_INSET },
  grabArea: { flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  grabTarget: { width: 104, alignItems: 'center', justifyContent: 'center' },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#ffffff52' },
  controls: { position: 'absolute', right: MAP_FLOATING_EDGE_INSET },
  iconButton: { minWidth: 44, minHeight: 44, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  island: { position: 'absolute', left: MAP_FLOATING_EDGE_INSET, right: MAP_FLOATING_EDGE_INSET,
    borderRadius: MAP_SHEET_CORNER_RADIUS },
  islandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MAP_ISLAND_ACTION_HEIGHT,
    marginTop: 'auto', marginBottom: MAP_ISLAND_BOTTOM_INSET },
  avatar: { height: MAP_ISLAND_ACTION_HEIGHT, width: MAP_ISLAND_ACTION_HEIGHT, borderRadius: MAP_ISLAND_ACTION_HEIGHT / 2,
    alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 28 },
  status: { position: 'absolute', width: 15, height: 15, borderRadius: 8, right: -1, bottom: -1, borderColor: '#1d2b29', borderWidth: 2 },
  commands: { width: MAP_ISLAND_ACTION_HEIGHT, height: MAP_ISLAND_ACTION_HEIGHT, borderRadius: MAP_ISLAND_ACTION_HEIGHT / 2,
    backgroundColor: '#ffffff1f', alignItems: 'center', justifyContent: 'center' },
  commandBolt: { position: 'absolute', top: 6, left: 7 },
  cta: { flex: 1, minHeight: MAP_ISLAND_ACTION_HEIGHT, borderRadius: MAP_ISLAND_ACTION_HEIGHT / 2 },
  ctaBase: { backgroundColor: '#354FC5' },
  ctaFace: { flex: 1, minHeight: MAP_ISLAND_ACTION_HEIGHT, borderRadius: MAP_ISLAND_ACTION_HEIGHT / 2, overflow: 'hidden',
    backgroundColor: '#ffffff1f',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 8 },
  ctaRaisedFace: { minHeight: MAP_ISLAND_ACTION_HEIGHT - JOURNEY_BUTTON_DEPTH,
    marginBottom: JOURNEY_BUTTON_DEPTH, backgroundColor: D6_ACCENT },
  ctaSoftPressed: { opacity: 0.85 },
  ctaFaceLarge: { paddingVertical: 4 },
  ctaText: { color: '#fff', textAlign: 'center', fontSize: APP_TEXT_SIZE.body, fontWeight: '800' },
  ctaTextLarge: { fontSize: APP_TEXT_SIZE.heading },
  ctaFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, transformOrigin: 'left center', backgroundColor: D6_ACCENT },
  busy: { opacity: 0.6 },
  error: { color: '#ffb5b5', paddingHorizontal: 12, paddingBottom: 4 },
});
