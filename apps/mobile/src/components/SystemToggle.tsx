import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Host, Switch } from '@expo/ui';

/**
 * Single wrapper for on/off rows. Screens must not import RN Switch or paint
 * platform switch chrome themselves.
 */
export default function SystemToggle({
  value,
  onValueChange,
  accessibilityLabel,
  testID,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <View
      style={styles.wrap}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value }}
      testID={testID}
    >
      <Host matchContents style={styles.host}>
        <Switch value={value} onValueChange={onValueChange} />
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 51,
    height: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  host: {
    width: 51,
    height: 31,
  },
});
