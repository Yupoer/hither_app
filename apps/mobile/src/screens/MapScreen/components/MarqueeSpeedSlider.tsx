import React from 'react';
import PrefSlider from '../../../components/PrefSlider';
import { MARQUEE_SPEED_MAX, MARQUEE_SPEED_MIN } from '../../../state/PreferencesContext';

export type MarqueeSpeedSliderProps = {
  value: number;
  onChange: (value: number) => void;
  accent: string;
  accessibilityLabel: string;
};

export default function MarqueeSpeedSlider(props: MarqueeSpeedSliderProps) {
  return <PrefSlider {...props} min={MARQUEE_SPEED_MIN} max={MARQUEE_SPEED_MAX} />;
}
