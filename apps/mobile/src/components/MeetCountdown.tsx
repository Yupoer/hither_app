import React, { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

/**
 * Live meet-time countdown that ticks every second on its OWN timer, so the
 * big MapScreen tree doesn't re-render 1×/s. Within an hour it shows a ticking
 * `M:SS`; further out just `N分` (seconds are noise at that range). Turns
 * `redColor` once `redWithinMin` minutes (or fewer) remain. Overdue → leading `-`.
 */
export default function MeetCountdown({
  meetAtIso,
  redWithinMin,
  baseStyle,
  redColor,
}: {
  meetAtIso: string;
  redWithinMin: number;
  baseStyle?: StyleProp<TextStyle>;
  redColor: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const totalSec = Math.round((new Date(meetAtIso).getTime() - now) / 1000);
  const red = totalSec <= redWithinMin * 60;
  const sign = totalSec < 0 ? '-' : '';
  const abs = Math.abs(totalSec);
  const label =
    abs >= 3600
      ? `${sign}${Math.floor(abs / 60)}分`
      : `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;

  return (
    <Text style={[baseStyle, red ? { color: redColor } : null]} numberOfLines={1}>
      {label}
    </Text>
  );
}
