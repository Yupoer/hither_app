import React, { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, processColor, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import { NativeD6PaneView, NativeD6SurfaceView } from '../../../native/d6Pane';
import { D6_SURFACE_COLORS, D6_SURFACE_BORDER_COLOR, D6_SURFACE_SOLID_COLOR, MAP_FLOATING_GRABBER_HEIGHT } from '../../../components/mapSheetChrome';
import { useVisibleUi } from '../../../state/foregroundUi';
import type { useD6PaneDrag } from './useD6PaneDrag';
import { GestureDetector } from 'react-native-gesture-handler';
import { D6PaneScrollContext } from './D6PaneScrollView';
import { D6PaneInteractionContext } from './D6PaneInteraction';

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
  const [overlay, setOverlay] = useState<ReactNode>(null);
  const overlayRef = useAnimatedRef<View>();
  const bodyRef = useAnimatedRef<View>();
  const interaction = useMemo(() => ({ owner: panel.owner, paneGesture: panel.contentGesture,
    scrollGesture: panel.scrollGesture, overlayRef, setOverlay, open: open && visible,
    viewport: { ref: bodyRef, height: panel.height, closed } }),
  [panel.owner, panel.contentGesture, panel.scrollGesture, overlayRef, bodyRef, panel.height, closed, open, visible]);
  const draggableHeader = header ? <GestureDetector gesture={panel.headerGesture}><View collapsable={false}>{header}</View></GestureDetector> : null;
  const draggableFooter = footer ? <GestureDetector gesture={panel.footerGesture}><View collapsable={false} style={styles.footer}>{footer}</View></GestureDetector> : null;
  const content = <D6PaneScrollContext.Provider value={panel}>
    <GestureDetector gesture={panel.contentGesture}>
      <View collapsable={false} style={styles.viewport}>{body}</View>
    </GestureDetector>
  </D6PaneScrollContext.Provider>;
  const overlayLayer = <Animated.View ref={overlayRef} collapsable={false} pointerEvents="none" style={styles.overlay}>
    {open && visible ? overlay : null}
  </Animated.View>;
  if (!NativeD6PaneView || !NativeD6SurfaceView) return <D6PaneInteractionContext.Provider value={interaction}>
    <Animated.View pointerEvents="box-none" style={[style, styles.clipped, animatedStyle]}>
      {surface}
      {direction === 1 ? <>{decoration}{draggableHeader}</> : grabber}
      <View ref={bodyRef} collapsable={false} pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open} style={styles.viewport}>{content}</View>
      {direction === 1 ? grabber : draggableFooter}
    </Animated.View>
    {overlayLayer}
  </D6PaneInteractionContext.Provider>;
  const fixedHeight = closed - grabberHeight;
  return <D6PaneInteractionContext.Provider value={interaction}>
    <NativeD6PaneView ref={nativeRef} pointerEvents="box-none" style={[style, { height: full }]}
      closedHeight={closed} referenceHeight={layoutHeight}
      grabberHeight={grabberHeight} direction={direction} cornerRadius={cornerRadius}
      contentVisible={body != null}>
      {visible ? <NativeD6SurfaceView testID="d6-native-surface" pointerEvents="none" style={StyleSheet.absoluteFill}
        colors={D6_SURFACE_COLORS[direction === 1 ? 'thin' : 'thick'].map(processColor)} cornerRadius={cornerRadius}
        borderWidth={StyleSheet.hairlineWidth} borderColor={D6_SURFACE_BORDER_COLOR} solidColor={D6_SURFACE_SOLID_COLOR}
        blurIntensity={direction === 1 ? 48 : 72} /> : null}
      {decoration ? <View collapsable={false} testID="d6-native-decoration" pointerEvents="none" style={[styles.slot, { height: closed }]}>{decoration}</View> : null}
      {header ? <View collapsable={false} testID="d6-native-header" style={styles.slot}>{draggableHeader}</View> : null}
      <View ref={bodyRef} collapsable={false} testID="d6-native-body" pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open}
        style={[styles.slot, { top: direction === 1 ? fixedHeight : grabberHeight,
          height: Math.max(0, layoutHeight - closed), overflow: 'hidden' }]}>{content}</View>
      <View collapsable={false} testID="d6-native-grabber" style={[styles.slot, {
        top: direction === 1 ? full - grabberHeight : 0, height: grabberHeight,
      }]}>{grabber}</View>
      {footer ? <View collapsable={false} testID="d6-native-footer" style={[styles.slot, { top: full - fixedHeight, height: fixedHeight }]}>{draggableFooter}</View> : null}
    </NativeD6PaneView>
    {overlayLayer}
  </D6PaneInteractionContext.Provider>;
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', left: 0, right: 0 },
  viewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  clipped: { overflow: 'hidden' },
  footer: { flexShrink: 0 },
  overlay: { ...StyleSheet.absoluteFill, zIndex: 100 },
});
