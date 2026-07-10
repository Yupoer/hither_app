import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { useTheme } from '../../state/PreferencesContext';
import { useTranslation } from '../../i18n';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';
import { selectionTick } from '../../utils/haptics';

function daysUntil(date: Date): number {
  const ms = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default function L3DepartureStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [date, setDate] = useState<Date | null>(
    answers.departureDate ? new Date(answers.departureDate) : null,
  );

  const openAndroidPicker = () => {
    DateTimePickerAndroid.open({
      value: date ?? new Date(),
      mode: 'date',
      minimumDate: new Date(),
      onChange: (event, selected) => {
        if (event.type === 'set' && selected) {
          selectionTick();
          setDate(selected);
        }
      },
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
        <View style={styles.footerStack}>
          <PrimaryButton
            label={t('onboarding.continue')}
            disabled={!date}
            onPress={() => onAnswer({ departureDate: date ? date.toISOString() : null })}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              selectionTick();
              onAnswer({ departureDate: null });
            }}
            style={styles.nowLink}
          >
            <Text style={[styles.nowLinkText, { color: colors.textSecondary }]}>
              {t('onboarding.l3.now')}
            </Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.body}>
        {Platform.OS === 'android' ? (
          <PrimaryButton
            label={date ? date.toDateString() : t('onboarding.l3.title')}
            onPress={openAndroidPicker}
          />
        ) : (
          <DateTimePicker
            value={date ?? new Date()}
            mode="date"
            display="inline"
            minimumDate={new Date()}
            onChange={(_event, selected) => {
              if (selected) {
                selectionTick();
                setDate(selected);
              }
            }}
          />
        )}
        {date ? (
          <Text style={[styles.countdown, { color: colors.textSecondary }]}>
            {t('onboarding.l3.countdown', { days: daysUntil(date) })}
          </Text>
        ) : null}
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center' },
  countdown: { fontSize: 15, marginTop: 16 },
  footerStack: { gap: 10 },
  nowLink: { alignItems: 'center', paddingVertical: 6 },
  nowLinkText: { fontSize: 14, textDecorationLine: 'underline' },
});
