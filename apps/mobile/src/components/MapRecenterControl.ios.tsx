import React from 'react';
import { Host, Button, Divider, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonBorderShape,
  buttonStyle,
  cornerRadius,
  frame,
  foregroundColor,
  glassEffect,
  labelStyle,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../native';
import { glass } from '../glass';
import type { MapRecenterControlProps } from './MapRecenterControl';

/** One native Liquid Glass capsule containing two plain SwiftUI buttons. */
export default function MapRecenterControl({
  onFitAll,
  onLocate,
  fitAllLabel,
  locateLabel,
  style,
}: MapRecenterControlProps) {
  const available = liquidGlass.isLiquidGlassAvailable();
  const surface = available
    ? [glassEffect({ glass: { variant: 'regular', interactive: false }, shape: 'capsule' })]
    : [background('rgba(40, 44, 52, 0.9)'), cornerRadius(25)];
  const plainButton = (label: string) => [
    buttonStyle('plain'),
    buttonBorderShape('circle'),
    labelStyle('iconOnly' as const),
    frame({ width: 50, height: 47 }),
    foregroundColor(glass.textPrimary),
    accessibilityLabel(label),
  ];

  return (
    <Host matchContents={false} style={[{ width: 50, height: 96 }, style]}>
      <VStack spacing={0} modifiers={[frame({ width: 50, height: 96 }), ...surface]}>
        <Button
          label={fitAllLabel}
          systemImage="arrow.up.left.and.arrow.down.right"
          onPress={onFitAll}
          modifiers={plainButton(fitAllLabel)}
        />
        <Divider />
        <Button
          label={locateLabel}
          systemImage="location.fill"
          onPress={onLocate}
          modifiers={plainButton(locateLabel)}
        />
      </VStack>
    </Host>
  );
}
