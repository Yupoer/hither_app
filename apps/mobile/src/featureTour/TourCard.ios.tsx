import React from 'react';
import { Host, Button, Text as SwiftText, VStack, HStack, Spacer } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonStyle,
  buttonBorderShape,
  cornerRadius,
  disabled as disabledModifier,
  dynamicTypeSize,
  font,
  foregroundColor,
  frame,
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../native';
import { glass } from '../glass';
import type { TourCardProps } from './TourCard';

/** Native SwiftUI copy and buttons; the RN parent still owns placement/animation. */
export default function TourCard({
  title,
  body,
  ctaLabel,
  prevLabel,
  canGoPrev,
  ctaDisabled,
  onPrev,
  onNext,
}: TourCardProps) {
  const glassAvailable = liquidGlass.isLiquidGlassAvailable();
  const surfaceModifiers = glassAvailable
    ? [
      glassEffect({
        glass: { variant: 'regular', interactive: false, tint: '#4B5362' },
        shape: 'roundedRectangle',
        cornerRadius: 16,
      }),
    ]
    : [background(glass.tourCard), cornerRadius(16)];
  const buttonModifiers = (prominent: boolean) => [
    buttonStyle(
      glassAvailable
        ? prominent ? 'glassProminent' : 'glass'
        : prominent ? 'borderedProminent' : 'bordered',
    ),
    padding({ horizontal: 28, vertical: 20 }),
    frame({ minHeight: 104 }),
    buttonBorderShape('capsule'),
  ];

  return (
    <Host
      style={{ width: '100%' }}
      matchContents
      colorScheme="dark"
      modifiers={[dynamicTypeSize({ max: 'accessibility3' })]}
    >
      <VStack
        spacing={0}
        alignment="leading"
        modifiers={[frame({ minWidth: 0, maxWidth: Infinity }), ...surfaceModifiers]}
      >
        <VStack
          spacing={8}
          alignment="leading"
          modifiers={[padding({ top: 18, leading: 18, trailing: 18, bottom: 8 })]}
        >
          {title.trim().length > 0 ? (
            <SwiftText
              modifiers={[
                font({ size: 18, weight: 'bold', textStyle: 'headline' }),
                foregroundColor(glass.textPrimary),
              ]}
            >
              {title}
            </SwiftText>
          ) : null}
          <SwiftText
            modifiers={[
              font({ size: 15, textStyle: 'body' }),
              foregroundColor(glass.textSecondary),
            ]}
          >
            {body}
          </SwiftText>
        </VStack>
        <HStack
          spacing={12}
          alignment="center"
          modifiers={[
            frame({ minWidth: 0, maxWidth: Infinity }),
            padding({ top: 8, leading: 18, trailing: 18, bottom: 18 }),
          ]}
        >
          {canGoPrev && onPrev ? (
            <Button
              label={prevLabel}
              onPress={onPrev}
              testID="tour-prev"
              modifiers={[
                ...buttonModifiers(false),
                accessibilityLabel(prevLabel),
                ...(ctaDisabled ? [disabledModifier(true)] : []),
              ]}
            />
          ) : <Spacer />}
          <Spacer />
          <Button
            label={ctaLabel}
            onPress={onNext}
            testID="tour-next"
            modifiers={[
              ...buttonModifiers(true),
              accessibilityLabel(ctaLabel),
              ...(ctaDisabled ? [disabledModifier(true)] : []),
            ]}
          />
        </HStack>
      </VStack>
    </Host>
  );
}
