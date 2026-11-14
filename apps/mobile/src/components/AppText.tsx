import React, { forwardRef } from 'react';
import {
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextProps,
  type TextInputProps,
} from 'react-native';
import { GLOBAL_FONT_SCALE_CAP } from '../theme/typeScale';

function fontLimit(requested: number | null | undefined) {
  return requested && requested > 0 ? Math.min(requested, GLOBAL_FONT_SCALE_CAP) : GLOBAL_FONT_SCALE_CAP;
}

export type AppTextRef = React.ComponentRef<typeof NativeText>;
export const AppText = forwardRef<AppTextRef, TextProps>(function AppText(props, ref) {
  return <NativeText {...props} ref={ref} maxFontSizeMultiplier={fontLimit(props.maxFontSizeMultiplier)} />;
});

export type AppTextInputRef = React.ComponentRef<typeof NativeTextInput>;
export const AppTextInput = forwardRef<AppTextInputRef, TextInputProps>(function AppTextInput(props, ref) {
  return <NativeTextInput {...props} ref={ref} maxFontSizeMultiplier={fontLimit(props.maxFontSizeMultiplier)} />;
});
