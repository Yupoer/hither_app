import React, { type ReactNode } from 'react';
import { StyleSheet, View, processColor, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { NativeD6PaneView, NativeD6SurfaceView } from '../../../native/d6Pane';
import { D6_SURFACE_COLORS, D6_SURFACE_BORDER_COLOR, D6_SURFACE_SOLID_COLOR, MAP_FLOATING_GRABBER_HEIGHT } from '../../../components/mapSheetChrome';
import { useVisibleUi } from '../../../state/foregroundUi';
import type { useD6PaneDrag } from './useD6PaneDrag';

type Props = {
  panel: ReturnType<typeof useD6PaneDrag>;
  direction: 1 | -1;
  cornerRadius: number;
  style: StyleProp<ViewStyle>;
  surface: ReactNode;
  header?: ReactNode;
  body: ReactNode;
  grabber: ReactNode;
  footer?: ReactNode;
  decoration?: ReactNode;
  open: boolean;
};

export function D6PaneFrame({ panel, direction, cornerRadius, style, surface, header, body, grabber, footer, decoration, open }: Props) {
  const { nativeRef, full, closed, layoutHeight, animatedStyle } = panel;
  const visible = useVisibleUi();
  if (!NativeD6PaneView || !NativeD6SurfaceView) return (
    <Animated.View pointerEvents="box-none" style={[style, animatedStyle]}>
      {surface}
      {direction === 1 ? <>{decoration}{header}</> : grabber}
      <View pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open} style={styles.viewport}>{body}</View>
      {direction === 1 ? grabber : footer}
    </Animated.View>
  );
  const fixedHeight = closed - MAP_FLOATING_GRABBER_HEIGHT;
  return (
    <NativeD6PaneView ref={nativeRef} pointerEvents="box-none" style={[style, { height: full }]}
      closedHeight={closed} referenceHeight={layoutHeight}
      grabberHeight={MAP_FLOATING_GRABBER_HEIGHT} direction={direction} cornerRadius={cornerRadius}
      contentVisible={body != null}>
      {visible ? <NativeD6SurfaceView testID="d6-native-surface" pointerEvents="none" style={StyleSheet.absoluteFill}
        colors={D6_SURFACE_COLORS[direction === 1 ? 'thin' : 'thick'].map(processColor)} cornerRadius={cornerRadius}
        borderWidth={StyleSheet.hairlineWidth} borderColor={D6_SURFACE_BORDER_COLOR} solidColor={D6_SURFACE_SOLID_COLOR}
        blurIntensity={direction === 1 ? 48 : 72} /> : null}
      {decoration ? <View collapsable={false} testID="d6-native-decoration" pointerEvents="none" style={[styles.slot, { height: closed }]}>{decoration}</View> : null}
      {header ? <View collapsable={false} testID="d6-native-header" style={styles.slot}>{header}</View> : null}
      <View collapsable={false} testID="d6-native-body" pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open}
        style={[styles.slot, { top: direction === 1 ? fixedHeight : MAP_FLOATING_GRABBER_HEIGHT,
          height: Math.max(0, layoutHeight - closed), overflow: 'hidden' }]}>{body}</View>
      <View collapsable={false} testID="d6-native-grabber" style={[styles.slot, {
        top: direction === 1 ? full - MAP_FLOATING_GRABBER_HEIGHT : 0, height: MAP_FLOATING_GRABBER_HEIGHT,
      }]}>{grabber}</View>
      {footer ? <View collapsable={false} testID="d6-native-footer" style={[styles.slot, { top: full - fixedHeight, height: fixedHeight }]}>{footer}</View> : null}
    </NativeD6PaneView>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', left: 0, right: 0 },
  viewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
});
