import React from 'react';
import { Button, Image } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  disabled as disabledModifier,
  frame,
  glassEffect,
  labelStyle,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../native';
import {
  MAP_SHEET_ACTION_HIT_SIZE,
  MAP_SHEET_ACTION_ICON_SIZE,
  MAP_SHEET_ACTION_VISUAL_SIZE,
} from './mapSheetChrome';

export type SheetHeaderActionKind = 'close' | 'commit';

/** Native SwiftUI header action shared by RN and native settings sheets. */
export default function SheetHeaderActionContent({
  action,
  onPress,
  accessibilityLabel: label,
  disabled = false,
}: {
  action: SheetHeaderActionKind;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  return (
    <Button
      role={action === 'commit' ? 'default' : 'cancel'}
      onPress={onPress}
      modifiers={[
        buttonStyle(liquidGlass.isLiquidGlassAvailable() ? 'plain' : 'bordered'),
        buttonBorderShape('circle'),
        frame({ width: MAP_SHEET_ACTION_VISUAL_SIZE, height: MAP_SHEET_ACTION_VISUAL_SIZE }),
        ...(liquidGlass.isLiquidGlassAvailable()
          ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })]
          : []),
        frame({ width: MAP_SHEET_ACTION_HIT_SIZE, height: MAP_SHEET_ACTION_HIT_SIZE }),
        labelStyle('iconOnly'),
        accessibilityLabel(label),
        ...(disabled ? [disabledModifier(true)] : []),
      ]}
    >
      <Image
        systemName={action === 'commit' ? 'checkmark' : 'xmark'}
        modifiers={[frame({
          width: MAP_SHEET_ACTION_ICON_SIZE,
          height: MAP_SHEET_ACTION_ICON_SIZE,
        })]}
      />
    </Button>
  );
}
