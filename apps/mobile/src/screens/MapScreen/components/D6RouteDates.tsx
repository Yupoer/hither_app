import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../../components/AppText';
import Pressable from '../../../components/MotionPressable';
import { localDayKey } from '../../../utils/tripDay';
import { D6_DAY_PALETTE, d6TripRange, type D6Day } from '../d6Itinerary';

const describeDate = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const EN_WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function D6RouteDates({
  days,
  accent,
  displayFont,
  chinese,
  onRange,
  onColor,
  busy,
  error,
}: {
  days: readonly D6Day[];
  accent: string;
  displayFont?: string;
  chinese: boolean;
  onRange: (days: number, departureDate: string) => Promise<boolean>;
  onColor: (day: number, color: string) => void;
  busy: boolean;
  error?: string | null;
}) {
  const start = days[0].date;
  const end = days[days.length - 1].date;
  const [month, setMonth] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1, 12));
  const [pendingStart, setPendingStart] = useState<Date | null>(null);
  const [colorDay, setColorDay] = useState<D6Day | null>(null);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const activeWeekdays = chinese ? WEEKDAYS : EN_WEEKDAYS;
  const offset = month.getDay();
  const monthDays = new Date(year, monthIndex + 1, 0).getDate();
  const monthRows = Math.ceil((offset + monthDays) / 7);

  async function chooseDate(date: Date) {
    if (!pendingStart) {
      setPendingStart(date);
      return;
    }
    const range = d6TripRange(pendingStart, date);
    if (await onRange(range.days, range.departureDate)) {
      setPendingStart(null);
      setColorDay(null);
    }
  }

  return (
    <View testID="d6-route-dates">
      <View style={styles.rangeHeader}>
        <Text style={[styles.range, displayFont ? { fontFamily: displayFont, fontWeight: 'normal', fontStyle: 'normal' } : null]}>
          {pendingStart ? `${describeDate(pendingStart)} – ` : `${describeDate(start)} – ${describeDate(end)}`}
        </Text>
        <Text style={styles.dayCount}>
          {pendingStart ? '' : chinese ? `${days.length} 天` : `${days.length} days`}
        </Text>
      </View>
      <View style={styles.monthHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={chinese ? '上個月' : 'Previous month'}
          style={styles.circle}
          onPress={() => setMonth(new Date(year, monthIndex - 1, 1, 12))}
        >
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>
        <Text style={styles.month}>
          {chinese ? `${year} 年 ${monthIndex + 1} 月` : month.toLocaleDateString('en', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={chinese ? '下個月' : 'Next month'}
          style={styles.circle}
          onPress={() => setMonth(new Date(year, monthIndex + 1, 1, 12))}
        >
          <Ionicons name="chevron-forward" size={20} color="white" />
        </Pressable>
      </View>
      <View style={styles.week}>
        {activeWeekdays.map((name) => <Text key={name} style={styles.weekday}>{name}</Text>)}
      </View>
      {Array.from({ length: monthRows }, (_item, row) => (
        <View key={row} style={styles.week}>
          {Array.from({ length: 7 }, (_column, column) => {
            const number = row * 7 + column + 1 - offset;
            if (number < 1 || number > monthDays) return <View key={column} style={styles.day} />;
            const date = new Date(year, monthIndex, number, 12);
            const key = localDayKey(date);
            const first = key === localDayKey(pendingStart ?? start);
            const last = key === localDayKey(pendingStart ?? end);
            const inRange = !pendingStart && key >= localDayKey(start) && key <= localDayKey(end);
            return (
              <Pressable
                key={column}
                testID={`d6-date-${key}`}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={key}
                accessibilityState={{ selected: first || last || inRange }}
                onPress={() => { void chooseDate(date); }}
                style={[
                  styles.day,
                  inRange && { backgroundColor: `${accent}38` },
                  (first || last) && { backgroundColor: accent },
                  first && styles.firstDay,
                  last && styles.lastDay,
                ]}
              >
                <Text style={styles.number}>{number}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayColors}>
        {days.map((day) => (
          <Pressable
            key={day.number}
            accessibilityRole="button"
            accessibilityLabel={chinese ? `${describeDate(day.date)} 的顏色` : `Color for ${describeDate(day.date)}`}
            accessibilityState={{ selected: colorDay?.number === day.number }}
            testID={`d6-color-day-${day.number}`}
            style={[styles.colorDay, colorDay?.number === day.number && styles.colorDaySelected]}
            onPress={() => setColorDay((current) => current?.number === day.number ? null : day)}
          >
            <Text style={[styles.colorDate, displayFont ? { fontFamily: displayFont, fontWeight: 'normal', fontStyle: 'normal' } : null]}>
              {day.date.getDate()}
            </Text>
            <View style={[styles.colorLine, { backgroundColor: day.color }]} />
          </Pressable>
        ))}
      </ScrollView>
      {colorDay ? (
        <View style={styles.swatches}>
          {D6_DAY_PALETTE.map((color, index) => (
            <Pressable
              key={color}
              accessibilityRole="button"
              accessibilityState={{ selected: colorDay.color === color }}
              accessibilityLabel={(chinese ? ['紫色', '青綠色', '橙色', '藍色', '桃紅色', '綠色'] : ['Purple', 'Teal', 'Orange', 'Blue', 'Pink', 'Green'])[index]}
              testID={`d6-day-color-${color}`}
              style={styles.swatch}
              onPress={() => { onColor(colorDay.number, color); setColorDay(null); }}
            >
              <View style={[styles.swatchColor, { backgroundColor: color }, colorDay.color === color && styles.swatchSelected]} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rangeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 4, marginBottom: 10 },
  range: { color: 'white', fontSize: APP_TEXT_SIZE.heading, fontWeight: '800', fontStyle: 'italic', fontVariant: ['tabular-nums'], flexShrink: 1 },
  dayCount: { color: 'rgba(255,255,255,.60)', fontWeight: '600', marginLeft: 8 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { color: 'white', fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
  circle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(255,255,255,.12)' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, color: 'rgba(255,255,255,.55)', fontSize: APP_TEXT_SIZE.caption, textAlign: 'center', paddingVertical: 8 },
  day: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', marginVertical: 1 },
  number: { color: 'white', fontSize: APP_TEXT_SIZE.title, fontWeight: '600', fontVariant: ['tabular-nums'] },
  firstDay: { borderTopLeftRadius: 22, borderBottomLeftRadius: 22 },
  lastDay: { borderTopRightRadius: 22, borderBottomRightRadius: 22 },
  dayColors: { flexDirection: 'row', gap: 4, paddingTop: 12, paddingBottom: 4 },
  colorDay: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.07)' },
  colorDaySelected: { borderColor: 'white', borderWidth: 1 },
  colorDate: { color: 'white', fontSize: APP_TEXT_SIZE.heading, fontStyle: 'italic', fontWeight: '800', fontVariant: ['tabular-nums'] },
  colorLine: { width: 14, height: 3, borderRadius: 2 },
  swatches: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  swatch: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  swatchColor: { width: 31, height: 31, borderRadius: 16 },
  swatchSelected: { borderColor: 'white', borderWidth: 2 },
  error: { color: '#FF8E8E', marginTop: 8, fontSize: APP_TEXT_SIZE.caption },
});
