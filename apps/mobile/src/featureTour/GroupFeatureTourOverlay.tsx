import React, { useEffect } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutRectangle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../i18n';

export interface GroupFeatureTourOverlayProps {
  visible: boolean;
  title: string;
  body: string;
  ctaLabel: string;
  targetRect: LayoutRectangle | null;
  onNext: () => void;
  /** When true, skip fade (reduce-motion). */
  reduceMotion?: boolean;
}

const HOLE_PAD = 8;
const HOLE_RADIUS = 14;
const DIM = 'rgba(0,0,0,0.62)';

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
  onNext,
  reduceMotion = false,
}: GroupFeatureTourOverlayProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [visible]);

  if (!visible) return null;

  const hole = targetRect
    ? {
        x: Math.max(0, targetRect.x - HOLE_PAD),
        y: Math.max(0, targetRect.y - HOLE_PAD),
        w: targetRect.width + HOLE_PAD * 2,
        h: targetRect.height + HOLE_PAD * 2,
      }
    : null;

  const placeAbove =
    hole != null && hole.y + hole.h > winH * 0.55;

  const cardTop = hole
    ? placeAbove
      ? Math.max(insets.top + 12, hole.y - 140)
      : Math.min(winH - insets.bottom - 160, hole.y + hole.h + 12)
    : winH * 0.35;

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
            {/* Four dim strips around the hole (keeps hole “clear”). */}
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
            {/* Non-interactive hole frame for visual ring */}
            <View
              pointerEvents="none"
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

      <View
        style={[
          styles.card,
          {
            top: cardTop,
            marginHorizontal: 20,
            opacity: reduceMotion ? 1 : 1,
          },
        ]}
        accessibilityRole="summary"
        accessibilityLabel={`${title}. ${body}`}
      >
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable
          onPress={onNext}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel || t('tour.next')}
        >
          <Text style={styles.ctaText}>{ctaLabel || t('tour.next')}</Text>
        </Pressable>
      </View>
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
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#1a2233',
    borderRadius: 16,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
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
  ctaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default GroupFeatureTourOverlay;
