import type { Destination } from '../types';

export type DestinationMarkerValues = {
  emoji: string | null;
  markerColor: string | null;
};

export type PendingDestinationMutation = {
  mutationId: string;
  destinationId: string;
  previous: DestinationMarkerValues;
  optimistic: DestinationMarkerValues;
};

function normalizeValues(values: Partial<DestinationMarkerValues>): DestinationMarkerValues {
  return {
    emoji: values.emoji ?? null,
    markerColor: values.markerColor ?? null,
  };
}

export function destinationMarkerValues(destination: Pick<Destination, 'emoji' | 'markerColor'>): DestinationMarkerValues {
  return normalizeValues(destination);
}

export function markerValuesEqual(
  left: DestinationMarkerValues,
  right: DestinationMarkerValues,
): boolean {
  return left.emoji === right.emoji && left.markerColor === right.markerColor;
}

/** Apply mutations in creation order; removing one mutation leaves newer ones intact. */
export function applyDestinationMutationOverlay(
  destinations: readonly Destination[],
  pending: readonly PendingDestinationMutation[],
): Destination[] {
  if (pending.length === 0) return [...destinations];
  const byId = new Map<string, Destination>();
  for (const destination of destinations) byId.set(destination.id, { ...destination });
  for (const mutation of pending) {
    const destination = byId.get(mutation.destinationId);
    if (!destination) continue;
    byId.set(mutation.destinationId, {
      ...destination,
      emoji: mutation.optimistic.emoji,
      markerColor: mutation.optimistic.markerColor,
    });
  }
  return destinations.map((destination) => byId.get(destination.id) ?? destination);
}

export function enqueueDestinationMutation(
  pending: readonly PendingDestinationMutation[],
  mutation: PendingDestinationMutation,
): PendingDestinationMutation[] {
  return [...pending, mutation];
}

export function removeDestinationMutation(
  pending: readonly PendingDestinationMutation[],
  mutationId: string,
): PendingDestinationMutation[] {
  return pending.filter((mutation) => mutation.mutationId !== mutationId);
}

/**
 * Reconcile only against server rows. If the latest optimistic value is
 * already present, all older mutations for that destination are obsolete too.
 * A stale response for another destination cannot clear this overlay.
 */
export function reconcileDestinationMutations(
  pending: readonly PendingDestinationMutation[],
  serverDestinations: readonly Destination[],
): PendingDestinationMutation[] {
  if (pending.length === 0) return [];
  const serverById = new Map(serverDestinations.map((destination) => [
    destination.id,
    destinationMarkerValues(destination),
  ]));
  const latestByDestination = new Map<string, PendingDestinationMutation>();
  for (const mutation of pending) latestByDestination.set(mutation.destinationId, mutation);

  const completedDestinationIds = new Set<string>();
  const completedMutationIds = new Set<string>();
  for (const mutation of pending) {
    const server = serverById.get(mutation.destinationId);
    if (!server) continue;
    const latest = latestByDestination.get(mutation.destinationId);
    if (latest && markerValuesEqual(server, latest.optimistic)) {
      completedDestinationIds.add(mutation.destinationId);
      continue;
    }
    if (markerValuesEqual(server, mutation.optimistic)) {
      completedMutationIds.add(mutation.mutationId);
    }
  }

  return pending.filter((mutation) => (
    !completedDestinationIds.has(mutation.destinationId)
    && !completedMutationIds.has(mutation.mutationId)
  ));
}
