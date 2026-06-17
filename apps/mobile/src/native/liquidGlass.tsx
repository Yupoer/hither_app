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
import { View, type ViewProps } from 'react-native';
import {
  GlassView as ExpoGlassView,
  isLiquidGlassAvailable as expoIsLiquidGlassAvailable,
  type GlassStyle,
} from 'expo-glass-effect';
import { useTheme } from '../state/PreferencesContext';

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
 */
export function GlassView({
  glassStyle = 'regular',
  tintColor,
  style,
  children,
  ...rest
}: GlassViewProps) {
  const { colors } = useTheme();
  if (isLiquidGlassAvailable()) {
    return (
      <ExpoGlassView
        glassEffectStyle={glassStyle}
        tintColor={tintColor}
        style={style}
        {...rest}
      >
        {children}
      </ExpoGlassView>
    );
  }
  return (
    <View style={[{ backgroundColor: colors.glass }, style]} {...rest}>
      {children}
    </View>
  );
}
