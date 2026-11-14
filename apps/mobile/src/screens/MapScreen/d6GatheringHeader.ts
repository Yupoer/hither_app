import type { Destination } from '../../types';
import type { D6Journey } from './components/D6HomeChrome';

type MeetingDisplay =
  | { kind: 'none' }
  | { kind: 'status'; status: 'calculating' }
  | { kind: 'duration'; hours: number; minutes: number }
  | { kind: 'time'; value: string; hot?: boolean; unit?: boolean };

export function d6MeetingDisplay(stop: Destination | null, phase: D6Journey, eta: number | null, now: number, locale: string): MeetingDisplay {
  if (phase === 'arrived') return { kind: 'time', value: '✓', hot: true };
  if (phase === 'going') {
    if (eta == null || !Number.isFinite(eta)) return { kind: 'status', status: 'calculating' };
    const minutes = Math.max(0, Math.ceil(eta / 60));
    return minutes < 60 ? { kind: 'time', value: String(minutes), unit: true, hot: true }
      : { kind: 'duration', hours: Math.floor(minutes / 60), minutes: minutes % 60 };
  }
  const meetAt = stop?.meetAt ? Date.parse(stop.meetAt) : NaN;
  if (!Number.isFinite(meetAt)) return { kind: 'none' };
  const minutes = Math.ceil((meetAt - now) / 60000);
  if (meetAt >= now && minutes <= 15) return { kind: 'time', value: String(minutes), unit: true, hot: true };
  return { kind: 'time', value: new Date(meetAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) };
}

export function d6TravelTime(eta: number | null, zh: boolean): string {
  if (eta == null || !Number.isFinite(eta)) return '—';
  const minutes = Math.max(0, Math.ceil(eta / 60));
  return minutes < 60 ? `${minutes} ${zh ? '分' : 'min'}`
    : `${Math.floor(minutes / 60)} ${zh ? '時' : 'h'} ${minutes % 60} ${zh ? '分' : 'min'}`;
}
