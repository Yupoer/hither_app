import React from 'react';
import { StyleSheet } from 'react-native';
import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { frame, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import type { AuthModeSelectorProps } from './AuthModeSelector';

export default function AuthModeSelector({ mode, onChange, labels, disabled }: AuthModeSelectorProps) {
  return (
    <Host style={styles.host} colorScheme="dark" pointerEvents={disabled ? 'none' : 'auto'}>
      <Picker
        selection={mode}
        onSelectionChange={(next) => onChange(next as 'signin' | 'signup')}
        modifiers={[pickerStyle('segmented'), frame({ minWidth: 0, maxWidth: Infinity, height: 48 })]}
      >
        <Text modifiers={[tag('signin')]}>{labels.signin}</Text>
        <Text modifiers={[tag('signup')]}>{labels.signup}</Text>
      </Picker>
    </Host>
  );
}

const styles = StyleSheet.create({ host: { width: '100%', height: 48 } });

