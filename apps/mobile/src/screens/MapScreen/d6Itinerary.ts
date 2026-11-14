import type { DailyAccommodation, Destination } from '../../types';
import { dateForTripDay, localDayKey, openDestinationsForReorder } from '../../utils/tripDay';
import type { ReorderUpdate } from './itineraryReorder';

export const D6_DAY_PALETTE = ['#A35FC9', '#2FA394', '#E07A2E', '#3D7FD9', '#D9578F', '#4E9F5A'];

export type D6Day = { number: number; date: Date; color: string };

export function d6TripDays(
  departure: Date,
  count: number,
  dayColors: Readonly<Record<number, string>>,
): D6Day[] {
  const departureDate = localDayKey(departure);
  return Array.from({ length: count }, (_item, index) => {
    const number = index + 1;
    return {
      number,
      date: dateForTripDay(departureDate, number) ?? departure,
      color: dayColors[number] ?? D6_DAY_PALETTE[index % D6_DAY_PALETTE.length],
    };
  });
}

export function d6DayNumber(departure: Date, date: Date): number {
  const a = Date.UTC(departure.getFullYear(), departure.getMonth(), departure.getDate());
  const b = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return (b - a) / 86_400_000 + 1;
}

export function d6TripRange(first: Date, second: Date): { days: number; departureDate: string } {
  const offset = d6DayNumber(first, second) - 1;
  return {
    days: Math.abs(offset) + 1,
    departureDate: localDayKey(offset >= 0 ? first : second),
  };
}

export type D6RouteRow =
  | { kind: 'destination'; id: string; destination: Destination; isLegacyStay?: boolean }
  | { kind: 'accommodation'; id: string; accommodation: DailyAccommodation; destination?: Destination };

export function d6DayRows(
  destinations: readonly Destination[],
  day: D6Day,
  dailyAccommodations: readonly DailyAccommodation[],
): D6RouteRow[] {
  const open = openDestinationsForReorder(destinations).filter((d) => (d.day ?? 0) === day.number);
  const stay = dailyAccommodations.find((item) => item.stayDate === localDayKey(day.date));
  const source = stay && open.find((destination) => destination.id === stay.sourceDestinationId);
  const rows = open
    .filter((destination) => destination.id !== source?.id)
    .map((destination): D6RouteRow => ({ kind: 'destination', id: destination.id, destination,
      ...(destination.kind === 'accommodation' ? { isLegacyStay: true } : {}),
    }));
  if (stay) rows.push({ kind: 'accommodation', id: stay.id, accommodation: stay, destination: source });
  return rows;
}

export function d6Reorder(
  destinations: readonly Destination[],
  action: { ids: readonly string[]; day: number | null; beforeId?: string },
): ReorderUpdate[] {
  const open = openDestinationsForReorder(destinations);
  const moved = open.filter((destination) => action.ids.includes(destination.id));
  const remaining = open.filter((destination) => !action.ids.includes(destination.id));
  const dayNumber = action.day ?? 0;
  const target = remaining.findIndex((destination) => (destination.day ?? 0) === dayNumber
    && destination.id === action.beforeId);
  const afterDay = remaining.findIndex((destination) => (destination.day ?? 0) > dayNumber);
  const at = target >= 0 ? target : afterDay >= 0 ? afterDay : remaining.length;
  remaining.splice(at, 0, ...moved.map((destination) => ({ ...destination, day: action.day })));
  if (open.every((destination, index) => remaining[index]?.id === destination.id
    && remaining[index].day === destination.day)) return [];
  return remaining.map((destination, position) => ({
    id: destination.id,
    position,
    day: destination.day,
    ...(action.ids.includes(destination.id) && destination.stayAnchor ? { stayAnchor: false } : {}),
  }));
}

export function d6DropLabel(rows: readonly D6RouteRow[], draggedId: string, target: { kind: 'row'; id: string; edge: 'above' | 'below' } | { kind: 'day'; day: number } | null, chinese: boolean): string {
  if (!target) return chinese ? '拖至插入位置' : 'Drag to an insertion point';
  if (target.kind === 'day') return chinese ? `移至第 ${target.day} 天` : `Move to day ${target.day}`;
  const stops = rows.filter(row => row.id !== draggedId && row.kind === 'destination' && !row.isLegacyStay);
  const index = stops.findIndex(row => row.id === target.id) + (target.edge === 'below' ? 1 : 0);
  const before = stops[index - 1]?.destination?.title;
  const after = stops[index]?.destination?.title;
  if (before && after) return chinese ? `放在「${before}」與「${after}」之間` : `Between ${before} and ${after}`;
  if (after) return chinese ? `放在「${after}」之前` : `Before ${after}`;
  if (before) return chinese ? `放在「${before}」之後` : `After ${before}`;
  return chinese ? '放在當天第一站' : 'First stop of the day';
}
