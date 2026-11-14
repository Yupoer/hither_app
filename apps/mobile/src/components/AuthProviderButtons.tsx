import { APP_TEXT_SIZE } from '../theme/typeScale';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText as Text } from './AppText';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Ionicons } from '@expo/vector-icons';
import Pressable from './MotionPressable';
import GoogleGIcon from './GoogleGIcon';

const HEIGHT = 54;
const RADIUS = 16;

export function AppleContinueButton({ onPress, testID, disabled }: {
  onPress: () => void; testID: string; disabled: boolean;
}) {
  return (
    <View pointerEvents={disabled ? 'none' : 'auto'} style={disabled && styles.disabled}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={RADIUS}
        style={styles.apple}
        testID={testID}
        onPress={onPress}
      />
    </View>
  );
}

export function AuthProviderButton({ provider, label, onPress, testID, disabled, expanded }: {
  provider: 'google' | 'email'; label: string; onPress: () => void; testID: string; disabled: boolean; expanded?: boolean;
}) {
  const google = provider === 'google';
  return (
    <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled, expanded }} testID={testID} onPress={onPress}
      style={[styles.button, google ? styles.google : styles.email, disabled && styles.disabled]}>
      {google ? <GoogleGIcon size={19} /> : <Ionicons name="mail-outline" size={20} color="#EBEFFF" />}
      <Text style={[styles.label, google && styles.googleLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  apple: { height: HEIGHT, width: '100%' },
  button: { minHeight: HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS },
  google: { backgroundColor: '#F4F5F9' },
  email: { backgroundColor: '#171D31D9', borderWidth: 1, borderColor: '#BBC7FA66' },
  label: { color: '#fff', fontSize: APP_TEXT_SIZE.body, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  googleLabel: { color: '#222536' },
  disabled: { opacity: .50 },
});
