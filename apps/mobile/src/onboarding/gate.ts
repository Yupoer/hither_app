/**
 * RoleSelect is the reset-replay consumption boundary (#181).
 * Skip the initial navigator mount (previousName == null). Recheck when
 * arriving at RoleSelect from elsewhere, even if membership is still set.
 */
export function shouldRecheckOnboardingOnRouteChange(
  previousName: string | null,
  nextName: string | null,
): boolean {
  if (nextName !== 'RoleSelect') return false;
  if (previousName == null) return false;
  return previousName !== 'RoleSelect';
}

/** Home boundary includes RoleSelect, not only "no membership". */
export function isOnboardingHomeBoundary(input: {
  hasUser: boolean;
  hasMembership: boolean;
  routeName: string | null;
}): boolean {
  if (input.routeName === 'RoleSelect') return true;
  return !(input.hasUser && input.hasMembership);
}
