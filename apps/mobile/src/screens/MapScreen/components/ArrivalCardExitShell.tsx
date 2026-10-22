import React from 'react';
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { ARRIVAL_CARD_EXIT_MS } from '../../../utils/arrivalCardExit';

/** Gathering-point card press shell — haptic only, no scale animation. */
/**
 * #149 whole-card exit: 440ms fade + slight upward slide when stop completes.
 */
export function ArrivalCardExitShell({
  exiting,
  children,
}: {
  exiting: boolean;
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    return {
      opacity: withTiming(exiting ? 0 : 1, {
        duration: ARRIVAL_CARD_EXIT_MS,
        easing: Easing.out(Easing.cubic),
      }),
      transform: [
        {
          translateY: withTiming(exiting ? -16 : 0, {
            duration: ARRIVAL_CARD_EXIT_MS,
            easing: Easing.out(Easing.cubic),
          }),
        },
      ],
    };
  }, [exiting]);
  return <Animated.View style={style}>{children}</Animated.View>;
}
