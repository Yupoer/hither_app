import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { MapRecenterControlProps } from './MapRecenterControl';
import NativeGlassButton from './NativeGlassButton';

/** Native SwiftUI controls preserve the system glass press interaction. */
export default function MapRecenterControl({
  onFitAll,
  onLocate,
  fitAllLabel,
  locateLabel,
  style,
}: MapRecenterControlProps) {
  return (
    <View style={[styles.root, style]}>
      <NativeGlassButton
        size={46}
        systemImage="arrow.up.left.and.arrow.down.right"
        imageSize={20}
        foregroundColor="#fff"
        onPress={onFitAll}
        testID="map-fit-all"
        accessibilityLabel={fitAllLabel}
      />
      <NativeGlassButton
        size={46}
        systemImage="location.fill"
        imageSize={20}
        foregroundColor="#fff"
        onPress={onLocate}
        testID="map-locate-me"
        accessibilityLabel={locateLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 50,
    height: 96,
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'visible',
  },
});
