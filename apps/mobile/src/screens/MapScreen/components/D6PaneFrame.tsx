import React, { type ReactNode } from 'react';
import { StyleSheet, View, processColor, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { NativeD6PaneView, NativeD6SurfaceView } from '../../../native/d6Pane';
import { D6_SURFACE_COLORS, D6_SURFACE_BORDER_COLOR, D6_SURFACE_SOLID_COLOR, MAP_FLOATING_GRABBER_HEIGHT } from '../../../components/mapSheetChrome';
import { useVisibleUi } from '../../../state/foregroundUi';
import type { useD6PaneDrag } from './useD6PaneDrag';
import { GestureDetector } from 'react-native-gesture-handler';
import { D6PaneScrollContext } from './D6PaneScrollView';

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
  grabberHeight?: number;
};

export function D6PaneFrame({ panel, direction, cornerRadius, style, surface, header, body, grabber, footer, decoration, open,
  grabberHeight = MAP_FLOATING_GRABBER_HEIGHT }: Props) {
  const { nativeRef, full, closed, layoutHeight, animatedStyle } = panel;
  const visible = useVisibleUi();
  const content = <D6PaneScrollContext.Provider value={panel}>
    <GestureDetector gesture={panel.contentGesture}>
      <View collapsable={false} style={styles.viewport}>{body}</View>
    </GestureDetector>
  </D6PaneScrollContext.Provider>;
  if (!NativeD6PaneView || !NativeD6SurfaceView) return (
    <Animated.View pointerEvents="box-none" style={[style, styles.clipped, animatedStyle]}>
      {surface}
      {direction === 1 ? <>{decoration}{header}</> : grabber}
      <View pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open} style={styles.viewport}>{content}</View>
      {direction === 1 ? grabber : footer}
    </Animated.View>
  );
  const fixedHeight = closed - grabberHeight;
  return (
    <NativeD6PaneView ref={nativeRef} pointerEvents="box-none" style={[style, { height: full }]}
      closedHeight={closed} referenceHeight={layoutHeight}
      grabberHeight={grabberHeight} direction={direction} cornerRadius={cornerRadius}
      contentVisible={body != null}>
      {visible ? <NativeD6SurfaceView testID="d6-native-surface" pointerEvents="none" style={StyleSheet.absoluteFill}
        colors={D6_SURFACE_COLORS[direction === 1 ? 'thin' : 'thick'].map(processColor)} cornerRadius={cornerRadius}
        borderWidth={StyleSheet.hairlineWidth} borderColor={D6_SURFACE_BORDER_COLOR} solidColor={D6_SURFACE_SOLID_COLOR}
        blurIntensity={direction === 1 ? 48 : 72} /> : null}
      {decoration ? <View collapsable={false} testID="d6-native-decoration" pointerEvents="none" style={[styles.slot, { height: closed }]}>{decoration}</View> : null}
      {header ? <View collapsable={false} testID="d6-native-header" style={styles.slot}>{header}</View> : null}
      <View collapsable={false} testID="d6-native-body" pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open}
        style={[styles.slot, { top: direction === 1 ? fixedHeight : grabberHeight,
          height: Math.max(0, layoutHeight - closed), overflow: 'hidden' }]}>{content}</View>
      <View collapsable={false} testID="d6-native-grabber" style={[styles.slot, {
        top: direction === 1 ? full - grabberHeight : 0, height: grabberHeight,
      }]}>{grabber}</View>
      {footer ? <View collapsable={false} testID="d6-native-footer" style={[styles.slot, { top: full - fixedHeight, height: fixedHeight }]}>{footer}</View> : null}
    </NativeD6PaneView>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', left: 0, right: 0 },
  viewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  clipped: { overflow: 'hidden' },
});
