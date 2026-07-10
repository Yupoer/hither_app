import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../state/PreferencesContext';
import { stepProgress } from '../progress';
import type { OnboardingRole, StepId } from '../types';

/**
 * Minimal progress indicator: N dots, current one highlighted. Shared by
 * every step screen — swap this file alone to change the progress UI.
 */
export default function ProgressDots({
  step,
  role,
}: {
  step: StepId;
  role: OnboardingRole | undefined;
}) {
  const { colors } = useTheme();
  const { index, total } = stepProgress(step, role);
  return (
    <View style={styles.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            {
              backgroundColor: i === index ? colors.accent : colors.border,
              width: i === index ? 18 : 6,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 20 },
  dot: { height: 6, borderRadius: 3 },
});
