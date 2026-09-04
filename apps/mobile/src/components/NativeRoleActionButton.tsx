import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type NativeRoleActionButtonProps = {
  label: string;
  systemImage: string;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  disabled?: boolean;
  accent?: string;
  style?: StyleProp<ViewStyle>;
};

/** Android and pre-iOS-26 fallback for the native SwiftUI role tile. */
export default function NativeRoleActionButton({
  label,
  systemImage,
  onPress,
  accessibilityLabel,
  testID,
  disabled = false,
  accent = 'rgba(10, 16, 28, 0.65)',
  style,
}: NativeRoleActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [styles.tile, { backgroundColor: accent }, style, pressed && styles.pressed]}
    >
      <View style={styles.iconSlot}>
        <Ionicons name={systemImage === 'person.2.badge.plus' ? 'person-add-outline' : 'keypad'} size={42} color="#fff" />
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  iconSlot: { width: 60, height: 56, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 17.5, lineHeight: 21, fontWeight: '800', color: '#fff' },
  pressed: { opacity: 0.82 },
});
