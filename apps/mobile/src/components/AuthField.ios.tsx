import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Host, SecureField, TextField, useNativeState } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  frame,
  accessibilityLabel as accessibilityLabelModifier,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import type { AuthFieldProps } from './AuthField';

export default function AuthField({
  value,
  onChangeText,
  accessibilityLabel,
  secureTextEntry = false,
  onBlur,
  onFocus,
  placeholder,
  autoFocus,
  testID,
}: AuthFieldProps) {
  const nativeText = useNativeState(value);

  useEffect(() => {
    if (nativeText.get() !== value) nativeText.set(value);
  }, [nativeText, value]);

  const modifiers = [
      frame({ minWidth: 0, maxWidth: Infinity, height: 52 }),
      padding({ horizontal: 18 }),
      font({ size: 18 }),
      foregroundStyle('#FFFFFF'),
      accessibilityLabelModifier(accessibilityLabel),
  ];
  const field = secureTextEntry ? (
    <SecureField
      text={nativeText}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onTextChange={onChangeText}
      onFocusChange={(focused) => (focused ? onFocus?.() : onBlur?.())}
      modifiers={modifiers}
    />
  ) : (
    <TextField
      text={nativeText}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onTextChange={onChangeText}
      onFocusChange={(focused) => (focused ? onFocus?.() : onBlur?.())}
      modifiers={modifiers}
    />
  );

  return (
    <Host
      style={styles.host}
      colorScheme="dark"
      testID={testID}
    >
      {field}
    </Host>
  );
}

const styles = StyleSheet.create({ host: { flex: 1 } });
