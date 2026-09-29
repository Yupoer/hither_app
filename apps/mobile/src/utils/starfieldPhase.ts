export const STARFIELD_PERIOD_SECONDS = 120;
export function advanceStarfieldPhase(phase: number, deltaMs: number, speed = 1.2): number {
  'worklet';
  return (phase + Math.max(0, Math.min(deltaMs, 100)) * speed / (1000 * STARFIELD_PERIOD_SECONDS)) % 1;
}

export function advanceStarfieldPosition(position: number, deltaMs: number, velocity: number, span: number): number {
  'worklet';
  return span > 0 ? (position + Math.max(0, Math.min(deltaMs, 100)) * velocity / 1000) % span : 0;
}
