import React from 'react';
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  Text,
  type ViewStyle,
  View,
} from 'react-native';
import {
  MAP_SHEET_ACTION_HIT_SIZE,
  MAP_SHEET_ACTION_ICON_SIZE,
  MAP_SHEET_ACTION_VISUAL_SIZE,
} from './mapSheetChrome';

export type SheetHeaderActionKind = 'close' | 'commit';

type IconProps = { name: string; size: number; color: string };
let IoniconsComponent: React.ComponentType<IconProps> | null | undefined;

// Keep the node-only Jest runner independent from Expo's ESM icon bundle;
// native iOS/Android still resolve the real Ionicons component at runtime.
function getIonicons() {
  if (IoniconsComponent !== undefined) return IoniconsComponent;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    IoniconsComponent = (require('@expo/vector-icons') as { Ionicons?: React.ComponentType<IconProps> }).Ionicons ?? null;
  } catch {
    IoniconsComponent = null;
  }
  return IoniconsComponent;
}

/** Shared fallback header action; iOS swaps in the native glass implementation. */
export default function SheetHeaderAction({
  action,
  onPress,
  accessibilityLabel,
  disabled = false,
  style,
}: {
  action: SheetHeaderActionKind;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const Icon = getIonicons();
  return (
    <Pressable
      style={({ pressed }) => [styles.hit, style, pressed && styles.pressed]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <View style={[styles.visual, styles.fallbackVisual]}>
        {Icon ? (
          <Icon
            name={action === 'commit' ? 'checkmark' : 'close'}
            size={MAP_SHEET_ACTION_ICON_SIZE}
            color="#fff"
          />
        ) : (
          <Text style={styles.fallbackIcon}>{action === 'commit' ? '✓' : '×'}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: MAP_SHEET_ACTION_HIT_SIZE,
    height: MAP_SHEET_ACTION_HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visual: {
    width: MAP_SHEET_ACTION_VISUAL_SIZE,
    height: MAP_SHEET_ACTION_VISUAL_SIZE,
    borderRadius: MAP_SHEET_ACTION_VISUAL_SIZE / 2,
    overflow: 'hidden',
  },
  fallbackVisual: { backgroundColor: 'rgba(255,255,255,0.1)' },
  pressed: { opacity: 0.82 },
  fallbackIcon: {
    color: '#fff',
    fontSize: MAP_SHEET_ACTION_ICON_SIZE,
    lineHeight: MAP_SHEET_ACTION_ICON_SIZE,
    textAlign: 'center',
  },
});
