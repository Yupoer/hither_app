import React from 'react';
import { Host, Button } from '@expo/ui/swift-ui';
import {
  accessibilityLabel as accessibilityLabelModifier,
  accessibilityHint as accessibilityHintModifier,
  buttonStyle,
  buttonBorderShape,
  disabled as disabledModifier,
  frame,
  labelStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../native';
import type { NativeGlassButtonProps } from './NativeGlassButton';

/** SwiftUI button styles are native on iOS 26 and bordered on older iOS. */
export default function NativeGlassButton({
  label,
  systemImage,
  onPress,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
  variant = 'glass',
  role = 'default',
  tintColor,
  layout,
  shape = label ? 'capsule' : 'circle',
}: NativeGlassButtonProps) {
  const styleName = liquidGlass.isLiquidGlassAvailable()
    ? variant
    : variant === 'glassProminent'
      ? 'borderedProminent'
      : 'bordered';
  const modifiers = [
    buttonStyle(styleName),
    buttonBorderShape(shape),
    accessibilityLabelModifier(accessibilityLabel),
    ...(accessibilityHint ? [accessibilityHintModifier(accessibilityHint)] : []),
    ...(systemImage && !label ? [labelStyle('iconOnly' as const)] : []),
    ...(tintColor ? [tint(tintColor)] : []),
    ...(disabled ? [disabledModifier(true)] : []),
    ...(layout === 'square'
      ? [frame({ width: 52, height: 52 })]
      : layout === 'fill'
        ? [frame({ minWidth: 0, maxWidth: Infinity, minHeight: 52, maxHeight: 52 })]
        : []),
  ];
  return (
    <Host matchContents style={style}>
      <Button
        label={label ?? accessibilityLabel}
        systemImage={systemImage as never}
        role={role}
        onPress={onPress}
        testID={testID}
        modifiers={modifiers}
      />
    </Host>
  );
}
