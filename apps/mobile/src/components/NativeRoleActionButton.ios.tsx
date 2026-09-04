import React from 'react';
import { Host, Button, Image, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  disabled,
  font,
  foregroundColor,
  frame,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../native';
import type { NativeRoleActionButtonProps } from './NativeRoleActionButton';

/** Native SwiftUI role tile using iOS 26 Liquid Glass with bordered fallback. */
export default function NativeRoleActionButton({
  label,
  systemImage,
  onPress,
  accessibilityLabel: a11yLabel,
  testID,
  disabled: isDisabled = false,
  style,
}: NativeRoleActionButtonProps) {
  const resolvedSystemImage = systemImage === 'keypad' ? 'circle.grid.3x3.fill' : systemImage;
  return (
    <Host style={[{ flex: 1, aspectRatio: 1 }, style]} colorScheme="dark">
      <Button
        onPress={onPress}
        testID={testID}
        modifiers={[
          buttonStyle(liquidGlass.isLiquidGlassAvailable() ? 'glass' : 'bordered'),
          buttonBorderShape('roundedRectangle', 30),
          frame({ minWidth: 0, maxWidth: 10000, minHeight: 0, maxHeight: 10000 }),
          accessibilityLabel(a11yLabel),
          ...(isDisabled ? [disabled(true)] : []),
        ]}
      >
        <VStack alignment="center" spacing={10} modifiers={[padding({ all: 16 }), frame({ minWidth: 0, maxWidth: 10000, minHeight: 0, maxHeight: 10000 })]}>
          <VStack alignment="center" modifiers={[frame({ height: 56 })]}>
            <Image systemName={resolvedSystemImage as never} size={42} color="#fff" />
          </VStack>
          <Text modifiers={[foregroundColor('#fff'), font({ size: 17.5, weight: 'bold' })]}>{label}</Text>
        </VStack>
      </Button>
    </Host>
  );
}
