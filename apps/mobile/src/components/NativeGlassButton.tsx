import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export type NativeGlassButtonProps = {
  label?: string;
  systemImage?: string;
  onPress?: (event?: GestureResponderEvent) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  variant?: 'glass' | 'glassProminent';
  role?: 'default' | 'cancel' | 'destructive';
  selected?: boolean;
  busy?: boolean;
  tintColor?: string;
  foregroundColor?: string;
  layout?: 'square' | 'fill';
  shape?: 'circle' | 'capsule';
  /** Fixed square size for icon-only controls (defaults to 52pt). */
  size?: number;
  /** Explicit width for controls whose height is independent (e.g. fill rows). */
  width?: number;
  /** Fixed height for full-width controls (defaults to 52pt). */
  height?: number;
};

type FallbackIconProps = { name: string; size: number; color: string };
let FallbackIconComponent: React.ComponentType<FallbackIconProps> | null | undefined;

function getFallbackIcon() {
  if (FallbackIconComponent !== undefined) return FallbackIconComponent;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const icons = require('@expo/vector-icons') as { Ionicons?: React.ComponentType<FallbackIconProps> };
    FallbackIconComponent = icons.Ionicons ?? null;
  } catch {
    // Jest's node-only transform cannot load Expo's ESM icon bundle; text is
    // only a test/unsupported-runtime fallback and never used by native iOS.
    FallbackIconComponent = null;
  }
  return FallbackIconComponent;
}

const FALLBACK_ICON: Record<string, string> = {
  'star.fill': 'star',
  star: 'star-outline',
  'location.fill': 'navigate',
  location: 'navigate-outline',
  xmark: 'close',
  'square.and.arrow.up': 'share-outline',
  'arrow.up.left.and.arrow.down.right': 'expand-outline',
  'person.3.fill': 'people-outline',
  leaf: 'leaf-outline',
  checkmark: 'checkmark',
  eye: 'eye-outline',
  'eye.slash': 'eye-off-outline',
};

/** Android/older-runtime fallback for the iOS SwiftUI glass button. */
export default function NativeGlassButton({
  label,
  systemImage,
  onPress,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
  selected = false,
  busy = false,
  layout,
  shape = label ? 'capsule' : 'circle',
  size,
  width,
  height,
  foregroundColor = '#fff',
}: NativeGlassButtonProps) {
  const icon = systemImage ? FALLBACK_ICON[systemImage] ?? 'ellipse-outline' : null;
  const Icon = icon ? getFallbackIcon() : null;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.fallback,
        shape === 'circle' ? styles.circle : styles.capsule,
        layout === 'square' && styles.square,
        (size || width) ? { width: width ?? size, height: size ?? height, borderRadius: shape === 'circle' && size ? size / 2 : 26 } : null,
        height ? { height } : null,
        style,
        pressed && styles.pressed,
      ]}
      onPress={onPress as PressableProps['onPress']}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected, busy }}
      testID={testID}
    >
      {Icon ? <Icon name={icon ?? 'ellipse-outline'} size={26} color={foregroundColor} /> : icon ? <Text style={[styles.icon, { color: foregroundColor }]}>{icon}</Text> : null}
      {label ? <Text style={[styles.label, { color: foregroundColor }]}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  square: { width: 52, height: 52 },
  circle: { borderRadius: 26 },
  capsule: { minHeight: 52, borderRadius: 26, paddingHorizontal: 14 },
  pressed: { opacity: 0.82 },
  icon: { color: '#fff', fontSize: 26, lineHeight: 30 },
  label: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
