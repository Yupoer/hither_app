import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

export const DEFAULT_MARQUEE_PX_PER_SEC = 40;
export const MARQUEE_SPEED_MIN = 20;
export const MARQUEE_SPEED_MAX = 80;

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  /** When false, always show a static single-line ellipsis. Default true. */
  enabled?: boolean;
  /**
   * When false (e.g. off-screen carousel page), hold static ellipsis.
   * When true, wait {@link activationDelayMs} then start marquee if overflowing.
   * Default true.
   */
  active?: boolean;
  /** Delay after becoming active before the first scroll (ms). Default 1600. */
  activationDelayMs?: number;
  /** Constant scroll speed in px/s (all marquees share this). Default 40. */
  pixelsPerSecond?: number;
  /** Pause at the end before restarting the loop (ms). Default 1500. */
  endPauseMs?: number;
  /** Pause at the start of each loop cycle after the first (ms). Default 1000. */
  startPauseMs?: number;
};

/**
 * Tunnel marquee: measure OUTSIDE the clip so cold carousel mounts still get
 * full single-line width. Cave mouth (overflow:hidden) only wraps the viewport.
 *
 * Speed is constant px/s: duration = travel / pxPerSec (no min/max clamps that
 * change effective speed by title length).
 *
 * After the card becomes active, wait activationDelayMs (≈1–2s) holding the
 * static ellipsis, then run the loop:
 *   hold start → scroll left until end fully visible → hold end → snap → repeat.
 */
export default function OverflowMarquee({
  text,
  style,
  containerStyle,
  enabled = true,
  active = true,
  activationDelayMs = 1600,
  pixelsPerSecond = DEFAULT_MARQUEE_PX_PER_SEC,
  endPauseMs = 1500,
  startPauseMs = 1000,
}: Props) {
  const reduceMotion = useReducedMotion();
  const offset = useSharedValue(0);
  const [viewportW, setViewportW] = useState(0);
  const [textW, setTextW] = useState(0);
  /** True only after active + activationDelayMs (so swipe-in waits 1–2s). */
  const [armed, setArmed] = useState(false);
  /** Bump to remount measure host when layout was zero then became real. */
  const [measureGen, setMeasureGen] = useState(0);
  const retriedRef = useRef(false);

  const fontKey = useMemo(() => {
    const flat = StyleSheet.flatten(style) as TextStyle | undefined;
    if (!flat) return '';
    return [
      flat.fontSize ?? '',
      flat.fontFamily ?? '',
      flat.fontWeight ?? '',
      flat.letterSpacing ?? '',
      flat.fontVariant?.join(',') ?? '',
    ].join('|');
  }, [style]);

  const lineHeight = useMemo(() => {
    const flat = StyleSheet.flatten(style) as TextStyle | undefined;
    if (flat && typeof flat.lineHeight === 'number') return flat.lineHeight;
    if (flat && typeof flat.fontSize === 'number') {
      return Math.round(flat.fontSize * 1.2);
    }
    return undefined;
  }, [style]);

  const pxPerSec = useMemo(() => {
    const n = Number(pixelsPerSecond);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_MARQUEE_PX_PER_SEC;
    return Math.min(MARQUEE_SPEED_MAX, Math.max(MARQUEE_SPEED_MIN, n));
  }, [pixelsPerSecond]);

  useEffect(() => {
    setTextW(0);
    retriedRef.current = false;
    setMeasureGen((g) => g + 1);
  }, [text, fontKey]);

  // Arm only after the card has been the focused stop for ~1–2s.
  useEffect(() => {
    if (!enabled || !active) {
      setArmed(false);
      return;
    }
    setArmed(false);
    const delay = Math.max(0, activationDelayMs);
    const t = setTimeout(() => setArmed(true), delay);
    return () => clearTimeout(t);
  }, [active, activationDelayMs, enabled, text]);

  // When viewport first becomes usable but text still unmeasured, force one remeasure.
  useEffect(() => {
    if (!enabled || viewportW <= 0 || textW > 0 || retriedRef.current) return;
    const t = setTimeout(() => {
      if (textW > 0) return;
      retriedRef.current = true;
      setMeasureGen((g) => g + 1);
    }, 50);
    return () => clearTimeout(t);
  }, [enabled, textW, viewportW]);

  const overflow = textW > viewportW + 1 && viewportW > 0 && textW > 0;
  const shouldMarquee =
    Boolean(enabled) && Boolean(active) && armed && !reduceMotion && overflow;
  const travel = Math.max(0, textW - viewportW);

  useEffect(() => {
    cancelAnimation(offset);
    offset.value = 0;
    if (!shouldMarquee || travel <= 0) return;

    // Constant px/s — longer titles take longer, but all move at the same speed.
    const duration = Math.max(1, Math.round((travel / pxPerSec) * 1000));

    offset.value = withRepeat(
      withSequence(
        withDelay(
          startPauseMs,
          withTiming(-travel, {
            duration,
            easing: Easing.linear,
            reduceMotion: ReduceMotion.System,
          }),
        ),
        withDelay(
          endPauseMs,
          withTiming(0, {
            duration: 0,
            reduceMotion: ReduceMotion.System,
          }),
        ),
      ),
      -1,
      false,
    );

    return () => cancelAnimation(offset);
  }, [
    endPauseMs,
    offset,
    pxPerSec,
    shouldMarquee,
    startPauseMs,
    text,
    travel,
  ]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const onTextWidth = useCallback((w: number) => {
    if (w > 0) setTextW((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
  }, []);

  // Measure OUTSIDE overflow:hidden so carousel cold mounts get full line width.
  const measureNode = (
    <View
      key={`measure-${measureGen}`}
      style={styles.measureHost}
      pointerEvents="none"
      collapsable={false}
    >
      <Text
        style={[style, styles.measureText]}
        onTextLayout={(e) => {
          const w = e.nativeEvent.lines.reduce(
            (max, line) => Math.max(max, line.width),
            0,
          );
          onTextWidth(w);
        }}
        onLayout={(e) => {
          onTextWidth(e.nativeEvent.layout.width);
        }}
      >
        {text}
      </Text>
    </View>
  );

  return (
    <View
      style={[
        styles.outer,
        containerStyle,
        lineHeight != null && { height: lineHeight },
      ]}
    >
      {measureNode}
      <View style={[styles.mouth, lineHeight != null && { height: lineHeight }]}>
        <View
          style={[styles.viewport, lineHeight != null && { height: lineHeight }]}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0) {
              setViewportW((prev) => {
                if (Math.abs(prev - w) <= 0.5) return prev;
                // First real width: allow another measure pass if text was 0.
                if (prev <= 0) retriedRef.current = false;
                return w;
              });
            }
          }}
        >
          {shouldMarquee ? (
            <Animated.View
              style={[
                styles.track,
                textW > 0 ? { width: textW } : null,
                animatedStyle,
              ]}
              pointerEvents="none"
            >
              <Text
                style={[
                  style,
                  styles.scrollText,
                  textW > 0 ? { width: textW } : null,
                ]}
              >
                {text}
              </Text>
            </Animated.View>
          ) : (
            <Text style={style} numberOfLines={1} ellipsizeMode="tail">
              {text}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Flex slot for the title — does NOT clip (measure lives here). */
  outer: {
    flex: 1,
    minWidth: 0,
  },
  /** Cave mouth — only this clips the scrolling train. */
  mouth: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  viewport: {
    overflow: 'hidden',
    width: '100%',
    minWidth: 0,
  },
  track: {
    flexDirection: 'row',
    flexShrink: 0,
  },
  /**
   * Sibling of mouth (not inside overflow:hidden). Wide host so the full
   * string lays out on one line. Fully invisible.
   */
  measureHost: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    top: 0,
    zIndex: -1,
    width: 10000,
    overflow: 'visible',
  },
  measureText: {
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  scrollText: {
    flexShrink: 0,
  },
});
