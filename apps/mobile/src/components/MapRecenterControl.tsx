import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { liquidGlass } from '../native';
import { glass } from '../glass';
import { Ionicons } from '@expo/vector-icons';

export type MapRecenterControlProps = {
  onFitAll: () => void;
  onLocate: () => void;
  fitAllLabel: string;
  locateLabel: string;
  style?: StyleProp<ViewStyle>;
};

/** Android/older-runtime fallback for the native vertical glass control. */
export default function MapRecenterControl({
  onFitAll,
  onLocate,
  fitAllLabel,
  locateLabel,
  style,
}: MapRecenterControlProps) {
  return (
    <View style={[styles.root, style]}>
      <liquidGlass.GlassView glassStyle="regular" tintColor={glass.pill} style={StyleSheet.absoluteFill} />
      <Pressable
        style={styles.button}
        onPress={onFitAll}
        accessibilityRole="button"
        accessibilityLabel={fitAllLabel}
      >
        <Ionicons name="expand-outline" size={20} color={glass.textPrimary} />
      </Pressable>
      <View style={styles.divider} />
      <Pressable
        style={styles.button}
        onPress={onLocate}
        accessibilityRole="button"
        accessibilityLabel={locateLabel}
      >
        <Ionicons name="navigate" size={20} color={glass.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 50,
    height: 96,
    borderRadius: 25,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairlineSoft,
  },
  button: { width: 50, height: 47, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: glass.hairlineStrong },
});
