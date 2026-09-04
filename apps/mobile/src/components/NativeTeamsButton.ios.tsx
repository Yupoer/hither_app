import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import SwiftUIGlassSurface from './SwiftUIGlassSurface';
import type { NativeTeamsButtonProps } from './NativeTeamsButton';

export default function NativeTeamsButton({ label, count, onPress, accessibilityLabel: a11yLabel, testID, style }: NativeTeamsButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      testID={testID}
      style={({ pressed }) => [styles.button, style, pressed && styles.pressed]}
    >
      <SwiftUIGlassSurface shape="capsule" style={StyleSheet.absoluteFill} />
      <Text style={styles.label}>{label}</Text>
      <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 56,
    borderRadius: 28,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'transparent',
    alignSelf: 'center',
    overflow: 'hidden',
  },
  label: { color: '#fff', fontSize: 17.5, fontWeight: '700' },
  badge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,149,0,0.28)',
  },
  badgeText: { color: '#ff9500', fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.82 },
});
