import React from 'react';
import { Host, Button, HStack, Text } from '@expo/ui/swift-ui';
import { accessibilityLabel, background, buttonBorderShape, buttonStyle, clipShape, font, foregroundColor, frame, padding } from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../native';
import type { NativeTeamsButtonProps } from './NativeTeamsButton';

export default function NativeTeamsButton({ label, count, width, onPress, accessibilityLabel: a11yLabel, testID, style }: NativeTeamsButtonProps) {
  return (
    <Host matchContents={width == null} style={[{ width, height: 56, alignSelf: 'center' }, style]} colorScheme="dark">
      <Button onPress={onPress} testID={testID} modifiers={[
        buttonStyle(liquidGlass.isLiquidGlassAvailable() ? 'glass' : 'bordered'),
        buttonBorderShape('capsule'), frame({ width, height: 56 }),
        accessibilityLabel(count > 0 ? `${a11yLabel}, ${count}` : a11yLabel),
      ]}>
        <HStack spacing={8} modifiers={[padding({ horizontal: width == null ? 28 : 12 }), frame({ height: 32 })]}>
          <Text modifiers={[font({ size: 17.5, weight: 'bold' }), foregroundColor('#fff')]}>{label}</Text>
          {count > 0 ? <Text modifiers={[
            font({ size: 15, weight: 'heavy' }), foregroundColor('#ff9500'),
            padding({ horizontal: 7 }), frame({ minWidth: 26, height: 26 }),
            background('rgba(255,149,0,0.28)'), clipShape('capsule'),
          ]}>{count}</Text> : null}
        </HStack>
      </Button>
    </Host>
  );
}
