import { useMemo } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { indicatorRowGeometry } from '../../../utils/pagination';

/**
 * Gathering-point pagination (max 5 visible). Each item occupies its own
 * active pill / inactive dot width in normal flow — no absolute overlay.
 */
export function CarouselDots({
  total,
  active,
  maxVisible,
  destinationIds,
  styles,
  reduceMotion = false,
}: {
  total: number;
  active: number;
  maxVisible: number;
  destinationIds: readonly string[];
  styles: {
    dots: object;
    dot: object;
    dotActive: object;
  };
  reduceMotion?: boolean;
}) {
  const row = useMemo(
    () => indicatorRowGeometry(total, active, maxVisible),
    [total, active, maxVisible],
  );

  return (
    <View style={[styles.dots, { flexShrink: 0 }]}>
      {row.items.map((item) => (
        <CarouselDot
          key={`dot-${destinationIds[item.index] ?? item.index}`}
          active={item.active}
          reduceMotion={reduceMotion}
          styles={styles}
        />
      ))}
    </View>
  );
}

function CarouselDot({
  active,
  reduceMotion,
  styles,
}: {
  active: boolean;
  reduceMotion: boolean;
  styles: {
    dot: object;
    dotActive: object;
  };
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    width: withTiming(active ? 18 : 6, {
      duration: reduceMotion ? 0 : 200,
    }),
  }), [active, reduceMotion]);

  return (
    <Animated.View
      style={[styles.dot, active ? styles.dotActive : null, animatedStyle]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
