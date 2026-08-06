import { TOUR_STEPS, type TourStepDef, type TourStepId } from './constants';

export interface TourControllerState {
  active: boolean;
  stepIndex: number;
}

export function createTourControllerState(active = false): TourControllerState {
  return { active, stepIndex: 0 };
}

export function currentStep(state: TourControllerState): TourStepDef | null {
  if (!state.active) return null;
  return TOUR_STEPS[state.stepIndex] ?? null;
}

export function advanceTour(state: TourControllerState): TourControllerState {
  if (!state.active) return state;
  const next = state.stepIndex + 1;
  if (next >= TOUR_STEPS.length) {
    return { active: false, stepIndex: 0 };
  }
  return { active: true, stepIndex: next };
}

export function isFinalStep(state: TourControllerState): boolean {
  const step = currentStep(state);
  return Boolean(step?.final);
}

export function startTour(): TourControllerState {
  return { active: true, stepIndex: 0 };
}

export function stopTour(): TourControllerState {
  return { active: false, stepIndex: 0 };
}

export function stepOrder(): TourStepId[] {
  return TOUR_STEPS.map((s) => s.id);
}

export function stepCount(): number {
  return TOUR_STEPS.length;
}
