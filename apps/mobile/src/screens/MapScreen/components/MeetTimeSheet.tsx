import OverlaySheet from '../../../components/OverlaySheet';
import { accentMix, glass } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import { MEET_RED_OPTIONS } from '../../../state/PreferencesContext';
import { lightTap } from '../../../utils/haptics';
import { addMinutesToPickerValue, startOfTodayLocal, clampDateNotBeforeToday } from '../../../utils/meetTime';
import { Segmented } from './Segmented';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import React from 'react';
import { View, Text, Pressable, Platform, Alert } from 'react-native';
import type { MapStyles } from '../styles';

export interface MeetTimeSheetProps {
  accent: string;
  meetTimeEditor: { id: string; value: Date; redMin: number; quickMinutes: number | null; } | null;
  openAndroidMeetDate: () => void;
  persistMeetTime: (destinationId: string, value: Date | null, redMin?: number) => void;
  setMeetTimeEditor: React.Dispatch<React.SetStateAction<{ id: string; value: Date; redMin: number; quickMinutes: number | null; } | null>>;
  styles: MapStyles;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function MeetTimeSheet({
  accent,
  meetTimeEditor,
  openAndroidMeetDate,
  persistMeetTime,
  setMeetTimeEditor,
  styles,
  t,
}: MeetTimeSheetProps) {
  return (
    <OverlaySheet
      visible={!!meetTimeEditor}
      onClose={() => setMeetTimeEditor(null)}
      title={t('meetTime.set')}
      accent={accent}
      doneLabel={t('common.cancel')}
      doneSystemImage="xmark"
      edgeToEdge
    >
      {meetTimeEditor && (
        <View style={styles.meetEditorBody}>
          <Text style={[styles.sectionLabel, styles.meetSectionLabel]}>
            {t('meetTime.quickSection')}
          </Text>
          <View style={styles.meetQuickRow}>
            {[10, 30, 60].map((m) => (
              <Pressable
                key={m}
                testID={`meet-time-plus-${m}`}
                style={[
                  styles.meetQuickBtn,
                  meetTimeEditor.quickMinutes === m && {
                    borderColor: accent,
                    backgroundColor: accentMix(accent, 14),
                  },
                ]}
                onPress={() => {
                  lightTap();
                  const shortcut = addMinutesToPickerValue(meetTimeEditor.value, m);
                  setMeetTimeEditor((s) =>
                    s ? { ...s, value: shortcut, quickMinutes: m } : s,
                  );
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  m < 60
                    ? t('map.meetInMinutes', { n: m })
                    : t('map.meetInHours', { n: m / 60 })
                }
              >
                <Ionicons
                  name="time-outline"
                  size={16}
                  color={
                    meetTimeEditor.quickMinutes === m ? accent : glass.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.meetQuickBtnText,
                    meetTimeEditor.quickMinutes === m && { color: accent },
                  ]}
                >
                  {m < 60
                    ? t('map.meetInMinutes', { n: m })
                    : t('map.meetInHours', { n: m / 60 })}
                </Text>
              </Pressable>
            ))}
          </View>
    
          <Text style={[styles.sectionLabel, styles.meetSectionLabel]}>
            {t('meetTime.timeSection')}
          </Text>
          <Pressable
            style={styles.meetDateSummary}
            onPress={
              Platform.OS === 'android'
                ? () => {
                    lightTap();
                    openAndroidMeetDate();
                  }
                : undefined
            }
            accessibilityRole={Platform.OS === 'android' ? 'button' : undefined}
            accessibilityLabel={t('meetTime.pickDateTime')}
            testID="meet-time-date"
          >
            <Ionicons name="calendar-outline" size={20} color={accent} />
            <Text style={styles.meetSelectedClock}>
              {meetTimeEditor.value.toLocaleString(undefined, {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={glass.textSecondary}
            />
          </Pressable>
    
          {Platform.OS !== 'android' && (
            <View style={styles.meetPickerWrap}>
              <DateTimePicker
                testID="meet-time-picker"
                value={meetTimeEditor.value}
                mode="datetime"
                display="spinner"
                minuteInterval={1}
                minimumDate={startOfTodayLocal()}
                onChange={(_event, selected) =>
                  selected &&
                  setMeetTimeEditor((s) =>
                    s
                      ? {
                          ...s,
                          value: clampDateNotBeforeToday(selected),
                          quickMinutes: null,
                        }
                      : s,
                  )
                }
              />
            </View>
          )}
    
          <View style={{ marginTop: 10, marginBottom: 6 }}>
            <View style={styles.meetSectionHeader}>
              <Text style={styles.meetSectionHeaderLabel}>
                {t('meetTime.redSection')}
              </Text>
              <Pressable
                hitSlop={10}
                onPress={() =>
                  Alert.alert(t('meetTime.redSection'), t('meetTime.redHint'))
                }
                accessibilityRole="button"
                accessibilityLabel={t('meetTime.redInfo')}
                style={styles.meetSectionHeaderInfo}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={20}
                  color={accent}
                />
              </Pressable>
            </View>
            <Segmented
              accent={accent}
              options={MEET_RED_OPTIONS.map((m) => ({
                key: String(m),
                label: t('meetTime.redOption', { minutes: m }),
              }))}
              value={String(meetTimeEditor.redMin)}
              onChange={(v) =>
                setMeetTimeEditor((s) => (s ? { ...s, redMin: Number(v) } : s))
              }
            />
          </View>
          <Pressable
            style={[
              styles.meetSetBtn,
              { backgroundColor: accentMix(accent, 90), borderColor: accentMix(accent, 50) },
            ]}
            testID="meet-time-save"
            onPress={() => {
              persistMeetTime(
                meetTimeEditor.id,
                meetTimeEditor.value,
                meetTimeEditor.redMin,
              );
              setMeetTimeEditor(null);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.meetSetText}>{t('meetTime.set')}</Text>
          </Pressable>
          <Pressable
            style={styles.meetClearBtn}
            testID="meet-time-clear"
            onPress={() => {
              persistMeetTime(meetTimeEditor.id, null);
              setMeetTimeEditor(null);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.meetClearText}>{t('meetTime.clear')}</Text>
          </Pressable>
        </View>
      )}
    </OverlaySheet>
  );
}
