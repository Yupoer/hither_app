import { TOUR_STEPS, type TourStepDef, type TourStepId } from './constants';

export interface TourControllerState {
  active: boolean;
  stepIndex: number;
}

export function createTourControllerState(active = false): TourControllerState {
  return { active, stepIndex: 0 };
}

export function currentStep(
  state: TourControllerState,
  steps: readonly TourStepDef[] = TOUR_STEPS,
): TourStepDef | null {
  if (!state.active) return null;
  return steps[state.stepIndex] ?? null;
}

export function advanceTour(
  state: TourControllerState,
  steps: readonly TourStepDef[] = TOUR_STEPS,
): TourControllerState {
  if (!state.active) return state;
  const next = state.stepIndex + 1;
  if (next >= steps.length) {
    return { active: false, stepIndex: 0 };
  }
  return { active: true, stepIndex: next };
}

export function isFinalStep(
  state: TourControllerState,
  steps: readonly TourStepDef[] = TOUR_STEPS,
): boolean {
  const step = currentStep(state, steps);
  return Boolean(step?.final);
}

export function startTour(): TourControllerState {
  return { active: true, stepIndex: 0 };
}

export function stopTour(): TourControllerState {
  return { active: false, stepIndex: 0 };
}

export function stepOrder(steps: readonly TourStepDef[] = TOUR_STEPS): TourStepId[] {
  return steps.map((s) => s.id);
}

export function stepCount(steps: readonly TourStepDef[] = TOUR_STEPS): number {
  return steps.length;
}
