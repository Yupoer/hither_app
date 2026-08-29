import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Host, Spacer, VStack } from '@expo/ui/swift-ui';
import {
  background,
  cornerRadius,
  frame,
  glassEffect,
} from '@expo/ui/swift-ui/modifiers';
import { Ionicons } from '@expo/vector-icons';
import { liquidGlass } from '../native';
import { glass, MAP_SURFACE_OPACITY } from '../glass';
import type { MapRecenterControlProps } from './MapRecenterControl';

/** Native Liquid Glass capsule background with ordinary accessible RN controls. */
export default function MapRecenterControl({
  onFitAll,
  onLocate,
  fitAllLabel,
  locateLabel,
  style,
}: MapRecenterControlProps) {
  const available = liquidGlass.isLiquidGlassAvailable();
  const surface = available
    ? [glassEffect({ glass: { variant: 'regular', interactive: false }, shape: 'capsule' })]
    : [background('rgba(40, 44, 52, 0.9)'), cornerRadius(25)];

  return (
    <View style={[styles.root, style]}>
      <Host matchContents={false} style={[StyleSheet.absoluteFill, { opacity: MAP_SURFACE_OPACITY }]}>
        <VStack spacing={0} modifiers={[frame({ width: 50, height: 96 }), ...surface]}>
          <Spacer modifiers={[frame({ width: 50, height: 47 })]} />
          <Spacer modifiers={[frame({ width: 50, height: 1 })]} />
          <Spacer modifiers={[frame({ width: 50, height: 47 })]} />
        </VStack>
      </Host>
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
