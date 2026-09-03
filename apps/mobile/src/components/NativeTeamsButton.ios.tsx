import React from 'react';
import { Host, Button, HStack, Text } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  backgroundOverlay,
  buttonBorderShape,
  buttonStyle,
  cornerRadius,
  font,
  foregroundColor,
  frame,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../native';
import type { NativeTeamsButtonProps } from './NativeTeamsButton';

export default function NativeTeamsButton({ label, count, onPress, accessibilityLabel: a11yLabel, testID, style }: NativeTeamsButtonProps) {
  return (
    <Host style={[{ minHeight: 50 }, style]} colorScheme="dark">
      <Button
        onPress={onPress}
        testID={testID}
        modifiers={[
          buttonStyle(liquidGlass.isLiquidGlassAvailable() ? 'glass' : 'bordered'),
          buttonBorderShape('capsule'),
          frame({ minHeight: 50 }),
          accessibilityLabel(a11yLabel),
        ]}
      >
        <HStack spacing={8} alignment="center" modifiers={[padding({ horizontal: 32, vertical: 10 })]}>
          <Text modifiers={[font({ size: 16, weight: 'bold' }), foregroundColor('#fff')]}>{label}</Text>
          <Text modifiers={[font({ size: 14, weight: 'bold' }), foregroundColor('#ff9500'), backgroundOverlay({ color: 'rgba(255,149,0,0.24)' }), cornerRadius(12), padding({ horizontal: 7, vertical: 3 })]}>{String(count)}</Text>
        </HStack>
      </Button>
    </Host>
  );
}
