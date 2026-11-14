import { APP_TEXT_SIZE } from '../../theme/typeScale';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText as Text } from '../../components/AppText';
import Pressable from '../../components/MotionPressable';
import MetalforgeBackground from '../../components/MetalforgeBackground';
import Animated, { Easing, ReduceMotion, withDelay, withTiming } from 'react-native-reanimated';
import { useOptionalVisuals } from '../../state/foregroundUi';

export const ENTRY_BACKGROUND = '#0F1220';
export const ENTRY_ACCENT = '#4C6FFF';

const herd = [
  { emoji: '🐑', color: '#DCE5EF', x: -57, y: 2, fromX: -180, fromY: -90 },
  { emoji: '🐼', color: '#E6E6E6', x: 57, y: 2, fromX: 180, fromY: -90 },
  { emoji: '🐧', color: '#CDE2F1', x: -110, y: 29, fromX: -220, fromY: 105 },
  { emoji: '🐨', color: '#DAD3E8', x: 110, y: 29, fromX: 220, fromY: 105 },
  { emoji: '🦊', color: '#F3C443', x: 0, y: -21, fromX: 0, fromY: -175 },
];

export function EntryBackdrop({ active, allowInactive }: { active: boolean; allowInactive?: boolean }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <MetalforgeBackground active={active} allowInactive={allowInactive} />
      <View style={styles.backdropVeil} />
    </View>
  );
}

export function WelcomeHerd({ compact }: { compact: boolean }) {
  const visuals = useOptionalVisuals();
  const avatarScale = compact ? 0.8 : 1;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.herd, compact && styles.compactHerd]}
    >
      {herd.map(({ emoji, color, x, y, fromX, fromY }, index) => {
        const duration = 720;
        const delay = index * 75;
        const endX = x * avatarScale;
        const endY = y * avatarScale;
        const enter = () => {
          'worklet';
          const motion = { duration, easing: Easing.bezier(0.2, 0.8, 0.2, 1), reduceMotion: ReduceMotion.System };
          return {
            initialValues: { opacity: 0, transform: [{ translateX: fromX }, { translateY: fromY }] },
            animations: {
              opacity: withDelay(delay, withTiming(1, motion)),
              transform: [
                { translateX: withDelay(delay, withTiming(endX, motion)) },
                { translateY: withDelay(delay, withTiming(endY, motion)) },
              ],
            },
          };
        };
        return (
          <Animated.View
            key={emoji}
            entering={visuals ? enter : undefined}
            style={[
              styles.herdAvatar,
              { backgroundColor: color, transform: [{ translateX: endX }, { translateY: endY }] },
            ]}
          >
            <Text allowFontScaling={false} style={styles.herdEmoji}>{emoji}</Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

export function EntryAvatar({ emoji, color, size = 50, circle = false }: {
  emoji: string;
  color: string | undefined;
  size?: number;
  circle?: boolean;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.avatar, {
        width: size,
        height: size,
        borderRadius: size * (circle ? 0.5 : 0.30),
        backgroundColor: color ?? '#34394D',
      }]}
    >
      <Text allowFontScaling={false} style={{ fontSize: Math.round(size * 0.56) }}>{emoji}</Text>
    </View>
  );
}

export function EntryPrimaryButton({ label, testID, accent, disabled, onPress, style }: {
  label: string;
  testID?: string;
  accent: string;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.primary, { backgroundColor: accent }, (disabled || pressed) && styles.inactive, style]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdropVeil: { ...StyleSheet.absoluteFill, backgroundColor: '#10132644' },
  herd: { height: 120, width: 280, alignItems: 'center', justifyContent: 'center' },
  compactHerd: { height: 100 },
  herdAvatar: {
    position: 'absolute', width: 50, height: 50, borderRadius: 25,
    borderWidth: 3, borderColor: 'rgba(15,18,32,0.9)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.4, shadowRadius: 10,
  },
  herdEmoji: { fontSize: 24 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 6 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: APP_TEXT_SIZE.body, textAlign: 'center' },
  inactive: { opacity: 0.45 },
});
