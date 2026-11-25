import { HITHER_ACCENT } from '../../../theme/brand';
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
import Reanimated, { Easing, FadeIn, FadeOut, LinearTransition, runOnJS, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useD6PaneDrag, type D6PaneContentPart } from './useD6PaneDrag';
import { D6PaneFrame } from './D6PaneFrame';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SwiftUIGlassSurface from '../../../components/SwiftUIGlassSurface';
import GatheringCardParticles from '../../../components/GatheringCardParticles';
import OverflowMarquee from '../../../components/OverflowMarquee';
import { HitherText } from '../../../components/HitherText';
import { MAP_FLOATING_EDGE_INSET, MAP_FLOATING_GRABBER_HEIGHT, MAP_GATHERING_CORNER_RADIUS, MAP_ISLAND_ACTION_HEIGHT,
  MAP_ISLAND_BOTTOM_INSET, MAP_ISLAND_CORNER_RADIUS, MAP_ISLAND_GRABBER_HEIGHT, MAP_ISLAND_HEIGHT,
  MAP_ISLAND_SIDE_INSET, MAP_SHEET_ACTION_VISUAL_SIZE, SHEET_CORNER_ACTION_INSET, D6_SURFACE_COLORS, D6_SURFACE_BORDER_COLOR, D6_SURFACE_SOLID_COLOR, D6_TRIGGER_SHADOW_COLOR } from '../../../components/mapSheetChrome';
import MapRecenterControl from '../../../components/MapRecenterControl';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useForegroundUi, useVisibleUi } from '../../../state/foregroundUi';
import { liquidGlass } from '../../../native';
import { NativeD6GradientView } from '../../../native/d6Pane';
import { startJourneyHoldHaptics } from '../../../native/journeyHoldHaptics';
import { formatDistance, type TravelMode } from '../../../utils/geo';
import { D6_DAY_PALETTE } from '../d6Itinerary';
import type { Destination } from '../../../types';
import { d6MeetingDisplay, d6TravelTime } from '../d6GatheringHeader';
import { glass } from '../../../glass';
import { lightTap } from '../../../utils/haptics';
import { cancelledD6Touch, d6ActivationKind, type D6DragOwner } from './d6DragOwnership';
export { d6MeetingDisplay } from '../d6GatheringHeader';

export { HITHER_ACCENT as D6_ACCENT } from '../../../theme/brand';
export type D6Pane = 'itinerary' | 'team';
export type D6Journey = 'empty' | 'ready' | 'going' | 'arrived';
const FONT = 'BarlowCondensed-ExtraBoldItalic';
/** Stage one shows all stops or members; content taller than this share of the screen opens fully. */
const STAGE_ONE_LIMIT = 0.6;
const ITINERARY_BUTTON_SIZE = 52;
const TOP_BODY_INSET = 6;
const COMPACT_BODY_INSET = 14;
const GATHERING_CORNER_ACTION_INSET = MAP_GATHERING_CORNER_RADIUS - MAP_SHEET_ACTION_VISUAL_SIZE / 2;
const COMPACT_CORNER_ACTION = {
  marginTop: GATHERING_CORNER_ACTION_INSET - COMPACT_BODY_INSET,
  marginRight: GATHERING_CORNER_ACTION_INSET - SHEET_CORNER_ACTION_INSET,
};
const TEAM_BODY_INSET = 6;
const PANE_FIT_SLACK = 8;
const MIN_PANE_BODY = 120;
const ISLAND_HIDE_OVERSHOOT = 24;
const TOP_GRABBER_HEIGHT = 22;
const D6_COUNTDOWN_COLOR = '#7993FF';
const REMAINING_TIME_SCALE = 1.25;
const END_HOLD_MS = 1500;
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

const Grabber = React.memo(function Grabber({ gesture, detent, snapTo, pressCancelled, label, testID, height = MAP_FLOATING_GRABBER_HEIGHT }: Pick<ReturnType<typeof useD6PaneDrag>, 'gesture' | 'detent' | 'snapTo' | 'pressCancelled'> & {
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
          onPress={event => { if (!cancelledD6Touch(pressCancelled.get(), event)) snapTo(detent === 'closed' || detent === 'full' ? 'half' : 'closed'); }}
          style={[styles.grabTarget, { height }]} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
          <View style={styles.grab} />
        </MotionPressable>
      </View>
    </GestureDetector>
  );
});

type HeaderProps = {
  phase: D6Journey;
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

const Header = React.memo(function Header({ stop, phase,
  travelMode, distance, eta, arrived, total, displayFont, marqueeEnabled, marqueeSpeed, zh }: HeaderProps & { stop: Destination }) {
  const { fontScale, width } = useWindowDimensions();
  const visible = useVisibleUi();
  const [now, setNow] = useState(Date.now);
  const largeText = fontScale > 1.45;
  const unit = zh ? '分' : 'min';
  const time = d6MeetingDisplay(stop, phase, eta, now, zh ? 'zh-TW' : 'en-GB');
  const going = phase === 'going';
  const stacked = largeText || (going && width < 350 && time.kind === 'duration');
  const compactGoing = going && !stacked;
  const hasTime = time.kind !== 'none';
  const itineraryDay = phase === 'ready' && stop.day != null && stop.day > 0 ? stop.day : null;
  const showTrailing = hasTime || itineraryDay !== null;
  const titleMaxWidth = width / 2 + 64 - MAP_FLOATING_EDGE_INSET - SHEET_CORNER_ACTION_INSET - 1;
  const metricFont = displayFont ? { fontFamily: displayFont, fontStyle: 'normal' as const, fontWeight: '400' as const } : undefined;
  const label = stop.title;
  return (
    <Reanimated.View layout={HEADER_LAYOUT} style={[styles.headerRow, going && styles.headerRowGoing, stacked && styles.headerRowStacked]}>
      {visible && stop.meetAt && phase === 'ready' ? <MeetingClock key={stop.meetAt} onTick={setNow} /> : null}
      <Reanimated.View layout={HEADER_LAYOUT} style={[styles.headerMain, compactGoing && styles.headerMainGoing,
        !stacked && !going && hasTime && { maxWidth: titleMaxWidth }, stacked && styles.headerMainStacked]}>
        {!largeText && marqueeEnabled ? (
          <OverflowMarquee text={label} style={[styles.title, compactGoing && styles.titleGoing]} active={visible} pixelsPerSecond={marqueeSpeed} />
        ) : <HitherText typeRole="title" allowFontScaling={!largeText} style={[styles.title, compactGoing && styles.titleGoing, largeText && styles.titleLarge]}
          numberOfLines={largeText ? 2 : 1}>{label}</HitherText>}
        <Reanimated.View key={phase} layout={HEADER_LAYOUT} entering={HEADER_ENTER} exiting={HEADER_EXIT}
          style={[styles.facts, compactGoing && styles.factsGoing]}>
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
      </Reanimated.View>
      {showTrailing ? <View style={[styles.headerTrailing, stacked && styles.headerTrailingStacked]}>
        {hasTime ? (
          <Reanimated.View key={`${phase}:${time.kind}`} layout={HEADER_LAYOUT} entering={HEADER_ENTER} exiting={HEADER_EXIT}
            style={time.kind === 'status' ? styles.timeStatus : [styles.timeRow, compactGoing && styles.timeRowGoing, !going && styles.timeRowScheduled]}>
            {time.kind === 'status' ? <>
              <Ionicons name="navigate-outline" size={17} color={FACT_TINT.travel} />
              <HitherText testID="d6-home-meeting-time" style={styles.timeStatusText}>{zh ? '估算中' : 'Calculating'}</HitherText>
            </> : time.kind === 'duration' ? (
              <View accessible accessibilityLabel={zh ? `${time.hours} 小時 ${time.minutes} 分鐘` : `${time.hours} hours ${time.minutes} minutes`}
                testID="d6-home-meeting-time" style={styles.durationRow}>
                <HitherText typeRole="metric" allowFontScaling={!largeText} style={[styles.time, styles.durationTime, metricFont, styles.hot]}>{time.hours}</HitherText>
                <HitherText allowFontScaling={!largeText} style={[styles.timeUnit, styles.durationUnit, styles.hot]}>{zh ? '時' : 'h'}</HitherText>
                <HitherText typeRole="metric" allowFontScaling={!largeText} style={[styles.time, styles.durationTime, metricFont, styles.hot]}>{time.minutes}</HitherText>
                <HitherText allowFontScaling={!largeText} style={[styles.timeUnit, styles.durationUnit, styles.hot]}>{zh ? '分' : 'm'}</HitherText>
              </View>
            ) : <>
              <HitherText typeRole="metric" allowFontScaling={!largeText} testID="d6-home-meeting-time" numberOfLines={1} style={[
                styles.time, largeText && styles.timeLarge, time.unit && styles.remainingTime,
                largeText && time.unit && styles.remainingTimeLarge, compactGoing && styles.goingTime, metricFont, time.hot && styles.hot,
              ]}>{time.value}</HitherText>
              {time.unit ? <HitherText allowFontScaling={!largeText} style={[styles.timeUnit, styles.remainingUnit, largeText && styles.remainingUnitLarge, time.hot && styles.hot]}>{unit}</HitherText> : null}
            </>}
          </Reanimated.View>
        ) : null}
        {itineraryDay != null ? <HitherText typeRole="title" numberOfLines={1} style={styles.dayText}>
          {zh ? `第 ${itineraryDay} 天` : `Day ${itineraryDay}`}
        </HitherText> : null}
      </View> : null}
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

const JourneyButton = React.memo(function JourneyButton({ phase, pressCancelled, canLead, asked, busy, progress, reduceMotion, zh, onAction, onStop, interactive }: CtaProps & {
  interactive: boolean;
  pressCancelled: SharedValue<boolean>;
}) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.45;
  const base = Math.max(0, Math.min(1, progress ?? 0));
  const [fill] = useState(() => new Animated.Value(base));
  const [buttonDepth] = useState(() => new Animated.Value(0));
  const stopHoldFeedback = useRef<(() => void) | null>(null);
  const visible = useForegroundUi();
  const clearHoldFeedback = useCallback(() => {
    stopHoldFeedback.current?.();
    stopHoldFeedback.current = null;
  }, []);
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
      clearHoldFeedback();
      fill.stopAnimation();
      buttonDepth.stopAnimation();
    };
  });
  const animate = (target: number, duration: number) => Animated.timing(fill, { toValue: target, duration, useNativeDriver: true });
  const cancelHold = useCallback(() => {
    clearHoldFeedback();
    holding.current = false;
    stoppedTouch.current = true;
    fill.stopAnimation();
    fill.setValue(base);
    buttonDepth.stopAnimation();
    buttonDepth.setValue(0);
    setPressed(false);
  }, [base, buttonDepth, clearHoldFeedback, fill]);
  useAnimatedReaction(() => pressCancelled.get(), cancelled => {
    if (cancelled) runOnJS(cancelHold)();
  });
  const endWithConfirmation = () => Alert.alert(zh ? '結束導航？' : 'End navigation?', undefined, [
    { text: zh ? '取消' : 'Cancel', style: 'cancel' },
    { text: zh ? '結束導航' : 'End navigation', onPress: () => void onStop() },
  ]);
  const going = phase === 'going';
  const canHold = going && canLead && !screenReader && !busy && visible && interactive;
  const unavailable = !interactive || busy || (canLead ? false : going || phase === 'arrived' || phase === 'empty' || asked);
  const quiet = !canLead && (phase === 'empty' || phase === 'arrived' || asked);
  const elevated = !quiet;
  const depressed = pressed && !unavailable;
  const shadowVisible = elevated && !unavailable && !depressed;
  function moveFace(toValue: number) {
    if (reduceMotion) buttonDepth.setValue(0);
    else if (toValue === 0) Animated.spring(buttonDepth, { toValue: 0, stiffness: 340, damping: 18, mass: 0.8, useNativeDriver: true }).start();
    else Animated.timing(buttonDepth, { toValue, duration: 90, useNativeDriver: true }).start();
  }
  function runAction() {
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
        if (!holding.current || stoppedTouch.current || pressCancelled.get()) return;
        stoppedTouch.current = true;
        clearHoldFeedback();
        fill.stopAnimation();
        fill.setValue(1);
        void onStop();
      } : undefined}
      style={[styles.cta, shadowVisible && (going ? styles.ctaGoingShadow : styles.ctaShadow), busy && styles.busy]}
      onPressIn={() => {
        if (unavailable || pressCancelled.get()) return;
        stoppedTouch.current = false;
        setPressed(true);
        moveFace(JOURNEY_BUTTON_DEPTH);
        if (!canHold) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
          return;
        }
        holding.current = true;
        clearHoldFeedback();
        stopHoldFeedback.current = startJourneyHoldHaptics(END_HOLD_MS);
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
      onPress={event => {
        if (cancelledD6Touch(pressCancelled.get(), event)) return;
        if (stoppedTouch.current) {
          stoppedTouch.current = false;
          if (d6ActivationKind(event) === 'touch') return;
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
        elevated && !going && styles.ctaRaisedFace,
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
  stop: Destination | null;
  pane: D6Pane | null;
  onPaneChange: (pane: D6Pane | null) => void;
  itinerary: ReactNode;
  team: ReactNode;
  footer?: ReactNode;
  /** Actions that replace the island while the itinerary is in selection mode. */
  floatingActions?: ReactNode;
  selfEmoji: string;
  selfColor: string;
  statusColor: string;
  onProfile: () => void;
  onCommands: () => void;
  onFit: () => void;
  onLocate: () => void;
  suspended?: boolean;
  commandsPresented: boolean;
  celebration: SharedValue<number>;
  onTopHeight: (height: number) => void;
  lowPowerMode?: boolean | null;
  thermalState?: string | null;
  error?: string | null;
};

type PaneContent = { leading: number; content: number | null };
type ItineraryFit = { open: boolean; height: number };

export function D6HomeChrome(props: HomeChromeProps) {
  const { pane, onPaneChange, itinerary, team, footer, floatingActions, selfEmoji, selfColor, statusColor, onProfile, onCommands,
    onFit, onLocate, suspended = false, commandsPresented, celebration, onTopHeight,
    stop, canLead, zh, error, phase, lowPowerMode, thermalState } = props;
  const insets = useSafeAreaInsets();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const [headerHeight, setHeaderHeight] = useState(82);
  const owner = useSharedValue<D6DragOwner>('idle');
  const openPane = useSharedValue<D6Pane | null>(pane);
  const [islandControlsHeight, setIslandControlsHeight] = useState(MAP_ISLAND_HEIGHT - MAP_ISLAND_GRABBER_HEIGHT);
  const [itineraryContent, setItineraryContent] = useState<PaneContent>({ leading: 0, content: null });
  const [teamContent, setTeamContent] = useState<PaneContent>({ leading: 0, content: null });
  const compact = !stop;
  const topOpen = pane === 'itinerary';
  const teamOpen = pane === 'team';
  const islandHidden = commandsPresented || floatingActions != null;
  const interactive = !suspended && !commandsPresented;
  const topEdge = Math.max(56, insets.top - 3);
  const bottom = Math.max(24, insets.bottom - 8);
  const topClosed = compact ? TOP_GRABBER_HEIGHT : headerHeight + TOP_GRABBER_HEIGHT;
  const topVisibleHeight = compact ? ITINERARY_BUTTON_SIZE : topClosed;
  const islandClosed = islandControlsHeight + MAP_ISLAND_GRABBER_HEIGHT;
  const topMaxFull = Math.max(topClosed, screenHeight - topEdge - bottom - islandClosed - MAP_FLOATING_EDGE_INSET);
  const islandMaxFull = Math.max(islandClosed, screenHeight - bottom - topEdge);
  const islandBelowTop = Math.max(islandClosed, screenHeight - bottom - topEdge - topVisibleHeight - MAP_FLOATING_EDGE_INSET);

  const [itineraryFit, setItineraryFit] = useState<ItineraryFit>({ open: topOpen, height: 0 });
  const measuredItinerary = itineraryContent.content == null ? null
    : topClosed + (compact ? COMPACT_BODY_INSET : TOP_BODY_INSET) + itineraryContent.leading + itineraryContent.content + PANE_FIT_SLACK;
  if (itineraryFit.open !== topOpen) {
    setItineraryFit({ open: topOpen, height: topOpen ? measuredItinerary ?? 0 : 0 });
  } else if (topOpen && measuredItinerary != null && measuredItinerary > itineraryFit.height) {
    setItineraryFit({ ...itineraryFit, height: measuredItinerary });
  }
  const contentFull = (fit: number, closed: number, maxFull: number) => Math.min(maxFull, Math.max(closed + MIN_PANE_BODY, fit));
  const stageOneHeight = (fit: number, closed: number, full: number) => fit > screenHeight * STAGE_ONE_LIMIT ? full
    : Math.min(full, Math.max(closed + MIN_PANE_BODY, fit));
  const teamFit = islandClosed + (teamContent.content ?? 0) + TEAM_BODY_INSET;
  const topFull = contentFull(itineraryFit.height, topClosed, topMaxFull);
  const islandFull = contentFull(teamFit, islandClosed, islandMaxFull);
  const itineraryOpenHeight = stageOneHeight(itineraryFit.height, topClosed, topFull);
  const teamOpenHeight = stageOneHeight(teamFit, islandClosed, islandFull);

  const changeItinerary = useCallback((open: boolean) => onPaneChange(open ? 'itinerary' : null), [onPaneChange]);
  const changeTeam = useCallback((open: boolean) => onPaneChange(open ? 'team' : null), [onPaneChange]);
  const beginItineraryDrag = useCallback(() => {
    if (openPane.get() === 'team') onPaneChange(null);
  }, [onPaneChange, openPane]);
  const beginTeamDrag = useCallback(() => {
    if (openPane.get() === 'itinerary') onPaneChange(null);
  }, [onPaneChange, openPane]);
  const reportItinerary = useCallback((part: D6PaneContentPart) => setItineraryContent(current => ({ ...current, ...part })), []);
  const reportTeam = useCallback((part: D6PaneContentPart) => setTeamContent(current => ({ ...current, ...part })), []);
  const top = useD6PaneDrag({
    closed: topClosed,
    openHeight: itineraryOpenHeight,
    enabled: interactive,
    full: topFull,
    direction: 1, open: topOpen, reduceMotion: props.reduceMotion, owner,
    onOpenChange: changeItinerary, onDragBegin: beginItineraryDrag, onContentHeight: reportItinerary,
  });
  const island = useD6PaneDrag({
    closed: islandClosed, openHeight: teamOpenHeight, enabled: interactive && !islandHidden,
    full: islandFull,
    direction: -1, open: teamOpen, reduceMotion: props.reduceMotion, owner,
    onOpenChange: changeTeam, onDragBegin: beginTeamDrag, onContentHeight: reportTeam,
  });
  const topLabel = topOpen ? (zh ? '收合行程' : 'Close itinerary') : (zh ? '展開行程' : 'Open itinerary');
  const goRoute = () => {
    top.snapTo(top.detent === 'closed' || top.detent === 'full' ? 'half' : 'closed');
  };
  const openItineraryButton = () => top.snapTo('half');
  const showItinerary = topOpen || top.preview;
  const showTeam = teamOpen || island.preview;
  const itineraryCollapsed = compact && !showItinerary;
  const topHeight = top.height;
  const islandHeight = island.height;
  const islandOffset = useSharedValue(islandHidden ? 1 : 0);
  const particleTone = useAnimatedStyle(() => ({
    opacity: 1 - 0.45 * Math.min(1, Math.max(0, (topHeight.get() - topClosed) / 80)),
  }));
  const cueFrame = useAnimatedStyle(() => {
    const opacity = celebration.get();
    return { opacity, height: opacity > 0 ? topHeight.get() : 0 };
  });
  const cueScale = useAnimatedStyle(() => ({ transform: [{ scale: 0.76 + celebration.get() * 0.24 }] }));
  const topLift = useAnimatedStyle(() => {
    const span = islandMaxFull - islandBelowTop;
    const covered = span <= 0 ? 0 : Math.min(1, Math.max(0, (islandHeight.get() - islandBelowTop) / span));
    return { transform: [{ translateY: -covered * (topEdge + topVisibleHeight + MAP_FLOATING_EDGE_INSET) }] };
  });
  const cardWidth = screenWidth - MAP_FLOATING_EDGE_INSET * 2;
  const morph = useSharedValue(!compact || topOpen ? 1 : 0);
  const cardShape = useDerivedValue(() => compact
    ? Math.min(1, Math.max(0, (topHeight.get() - ITINERARY_BUTTON_SIZE) / Math.max(1, itineraryOpenHeight - ITINERARY_BUTTON_SIZE)))
    : morph.get());
  const itineraryMorph = useAnimatedStyle(() => {
    const progress = cardShape.get();
    return {
      width: ITINERARY_BUTTON_SIZE + (cardWidth - ITINERARY_BUTTON_SIZE) * progress,
      height: Math.max(ITINERARY_BUTTON_SIZE * (1 - progress), topHeight.get()),
      borderRadius: ITINERARY_BUTTON_SIZE / 2 + (MAP_GATHERING_CORNER_RADIUS - ITINERARY_BUTTON_SIZE / 2) * progress,
    };
  });
  const itineraryButtonMorph = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, cardShape.get() * 3) }));
  const islandShift = useAnimatedStyle(() => ({
    transform: [{ translateY: islandOffset.get() * (islandClosed + bottom + ISLAND_HIDE_OVERSHOOT) }],
  }));
  return (
    <View pointerEvents={interactive ? 'box-none' : 'none'}
      accessibilityElementsHidden={!interactive} importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
      style={[styles.layer, suspended && styles.suspended]}>
      {top.lifecycle}
      {island.lifecycle}
      <SyncPane key={pane ?? 'none'} pane={openPane} value={pane} />
      <MorphTo key={`${compact}:${topOpen}`} value={morph} expanded={!compact || topOpen} reduceMotion={props.reduceMotion} />
      <IslandVisibility key={String(islandHidden)} offset={islandOffset} hidden={islandHidden} reduceMotion={props.reduceMotion} />
      {compact ? <CompactTopHeight report={onTopHeight} /> : null}
      <Reanimated.View style={[StyleSheet.absoluteFill, topLift]} pointerEvents="box-none">
        <Reanimated.View style={[styles.topMorph, compact && styles.topMorphClip, { top: topEdge }, itineraryMorph]}
          pointerEvents={itineraryCollapsed ? 'none' : 'box-none'}
          accessibilityElementsHidden={itineraryCollapsed} importantForAccessibility={itineraryCollapsed ? 'no-hide-descendants' : 'auto'}>
          <D6PaneFrame panel={top} direction={1} cornerRadius={MAP_GATHERING_CORNER_RADIUS} grabberHeight={TOP_GRABBER_HEIGHT}
            cornerAction={compact ? COMPACT_CORNER_ACTION : undefined}
            style={[styles.top, { width: cardWidth }]} open={topOpen}
            surface={<D6Surface radius={MAP_GATHERING_CORNER_RADIUS} />}
            header={stop ? <View>
              {stop ? <Reanimated.View style={[styles.particleField, particleTone]} pointerEvents="none">
                <GatheringCardParticles running={phase === 'going' && !suspended}
                  lowPowerMode={lowPowerMode} thermalState={thermalState} />
              </Reanimated.View> : null}
              <MotionPressable testID="home-itinerary-toggle" accessibilityRole="button" accessibilityHint={topLabel}
                onPress={event => {
                  if (cancelledD6Touch(top.pressCancelled.get(), event)) return;
                  goRoute();
                }} style={styles.headingButton}
                onLayout={({ nativeEvent: { layout: { height } } }) => {
                  setHeaderHeight(height);
                  onTopHeight(height + TOP_GRABBER_HEIGHT);
                }}>
                <Header stop={stop} phase={phase} travelMode={props.travelMode}
                  distance={props.distance} eta={props.eta} arrived={props.arrived} total={props.total}
                  displayFont={props.displayFont} marqueeEnabled={props.marqueeEnabled} marqueeSpeed={props.marqueeSpeed} zh={zh} />
              </MotionPressable>
            </View> : undefined}
            body={showItinerary ? <View collapsable={false} testID="d6-route-viewport" onLayout={top.contentDidLayout}
              style={[styles.topBody, compact && styles.topBodyCompact]}>{itinerary}</View> : null}
            grabber={<Grabber gesture={top.gesture} detent={top.detent} snapTo={top.snapTo} pressCancelled={top.pressCancelled} label={topLabel} testID="home-itinerary-grabber" height={TOP_GRABBER_HEIGHT} />}
          />
        </Reanimated.View>
        {compact ? <Reanimated.View pointerEvents={itineraryCollapsed ? 'auto' : 'none'}
          style={[styles.itineraryButton, { top: topEdge }, itineraryButtonMorph]}>
          <MotionPressable testID="home-itinerary-button" accessibilityRole="button" onPress={openItineraryButton}
            accessibilityLabel={zh ? '查看行程' : 'View itinerary'} style={styles.itineraryButtonHit}>
            <D6Surface radius={ITINERARY_BUTTON_SIZE / 2} />
            <Ionicons name="calendar-outline" size={23} color="#fff" />
          </MotionPressable>
        </Reanimated.View> : null}
        <Reanimated.View testID="home-gathering-celebration" pointerEvents="none" accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.celebrationLayer, { top: topEdge }, cueFrame]}>
          <Reanimated.View style={[styles.celebrationBadge, cueScale]}>
            <Ionicons name="checkmark" size={24} color="#fff" />
          </Reanimated.View>
        </Reanimated.View>
      </Reanimated.View>
      {!pane && !top.preview && !island.preview && !suspended && !islandHidden ? <MapRecenterControl style={[styles.controls, { bottom: bottom + islandClosed + 16 }]}
        onFitAll={onFit} onLocate={onLocate} fitAllLabel={zh ? '縮放到全隊' : 'Fit team on map'}
        locateLabel={zh ? '回到我的位置' : 'Show my location'} /> : null}
      <Reanimated.View pointerEvents={islandHidden ? 'none' : 'box-none'}
        accessibilityElementsHidden={islandHidden} importantForAccessibility={islandHidden ? 'no-hide-descendants' : 'auto'}
        style={[StyleSheet.absoluteFill, islandShift]}>
        <D6PaneFrame panel={island} direction={-1} cornerRadius={MAP_ISLAND_CORNER_RADIUS} grabberHeight={MAP_ISLAND_GRABBER_HEIGHT}
          style={[styles.island, { bottom }]} open={teamOpen}
          surface={<D6Surface radius={MAP_ISLAND_CORNER_RADIUS} />}
          body={showTeam ? <View collapsable={false} testID="d6-team-viewport" onLayout={island.contentDidLayout} style={styles.teamBody}>
            {team}
          </View> : null}
          grabber={<Grabber gesture={island.gesture} detent={island.detent} snapTo={island.snapTo} pressCancelled={island.pressCancelled}
            label={teamOpen ? (zh ? '收合隊伍' : 'Close team') : (zh ? '展開隊伍' : 'Open team')}
            testID="home-team-toggle" height={MAP_ISLAND_GRABBER_HEIGHT} />}
          footer={<View style={styles.islandControls} onLayout={({ nativeEvent: { layout: { height } } }) => {
            if (!footer) setIslandControlsHeight(height);
          }}>
            {error && !topOpen ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            {footer ?? <View style={styles.islandRow}>
              <MotionPressable motion="depth" testID="home-profile" accessibilityRole="button" accessibilityLabel={zh ? '你' : 'You'} onPressIn={lightTap} onPress={event => { if (!cancelledD6Touch(island.pressCancelled.get(), event)) onProfile(); }} style={[styles.avatar, { backgroundColor: selfColor, borderColor: statusColor }]}>
                <Text allowFontScaling={false} style={styles.avatarEmoji}>{selfEmoji}</Text>
              </MotionPressable>
              <JourneyButton interactive={interactive} phase={phase} pressCancelled={island.pressCancelled} canLead={canLead} asked={props.asked} busy={props.busy}
                progress={props.progress} reduceMotion={props.reduceMotion} zh={zh} onAction={props.onAction} onStop={props.onStop} />
              <MotionPressable motion="depth" testID="home-commands" accessibilityRole="button" accessibilityLabel={zh ? '快捷指令' : 'Quick commands'} onPressIn={lightTap} onPress={event => { if (!cancelledD6Touch(island.pressCancelled.get(), event)) onCommands(); }} style={styles.commands}>
                <View>
                  <Ionicons name="chatbubble-outline" size={27} color="#fff" />
                  <Ionicons name="flash" size={13} color="#fff" style={styles.commandBolt} />
                </View>
              </MotionPressable>
            </View>}
          </View>}
        />
      </Reanimated.View>
      {floatingActions ? <Reanimated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)}
        pointerEvents="box-none" style={[styles.floatingActions, { bottom }]}>
        {floatingActions}
      </Reanimated.View> : null}
    </View>
  );
}

function SyncPane({ pane, value }: { pane: SharedValue<D6Pane | null>; value: D6Pane | null }) {
  useMountEffect(() => { pane.set(value); });
  return null;
}

function IslandVisibility({ offset, hidden, reduceMotion }: { offset: SharedValue<number>; hidden: boolean; reduceMotion: boolean }) {
  useMountEffect(() => {
    const target = hidden ? 1 : 0;
    offset.set(reduceMotion ? target : withTiming(target, { duration: hidden ? 240 : 320, easing: Easing.out(Easing.cubic) }));
  });
  return null;
}

function MorphTo({ value, expanded, reduceMotion }: { value: SharedValue<number>; expanded: boolean; reduceMotion: boolean }) {
  useMountEffect(() => {
    const target = expanded ? 1 : 0;
    value.set(reduceMotion ? target : withTiming(target, expanded
      ? { duration: 380, easing: Easing.out(Easing.cubic) }
      : { duration: 300, easing: Easing.out(Easing.cubic) }));
  });
  return null;
}

function CompactTopHeight({ report }: { report: (height: number) => void }) {
  useMountEffect(() => { report(ITINERARY_BUTTON_SIZE); });
  return null;
}

export const d6ChromeStyles = StyleSheet.create({
  text: { color: '#fff', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  muted: { color: '#ffffff99', fontSize: APP_TEXT_SIZE.caption, fontVariant: ['tabular-nums'] },
  primary: { minHeight: 56, borderRadius: 28, backgroundColor: HITHER_ACCENT, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  softButton: { minHeight: 44, borderRadius: 999, backgroundColor: '#ffffff1f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
});

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, zIndex: 55 },
  suspended: { opacity: 0 },
  hiddenIsland: { opacity: 0 },
  celebrationLayer: { position: 'absolute', left: MAP_FLOATING_EDGE_INSET, right: MAP_FLOATING_EDGE_INSET, zIndex: 1,
    borderRadius: MAP_GATHERING_CORNER_RADIUS, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000059' },
  celebrationBadge: { width: 42, height: 42, borderRadius: 21, backgroundColor: glass.ok, alignItems: 'center', justifyContent: 'center' },
  topMorph: { position: 'absolute', right: MAP_FLOATING_EDGE_INSET },
  topMorphClip: { overflow: 'hidden' },
  top: { position: 'absolute', right: 0, top: 0, borderRadius: MAP_GATHERING_CORNER_RADIUS },
  headingButton: { flexShrink: 0, paddingHorizontal: SHEET_CORNER_ACTION_INSET, paddingTop: 20, paddingBottom: 4 },
  particleField: { ...StyleSheet.absoluteFill, overflow: 'hidden',
    borderTopLeftRadius: MAP_GATHERING_CORNER_RADIUS, borderTopRightRadius: MAP_GATHERING_CORNER_RADIUS },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60 },
  headerRowGoing: { alignItems: 'flex-end' },
  headerRowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 4 },
  headerMain: { flex: 1, minWidth: 0, gap: 4, justifyContent: 'center', paddingStart: 1 },
  headerMainGoing: { gap: 0 },
  headerMainStacked: { flex: 0 },
  title: { color: '#fff', fontSize: APP_TEXT_SIZE.title, lineHeight: APP_TEXT_LINE_HEIGHT.title, fontWeight: '800' },
  titleGoing: { lineHeight: 22 },
  titleLarge: { fontSize: APP_TEXT_SIZE.heading, lineHeight: 37 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 14, rowGap: 4 },
  factsGoing: { marginTop: -6 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 22 },
  factIcon: { width: 18, height: 22, alignItems: 'center', justifyContent: 'center' },
  factText: { color: '#ffffffe8', fontSize: APP_TEXT_SIZE.body, lineHeight: APP_TEXT_LINE_HEIGHT.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  factTextLarge: { fontSize: APP_TEXT_SIZE.title, lineHeight: 29 },
  headerTrailing: { alignItems: 'flex-end', flexShrink: 0, gap: 3 },
  headerTrailingStacked: { alignSelf: 'flex-end' },
  dayText: { color: '#fff', fontSize: APP_TEXT_SIZE.title, fontWeight: '700' },
  timeRow: { marginLeft: 'auto', flexShrink: 0, flexDirection: 'row', alignItems: 'baseline', gap: 4, marginRight: 2 },
  timeRowGoing: { transform: [{ translateY: 5 }] },
  timeRowScheduled: { transform: [{ translateY: 5 }] },
  durationRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  durationTime: { lineHeight: 56 },
  durationUnit: { fontSize: APP_TEXT_SIZE.caption * REMAINING_TIME_SCALE },
  timeStatus: { marginLeft: 'auto', flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 16, backgroundColor: '#B4C7FF1F' },
  timeStatusText: { color: '#E0E9FF', fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
  time: { color: '#fff', fontSize: APP_TEXT_SIZE.metric, lineHeight: APP_TEXT_LINE_HEIGHT.metric, letterSpacing: 0.25, fontStyle: 'italic', fontWeight: '800', fontVariant: ['tabular-nums'] },
  timeLarge: { fontSize: APP_TEXT_SIZE.metric, lineHeight: 72 },
  timeUnit: { color: '#ffffffd0', fontSize: APP_TEXT_SIZE.body, fontWeight: '700' },
  remainingTime: { fontSize: APP_TEXT_SIZE.metric * REMAINING_TIME_SCALE, lineHeight: APP_TEXT_LINE_HEIGHT.metric * REMAINING_TIME_SCALE },
  remainingTimeLarge: { lineHeight: 72 * REMAINING_TIME_SCALE },
  goingTime: { fontSize: 70, lineHeight: 56 },
  remainingUnit: { fontSize: APP_TEXT_SIZE.body * REMAINING_TIME_SCALE },
  remainingUnitLarge: { fontSize: APP_TEXT_SIZE.title * REMAINING_TIME_SCALE },
  hot: { color: D6_COUNTDOWN_COLOR },
  topBody: { flex: 1, minHeight: 0, paddingHorizontal: SHEET_CORNER_ACTION_INSET, marginTop: TOP_BODY_INSET },
  topBodyCompact: { marginTop: COMPACT_BODY_INSET },
  itineraryButton: { position: 'absolute', right: MAP_FLOATING_EDGE_INSET, width: ITINERARY_BUTTON_SIZE, height: ITINERARY_BUTTON_SIZE },
  itineraryButtonHit: { flex: 1, borderRadius: ITINERARY_BUTTON_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  floatingActions: { position: 'absolute', left: MAP_FLOATING_EDGE_INSET, right: MAP_FLOATING_EDGE_INSET },
  teamBody: { flex: 1, minHeight: 0, paddingHorizontal: SHEET_CORNER_ACTION_INSET, marginBottom: TEAM_BODY_INSET },
  islandControls: { flexShrink: 0, paddingHorizontal: MAP_ISLAND_SIDE_INSET },
  grabArea: { flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  grabTarget: { width: 104, alignItems: 'center', justifyContent: 'center' },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#ffffff52' },
  controls: { position: 'absolute', right: MAP_FLOATING_EDGE_INSET },
  iconButton: { minWidth: 44, minHeight: 44, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  island: { position: 'absolute', left: MAP_FLOATING_EDGE_INSET, right: MAP_FLOATING_EDGE_INSET,
    borderRadius: MAP_ISLAND_CORNER_RADIUS },
  islandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MAP_ISLAND_ACTION_HEIGHT,
    marginTop: 'auto', marginBottom: MAP_ISLAND_BOTTOM_INSET },
  avatar: { height: MAP_ISLAND_ACTION_HEIGHT, width: MAP_ISLAND_ACTION_HEIGHT, borderRadius: MAP_ISLAND_ACTION_HEIGHT / 2,
    borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 28 },
  commands: { width: MAP_ISLAND_ACTION_HEIGHT, height: MAP_ISLAND_ACTION_HEIGHT, borderRadius: MAP_ISLAND_ACTION_HEIGHT / 2,
    backgroundColor: '#ffffff1f', alignItems: 'center', justifyContent: 'center' },
  commandBolt: { position: 'absolute', top: 6, left: 7 },
  cta: { flex: 1, minHeight: MAP_ISLAND_ACTION_HEIGHT, borderRadius: MAP_ISLAND_ACTION_HEIGHT / 2 },
  ctaShadow: { boxShadow: [{ offsetX: 0, offsetY: JOURNEY_BUTTON_DEPTH, blurRadius: 0, color: D6_TRIGGER_SHADOW_COLOR }] },
  ctaGoingShadow: { boxShadow: [{ offsetX: 0, offsetY: JOURNEY_BUTTON_DEPTH, blurRadius: 0, color: '#00000066' }] },
  ctaFace: { flex: 1, minHeight: MAP_ISLAND_ACTION_HEIGHT, borderRadius: MAP_ISLAND_ACTION_HEIGHT / 2, overflow: 'hidden',
    backgroundColor: '#ffffff1f',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 8 },
  ctaRaisedFace: { minHeight: MAP_ISLAND_ACTION_HEIGHT, backgroundColor: HITHER_ACCENT },
  ctaSoftPressed: { opacity: 0.85 },
  ctaFaceLarge: { paddingVertical: 4 },
  ctaText: { color: '#fff', textAlign: 'center', fontSize: APP_TEXT_SIZE.body, fontWeight: '800' },
  ctaTextLarge: { fontSize: APP_TEXT_SIZE.heading },
  ctaFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, transformOrigin: 'left center', backgroundColor: HITHER_ACCENT },
  busy: { opacity: 0.6 },
  error: { color: '#ffb5b5', paddingHorizontal: 12, paddingBottom: 4 },
});
