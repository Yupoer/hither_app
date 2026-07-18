/**
 * Whether a user may mark arrival at `dest` given sequential itinerary rules.
 * Mirrors set_destination_arrival: earlier same-scope stops must be closed or
 * already personally arrived. The first open stop is always markable.
 */

export interface ArrivalMarkStop {
  id: string;
  order: number;
  subgroupId?: string | null;
  closedAt?: string | null;
}

export function canMarkDestinationArrival(opts: {
  destId: string;
  destOrder: number;
  destSubgroupId?: string | null;
  scopedDestinations: ArrivalMarkStop[];
  myArrivedDestinationIds: ReadonlySet<string>;
}): boolean {
  const scopeKey = opts.destSubgroupId ?? null;
  return !opts.scopedDestinations.some((stop) => {
    if ((stop.subgroupId ?? null) !== scopeKey) return false;
    if (stop.order >= opts.destOrder) return false;
    if (stop.closedAt) return false;
    if (opts.myArrivedDestinationIds.has(stop.id)) return false;
    return true;
  });
}
