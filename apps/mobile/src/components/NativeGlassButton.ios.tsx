import React from 'react';
import type { ViewStyle } from 'react-native';
import { Host, Button, Image } from '@expo/ui/swift-ui';
import {
  accessibilityLabel as accessibilityLabelModifier,
  accessibilityHint as accessibilityHintModifier,
  buttonStyle,
  buttonBorderShape,
  controlSize,
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
  cornerRadius = 18,
  size,
  width,
  height,
  controlSize: requestedControlSize,
  foregroundColor,
}: NativeGlassButtonProps) {
  const iconOnly = Boolean(systemImage && !label);
  const controlSizeValue = requestedControlSize
    ?? (size != null && size >= 78 ? 'extraLarge' : size != null && size >= 64 ? 'large' : 'regular');
  const controlDimension = controlSizeValue === 'extraLarge' ? 78 : controlSizeValue === 'large' ? 64 : 52;
  const fixedWidth = width ?? size ?? (iconOnly ? controlDimension : undefined);
  const iconFrameSize = iconOnly ? (size ?? controlDimension) : undefined;
  const styleName = liquidGlass.isLiquidGlassAvailable()
    ? variant
    : variant === 'glassProminent'
      ? 'borderedProminent'
      : 'bordered';
  const borderShape = shape === 'roundedRectangle'
    ? buttonBorderShape(shape, cornerRadius)
    : buttonBorderShape(shape);
  const modifiers = [
    buttonStyle(styleName),
    borderShape,
    controlSize(controlSizeValue),
    accessibilityLabelModifier(accessibilityLabel),
    ...(accessibilityHint ? [accessibilityHintModifier(accessibilityHint)] : []),
    ...(systemImage && !label ? [labelStyle('iconOnly' as const)] : []),
    ...(tintColor ? [tint(tintColor)] : []),
    ...(foregroundColor ? [foregroundColorModifier(foregroundColor)] : []),
    ...(disabled ? [disabledModifier(true)] : []),
    ...(!iconOnly && fixedWidth
      ? [frame({ width: fixedWidth, height: size ?? height })]
      : !iconOnly && layout === 'square'
        ? [frame({ width: 52, height: 52 })]
      : !iconOnly && layout === 'fill'
        ? [frame({ minWidth: 0, maxWidth: Infinity, height: height ?? 52 })]
        : !iconOnly && layout === 'fit'
          ? [frame({ height: height ?? 52 })]
      : !iconOnly && height
        ? [frame({ minWidth: 0, maxWidth: Infinity, height })]
        : []),
  ];
  const hostSizing: ViewStyle | null = fixedWidth
    ? { width: fixedWidth, height: size ?? height }
    : layout === 'square'
      ? { width: 52, height: 52 }
      : layout === 'fill'
        ? { width: '100%', height: height ?? 52 }
        : layout === 'fit'
          ? { height: height ?? 52 }
        : height
          ? { height }
        : null;
  const button = iconOnly && systemImage ? (
    <Button
      role={role}
      onPress={onPress}
      testID={testID}
      modifiers={modifiers}
    >
      <Image
        systemName={systemImage as never}
        modifiers={iconFrameSize ? [frame({ width: iconFrameSize, height: iconFrameSize })] : undefined}
      />
    </Button>
  ) : (
    <Button
      label={label ?? accessibilityLabel}
      systemImage={systemImage as never}
      role={role}
      onPress={onPress}
      testID={testID}
      modifiers={modifiers}
    />
  );
  return (
    <Host
      matchContents={!(fixedWidth || layout === 'square' || layout === 'fill' || (height && layout !== 'fit'))}
      style={[hostSizing, style]}
      colorScheme="dark"
    >
      {button}
    </Host>
  );
}
