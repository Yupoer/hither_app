import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  findNodeHandle,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type LayoutRectangle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../i18n';
import { HOLE_RADIUS, paddedHole, placeTourCard, type OverlayHole } from './overlayLayout';

export interface GroupFeatureTourOverlayProps {
  visible: boolean;
  title: string;
  body: string;
  ctaLabel: string;
  targetRect: LayoutRectangle | null;
  /** Optional separate rect for tooltip placement (Stage Two shared tab strip). */
  placementRect?: LayoutRectangle | null;
  onNext: () => void;
  /** When true, skip fade-in and land at full opacity immediately. */
  reduceMotion?: boolean;
  /** Disable CTA while durable complete is in flight. */
  ctaDisabled?: boolean;
}

const DIM = 'rgba(0,0,0,0.62)';

function HoleCorner({
  hole,
  corner,
}: {
  hole: OverlayHole;
  corner: 'tl' | 'tr' | 'bl' | 'br';
}) {
  const r = HOLE_RADIUS;
  const pos =
    corner === 'tl'
      ? { top: hole.y, left: hole.x }
      : corner === 'tr'
        ? { top: hole.y, left: hole.x + hole.w - r }
        : corner === 'bl'
          ? { top: hole.y + hole.h - r, left: hole.x }
          : { top: hole.y + hole.h - r, left: hole.x + hole.w - r };
  const circlePos =
    corner === 'tl'
      ? { top: 0, left: 0 }
      : corner === 'tr'
        ? { top: 0, right: 0 }
        : corner === 'bl'
          ? { bottom: 0, left: 0 }
          : { bottom: 0, right: 0 };
  return (
    <View
      pointerEvents="none"
      style={[styles.holeCornerClip, pos]}
    >
      <View style={[styles.holeCornerFill, circlePos]} />
    </View>
  );
}

/**
 * Full-screen tour chrome: dim mask with a “hole” over the measured target,
 * tooltip card, and a single Next / Get started control. Blocks underlying UI.
 */
export function GroupFeatureTourOverlay({
  visible,
  title,
  body,
  ctaLabel,
  targetRect,
  placementRect = null,
  onNext,
  reduceMotion = false,
  ctaDisabled = false,
}: GroupFeatureTourOverlayProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const ctaRef = useRef<View>(null);
  // Animated.Value is stable; useState avoids ref.current during render (compiler).
  const [opacity] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  // Content key invalidates measured height without an effect setState.
  const contentKey = `${title}\0${body}\0${ctaLabel}`;
  const [cardLayout, setCardLayout] = useState<{ key: string; height: number | null }>({
    key: contentKey,
    height: null,
  });
  const cardHeight = cardLayout.key === contentKey ? cardLayout.height : null;

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [visible]);

  // Reduced motion: snap to full opacity. Otherwise short fade-in per step.
  useEffect(() => {
    if (!visible) {
      opacity.setValue(0);
      return;
    }
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [visible, title, body, reduceMotion, opacity]);

  // Move screen-reader focus to the step card / CTA when the step changes.
  useEffect(() => {
    if (!visible) return;
    const handle = findNodeHandle(ctaRef.current);
    if (handle == null) return;
    const timer = setTimeout(() => {
      AccessibilityInfo.setAccessibilityFocus?.(handle);
    }, 100);
    return () => clearTimeout(timer);
  }, [visible, title, ctaLabel]);

  const hole = useMemo(
    () => (targetRect ? paddedHole(targetRect) : null),
    [targetRect],
  );
  const placementHole = useMemo(() => {
    if (placementRect) return paddedHole(placementRect);
    return hole;
  }, [placementRect, hole]);

  const placement = useMemo(
    () =>
      placeTourCard({
        hole: placementHole,
        windowWidth: winW,
        windowHeight: winH,
        insets: { top: insets.top, bottom: insets.bottom },
        cardHeight,
      }),
    [placementHole, winW, winH, insets.top, insets.bottom, cardHeight],
  );

  const a11yLabel = [title, body].filter((part) => part.trim().length > 0).join('. ');

  const onCardLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h <= 0) return;
    setCardLayout((prev) => {
      if (prev.key === contentKey && prev.height === h) return prev;
      return { key: contentKey, height: h };
    });
  };

  if (!visible) return null;

  return (
    <View
      style={styles.root}
      pointerEvents="box-none"
      accessibilityViewIsModal
      importantForAccessibility="yes"
    >
      {/* Full-screen intercept */}
      <View style={StyleSheet.absoluteFill} pointerEvents="auto">
        {hole ? (
          <>
            <View style={[styles.dim, { top: 0, left: 0, right: 0, height: hole.y }]} />
            <View
              style={[
                styles.dim,
                { top: hole.y + hole.h, left: 0, right: 0, bottom: 0 },
              ]}
            />
            <View
              style={[
                styles.dim,
                { top: hole.y, left: 0, width: hole.x, height: hole.h },
              ]}
            />
            <View
              style={[
                styles.dim,
                {
                  top: hole.y,
                  left: hole.x + hole.w,
                  right: 0,
                  height: hole.h,
                },
              ]}
            />
            <HoleCorner hole={hole} corner="tl" />
            <HoleCorner hole={hole} corner="tr" />
            <HoleCorner hole={hole} corner="bl" />
            <HoleCorner hole={hole} corner="br" />
            <View
              pointerEvents="none"
              testID="tour-hole-ring"
              style={[
                styles.holeRing,
                {
                  top: hole.y,
                  left: hole.x,
                  width: hole.w,
                  height: hole.h,
                  borderRadius: HOLE_RADIUS,
                },
              ]}
            />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.dim]} />
        )}
      </View>

      <Animated.View
        onLayout={onCardLayout}
        style={[
          styles.card,
          {
            top: placement.cardTop,
            left: 20,
            right: 20,
            opacity,
            maxHeight: placement.maxCardHeight,
          },
        ]}
        accessibilityRole="summary"
        accessibilityLabel={a11yLabel}
      >
        <ScrollView
          bounces={false}
          nestedScrollEnabled
          style={{ maxHeight: Math.max(80, placement.maxCardHeight - 8) }}
          contentContainerStyle={styles.cardScrollContent}
        >
          {title.trim().length > 0 ? (
            <Text style={styles.title} maxFontSizeMultiplier={1.6}>{title}</Text>
          ) : null}
          <Text style={styles.body} maxFontSizeMultiplier={1.6}>{body}</Text>
          <Pressable
            ref={ctaRef}
            onPress={onNext}
            disabled={ctaDisabled}
            style={({ pressed }) => [
              styles.cta,
              pressed && styles.ctaPressed,
              ctaDisabled && styles.ctaDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel || t('tour.next')}
            accessibilityState={{ disabled: ctaDisabled }}
          >
            <Text style={styles.ctaText} maxFontSizeMultiplier={1.4}>
              {ctaLabel || t('tour.next')}
            </Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    zIndex: 10000,
    elevation: 10000,
  },
  dim: {
    position: 'absolute',
    backgroundColor: DIM,
  },
  holeRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  holeCornerClip: {
    position: 'absolute',
    width: HOLE_RADIUS,
    height: HOLE_RADIUS,
    overflow: 'hidden',
  },
  holeCornerFill: {
    position: 'absolute',
    width: HOLE_RADIUS * 2,
    height: HOLE_RADIUS * 2,
    borderRadius: HOLE_RADIUS,
    borderWidth: HOLE_RADIUS,
    borderColor: DIM,
  },
  card: {
    position: 'absolute',
    backgroundColor: '#1a2233',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  cardScrollContent: {
    padding: 18,
  },
  title: {
    color: '#F5F7FB',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    color: 'rgba(245,247,251,0.82)',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  cta: {
    alignSelf: 'flex-end',
    backgroundColor: '#4C8DFF',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  ctaPressed: { opacity: 0.85 },
  ctaDisabled: { opacity: 0.55 },
  ctaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default GroupFeatureTourOverlay;
