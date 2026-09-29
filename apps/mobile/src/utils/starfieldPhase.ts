export const STARFIELD_PERIOD_SECONDS = 120;
export function advanceStarfieldPhase(phase: number, deltaMs: number, speed = 1.2): number {
  'worklet';
  return (phase + Math.max(0, Math.min(deltaMs, 50)) * speed / (1000 * STARFIELD_PERIOD_SECONDS)) % 1;
}
