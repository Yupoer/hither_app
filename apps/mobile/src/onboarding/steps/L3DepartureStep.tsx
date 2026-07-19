import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { HitherText } from '../../components/HitherText';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../state/PreferencesContext';
import { accentMix } from '../../glass';
import { useTranslation } from '../../i18n';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';
import { selectionTick } from '../../utils/haptics';

const DAY_MS = 24 * 60 * 60 * 1000;
// The 自訂 (custom) tile gets its own distinct hue so the two options read as
// clearly different choices (Design System "Electric Sky" secondary).
const CUSTOM_COLOR = '#37B6FF';

function daysUntil(date: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / DAY_MS));
}

export default function L3DepartureStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [key, setKey] = useState<'now' | 'custom' | null>(
    answers.departureDate ? 'custom' : null,
  );
  const [customDate, setCustomDate] = useState<Date | null>(
    answers.departureDate ? new Date(answers.departureDate) : null,
  );
  const [showIosPicker, setShowIosPicker] = useState(false);

  const openCustom = () => {
    selectionTick();
    if (Platform.OS === 'android') {
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
    } else {
      setShowIosPicker(true);
    }
  };

  const effectiveDate = key === 'custom' ? customDate : key === 'now' ? new Date() : null;
  const canContinue = key === 'now' || (key === 'custom' && customDate !== null);

  const submit = () => {
    onAnswer({
      departureDate:
        key === 'custom' && customDate ? customDate.toISOString() : null,
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
      {/* Two side-by-side, colour-differentiated choices — never stacked. */}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: key === 'now' }}
          onPress={() => {
            selectionTick();
            setKey('now');
          }}
          style={[
            styles.tile,
            { borderColor: colors.accent },
            key === 'now' && { backgroundColor: colors.accent },
          ]}
        >
          <Ionicons
            name="flash"
            size={22}
            color={key === 'now' ? colors.accentText : colors.accent}
          />
          <HitherText
            typeRole="callout"
            style={[
              styles.tileLabel,
              { color: key === 'now' ? colors.accentText : colors.textPrimary },
            ]}
          >
            {t('onboarding.l3.optNow')}
          </HitherText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: key === 'custom' }}
          onPress={openCustom}
          style={[
            styles.tile,
            { borderColor: CUSTOM_COLOR },
            key === 'custom' && { backgroundColor: CUSTOM_COLOR },
          ]}
        >
          <Ionicons
            name="calendar"
            size={22}
            color={key === 'custom' ? '#fff' : CUSTOM_COLOR}
          />
          <HitherText
            typeRole="callout"
            style={[
              styles.tileLabel,
              { color: key === 'custom' ? '#fff' : colors.textPrimary },
            ]}
            numberOfLines={1}
          >
            {key === 'custom' && customDate
              ? customDate.toLocaleDateString()
              : t('onboarding.l3.optCustom')}
          </HitherText>
        </Pressable>
      </View>

      {effectiveDate ? (
        <View style={styles.countdownWrap}>
          <View style={[styles.countdownPill, { backgroundColor: accentMix(colors.accent, 16), borderColor: accentMix(colors.accent, 40) }]}>
            <Ionicons name="hourglass-outline" size={20} color={colors.accent} />
            <HitherText typeRole="callout" style={[styles.countdownText, { color: colors.accent }]}>
              {t('onboarding.l3.countdown', { days: daysUntil(effectiveDate) })}
            </HitherText>
          </View>
        </View>
      ) : null}

      {/* Calendar in a centered popup so it's never clipped off-screen or
          hidden behind the footer button. */}
      <Modal
        visible={showIosPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowIosPicker(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowIosPicker(false)} />
        <View style={styles.modalWrap} pointerEvents="box-none">
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <DateTimePicker
              value={customDate ?? new Date()}
              mode="date"
              display="inline"
              minimumDate={new Date()}
              style={styles.picker}
              onChange={(_event, selected) => {
                if (selected) {
                  selectionTick();
                  setCustomDate(selected);
                  setKey('custom');
                }
              }}
            />
            <PrimaryButton
              label={t('onboarding.continue')}
              onPress={() => {
                selectionTick();
                setShowIosPicker(false);
              }}
            />
          </View>
        </View>
      </Modal>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, marginTop: 8 },
  tile: {
    flex: 1,
    aspectRatio: 1.25,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  tileLabel: { fontSize: 16, fontWeight: '700' },
  // Enlarged, badge-style "days to go" so it reads as the confirmation moment.
  countdownWrap: { alignItems: 'center', marginTop: 28 },
  countdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  countdownText: { fontSize: 20, fontWeight: '800' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  // Minimal side padding + centered card so the inline calendar is never
  // clipped on the right.
  modalWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10 },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 14,
    gap: 12,
  },
  picker: { alignSelf: 'center', width: '100%' },
});
