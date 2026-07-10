import type { OnboardingRole, StepId } from './types';

/**
 * Pure "step N of M" progress for the current branch, used by the minimal dot
 * indicator on every step. `role` disambiguates once past the shared
 * intro/theme/role steps (before a role is chosen the shared steps still
 * report their position within the 3-step shared prefix).
 */

const SHARED: StepId[] = ['intro', 'theme', 'role'];
const LEADER: StepId[] = ['L1_purpose', 'L2_days', 'L3_departure'];
const FOLLOWER: StepId[] = ['F1', 'F2', 'F3', 'mascot', 'F4_prefs'];
const BROWSER: StepId[] = ['C1_why', 'C2_companions', 'C3_wanted'];

export function branchSteps(role: OnboardingRole | undefined): StepId[] {
  const tail = role === 'leader' ? LEADER : role === 'follower' ? FOLLOWER : BROWSER;
  return [...SHARED, ...tail];
}

export function stepProgress(
  step: StepId,
  role: OnboardingRole | undefined,
): { index: number; total: number } {
  const steps = branchSteps(role);
  const index = steps.indexOf(step);
  return { index: index < 0 ? 0 : index, total: steps.length };
}
