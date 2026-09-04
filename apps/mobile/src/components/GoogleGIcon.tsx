import React from 'react';
import { Image, StyleSheet, type ImageStyle } from 'react-native';

/**
 * Offline Google mark used by the auth gate. Keep this as a local bundled
 * asset so the sign-in surface never depends on a network-loaded image.
 */
const GOOGLE_G_ASSET = require('../../assets/google-g.png');

export default function GoogleGIcon({ size = 30, style }: { size?: number; style?: ImageStyle }) {
  return (
    <Image
      source={GOOGLE_G_ASSET}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      style={[styles.icon, { width: size, height: size }, style]}
    />
  );
}

const styles = StyleSheet.create({
  icon: { flexShrink: 0 },
});
