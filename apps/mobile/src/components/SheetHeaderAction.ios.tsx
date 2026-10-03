import React from 'react';
import { Host } from '@expo/ui/swift-ui';
import { Pressable, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SheetHeaderActionVisual,
  type SheetHeaderActionKind,
} from './SheetHeaderActionContent.ios';
import ReactNativeSheetHeaderAction from './ReactNativeSheetHeaderAction';
import { liquidGlass } from '../native';
import { MAP_SHEET_ACTION_HIT_SIZE } from './mapSheetChrome';

export type { SheetHeaderActionKind } from './SheetHeaderActionContent.ios';

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
  if (!liquidGlass.isLiquidGlassAvailable()) {
    return <ReactNativeSheetHeaderAction {...{ action, onPress, accessibilityLabel, disabled, style }} />;
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.hit, style, pressed && styles.pressed]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <View pointerEvents="none" accessible={false} accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants" collapsable={false}>
        <Host style={styles.host} colorScheme="dark" matchContents={false} pointerEvents="none">
          <SheetHeaderActionVisual action={action} />
        </Host>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { width: MAP_SHEET_ACTION_HIT_SIZE, height: MAP_SHEET_ACTION_HIT_SIZE,
    alignItems: 'center', justifyContent: 'center' },
  host: { width: MAP_SHEET_ACTION_HIT_SIZE, height: MAP_SHEET_ACTION_HIT_SIZE },
  pressed: { opacity: 0.82 },
});
