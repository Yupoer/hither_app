import React, { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { formatCompactDurationFromMinutes } from '../utils/geo';

function formatMeetClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Live meet-time countdown that ticks every second on its OWN timer, so the
 * big MapScreen tree doesn't re-render 1×/s.
 *
 * - compact (default): within an hour ticking `M:SS`; further out `Nhr` / `NdNhr`
 * - minutes: whole minutes left (e.g. expanded gather card "944 分鐘")
 *
 * When the meet time has arrived (totalSec <= 0), shows the due clock label
 * instead of a zero countdown.
 *
 * Turns `redColor` once `redWithinMin` minutes (or fewer) remain.
 */
export default React.memo(function MeetCountdown({
  meetAtIso,
  redWithinMin,
  baseStyle,
  redColor,
  variant = 'compact',
  formatMinutes,
  formatDue,
  onDueChange,
  adjustsFontSizeToFit = false,
  minimumFontScale = 0.7,
}: {
  meetAtIso: string;
  redWithinMin: number;
  baseStyle?: StyleProp<TextStyle>;
  redColor: string;
  variant?: 'compact' | 'minutes';
  /** Used when variant is `minutes` — e.g. (m) => t('map.meetMinutes', { minutes: m }). */
  formatMinutes?: (minutes: number) => string;
  /** When meet time is due/past — e.g. (time) => t('map.meetAtClock', { time }). */
  formatDue?: (time: string) => string;
  /** Fires when countdown crosses into/out of "due" so caption can switch. */
  onDueChange?: (due: boolean) => void;
  /** Shrink long minute labels inside fixed-width meet chrome. */
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingSec = Math.round((new Date(meetAtIso).getTime() - now) / 1000);
  const due = remainingSec <= 0;
  const totalSec = Math.max(0, remainingSec);
  const red = due || totalSec <= redWithinMin * 60;
  const wholeMin = Math.ceil(totalSec / 60);
  const dueClock = formatMeetClock(meetAtIso);
  const label = due
    ? formatDue
      ? formatDue(dueClock)
      : dueClock
        ? `${dueClock}`
        : '0'
    : variant === 'minutes'
      ? formatMinutes
        ? formatMinutes(wholeMin)
        : `${wholeMin} min`
      : totalSec >= 3600
        ? formatCompactDurationFromMinutes(Math.floor(totalSec / 60))
        : `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;

  useEffect(() => {
    onDueChange?.(due);
  }, [due, onDueChange]);

  return (
    <Text
      style={[baseStyle, red ? { color: redColor } : null]}
      numberOfLines={1}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      minimumFontScale={minimumFontScale}
    >
      {label}
    </Text>
  );
});
