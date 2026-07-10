/** Free-plan caps (Hither Pro removes them). Enforced client-side for now. */
export const FREE_LIMITS = {
  groupMembers: 4,
  anonymousMembers: 2,
  destinationsPerItinerary: 5,
  kmlImportPoints: 5,
  stragglerThresholdM: 500,
  historyEntries: 3,
} as const;
