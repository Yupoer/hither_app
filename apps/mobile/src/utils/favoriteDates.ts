/**
 * Eligible dates when adding a favorite place into a trip itinerary.
 * - Before trip: all trip days
 * - During trip: today and future days only
 * - After trip: none
 */

import {
  currentTripDayNumber,
  dateForTripDay,
  localDayKey,
  parseDateOnlyLocal,
} from './tripDay';

export interface FavoriteDateOption {
  day: number;
  dateKey: string;
  date: Date;
}

export function eligibleFavoriteDateOptions(input: {
  departureDate: string | null | undefined;
  tripDays: number | null | undefined;
  now?: Date;
}): FavoriteDateOption[] {
  const now = input.now ?? new Date();
  const days =
    typeof input.tripDays === 'number' && input.tripDays > 0
      ? Math.floor(input.tripDays)
      : 0;
  if (!days || !parseDateOnlyLocal(input.departureDate ?? null)) {
    // No trip window configured — allow day 1 only (same as add destination).
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    return [{ day: 1, dateKey: localDayKey(d), date: d }];
  }

  const current = currentTripDayNumber(input.departureDate, days, now);
  if (current != null && current > days) {
    // Trip fully over — cannot add.
    return [];
  }

  const startDay =
    current == null || current <= 0 ? 1 : Math.min(days, Math.max(1, current));
  const options: FavoriteDateOption[] = [];
  for (let day = startDay; day <= days; day++) {
    const date = dateForTripDay(input.departureDate, day);
    if (!date) continue;
    options.push({
      day,
      dateKey: localDayKey(date),
      date,
    });
  }
  return options;
}
