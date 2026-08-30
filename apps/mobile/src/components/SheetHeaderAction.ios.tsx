import React from 'react';
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SwiftUIGlassSurface from './SwiftUIGlassSurface';
import {
  MAP_SHEET_ACTION_ICON_SIZE,
  MAP_SHEET_ACTION_HIT_SIZE,
  MAP_SHEET_ACTION_VISUAL_SIZE,
} from './mapSheetChrome';

export type SheetHeaderActionKind = 'close' | 'commit';

/** iOS header action: one native Liquid Glass circle and one touch target. */
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
  return (
    <Pressable
      style={({ pressed }) => [styles.hit, style, pressed && styles.pressed]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <SwiftUIGlassSurface shape="circle" style={styles.visual}>
        <Ionicons
          name={action === 'commit' ? 'checkmark' : 'close'}
          size={MAP_SHEET_ACTION_ICON_SIZE}
          color="#fff"
        />
      </SwiftUIGlassSurface>
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
  pressed: { opacity: 0.82 },
});
