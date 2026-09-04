import React from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

export type AuthFieldProps = Pick<
  TextInputProps,
  | 'autoCapitalize'
  | 'autoCorrect'
  | 'autoFocus'
  | 'keyboardAppearance'
  | 'keyboardType'
  | 'placeholder'
  | 'placeholderTextColor'
  | 'secureTextEntry'
  | 'textContentType'
  | 'testID'
> & {
  value: string;
  onChangeText: (value: string) => void;
  accessibilityLabel: string;
  onBlur?: () => void;
  onFocus?: () => void;
};

export default function AuthField({ value, onChangeText, accessibilityLabel, ...props }: AuthFieldProps) {
  return (
    <TextInput
      {...props}
      style={styles.input}
      value={value}
      onChangeText={onChangeText}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

const styles = StyleSheet.create({
  input: { flex: 1, minHeight: 48, fontSize: 17.5, color: '#fff' },
});
