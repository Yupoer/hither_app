import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type AuthMode = 'signin' | 'signup';
export type AuthModeSelectorProps = {
  mode: AuthMode;
  onChange: (mode: AuthMode) => void;
  labels: { signin: string; signup: string };
  disabled?: boolean;
};

export default function AuthModeSelector({ mode, onChange, labels, disabled }: AuthModeSelectorProps) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {(['signin', 'signup'] as AuthMode[]).map((next) => (
        <Pressable
          key={next}
          onPress={() => onChange(next)}
          disabled={disabled}
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === next, disabled }}
          testID={`login-tab-${next}`}
          style={[styles.tab, mode === next && styles.active]}
        >
          <Text style={[styles.text, mode === next && styles.activeText]}>
            {labels[next]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    borderRadius: 18,
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  tab: {
    flex: 1,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  active: { backgroundColor: 'rgba(255,255,255,0.16)' },
  text: { fontSize: 18, fontWeight: '600', color: 'rgba(235,235,245,0.6)' },
  activeText: { color: '#fff' },
});

