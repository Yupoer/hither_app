import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { lightTap } from '../utils/haptics';
import type { AuthModeSelectorProps } from './AuthModeSelector';

// Matches screen-1.webp: replaces <Picker modifiers={[pickerStyle('segmented')]}>
export default function AuthModeSelector({
  mode,
  onChange,
  labels,
  disabled,
}: AuthModeSelectorProps) {
  const reducedMotion = useReducedMotion();

  return (
    <View style={styles.container} accessibilityRole="tablist">
      {(['signin', 'signup'] as const).map((next) => {
        const isSelected = mode === next;
        return (
          <Pressable
            key={next}
            onPress={() => {
              if (isSelected || disabled) return;
              lightTap();
              onChange(next);
            }}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected, disabled }}
            testID={`login-tab-${next}`}
            style={styles.tab}
          >
            <Animated.View
              style={[
                styles.tabSurface,
                isSelected && styles.activeSurface,
                {
                  transform: [{ scale: isSelected ? 1 : 0.98 }],
                },
              ]}
            >
              <Text style={[styles.text, isSelected && styles.activeText]}>
                {labels[next]}
              </Text>
            </Animated.View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 248,
    height: 44,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    padding: 3,
  },
  tab: {
    flex: 1,
    height: 38,
  },
  tabSurface: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
  },
  activeSurface: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  text: {
    fontSize: 15.5,
    fontWeight: '600',
    color: 'rgba(235, 235, 245, 0.6)',
  },
  activeText: {
    fontWeight: '700',
    color: '#ffffff',
  },
});
