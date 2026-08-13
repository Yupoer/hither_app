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
import {
  holeRadius,
  paddedHole,
  placeTourCard,
  type OverlayHoleKind,
} from './overlayLayout';

export interface GroupFeatureTourOverlayProps {
  visible: boolean;
  title: string;
  body: string;
  ctaLabel: string;
  targetRect: LayoutRectangle | null;
  /** Optional separate rect for tooltip placement (Stage Two shared tab strip). */
  placementRect?: LayoutRectangle | null;
  /** Compact chips get a circular hole; gather/pane cards stay rounded-rect. */
  targetKind?: OverlayHoleKind;
  onNext: () => void;
  onPrev?: () => void;
  canGoPrev?: boolean;
  /** When true, skip fade-in and land at full opacity immediately. */
  reduceMotion?: boolean;
  /** Disable CTA while durable complete is in flight. */
  ctaDisabled?: boolean;
}

const DIM = 'rgba(0,0,0,0.62)';
const FADE_OUT_MS = 150;
const FADE_IN_MS = 180;
/** Title/body may scroll; keep Prev/Next outside the clipped region. */
const CTA_RESERVE_PX = 56;

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
  targetKind = 'card',
  onNext,
  onPrev,
  canGoPrev = false,
  reduceMotion = false,
  ctaDisabled = false,
}: GroupFeatureTourOverlayProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const ctaRef = useRef<View>(null);
  // Animated.Value is stable; useState avoids ref.current during render (compiler).
  const [opacity] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  // Fade only on copy change. Measure updates must not restart fade-out or
  // the overlay stays at opacity 0 (expand-card rect churn) and looks stuck.
  const stepKey = `${title}\0${body}\0${ctaLabel}`;
  const [shown, setShown] = useState({
    key: stepKey,
    title,
    body,
    ctaLabel,
  });
  const shownKeyRef = useRef(stepKey);
  const fadeGenRef = useRef(0);
  // Content key invalidates measured height without an effect setState.
  const contentKey = `${shown.title}\0${shown.body}\0${shown.ctaLabel}`;
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

  // Fade the whole chrome (dim + hole + ring + card) together on copy change.
  // Never require `finished` — a superseded timing would leave opacity at 0.
  useEffect(() => {
    if (!visible) {
      fadeGenRef.current += 1;
      opacity.setValue(0);
      return;
    }
    const nextShown = { key: stepKey, title, body, ctaLabel };
    if (reduceMotion) {
      const gen = ++fadeGenRef.current;
      shownKeyRef.current = stepKey;
      opacity.setValue(1);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 0,
        useNativeDriver: true,
      }).start(() => {
        if (gen !== fadeGenRef.current) return;
        setShown(nextShown);
      });
      return;
    }
    if (shownKeyRef.current === stepKey) {
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_IN_MS,
        useNativeDriver: true,
      }).start();
      return;
    }
    const gen = ++fadeGenRef.current;
    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_OUT_MS,
      useNativeDriver: true,
    }).start(() => {
      if (gen !== fadeGenRef.current) return;
      shownKeyRef.current = stepKey;
      setShown(nextShown);
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_IN_MS,
        useNativeDriver: true,
      }).start();
    });
  }, [visible, stepKey, title, body, ctaLabel, reduceMotion, opacity]);

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
  const r = hole ? holeRadius(hole, targetKind) : 0;
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

  const a11yLabel = [shown.title, shown.body].filter((part) => part.trim().length > 0).join('. ');
  const ctaBlocked = ctaDisabled;

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
      pointerEvents="auto"
      accessibilityViewIsModal
      importantForAccessibility="yes"
    >
      {/* Full-screen sink: swallows dim/hole touches. Does not call onNext. */}
      <View
        testID="tour-pointer-sink"
        style={StyleSheet.absoluteFill}
        pointerEvents="auto"
        onStartShouldSetResponder={() => true}
      />
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity }]}
      >
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
            <View
              testID="tour-hole-ring"
              style={[
                styles.holeRing,
                {
                  top: hole.y,
                  left: hole.x,
                  width: hole.w,
                  height: hole.h,
                  borderRadius: r,
                },
              ]}
            />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.dim]} />
        )}
      </Animated.View>

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
          style={{ maxHeight: Math.max(80, placement.maxCardHeight - CTA_RESERVE_PX) }}
          contentContainerStyle={styles.cardScrollContent}
        >
          {shown.title.trim().length > 0 ? (
            <Text style={styles.title} maxFontSizeMultiplier={1.6}>{shown.title}</Text>
          ) : null}
          <Text style={styles.body} maxFontSizeMultiplier={1.6}>{shown.body}</Text>
        </ScrollView>
        <View style={[styles.ctaRow, canGoPrev && onPrev ? styles.ctaRowWithPrev : null]}>
          {canGoPrev && onPrev ? (
            <Pressable
              testID="tour-prev"
              onPress={onPrev}
              disabled={ctaBlocked}
              style={({ pressed }) => [styles.prevCta, pressed && styles.ctaPressed]}
              accessibilityRole="button"
              accessibilityLabel={t('tour.prev')}
            >
              <Text style={styles.prevCtaText} maxFontSizeMultiplier={1.4}>
                {t('tour.prev')}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            ref={ctaRef}
            testID="tour-next"
            onPress={onNext}
            disabled={ctaBlocked}
            style={({ pressed }) => [
              styles.cta,
              pressed && styles.ctaPressed,
              ctaBlocked && styles.ctaDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={shown.ctaLabel || t('tour.next')}
            accessibilityState={{ disabled: ctaBlocked }}
          >
            <Text style={styles.ctaText} maxFontSizeMultiplier={1.4}>
              {shown.ctaLabel || t('tour.next')}
            </Text>
          </Pressable>
        </View>
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
    borderRadius: 0,
  },
  ctaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  ctaRowWithPrev: {
    justifyContent: 'space-between',
  },
  prevCta: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  prevCtaText: {
    color: 'rgba(245,247,251,0.9)',
    fontSize: 16,
    fontWeight: '600',
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
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 8,
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
