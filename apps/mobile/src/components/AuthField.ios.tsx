import React from 'react';
import { StyleSheet, TextInput } from 'react-native';
import type { AuthFieldProps } from './AuthField';

export default function AuthField({
  value,
  onChangeText,
  accessibilityLabel,
  secureTextEntry = false,
  onBlur,
  onFocus,
  placeholder,
  placeholderTextColor,
  autoFocus,
  autoCapitalize,
  autoCorrect,
  keyboardAppearance,
  keyboardType,
  textContentType,
  testID,
}: AuthFieldProps) {
  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
      onFocus={onFocus}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      autoFocus={autoFocus}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      keyboardAppearance={keyboardAppearance}
      keyboardType={keyboardType}
      secureTextEntry={secureTextEntry}
      textContentType={textContentType}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  input: { flex: 1, minHeight: 48, paddingHorizontal: 0, fontSize: 17.5, color: '#fff' },
});
