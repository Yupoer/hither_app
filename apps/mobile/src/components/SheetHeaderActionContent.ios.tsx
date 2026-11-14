import React from 'react';
import { Button, Image } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonBorderShape,
  buttonStyle,
  contentShape,
  disabled as disabledModifier,
  font,
  foregroundColor,
  frame,
  glassEffect,
  labelStyle,
  offset,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../native';
import {
  MAP_SHEET_ACTION_HIT_SIZE,
  MAP_SHEET_ACTION_ICON_SIZE,
  MAP_SHEET_ACTION_VISUAL_SIZE,
  SHEET_HEADER_SYMBOLS,
  type SheetHeaderActionKind,
} from './mapSheetChrome';
import type { SheetHeaderActionProps } from './ReactNativeSheetHeaderAction';

const SYMBOL_OFFSETS: Partial<Record<SheetHeaderActionKind, { x?: number; y?: number }>> = {
  share: { y: -2 },
  commit: { x: -0.33, y: -1 },
  back: { x: 0.67 },
};

export default function SheetHeaderActionContent({
  action,
  onPress,
  accessibilityLabel: label,
  testID,
  disabled = false,
}: Omit<SheetHeaderActionProps, 'style'>) {
  const glass = liquidGlass.isLiquidGlassAvailable();
  const symbolOffset = SYMBOL_OFFSETS[action];
  return (
    <Button
      role={action === 'close' ? 'cancel' : 'default'}
      testID={testID}
      onPress={disabled ? undefined : onPress}
      modifiers={[
        buttonStyle(glass ? 'plain' : 'bordered'),
        buttonBorderShape('circle'),
        frame({ width: MAP_SHEET_ACTION_VISUAL_SIZE, height: MAP_SHEET_ACTION_VISUAL_SIZE }),
        ...(glass
          ? [background('#ffffff26', shapes.circle()), glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })]
          : []),
        frame({ width: MAP_SHEET_ACTION_HIT_SIZE, height: MAP_SHEET_ACTION_HIT_SIZE }),
        labelStyle('iconOnly'),
        accessibilityLabel(label),
        ...(disabled ? [disabledModifier(true)] : []),
      ]}
    >
      <Image
        systemName={SHEET_HEADER_SYMBOLS[action]}
        modifiers={[
          font({ size: MAP_SHEET_ACTION_ICON_SIZE, weight: 'semibold' }),
          foregroundColor(action === 'favorited' ? '#FF8AA6' : '#fff'),
          ...(symbolOffset ? [offset(symbolOffset)] : []),
          frame({ maxWidth: Infinity, maxHeight: Infinity }),
          contentShape(shapes.circle()),
        ]}
      />
    </Button>
  );
}
