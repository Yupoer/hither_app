export const CHARGE_BALL_INTERVAL_MS = 280 / 1.5;
export const CHARGE_BALL_MAX_TRAVEL_MS = 6800 / 1.25;
export const CHARGE_BALL_OPACITY_LEVELS = 16;
export const CHARGE_BALL_MIN_OPACITY = 0.12;
export const CHARGE_BALL_MAX_OPACITY = 0.45;
export interface ChargeEmission { startedAt: number; stoppedAt?: number; }
export interface ChargeBall { id: string; x: number; y: number; radius: number; shade: number; }

/** Start/stop the inlet without removing balls that are already in flight. */
export function changeChargeEmission(windows: ChargeEmission[], emitting: boolean, now: number): ChargeEmission[] {
  const retained = windows.filter(window => window.stoppedAt == null || now < window.stoppedAt + CHARGE_BALL_MAX_TRAVEL_MS);
  const last = retained[retained.length - 1];
  if (emitting) return last && last.stoppedAt == null ? retained : [...retained, { startedAt: now }];
  return retained.map(window => window.stoppedAt == null ? { ...window, stoppedAt: now } : window);
}

/** A single full-height field; card collapse only clips it, never changes it. */
export function chargeBallsAt(now: number, width: number, windows: ChargeEmission[]): ChargeBall[] {
  'worklet';
  if (width <= 0) return [];
  const balls: ChargeBall[] = [];
  const fieldHeight = width * 0.85;
  for (const window of windows) {
    const first = Math.max(0, Math.floor((now - window.startedAt - CHARGE_BALL_MAX_TRAVEL_MS) / CHARGE_BALL_INTERVAL_MS));
    const last = Math.floor((Math.min(now, window.stoppedAt ?? now) - window.startedAt) / CHARGE_BALL_INTERVAL_MS + 1e-9);
    for (let index = first; index <= last; index++) {
      const bornAt = window.startedAt + index * CHARGE_BALL_INTERVAL_MS;
      if (window.stoppedAt != null && bornAt >= window.stoppedAt) continue;
      const age = now - bornAt;
      let seed = (Math.imul(index + 1, 747796405) + window.startedAt) >>> 0;
      seed = (Math.imul(seed ^ (seed >>> 16), 2246822507)) >>> 0;
      const vertical = (seed & 65535) / 65535;
      const variation = (seed >>> 16) / 65535;
      const radius = (5 + variation * 3) * 0.8 * width / 360;
      // Preserve the exact velocity multiplier even though the exit margins shrink.
      const duration = (5000 + variation * 1800) / 1.25
        * (width + radius * 2) / (width + radius / 0.8 * 2);
      if (age < 0 || age >= duration) continue;
      balls.push({
        id: `${window.startedAt}:${index}`,
        // Enter outside the right boundary and leave outside the left.
        x: width + radius - (width + radius * 2) * age / duration,
        y: radius + vertical * (fieldHeight - radius * 2) + Math.sin(age / 1100 + variation * 6) * 3,
        radius,
        // Deterministic, independent 4–6 second fade cycles.
        shade: Math.round((0.5 + 0.5 * Math.sin(age / (4000 + variation * 2000) * Math.PI * 2 + vertical * Math.PI * 2)) * (CHARGE_BALL_OPACITY_LEVELS - 1)),
      });
    }
  }
  return balls;
}
