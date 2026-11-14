import React from 'react';
import { StyleSheet } from 'react-native';
import { Host, Toggle } from '@expo/ui/swift-ui';
import { disabled, fixedSize, labelsHidden, toggleStyle } from '@expo/ui/swift-ui/modifiers';
import type { SystemToggleProps } from './SystemToggle';

export default function SystemToggle({ value, onValueChange, accessibilityLabel, testID, disabled: inactive = false }: SystemToggleProps) {
  return (
    <Host matchContents={false} style={styles.host} colorScheme="dark">
      <Toggle
        isOn={value}
        onIsOnChange={onValueChange}
        label={accessibilityLabel ?? ''}
        testID={testID}
        modifiers={[labelsHidden(), toggleStyle('switch'), fixedSize(), disabled(inactive)]}
      />
    </Host>
  );
}

const styles = StyleSheet.create({ host: { width: 76, height: 48, flexShrink: 0, overflow: 'visible' } });
