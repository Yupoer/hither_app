import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { glass } from '../glass';
import type { MapRecenterControlProps } from './MapRecenterControl';
import SwiftUIGlassSurface from './SwiftUIGlassSurface';

/** Native Liquid Glass capsule background with ordinary accessible RN controls. */
export default function MapRecenterControl({
  onFitAll,
  onLocate,
  fitAllLabel,
  locateLabel,
  style,
}: MapRecenterControlProps) {
  return (
    <View style={[styles.root, style]}>
      <SwiftUIGlassSurface shape="capsule" style={StyleSheet.absoluteFill} />
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
