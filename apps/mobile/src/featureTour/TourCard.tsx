import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { glass } from '../glass';

export type TourCardProps = {
  title: string;
  body: string;
  ctaLabel: string;
  prevLabel: string;
  canGoPrev: boolean;
  ctaDisabled: boolean;
  onPrev?: () => void;
  onNext: () => void;
  accessibilityLabel: string;
  maxCardHeight?: number;
  ctaReservePx?: number;
  minCardHeight?: number;
};

/** Android/older-runtime tour card. iOS resolves TourCard.ios.tsx instead. */
export default function TourCard({
  title,
  body,
  ctaLabel,
  prevLabel,
  canGoPrev,
  ctaDisabled,
  onPrev,
  onNext,
  accessibilityLabel,
  maxCardHeight = 320,
  ctaReservePx = 56,
  minCardHeight = 0,
}: TourCardProps) {
  return (
    <View style={[styles.card, minCardHeight > 0 && { minHeight: minCardHeight }]} accessibilityRole="summary" accessibilityLabel={accessibilityLabel}>
      <ScrollView
        bounces={false}
        nestedScrollEnabled
        style={[
          styles.copyScroll,
          { maxHeight: Math.max(96, maxCardHeight - Math.max(ctaReservePx, 70)) },
        ]}
        contentContainerStyle={styles.copy}
      >
        {title.trim().length > 0 ? (
          <Text style={styles.title} maxFontSizeMultiplier={1.6}>{title}</Text>
        ) : null}
        <Text style={styles.body} maxFontSizeMultiplier={1.6}>{body}</Text>
      </ScrollView>
      <View style={styles.ctaRow}>
        <View style={styles.prevSlot}>
          {canGoPrev && onPrev ? (
            <Pressable
              testID="tour-prev"
              onPress={onPrev}
              disabled={ctaDisabled}
              style={({ pressed }) => [styles.prevCta, pressed && styles.ctaPressed]}
              accessibilityRole="button"
              accessibilityLabel={prevLabel}
            >
              <Text style={styles.prevCtaText} maxFontSizeMultiplier={1.4}>{prevLabel}</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          testID="tour-next"
          onPress={onNext}
          disabled={ctaDisabled}
          style={({ pressed }) => [
            styles.cta,
            pressed && styles.ctaPressed,
            ctaDisabled && styles.ctaDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          accessibilityState={{ disabled: ctaDisabled }}
        >
          <Text style={styles.ctaText} maxFontSizeMultiplier={1.4}>{ctaLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: glass.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairlineSoft,
    overflow: 'hidden',
  },
  copyScroll: { flexGrow: 1, flexShrink: 1 },
  copy: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  title: { color: glass.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  body: { color: glass.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 16 },
  ctaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 18,
    minHeight: 70,
  },
  prevSlot: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  prevCta: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  prevCtaText: { color: glass.textPrimary, fontSize: 16, fontWeight: '600' },
  cta: { backgroundColor: '#4C8DFF', minHeight: 52, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 26 },
  ctaPressed: { opacity: 0.85 },
  ctaDisabled: { opacity: 0.55 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
