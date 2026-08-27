import React from 'react';
import type { ViewStyle } from 'react-native';
import { Host, Button } from '@expo/ui/swift-ui';
import {
  accessibilityLabel as accessibilityLabelModifier,
  accessibilityHint as accessibilityHintModifier,
  buttonStyle,
  buttonBorderShape,
  disabled as disabledModifier,
  frame,
  foregroundColor as foregroundColorModifier,
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
  size,
  width,
  height,
  foregroundColor,
}: NativeGlassButtonProps) {
  const fixedWidth = width ?? size;
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
    ...(foregroundColor ? [foregroundColorModifier(foregroundColor)] : []),
    ...(disabled ? [disabledModifier(true)] : []),
    ...(fixedWidth
      ? [frame({ width: fixedWidth, height: size ?? height })]
      : layout === 'square'
        ? [frame({ width: 52, height: 52 })]
        : layout === 'fill'
          ? [frame({ minWidth: 0, maxWidth: Infinity, height: height ?? 52 })]
          : height
            ? [frame({ minWidth: 0, maxWidth: Infinity, height })]
            : []),
  ];
  const hostSizing: ViewStyle | null = fixedWidth
    ? { width: fixedWidth, height: size ?? height }
    : layout === 'square'
      ? { width: 52, height: 52 }
      : layout === 'fill'
        ? { width: '100%', height: height ?? 52 }
        : height
          ? { width: '100%', height }
        : null;
  return (
    <Host matchContents={!(fixedWidth || height || layout)} style={[hostSizing, style]}>
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
