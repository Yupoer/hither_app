import { Platform, type ViewProps, type processColor } from 'react-native';
import { requireOptionalNativeModule, requireNativeViewManager } from 'expo-modules-core';
import Animated from 'react-native-reanimated';

const metricsModule = Platform.OS === 'ios'
  ? requireOptionalNativeModule<{ supportsNativePane?: boolean }>('HitherMetrics') : null;
export const nativeD6PaneAvailable = metricsModule?.supportsNativePane === true;

type NativePaneProps = ViewProps & {
  closedHeight: number;
  referenceHeight: number;
  grabberHeight: number;
  direction: number;
  cornerRadius: number;
  contentVisible: boolean;
};

export const NativeD6PaneView = nativeD6PaneAvailable
  ? Animated.createAnimatedComponent(requireNativeViewManager<NativePaneProps>('HitherMetrics')) : null;

export const NativeD6GradientView = nativeD6PaneAvailable
  ? requireNativeViewManager<ViewProps & {
    colors: readonly ReturnType<typeof processColor>[];
    cornerRadius: number;
    borderWidth: number;
    borderColor: string;
  }>('HitherMetrics', 'PaneGradient') : null;

export const NativeD6SurfaceView = nativeD6PaneAvailable
  ? requireNativeViewManager<ViewProps & {
    colors: readonly ReturnType<typeof processColor>[];
    cornerRadius: number;
    borderWidth: number;
    borderColor: string;
    solidColor: string;
    blurIntensity: number;
  }>('HitherMetrics', 'PaneSurface') : null;
