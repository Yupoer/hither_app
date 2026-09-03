import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export type NativeTeamsButtonProps = {
  label: string;
  count: number;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export default function NativeTeamsButton({ label, count, onPress, accessibilityLabel, testID, style }: NativeTeamsButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [styles.button, style, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{label}</Text>
      <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 50, borderRadius: 25, paddingHorizontal: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)' },
  label: { color: '#fff', fontSize: 16, fontWeight: '700' },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,149,0,0.24)' },
  badgeText: { color: '#ff9500', fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.82 },
});
