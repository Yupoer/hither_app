import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Host, Button, Text as SwiftText, VStack, HStack, Spacer } from '@expo/ui/swift-ui';
import { accessibilityLabel, background, buttonStyle, buttonBorderShape, cornerRadius,
  disabled as disabledModifier, dynamicTypeSize, font, foregroundColor, frame, glassEffect, padding, lineLimit, minimumScaleFactor } from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../native';
import { glass } from '../glass';
import type { TourCardProps } from './TourCard';

/** Native SwiftUI material, copy and buttons; only copy scrolls within the RN viewport. */
export default function TourCard({ title, body, ctaLabel, prevLabel, canGoPrev, ctaDisabled,
  onPrev, onNext, accessibilityLabel: a11yLabel, maxHeight, textScale = 1, fontScale = 1 }: TourCardProps) {
  const glassAvailable = liquidGlass.isLiquidGlassAvailable();
  const surfaceModifiers = glassAvailable
    ? [glassEffect({ glass: { variant: 'regular', interactive: false, tint: '#4B5362' },
      shape: 'roundedRectangle', cornerRadius: 16 })]
    : [background(glass.tourCard), cornerRadius(16)];
  const buttonModifiers = (prominent: boolean) => [
    buttonStyle(glassAvailable ? prominent ? 'glassProminent' : 'glass' : prominent ? 'borderedProminent' : 'bordered'),
    font({ size: 20 * textScale * fontScale, weight: 'semibold' }),
    frame({ minWidth: 0, maxWidth: Infinity, height: 55 }), buttonBorderShape('capsule'),
  ];
  // Explicit sizes include capped system scale once; SwiftUI must not scale again.
  const typeModifiers = [dynamicTypeSize({ min: 'large', max: 'large' })];
  return (
    <View style={{ maxHeight, borderRadius: 16, overflow: 'hidden' }} accessibilityRole="summary" accessibilityLabel={a11yLabel}>
      <Host style={StyleSheet.absoluteFill} matchContents={false} pointerEvents="none" colorScheme="dark">
        <VStack modifiers={[frame({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity }), ...surfaceModifiers]}><Spacer /></VStack>
      </Host>
      <ScrollView testID="tour-copy" style={{ flexGrow: 0, flexShrink: 1 }}>
        <Host style={{ width: '100%' }} matchContents={{ vertical: true }} colorScheme="dark" modifiers={typeModifiers}>
          <VStack spacing={8} alignment="leading" modifiers={[frame({ minWidth: 0, maxWidth: Infinity }), padding({ top: 16, leading: 18, trailing: 18, bottom: 8 })]}>
            {title.trim() ? <SwiftText modifiers={[font({ size: 18 * textScale * fontScale, weight: 'bold' }), foregroundColor(glass.textPrimary)]}>{title}</SwiftText> : null}
            <SwiftText modifiers={[font({ size: 15 * textScale * fontScale }), foregroundColor(glass.textSecondary)]}>{body}</SwiftText>
          </VStack>
        </Host>
      </ScrollView>
      <Host style={{ width: '100%', flexShrink: 0 }} matchContents={{ vertical: true }} colorScheme="dark" modifiers={typeModifiers}>
        <HStack spacing={8} alignment="center" modifiers={[frame({ minWidth: 0, maxWidth: Infinity }), padding({ top: 4, leading: 18, trailing: 18, bottom: 12 })]}>
          {canGoPrev && onPrev ? <Button onPress={onPrev} testID="tour-prev" modifiers={[...buttonModifiers(false), accessibilityLabel(prevLabel), ...(ctaDisabled ? [disabledModifier(true)] : [])]}><SwiftText modifiers={[lineLimit(1), minimumScaleFactor(0.8)]}>{prevLabel}</SwiftText></Button> : null}
          <Spacer />
          <Button onPress={onNext} testID="tour-next" modifiers={[...buttonModifiers(true), accessibilityLabel(ctaLabel), ...(ctaDisabled ? [disabledModifier(true)] : [])]}><SwiftText modifiers={[lineLimit(1), minimumScaleFactor(0.8)]}>{ctaLabel}</SwiftText></Button>
        </HStack>
      </Host>
    </View>
  );
}
