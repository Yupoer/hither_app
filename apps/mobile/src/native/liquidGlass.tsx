/**
 * Liquid Glass boundary (iOS 26 system material).
 *
 * The ONLY module that imports `expo-glass-effect`. Exposes a single
 * {@link GlassView} surface that renders the system Liquid Glass material
 * when available (iOS 26+) and falls back to the app's existing opaque
 * `colors.glass` style everywhere else (older iOS, Android, Expo Go on an
 * unsupported OS) — so layouts are identical with or without glass.
 *
 * A `.tsx` file because it ships a component; imported via the `liquidGlass`
 * namespace from `src/native`.
 */
import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import {
  GlassView as ExpoGlassView,
  isLiquidGlassAvailable as expoIsLiquidGlassAvailable,
  type GlassStyle,
} from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import { useTheme } from '../state/PreferencesContext';

/**
 * Re-alpha an `rgba(r, g, b, a)` string. The palette's `glass` colour is ~0.92
 * (near-opaque, for the no-blur fallback); over a BlurView we want a thin,
 * see-through veil of the SAME hue so the map reads through the blur — that's
 * the glassmorphism look (translucent tint + blur), not a solid panel.
 */
function thinTint(rgba: string, alpha = 0.28): string {
  const m = rgba.match(/rgba?\(([^)]+)\)/);
  if (!m) return rgba;
  const [r, g, b] = m[1].split(',').map((s) => s.trim());
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Whether the OS provides the Liquid Glass material (iOS 26+). Guarded so a
 * missing/older native module degrades to false instead of throwing.
 */
export function isLiquidGlassAvailable(): boolean {
  try {
    return expoIsLiquidGlassAvailable();
  } catch {
    return false;
  }
}

export interface GlassViewProps extends ViewProps {
  /** Glass material variant. Default 'regular'. */
  glassStyle?: GlassStyle;
  /** Optional tint over the glass. Omit for the neutral system material. */
  tintColor?: string;
}

/**
 * Frosted-glass surface. Drop-in for the `<View>` containers that used
 * `backgroundColor: colors.glass`: pass the same style (minus the
 * background) and it renders Liquid Glass when available, else a `View`
 * with the opaque fallback background.
 *
 * The glass material is decoupled from the app's custom theme (night/day/dusk)
 * and follows the OS appearance instead, so we tint it with the active theme's
 * `colors.glass` to keep the surface readable in every theme, and render the
 * children as ordinary subviews ON TOP of the material (not as vibrancy
 * children — that turned emoji icons into "?" tofu). The border / radius /
 * padding from `style` live on the outer container so they match the rest of
 * the themed UI.
 */
export function GlassView({
  glassStyle = 'regular',
  tintColor,
  style,
  children,
  ...rest
}: GlassViewProps) {
  const { colors, themeName } = useTheme();

  // iOS 26+: the system Liquid Glass material. No tint/overlay on top — the
  // material already blurs + refracts the background; a thin tint only if asked.
  if (isLiquidGlassAvailable()) {
    return (
      <View style={style} {...rest}>
        <ExpoGlassView
          glassEffectStyle={glassStyle}
          tintColor={tintColor}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {children}
      </View>
    );
  }

  // iOS 16–25 / Android: real glassmorphism via the built-in UIBlurEffect
  // material (expo-blur) under a THIN translucent tint of the same hue, so the
  // background shows through the blur. No gradient sheen (that read as an opaque
  // panel). `overflow: hidden` keeps the blur inside the rounded corners.
  const blurTint = themeName === 'day' ? 'light' : 'dark';
  return (
    <View style={[{ overflow: 'hidden' }, style]} {...rest}>
      <BlurView
        tint={blurTint}
        intensity={28}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          // An explicit tintColor is used verbatim (caller controls darkness /
          // alpha — e.g. the map banners pass a dark veil); only the default
          // theme glass gets thinned so the blur shows through.
          { backgroundColor: tintColor ?? thinTint(colors.glass) },
        ]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}
