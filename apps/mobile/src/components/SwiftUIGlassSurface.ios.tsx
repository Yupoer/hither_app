import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Host, Spacer, VStack } from '@expo/ui/swift-ui';
import { frame, glassEffect } from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../native';

export type SwiftUIGlassShape = 'circle' | 'capsule' | 'roundedRectangle';

export type SwiftUIGlassSurfaceProps = {
  style?: StyleProp<ViewStyle>;
  shape?: SwiftUIGlassShape;
  cornerRadius?: number;
  /** Existing fallback tint used only when the OS has no Liquid Glass. */
  fallbackTintColor?: string;
  children?: React.ReactNode;
};

/**
 * Background-only SwiftUI Liquid Glass surface.
 *
 * Foreground RN children remain siblings of this Host, so neither SwiftUI
 * material opacity nor native vibrancy can dim text/icons. Each instance owns
 * one glass shape; callers that need multiple nearby shapes should provide a
 * single native container instead of stacking surfaces.
 */
export default function SwiftUIGlassSurface({
  style,
  shape = 'roundedRectangle',
  cornerRadius = 24,
  fallbackTintColor,
  children,
}: SwiftUIGlassSurfaceProps) {
  if (!liquidGlass.isLiquidGlassAvailable()) {
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

  const glassShape = shape === 'roundedRectangle'
    ? { shape, cornerRadius }
    : { shape };

  return (
    <View style={style} pointerEvents="box-none">
      <Host matchContents={false} style={StyleSheet.absoluteFill} pointerEvents="none">
        <VStack
          spacing={0}
          modifiers={[
            frame({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity }),
            glassEffect({
              glass: { variant: 'regular', interactive: false },
              ...glassShape,
            }),
          ]}
        >
          <Spacer />
        </VStack>
      </Host>
      {children}
    </View>
  );
}
