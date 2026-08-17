/**
 * Local-only approach notify: fire once per destination per journey when
 * remaining first drops to ≤ total/5. Never fans out.
 */

export const APPROACH_NOTIFY_RATIO = 1 / 5;
export const APPROACH_FIRED_STORAGE_KEY = '@hither/approach-notify-fired';

export interface ApproachNotifyInput {
  remainingM: number;
  totalM: number;
  arrivalRadiusM: number;
  arrived: boolean;
  alreadyFired: boolean;
}

export function shouldFireApproachNotify(input: ApproachNotifyInput): boolean {
  if (input.alreadyFired || input.arrived) return false;
  const { remainingM, totalM, arrivalRadiusM } = input;
  if (!Number.isFinite(remainingM) || remainingM < 0) return false;
  if (!Number.isFinite(totalM) || totalM <= 0) return false;
  if (!Number.isFinite(arrivalRadiusM) || arrivalRadiusM < 0) return false;
  const threshold = totalM * APPROACH_NOTIFY_RATIO;
  if (arrivalRadiusM > threshold) return false;
  return remainingM <= threshold;
}

export function approachNotifyKey(
  sessionId: string | null | undefined,
  destinationId: string,
): string {
  return `${sessionId ?? 'local'}:${destinationId}`;
}

export function approachNotifyCopy(title: string): { title: string; body: string } {
  const trimmed = title.trim();
  return {
    title: '快到目的地了',
    body: trimmed ? `「${trimmed}」` : '「集合點」',
  };
}
