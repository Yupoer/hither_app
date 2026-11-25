import React, { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, processColor } from 'react-native';
import Animated, { useAnimatedRef, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { MaskedView } from '@expo/ui/community/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeD6PaneView, NativeD6SurfaceView } from '../../../native/d6Pane';
import { D6_SURFACE_COLORS, D6_SURFACE_BORDER_COLOR, D6_SURFACE_SOLID_COLOR, MAP_FLOATING_GRABBER_HEIGHT, MAP_ISLAND_BODY_FADE_HEIGHT } from '../../../components/mapSheetChrome';
import { useVisibleUi } from '../../../state/foregroundUi';
import type { useD6PaneDrag } from './useD6PaneDrag';
import { GestureDetector } from 'react-native-gesture-handler';
import { D6PaneScrollContext } from './D6PaneScrollView';
import { D6PaneInteractionContext } from './D6PaneInteraction';

const TEAM_TOP_FADE_HEIGHT = 64;

type Props = {
  panel: ReturnType<typeof useD6PaneDrag>;
  direction: 1 | -1;
  cornerRadius: number;
  style: React.ComponentProps<typeof Animated.View>['style'];
  surface: ReactNode;
  header?: ReactNode;
  body: ReactNode;
  grabber: ReactNode;
  footer?: ReactNode;
  open: boolean;
  grabberHeight?: number;
};

export function D6PaneFrame({ panel, direction, cornerRadius, style, surface, header, body, grabber, footer, open,
  grabberHeight = MAP_FLOATING_GRABBER_HEIGHT }: Props) {
  const { nativeRef, full, closed, layoutHeight, animatedStyle } = panel;
  const visible = useVisibleUi();
  const [overlay, setOverlay] = useState<ReactNode>(null);
  const overlayRef = useAnimatedRef<View>();
  const bodyRef = useAnimatedRef<View>();
  const interaction = useMemo(() => ({ owner: panel.owner, paneGesture: panel.contentGesture,
    scrollGesture: panel.scrollGesture, overlayRef, setOverlay, open: open && visible,
    viewport: { ref: bodyRef, height: panel.height, closed }, reportContent: panel.onContentHeight }),
  [panel.owner, panel.contentGesture, panel.scrollGesture, overlayRef, bodyRef, panel.height, closed, open, visible, panel.onContentHeight]);
  const draggableHeader = header ? <GestureDetector gesture={panel.headerGesture}><View collapsable={false}>{header}</View></GestureDetector> : null;
  const draggableFooter = footer ? <GestureDetector gesture={panel.footerGesture}><View collapsable={false} style={styles.footer}>{footer}</View></GestureDetector> : null;
  const content = <GestureDetector gesture={panel.contentGesture}>
    <View collapsable={false} style={styles.viewport}>{body}</View>
  </GestureDetector>;
  const paneContent = <D6PaneScrollContext.Provider value={panel}>
    {direction === -1 && body != null
      ? <TeamBodyFade height={panel.height} closed={closed} scrollOffset={panel.scrollOffset}>{content}</TeamBodyFade>
      : content}
  </D6PaneScrollContext.Provider>;
  const overlayLayer = <Animated.View ref={overlayRef} collapsable={false} pointerEvents="none" style={styles.overlay}>
    {open && visible ? overlay : null}
  </Animated.View>;
  if (!NativeD6PaneView || !NativeD6SurfaceView) return <D6PaneInteractionContext.Provider value={interaction}>
    <Animated.View pointerEvents="box-none" style={[style, styles.clipped, animatedStyle]}>
      {surface}
      {direction === 1 ? draggableHeader : grabber}
      <View ref={bodyRef} collapsable={false} pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open} style={styles.viewport}>{paneContent}</View>
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
        colors={D6_SURFACE_COLORS.thin.map(processColor)} cornerRadius={cornerRadius}
        borderWidth={StyleSheet.hairlineWidth} borderColor={D6_SURFACE_BORDER_COLOR} solidColor={D6_SURFACE_SOLID_COLOR}
        blurIntensity={48} /> : null}
      {header ? <View collapsable={false} testID="d6-native-header" style={styles.slot}>{draggableHeader}</View> : null}
      <View ref={bodyRef} collapsable={false} testID="d6-native-body" pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open}
        style={[styles.slot, { top: direction === 1 ? fixedHeight : grabberHeight,
          height: Math.max(0, layoutHeight - closed), overflow: 'hidden' }]}>{paneContent}</View>
      <View collapsable={false} testID="d6-native-grabber" style={[styles.slot, {
        top: direction === 1 ? full - grabberHeight : 0, height: grabberHeight,
      }]}>{grabber}</View>
      {footer ? <View collapsable={false} testID="d6-native-footer" style={[styles.slot, { top: full - fixedHeight, height: fixedHeight }]}>{draggableFooter}</View> : null}
    </NativeD6PaneView>
    {overlayLayer}
  </D6PaneInteractionContext.Provider>;
}

function TeamBodyFade({ height, closed, scrollOffset, children }: {
  height: SharedValue<number>;
  closed: number;
  scrollOffset: SharedValue<number>;
  children: ReactNode;
}) {
  const visibleMask = useAnimatedStyle(() => ({ height: Math.max(0, height.get() - closed) }));
  const topFade = useAnimatedStyle(() => {
    const progress = Math.min(1, Math.max(0, scrollOffset.get() / MAP_ISLAND_BODY_FADE_HEIGHT));
    return { height: TEAM_TOP_FADE_HEIGHT * progress };
  });
  return <MaskedView style={styles.viewport} maskElement={
    <Animated.View pointerEvents="none" style={[styles.mask, visibleMask]}>
      <Animated.View style={[styles.maskFade, topFade]}>
        <LinearGradient colors={['#ffffff00', '#fff']} locations={[0, 1]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <View style={styles.opaqueMask} />
      <LinearGradient colors={['#fff', '#ffffff00']} locations={[0, 1]} style={styles.maskFade} />
    </Animated.View>
  }>{children}</MaskedView>;
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', left: 0, right: 0 },
  viewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  clipped: { overflow: 'hidden' },
  mask: { position: 'absolute', top: 0, left: 0, right: 0 },
  opaqueMask: { flex: 1, backgroundColor: '#fff' },
  maskFade: { height: MAP_ISLAND_BODY_FADE_HEIGHT, flexShrink: 1 },
  footer: { flexShrink: 0 },
  overlay: { ...StyleSheet.absoluteFill, zIndex: 100 },
});
