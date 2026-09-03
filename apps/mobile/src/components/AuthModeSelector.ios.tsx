import React from 'react';
import { StyleSheet } from 'react-native';
import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { accessibilityLabel, disabled as disabledModifier, frame, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import type { AuthModeSelectorProps } from './AuthModeSelector';

export default function AuthModeSelector({ mode, onChange, labels, disabled: isDisabled }: AuthModeSelectorProps) {
  return (
    <Host style={styles.host} colorScheme="dark">
      <Picker
        selection={mode}
        onSelectionChange={(value) => onChange(value as AuthModeSelectorProps['mode'])}
        testID="login-mode-picker"
        modifiers={[pickerStyle('segmented'), frame({ width: 190, height: 42 }), accessibilityLabel('Authentication mode'), ...(isDisabled ? [disabledModifier(true)] : [])]}
      >
        <Text modifiers={[tag('signin')]}>{labels.signin}</Text>
        <Text modifiers={[tag('signup')]}>{labels.signup}</Text>
      </Picker>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: 190, height: 42, alignSelf: 'center' },
});

