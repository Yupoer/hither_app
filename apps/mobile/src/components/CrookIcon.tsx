import React from 'react';
import { View, type ViewStyle } from 'react-native';

/**
 * The Hither brand mark: a shepherd's crook (牧羊杖). Replaces the old lantern
 * emoji from v1 — the new design (Hither iOS Flow) uses this crook everywhere:
 * the role-select logo, gathering-point pins, the Dynamic Island and the
 * carousel cards.
 *
 * The design draws it as an SVG stroke `M24 52 L24 20 C24 6 9 6 9 21` in a
 * `0 0 40 56` viewBox. We reproduce it with two plain Views (a stem + a ∩ hook)
 * so it needs no `react-native-svg` native dependency and renders in Expo Go.
 *
 * ponytail: pure-View approximation of the crook; swap to react-native-svg if a
 * pixel-exact curve is ever needed at large sizes.
 *
 * `size` is the icon height (px); width follows the design's 40:56 ratio.
 */
export default function CrookIcon({
  size = 24,
  color = '#F5B142',
  glow = false,
  style,
}: {
  size?: number;
  color?: string;
  /** Amber drop-shadow, matching the design's `drop-shadow` glow. */
  glow?: boolean;
  style?: ViewStyle;
}) {
  const f = size / 56; // scale factor from the 0 0 40 56 viewBox
  const sw = 5 * f; // stroke width

  const glowStyle: ViewStyle = glow
    ? {
        shadowColor: color,
        shadowOpacity: 0.75,
        shadowRadius: 8 * f,
        shadowOffset: { width: 0, height: 0 },
      }
    : {};

  return (
    <View
      style={[{ width: 40 * f, height: 56 * f }, style]}
      accessible={false}
      pointerEvents="none"
    >
      {/* Hook: a ∩ half-ring whose right leg merges into the stem top. */}
      <View
        style={{
          position: 'absolute',
          left: 6.5 * f,
          top: 9 * f,
          width: 20 * f,
          height: 14 * f,
          borderTopLeftRadius: 10 * f,
          borderTopRightRadius: 10 * f,
          borderColor: color,
          borderTopWidth: sw,
          borderLeftWidth: sw,
          borderRightWidth: sw,
          borderBottomWidth: 0,
          ...glowStyle,
        }}
      />
      {/* Stem: rounded vertical bar from the hook down to the tip. */}
      <View
        style={{
          position: 'absolute',
          left: 24 * f - sw / 2,
          top: 19 * f,
          width: sw,
          height: 33 * f,
          borderRadius: sw / 2,
          backgroundColor: color,
          ...glowStyle,
        }}
      />
    </View>
  );
}
