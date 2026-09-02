import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import type { AuthModeSelectorProps } from './AuthModeSelector';

export default function AuthModeSelector({ mode, onChange, labels, disabled, wide = false }: AuthModeSelectorProps) {
  const reducedMotion = useReducedMotion();
  return (
    <View style={[styles.tabs, wide && styles.wideTabs]} accessibilityRole="tablist">
      {(['signin', 'signup'] as const).map((next) => (
        <Pressable
          key={next}
          onPress={() => onChange(next)}
          disabled={disabled}
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === next, disabled }}
          testID={`login-tab-${next}`}
          style={styles.tab}
        >
          <Animated.View
            style={[
              styles.tabSurface,
              mode === next && styles.active,
              {
                transitionProperty: ['backgroundColor', 'transform'],
                transitionDuration: reducedMotion ? 0 : 180,
                transform: [{ scale: mode === next ? 1 : 0.98 }],
              },
            ]}
          >
            <Text style={[styles.text, mode === next && styles.activeText]}>{labels[next]}</Text>
          </Animated.View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    width: '66.667%',
    alignSelf: 'center',
    flexDirection: 'row',
    borderRadius: 15,
    padding: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  wideTabs: {
    width: '100%',
    borderRadius: 20,
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.075)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  tab: {
    flex: 1,
    height: 32,
  },
  tabSurface: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  active: { backgroundColor: 'rgba(255,255,255,0.16)' },
  text: { fontSize: 18, fontWeight: '600', color: 'rgba(235,235,245,0.6)' },
  activeText: { color: '#fff' },
});
