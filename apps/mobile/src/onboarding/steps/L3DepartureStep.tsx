import React, { useState } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { useTheme } from '../../state/PreferencesContext';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import OptionCard from './OptionCard';
import PrimaryButton from './PrimaryButton';
import { selectionTick } from '../../utils/haptics';

type DepartKey = 'now' | 'in3' | 'week' | 'custom';

const DAY_MS = 24 * 60 * 60 * 1000;
const OPTION_ORDER: DepartKey[] = ['now', 'in3', 'week', 'custom'];

const LABEL_KEY: Record<DepartKey, TranslationKey> = {
  now: 'onboarding.l3.optNow',
  in3: 'onboarding.l3.opt3days',
  week: 'onboarding.l3.optWeek',
  custom: 'onboarding.l3.optCustom',
};

const EMOJI: Record<DepartKey, string> = {
  now: '⚡',
  in3: '📅',
  week: '🗓️',
  custom: '✏️',
};

function daysUntil(date: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / DAY_MS));
}

/** The actual departure Date a preset key resolves to. */
function presetDate(key: Exclude<DepartKey, 'custom'>): Date {
  const base = Date.now();
  if (key === 'in3') return new Date(base + 3 * DAY_MS);
  if (key === 'week') return new Date(base + 7 * DAY_MS);
  return new Date(base); // 'now'
}

export default function L3DepartureStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  // Restore a previously-saved custom date as the custom selection; presets
  // aren't round-tripped (the user just re-taps one).
  const [key, setKey] = useState<DepartKey | null>(
    answers.departureDate ? 'custom' : null,
  );
  const [customDate, setCustomDate] = useState<Date | null>(
    answers.departureDate ? new Date(answers.departureDate) : null,
  );
  const [showIosPicker, setShowIosPicker] = useState(false);

  const openAndroidPicker = () => {
    DateTimePickerAndroid.open({
      value: customDate ?? new Date(),
      mode: 'date',
      minimumDate: new Date(),
      onChange: (event, selected) => {
        if (event.type === 'set' && selected) {
          selectionTick();
          setCustomDate(selected);
          setKey('custom');
        }
      },
    });
  };

  const select = (k: DepartKey) => {
    selectionTick();
    if (k === 'custom') {
      // Pop the calendar; on iOS it renders inline below the options.
      if (Platform.OS === 'android') openAndroidPicker();
      else setShowIosPicker(true);
      return;
    }
    setShowIosPicker(false);
    setKey(k);
  };

  // Effective date for the countdown + submit ('now' departs immediately).
  const effectiveDate =
    key === 'custom' ? customDate : key ? presetDate(key) : null;
  const canContinue = key !== null && (key !== 'custom' || customDate !== null);

  const submit = () => {
    onAnswer({
      departureDate:
        key === 'now' ? null : effectiveDate ? effectiveDate.toISOString() : null,
    });
  };

  return (
    <StepShell
      step="L3_departure"
      role={answers.role}
      kicker={t('onboarding.l3.kicker')}
      title={t('onboarding.l3.title')}
      onBack={onBack}
      onSkip={onSkip}
      footer={
        <PrimaryButton
          label={t('onboarding.continue')}
          disabled={!canContinue}
          onPress={submit}
        />
      }
    >
      {OPTION_ORDER.map((k) => (
        <OptionCard
          key={k}
          emoji={EMOJI[k]}
          title={
            k === 'custom' && customDate
              ? customDate.toLocaleDateString()
              : t(LABEL_KEY[k])
          }
          selected={key === k}
          onPress={() => select(k)}
        />
      ))}

      {showIosPicker && Platform.OS === 'ios' ? (
        <DateTimePicker
          value={customDate ?? new Date()}
          mode="date"
          display="inline"
          minimumDate={new Date()}
          onChange={(_event, selected) => {
            if (selected) {
              selectionTick();
              setCustomDate(selected);
              setKey('custom');
              // Return to the options list with 自訂時間 now ticked.
              setShowIosPicker(false);
            }
          }}
        />
      ) : null}

      {effectiveDate ? (
        <Text style={[styles.countdown, { color: colors.textSecondary }]}>
          {t('onboarding.l3.countdown', { days: daysUntil(effectiveDate) })}
        </Text>
      ) : null}
    </StepShell>
  );
}

const styles = StyleSheet.create({
  countdown: { fontSize: 15, marginTop: 16, textAlign: 'center' },
});
