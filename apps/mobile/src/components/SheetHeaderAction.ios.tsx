import React from 'react';
import { Host } from '@expo/ui/swift-ui';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import SheetHeaderActionContent, {
  type SheetHeaderActionKind,
} from './SheetHeaderActionContent.ios';

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
  return (
    <Host style={[styles.host, style]} colorScheme="dark" matchContents={false}>
      <SheetHeaderActionContent
        action={action}
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
      />
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: 48, height: 48 },
});
