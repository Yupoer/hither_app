import React, { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { TYPE_MAX_MULTIPLIER, type TypeRole } from '../theme/typeScale';
import { usePreferences } from '../state/PreferencesContext';

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
 *
 * App Settings `textScale` multiplies design fontSize only (not emoji).
 * System Dynamic Type still applies via allowFontScaling + role caps.
 */
export function HitherText({
  typeRole = 'body',
  allowFontScaling,
  maxFontSizeMultiplier,
  style,
  ...rest
}: HitherTextProps) {
  const isEmoji = typeRole === 'emoji';
  const { textScale } = usePreferences();

  const scaledStyle = useMemo(() => {
    if (isEmoji || textScale === 1) return style;
    const flat = StyleSheet.flatten(style) as TextStyle | undefined;
    if (!flat || typeof flat.fontSize !== 'number') return style;
    return [style, { fontSize: Math.round(flat.fontSize * textScale) }];
  }, [isEmoji, textScale, style]);

  return (
    <Text
      {...rest}
      style={scaledStyle}
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

/** TextInput with body-level Dynamic Type cap by default + app textScale. */
export function HitherTextInput({
  typeRole = 'body',
  maxFontSizeMultiplier,
  style,
  ...rest
}: HitherTextInputProps) {
  const { textScale } = usePreferences();

  const scaledStyle = useMemo(() => {
    if (textScale === 1) return style;
    const flat = StyleSheet.flatten(style) as TextStyle | undefined;
    if (!flat || typeof flat.fontSize !== 'number') return style;
    return [style, { fontSize: Math.round(flat.fontSize * textScale) }];
  }, [textScale, style]);

  return (
    <TextInput
      {...rest}
      style={scaledStyle}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? TYPE_MAX_MULTIPLIER[typeRole]}
    />
  );
}

export default HitherText;
