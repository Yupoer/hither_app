import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { glass } from '../glass';
import { GLOBAL_FONT_SCALE_CAP } from '../theme/typeScale';

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
  maxHeight?: number;
  textScale?: number;
  fontScale?: number;
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
  maxHeight,
  textScale = 1,
}: TourCardProps) {
  return (
    <View style={[styles.card, { maxHeight }]} accessibilityRole="summary" accessibilityLabel={accessibilityLabel}>
      <ScrollView testID="tour-copy" style={styles.copyScroll} contentContainerStyle={styles.copy}>
        {title.trim().length > 0 ? (
          <Text style={[styles.title, { fontSize: 18 * textScale }]} maxFontSizeMultiplier={GLOBAL_FONT_SCALE_CAP}>{title}</Text>
        ) : null}
        <Text style={[styles.body, { fontSize: 15 * textScale, lineHeight: 22 * textScale }]} maxFontSizeMultiplier={GLOBAL_FONT_SCALE_CAP}>{body}</Text>
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
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.prevCtaText, { fontSize: 20 * textScale }]} maxFontSizeMultiplier={GLOBAL_FONT_SCALE_CAP}>{prevLabel}</Text>
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
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.ctaText, { fontSize: 20 * textScale }]} maxFontSizeMultiplier={GLOBAL_FONT_SCALE_CAP}>{ctaLabel}</Text>
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
  copyScroll: { flexGrow: 0, flexShrink: 1 },
  copy: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8 },
  title: { color: glass.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  body: { color: glass.textSecondary, fontSize: 15, lineHeight: 22 },
  ctaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 12,
    paddingTop: 4,
    gap: 8,
    flexShrink: 0,
  },
  prevSlot: { flex: 1, minWidth: 0 },
  prevCta: {
    height: 55,
    minWidth: 0,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  prevCtaText: { color: glass.textPrimary, fontSize: 20, fontWeight: '600' },
  cta: { backgroundColor: '#4C8DFF', flex: 1, minWidth: 0, height: 55, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 28 },
  ctaPressed: { opacity: 0.85 },
  ctaDisabled: { opacity: 0.55 },
  ctaText: { color: '#fff', fontSize: 20, fontWeight: '600' },
});
