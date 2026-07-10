import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation, type TranslationKey } from '../../i18n';
import { PREF_OPTIONS, type PrefOption } from '../content';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import OptionCard from './OptionCard';
import PrimaryButton from './PrimaryButton';
import { selectionTick } from '../../utils/haptics';

const LABEL_KEY: Record<PrefOption, TranslationKey> = {
  food: 'onboarding.f4.food',
  sights: 'onboarding.f4.sights',
  shopping: 'onboarding.f4.shopping',
  nature: 'onboarding.f4.nature',
  culture: 'onboarding.f4.culture',
  nightlife: 'onboarding.f4.nightlife',
};

const EMOJI: Record<PrefOption, string> = {
  food: '🍜',
  sights: '📸',
  shopping: '🛍️',
  nature: '🌿',
  culture: '🏛️',
  nightlife: '🌃',
};

// Fixed colour block behind each emoji so the tiles read as categories rather
// than bare stickers on the card. Theme-independent (decorative, not accent).
const TILE_COLOR: Record<PrefOption, string> = {
  food: '#E8663C',
  sights: '#3E86E0',
  shopping: '#4C6FE5',
  nature: '#3FA96B',
  culture: '#9B6BE0',
  nightlife: '#5C4CC4',
};

// Secondary label under the title — purely a visual hierarchy cue.
const SUBLABEL: Record<PrefOption, string> = {
  food: 'Food',
  sights: 'Sights',
  shopping: 'Shopping',
  nature: 'Nature',
  culture: 'Culture',
  nightlife: 'Nightlife',
};

export default function F4PrefsStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>(answers.prefs ?? []);

  const toggle = (opt: PrefOption) => {
    selectionTick();
    setSelected((prev) =>
      prev.includes(opt) ? prev.filter((p) => p !== opt) : [...prev, opt],
    );
  };

  return (
    <StepShell
      step="F4_prefs"
      role={answers.role}
      kicker={t('onboarding.f4.kicker')}
      title={t('onboarding.f4.title')}
      onBack={onBack}
      onSkip={onSkip}
      footer={
        <PrimaryButton
          label={t('onboarding.continue')}
          disabled={selected.length === 0}
          onPress={() => onAnswer({ prefs: selected })}
        />
      }
    >
      <View style={styles.grid}>
        {PREF_OPTIONS.map((opt) => (
          <View key={opt} style={styles.cell}>
            <OptionCard
              emoji={EMOJI[opt]}
              tileColor={TILE_COLOR[opt]}
              title={t(LABEL_KEY[opt])}
              subtitle={SUBLABEL[opt]}
              selected={selected.includes(opt)}
              onPress={() => toggle(opt)}
            />
          </View>
        ))}
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cell: { width: '48%' },
});
