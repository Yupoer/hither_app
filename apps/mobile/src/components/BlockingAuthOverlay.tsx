import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BouncingDots } from './AmicroButton';

export default function BlockingAuthOverlay({
  visible,
  color,
}: {
  visible: boolean;
  color: string;
}) {
  if (!visible) return null;
  return (
    <View
      style={styles.scrim}
      pointerEvents="auto"
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      accessibilityViewIsModal
      importantForAccessibility="yes"
      testID="auth-blocking-overlay"
    >
      <BouncingDots color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
});
