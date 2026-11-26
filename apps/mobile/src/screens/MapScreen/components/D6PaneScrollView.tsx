import React, { createContext, useContext } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useMountEffect } from '../../../hooks/useMountEffect';
import type { useD6PaneDrag } from './useD6PaneDrag';

type PaneScroll = Pick<ReturnType<typeof useD6PaneDrag>, 'scrollGesture' | 'scrollRef' | 'scrollHandler' | 'scrollContent' | 'scrollViewport' | 'scrollOffset' | 'onContentHeight'>;
export const D6PaneScrollContext = createContext<PaneScroll | null>(null);

/** `reserve` is extra height the pane sizes for beyond the measured content, reported with each content measurement. */
export function D6PaneScrollView({ onContentSizeChange, onLayout, reserve = 0, ...props }: Omit<ScrollViewProps, 'onScroll'> & { reserve?: number }) {
  const panel = useContext(D6PaneScrollContext);
  useMountEffect(() => {
    if (!panel) return;
    panel.scrollOffset.set(props.contentOffset?.y ?? 0);
    // The last measured height stays reported, so reopening targets the real height instead of a placeholder.
    return () => { panel.scrollOffset.set(0); };
  });
  if (!panel) return <ScrollView {...props} onContentSizeChange={onContentSizeChange} onLayout={onLayout} />;
  const { scrollGesture, scrollRef, scrollHandler, scrollContent, scrollViewport, onContentHeight: reportContent } = panel;
  return (
    <GestureDetector gesture={scrollGesture}>
      <Animated.ScrollView {...props} ref={scrollRef} onScroll={scrollHandler} scrollEventThrottle={16}
        bounces={false}
        onLayout={event => {
          scrollViewport.set(event.nativeEvent.layout.height);
          onLayout?.(event);
        }}
        onContentSizeChange={(width, height) => {
          scrollContent.set(height);
          reportContent?.({ content: height + reserve });
          onContentSizeChange?.(width, height);
        }} />
    </GestureDetector>
  );
}
