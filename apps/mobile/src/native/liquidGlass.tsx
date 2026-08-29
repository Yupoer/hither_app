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

/** Cached once — availability does not flip mid-session. */
let liquidGlassAvailableCache: boolean | null = null;

/**
 * Whether the OS provides the Liquid Glass material (iOS 26+). Guarded so a
 * missing/older native module degrades to false instead of throwing.
 */
export function isLiquidGlassAvailable(): boolean {
  if (liquidGlassAvailableCache !== null) return liquidGlassAvailableCache;
  try {
    liquidGlassAvailableCache = expoIsLiquidGlassAvailable();
  } catch {
    liquidGlassAvailableCache = false;
  }
  return liquidGlassAvailableCache;
}

export interface GlassViewProps extends ViewProps {
  /** Glass material variant. Default 'regular'. */
  glassStyle?: GlassStyle;
  /** Optional tint over the glass. Omit for the neutral system material. */
  tintColor?: string;
}

/**
 * Frosted-glass surface (pure). Prefer this when `tintColor` is known so we
 * avoid a PreferencesContext subscription on every map chrome surface.
 */
function GlassViewCore({
  glassStyle = 'regular',
  tintColor,
  fallbackGlass,
  style,
  children,
  ...rest
}: GlassViewProps & { fallbackGlass?: string }) {
  // iOS 26+: let the system material respond to the device's Liquid Glass and
  // accessibility preferences. Extra underlays and a forced color scheme
  // override the native preferred appearance and make map chrome too heavy.
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

  // iOS 16–25 / Android: use the existing UIBlurEffect fallback. Native
  // Liquid Glass handles the device's preferred look on supported iOS.
  const fill =
    tintColor ?? (fallbackGlass != null ? thinTint(fallbackGlass) : 'rgba(22, 26, 34, 0.28)');
  return (
    <View style={[{ overflow: 'hidden' }, style]} {...rest}>
      <BlurView
        tint="dark"
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
          { backgroundColor: fill },
        ]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

/** Theme-backed path only when no tintColor — rare for map chrome. */
function GlassViewWithTheme(props: GlassViewProps) {
  const { colors } = useTheme();
  return <GlassViewCore {...props} fallbackGlass={colors.glass} />;
}

/**
 * Frosted-glass surface. Drop-in for the `<View>` containers that used
 * `backgroundColor: colors.glass`: pass the same style (minus the
 * background) and it renders Liquid Glass when available, else a `View`
 * with the opaque fallback background.
 *
 * Children sit as ordinary subviews on top of the material (not as vibrancy
 * children), and border/radius/padding from `style` live on the outer view.
 *
 * Memoized: map chrome reuses stable tint/style props across parent thrash.
 * When `tintColor` is set (all map sheet/pill/card call sites), no theme
 * subscription — avoids PreferencesContext fan-out on every GPS tick.
 */
export const GlassView = React.memo(function GlassView(props: GlassViewProps) {
  if (props.tintColor != null) {
    return <GlassViewCore {...props} />;
  }
  return <GlassViewWithTheme {...props} />;
});
