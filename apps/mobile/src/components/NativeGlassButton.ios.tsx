import React from 'react';
import type { ViewStyle } from 'react-native';
import { Host, Button, HStack, Image, Text, ZStack, Spacer } from '@expo/ui/swift-ui';
import {
  accessibilityLabel as accessibilityLabelModifier,
  accessibilityHint as accessibilityHintModifier,
  buttonStyle,
  buttonBorderShape,
  controlSize,
  font,
  disabled as disabledModifier,
  frame,
  foregroundColor as foregroundColorModifier,
  labelStyle,
  offset,
  padding,
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
  fontSize,
  fontWeight,
  imageSize,
  spacing,
  iconOffset,
  centerText,
}: NativeGlassButtonProps) {
  const iconOnly = Boolean(!label);
  const controlSizeValue = requestedControlSize
    ?? (size != null && size >= 88 ? 'extraLarge' : size != null && size >= 74 ? 'large' : ((size != null && size < 44) || (height != null && height < 44)) ? 'small' : 'regular');
  const controlDimension = controlSizeValue === 'extraLarge' ? 78 : controlSizeValue === 'large' ? 64 : ((size != null && size < 44) || (height != null && height < 44)) ? 36 : 52;
  const fixedWidth = width ?? size ?? (iconOnly ? controlDimension : undefined);
  const styleName = variant === 'glassProminent'
    ? 'borderedProminent'
    : liquidGlass.isLiquidGlassAvailable()
      ? variant
      : 'bordered';
  const borderShape = shape === 'roundedRectangle'
    ? buttonBorderShape(shape, cornerRadius)
    : buttonBorderShape(shape);
  const modifiers = [
    buttonStyle(styleName),
    borderShape,
    ...(requestedControlSize ? [controlSize(requestedControlSize)] : []),
    accessibilityLabelModifier(accessibilityLabel),
    ...(accessibilityHint ? [accessibilityHintModifier(accessibilityHint)] : []),
    ...(tintColor ? [tint(tintColor)] : []),
    ...(foregroundColor ? [foregroundColorModifier(foregroundColor)] : []),
    ...(disabled ? [disabledModifier(true)] : []),
    ...(fixedWidth
      ? [frame({ width: fixedWidth, height: size ?? height })]
      : layout === 'square'
        ? [frame({ width: 52, height: 52 })]
      : layout === 'fill'
        ? [frame({ minWidth: 0, maxWidth: 1000, height: height ?? 52 })]
        : layout === 'fit'
          ? [frame({ height: height ?? 52 })]
      : height
        ? [frame({ minWidth: 0, maxWidth: 1000, height })]
        : []),
  ];
  const hostSizing: ViewStyle | null = fixedWidth
    ? { width: fixedWidth, height: size ?? height }
    : layout === 'square'
      ? { width: 52, height: 52 }
      : layout === 'fill'
        ? { height: height ?? 52 }
        : layout === 'fit'
          ? { height: height ?? 52 }
        : height
          ? { height }
        : null;
  const hasCustomTypography = fontSize != null || imageSize != null || spacing != null;
  const button = iconOnly ? (
    <Button
      role={role}
      onPress={onPress}
      testID={testID}
      modifiers={modifiers}
    >
      <HStack alignment="center" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
        {systemImage ? (
          <Image
            systemName={systemImage as never}
            modifiers={[
              font({ size: imageSize ?? Math.round((size ?? controlDimension) * 0.44), weight: 'medium' }),
              ...(iconOffset ? [offset(iconOffset)] : systemImage === 'apple.logo' ? [offset({ y: -2.5 })] : []),
            ]}
          />
        ) : (
          <Image
            systemName="circle.fill"
            modifiers={[
              font({ size: imageSize ?? Math.round((size ?? controlDimension) * 0.44), weight: 'medium' }),
              foregroundColorModifier('rgba(0,0,0,0)'),
            ]}
          />
        )}
      </HStack>
    </Button>
  ) : layout === 'fill' ? (
    <Button
      role={role}
      onPress={onPress}
      testID={testID}
      modifiers={modifiers}
    >
      <HStack alignment="center" spacing={spacing ?? 8} modifiers={[frame({ width: fixedWidth, height: height ?? 52 })]}>
        {systemImage ? (
          <Image
            systemName={systemImage as never}
            modifiers={[
              font({ size: imageSize ?? 18, weight: 'medium' }),
              foregroundColorModifier(foregroundColor ?? '#fff'),
            ]}
          />
        ) : null}
        <Text modifiers={[font({ size: fontSize ?? 16, weight: fontWeight ?? 'bold' }), foregroundColorModifier(foregroundColor ?? '#fff')]}>
          {label ?? accessibilityLabel}
        </Text>
      </HStack>
    </Button>
  ) : centerText && systemImage && label ? (
    <Button
      role={role}
      onPress={onPress}
      testID={testID}
      modifiers={modifiers}
    >
      <ZStack alignment="center" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
        <Text
          modifiers={[
            font({ size: fontSize ?? 16, weight: fontWeight ?? 'semibold' }),
            foregroundColorModifier(foregroundColor ?? '#fff'),
          ]}
        >
          {label ?? accessibilityLabel}
        </Text>
        <HStack alignment="center" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), padding({ leading: 14 })]}>
          <Image
            systemName={systemImage as never}
            modifiers={[
              font({ size: imageSize ?? 17, weight: 'medium' }),
              foregroundColorModifier(foregroundColor ?? '#fff'),
              ...(iconOffset ? [offset(iconOffset)] : []),
            ]}
          />
          <Spacer />
        </HStack>
      </ZStack>
    </Button>
  ) : (systemImage && label) || hasCustomTypography ? (
    <Button
      role={role}
      onPress={onPress}
      testID={testID}
      modifiers={modifiers}
    >
      <HStack alignment="center" spacing={spacing ?? 8} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
        {systemImage ? (
          <Image
            systemName={systemImage as never}
            modifiers={[
              font({ size: imageSize ?? 17, weight: 'medium' }),
              foregroundColorModifier(foregroundColor ?? '#fff'),
            ]}
          />
        ) : null}
        <Text
          modifiers={[
            font({ size: fontSize ?? 16, weight: fontWeight ?? 'semibold' }),
            foregroundColorModifier(foregroundColor ?? '#fff'),
          ]}
        >
          {label ?? accessibilityLabel}
        </Text>
      </HStack>
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
