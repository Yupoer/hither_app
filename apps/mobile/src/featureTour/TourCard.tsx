import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
}: TourCardProps) {
  return (
    <View style={styles.card} accessibilityRole="summary" accessibilityLabel={accessibilityLabel}>
      <View style={styles.copy}>
        {title.trim().length > 0 ? (
          <Text style={styles.title} maxFontSizeMultiplier={1.6}>{title}</Text>
        ) : null}
        <Text style={styles.body} maxFontSizeMultiplier={1.6}>{body}</Text>
      </View>
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
    backgroundColor: glass.tourCard,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairlineSoft,
    overflow: 'hidden',
  },
  copy: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  title: { color: glass.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  body: { color: glass.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 16 },
  ctaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 18,
    minHeight: 104,
  },
  prevSlot: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  prevCta: {
    minHeight: 104,
    paddingHorizontal: 28,
    paddingVertical: 20,
    borderRadius: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  prevCtaText: { color: glass.textPrimary, fontSize: 16, fontWeight: '600' },
  cta: { backgroundColor: '#4C8DFF', minHeight: 104, paddingHorizontal: 28, paddingVertical: 20, borderRadius: 52 },
  ctaPressed: { opacity: 0.85 },
  ctaDisabled: { opacity: 0.55 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
