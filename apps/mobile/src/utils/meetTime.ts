/** Minutes until meetAt (negative = overdue). Rounds toward zero. */
export function minutesUntil(meetAtIso: string, now: Date): number {
  const diffMs = new Date(meetAtIso).getTime() - now.getTime();
  return Math.trunc(diffMs / 60000);
}
