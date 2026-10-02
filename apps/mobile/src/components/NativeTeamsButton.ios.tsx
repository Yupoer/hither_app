import React from 'react';
import { Host, Button, HStack, Text } from '@expo/ui/swift-ui';
import { accessibilityLabel, background, buttonBorderShape, buttonStyle, clipShape, font, foregroundColor, frame, padding, lineLimit, minimumScaleFactor } from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../native';
import type { NativeTeamsButtonProps } from './NativeTeamsButton';

export default function NativeTeamsButton({ label, count, width, maxWidth, height = 56, fontSize = 17.5, horizontalPadding, onPress, accessibilityLabel: a11yLabel, testID, style }: NativeTeamsButtonProps) {
  return (
    <Host matchContents={width == null ? { horizontal: true } : false} style={[{ width, maxWidth, height, alignSelf: 'center' }, style]} colorScheme="dark">
      <Button onPress={onPress} testID={testID} modifiers={[
        buttonStyle(liquidGlass.isLiquidGlassAvailable() ? 'glass' : 'bordered'),
        buttonBorderShape('capsule'), frame({ width, height }),
        accessibilityLabel(count > 0 ? `${a11yLabel}, ${count}` : a11yLabel),
      ]}>
        <HStack spacing={8} modifiers={[padding({ horizontal: horizontalPadding ?? (width == null ? 28 : 12) }), frame({ width, maxWidth, minHeight: height - 16 })]}>
          <Text modifiers={[font({ size: fontSize, weight: 'bold' }), foregroundColor('#fff'), lineLimit(1), minimumScaleFactor(0.8)]}>{label}</Text>
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
