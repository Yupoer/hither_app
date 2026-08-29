import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { liquidGlass } from '../native';
import type { SwiftUIGlassShape } from './SwiftUIGlassSurface.ios';

export type { SwiftUIGlassSurfaceProps } from './SwiftUIGlassSurface.ios';

type Props = {
  style?: StyleProp<ViewStyle>;
  shape?: SwiftUIGlassShape;
  cornerRadius?: number;
  fallbackTintColor?: string;
  children?: React.ReactNode;
};

/** Non-iOS fallback; the platform-specific iOS file renders SwiftUI glass. */
export default function SwiftUIGlassSurface({
  style,
  fallbackTintColor,
  children,
}: Props) {
  return (
    <liquidGlass.GlassView
      glassStyle="regular"
      tintColor={fallbackTintColor}
      style={style}
      pointerEvents="box-none"
    >
      {children}
    </liquidGlass.GlassView>
  );
}
