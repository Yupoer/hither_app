import React from 'react';
import { StyleSheet } from 'react-native';
import { Host, Slider } from '@expo/ui/swift-ui';
import { accessibilityLabel, tint } from '@expo/ui/swift-ui/modifiers';
import { MARQUEE_SPEED_MAX, MARQUEE_SPEED_MIN } from '../../../state/PreferencesContext';
import { selectionTick } from '../../../utils/haptics';
import type { MarqueeSpeedSliderProps } from './MarqueeSpeedSlider';

export default function MarqueeSpeedSlider({
  value, onChange, accent, accessibilityLabel: label,
}: MarqueeSpeedSliderProps) {
  return (
    <Host style={styles.host} colorScheme="dark">
      <Slider
        testID="settings-marquee-speed"
        value={value}
        min={MARQUEE_SPEED_MIN}
        max={MARQUEE_SPEED_MAX}
        step={1}
        modifiers={[tint(accent), accessibilityLabel(label)]}
        onValueChange={next => {
          selectionTick();
          onChange(next);
        }}
      />
    </Host>
  );
}

const styles = StyleSheet.create({ host: { width: '100%', height: 44 } });
