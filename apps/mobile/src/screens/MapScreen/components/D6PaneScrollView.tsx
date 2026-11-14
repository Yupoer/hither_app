import React, { createContext, useContext } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import type { useD6PaneDrag } from './useD6PaneDrag';

type PaneScroll = Pick<ReturnType<typeof useD6PaneDrag>, 'scrollGesture' | 'scrollRef' | 'scrollHandler' | 'scrollContent' | 'scrollViewport'>;
export const D6PaneScrollContext = createContext<PaneScroll | null>(null);

export function D6PaneScrollView({ onContentSizeChange, onLayout, ...props }: Omit<ScrollViewProps, 'onScroll'>) {
  const panel = useContext(D6PaneScrollContext);
  if (!panel) return <ScrollView {...props} onContentSizeChange={onContentSizeChange} onLayout={onLayout} />;
  const { scrollGesture, scrollRef, scrollHandler, scrollContent, scrollViewport } = panel;
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
          onContentSizeChange?.(width, height);
        }} />
    </GestureDetector>
  );
}
