import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle, View } from 'react-native';
import { AppText as Text } from './AppText';
import Pressable from './MotionPressable';
import {
  MAP_SHEET_ACTION_HIT_SIZE,
  MAP_SHEET_ACTION_ICON_SIZE,
  MAP_SHEET_ACTION_VISUAL_SIZE,
  type SheetHeaderActionKind,
} from './mapSheetChrome';

export type { SheetHeaderActionKind } from './mapSheetChrome';
export type SheetHeaderActionProps = {
  action: SheetHeaderActionKind;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

const ICONS = {
  close: ['close', '×'],
  commit: ['checkmark', '✓'],
  share: ['share-outline', '↑'],
  back: ['chevron-back', '‹'],
  more: ['ellipsis-horizontal', '…'],
  favorite: ['heart-outline', '♡'],
  favorited: ['heart', '♥'],
} satisfies Record<SheetHeaderActionKind, readonly [string, string]>;

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

/** Stable RN header action for platforms without Liquid Glass. */
export default function SheetHeaderAction({
  action,
  onPress,
  accessibilityLabel,
  testID,
  disabled = false,
  style,
}: SheetHeaderActionProps) {
  const Icon = getIonicons();
  return (
    <Pressable
      style={({ pressed }) => [styles.hit, style, pressed && styles.pressed]}
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <View style={[styles.visual, styles.fallbackVisual]} pointerEvents="none"
        accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Icon ? (
          <Icon
            name={ICONS[action][0]}
            size={MAP_SHEET_ACTION_ICON_SIZE}
            color={action === 'favorited' ? '#FF8AA6' : '#fff'}
          />
        ) : (
          <Text style={styles.fallbackIcon}>{ICONS[action][1]}</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
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
