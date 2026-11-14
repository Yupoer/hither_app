import { APP_TEXT_SIZE } from '../theme/typeScale';
import React from 'react';
import { StyleSheet, type TextInputProps } from 'react-native';
import { AppTextInput as TextInput } from './AppText';

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
  input: { flex: 1, minHeight: 48, fontSize: APP_TEXT_SIZE.body, color: '#fff' },
});
