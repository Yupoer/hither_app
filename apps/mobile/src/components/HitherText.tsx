import React from 'react';
import {
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';
import { TYPE_MAX_MULTIPLIER, type TypeRole } from '../theme/typeScale';

export type HitherTextProps = TextProps & {
  /**
   * Typography scale role → maxFontSizeMultiplier (emoji disables scaling).
   * Named `typeRole` so it does not clash with RN/ARIA `role`.
   */
  typeRole?: TypeRole;
};

/**
 * Thin Text wrapper that enforces Dynamic Type policy via `typeRole`.
 * Prefer this over raw Text for user-facing copy; do not hand-roll
 * maxFontSizeMultiplier in feature components.
 */
export function HitherText({
  typeRole = 'body',
  allowFontScaling,
  maxFontSizeMultiplier,
  ...rest
}: HitherTextProps) {
  const isEmoji = typeRole === 'emoji';
  return (
    <Text
      {...rest}
      allowFontScaling={isEmoji ? false : (allowFontScaling ?? true)}
      maxFontSizeMultiplier={
        isEmoji ? 1 : (maxFontSizeMultiplier ?? TYPE_MAX_MULTIPLIER[typeRole])
      }
    />
  );
}

export type HitherTextInputProps = TextInputProps & {
  typeRole?: Exclude<TypeRole, 'emoji'>;
};

/** TextInput with body-level Dynamic Type cap by default. */
export function HitherTextInput({
  typeRole = 'body',
  maxFontSizeMultiplier,
  ...rest
}: HitherTextInputProps) {
  return (
    <TextInput
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? TYPE_MAX_MULTIPLIER[typeRole]}
    />
  );
}

export default HitherText;
