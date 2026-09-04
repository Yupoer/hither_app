import React from 'react';
import { StyleSheet } from 'react-native';
import { Button, HStack, Host, Image, Menu, Text } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  font,
  foregroundColor,
  frame,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { usePreferences } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { lightTap } from '../utils/haptics';
import { LANGUAGE_CHOICES } from '../utils/showLanguageChoice';
import { liquidGlass } from '../native';
import { NativeMenuHost } from '../native/menu';
import NativeGlassButton from './NativeGlassButton';

export default function LanguagePicker({ variant = 'segmented' }: { variant?: 'segmented' | 'menu' }) {
  const { language, setLanguage } = usePreferences();
  const { t } = useTranslation();
  const current = LANGUAGE_CHOICES.find((choice) => choice.key === language) ?? LANGUAGE_CHOICES[0];

  if (variant === 'segmented') {
    return (
      <Host style={styles.segmentedHost} colorScheme="dark">
        <HStack spacing={4} modifiers={[padding({ all: 3 }), buttonBorderShape('capsule', 999)]}>
          {LANGUAGE_CHOICES.map((option) => (
            <Button
              key={option.key}
              label={option.label}
              onPress={() => {
                if (option.key === language) return;
                lightTap();
                setLanguage(option.key);
              }}
              testID={`language-${option.key}`}
              modifiers={[
                buttonStyle(liquidGlass.isLiquidGlassAvailable() ? 'glass' : 'bordered'),
                buttonBorderShape('capsule'),
                font({ size: 13, weight: 'semibold' }),
                foregroundColor(option.key === language ? '#fff' : 'rgba(235,235,245,0.7)'),
              ]}
            />
          ))}
        </HStack>
      </Host>
    );
  }

  return (
    <NativeMenuHost
      accessibilityLabel={t('settings.language')}
      style={styles.menuHost}
      items={LANGUAGE_CHOICES.map((choice) => ({
        id: choice.key,
        title: choice.label,
        selected: choice.key === language,
      }))}
      onSelect={(id) => {
        if (id === language) return;
        lightTap();
        setLanguage(id as typeof language);
      }}
    >
      <NativeGlassButton
        systemImage="globe"
        shape="capsule"
        width={45}
        height={45}
        imageSize={19.2}
        variant="glass"
        accessibilityLabel={t('settings.language')}
        testID="language-menu"
        style={styles.menuHost}
      />
    </NativeMenuHost>
  );
}

const styles = StyleSheet.create({
  segmentedHost: { width: 190, height: 42 },
  menuHost: { width: 45, height: 45 },
});
