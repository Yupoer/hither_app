import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../state/PreferencesContext';
import { HitherText } from '../../components/HitherText';
import { mediumTap } from '../../utils/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  // Ease the disabled→enabled colour change instead of snapping — goal-gradient
  // feedback the moment a valid choice is made.
  const p = useSharedValue(disabled ? 0 : 1);
  useEffect(() => {
    p.value = withTiming(disabled ? 0 : 1, { duration: 240 });
  }, [disabled, p]);
  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [colors.border, colors.accent]),
  }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        mediumTap();
        onPress();
      }}
      style={[styles.btn, bgStyle]}
    >
      <HitherText
        typeRole="title"
        style={[styles.label, { color: disabled ? colors.textSecondary : colors.accentText }]}
      >
        {label}
      </HitherText>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignSelf: 'stretch',
    minHeight: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  label: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
});
