import React from 'react';
import { Platform, Switch, type SwitchProps } from 'react-native';

/**
 * System-looking toggle: iOS keeps the native UISwitch chrome (no custom
 * track/thumb paint). Android still accepts an accent track for brand color.
 */
export default function NativeSwitch({
  accent,
  trackColor: _trackColor,
  thumbColor: _thumbColor,
  ios_backgroundColor: _iosBackgroundColor,
  ...props
}: SwitchProps & { accent?: string }) {
  if (Platform.OS === 'ios') {
    // Drop track/thumb/ios_backgroundColor so they cannot leak via ...props.
    return <Switch {...props} />;
  }
  return (
    <Switch
      {...props}
      trackColor={{
        true: accent ?? _trackColor?.true ?? '#34C759',
        false: 'rgba(120,120,128,0.32)',
      }}
      thumbColor="#fff"
    />
  );
}
