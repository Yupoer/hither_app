import type { Destination } from '../types';
import type { CoreOperation } from '../types/coreData';

/** Project unacknowledged local itinerary intent onto a UI GroupState. */
export function projectOperationDestinations(
  currentDestinations: Destination[],
  operations: CoreOperation[],
): Destination[] {
  let destinations = [...currentDestinations];
  const open = operations
    .filter((operation) => operation.status === 'pending' || operation.status === 'failed' || operation.status === 'inflight')
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.createdAt - b.createdAt);
  for (const operation of open) {
    const payload = operation.payload;
    const destinationId = typeof payload.destinationId === 'string' ? payload.destinationId : operation.entityId;
    if (operation.operationType === 'add_destination') {
      if (!destinations.some((destination) => destination.id === destinationId)) {
        destinations.push({
          id: destinationId,
          title: String(payload.title ?? ''),
          order: destinations.length,
          day: typeof payload.day === 'number' ? payload.day : null,
          address: typeof payload.address === 'string' ? payload.address : undefined,
          coordinates: {
            latitude: Number(payload.latitude ?? 0),
            longitude: Number(payload.longitude ?? 0),
          },
          subgroupId: typeof payload.subgroupId === 'string' ? payload.subgroupId : undefined,
          kind: payload.kind === 'accommodation' ? 'accommodation' : 'stop',
          stayAnchor: payload.stayAnchor === true,
          providerPlaceId: typeof payload.providerPlaceId === 'string' ? payload.providerPlaceId : undefined,
          ...(Object.prototype.hasOwnProperty.call(payload, 'emoji')
            ? { emoji: typeof payload.emoji === 'string' ? payload.emoji : null }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(payload, 'markerColor')
            ? { markerColor: typeof payload.markerColor === 'string' ? payload.markerColor : null }
            : {}),
        });
      }
    } else if (operation.operationType === 'delete_destination') {
      destinations = destinations.filter((destination) => destination.id !== destinationId);
    } else if (operation.operationType === 'edit_destination') {
      const patch = (payload.patch ?? {}) as Record<string, unknown>;
      destinations = destinations.map((destination) => {
        if (destination.id !== destinationId) return destination;
        const next = { ...destination };
        if (Object.prototype.hasOwnProperty.call(patch, 'title') && typeof patch.title === 'string') {
          next.title = patch.title;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'address')) {
          next.address = typeof patch.address === 'string' ? patch.address : undefined;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'day')) {
          next.day = typeof patch.day === 'number' ? patch.day : null;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'subgroupId')) {
          next.subgroupId = typeof patch.subgroupId === 'string' ? patch.subgroupId : undefined;
        }
        if (patch.kind === 'stop' || patch.kind === 'accommodation') next.kind = patch.kind;
        if (Object.prototype.hasOwnProperty.call(patch, 'stayAnchor')) {
          next.stayAnchor = patch.stayAnchor === true;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'providerPlaceId')) {
          next.providerPlaceId = typeof patch.providerPlaceId === 'string'
            ? patch.providerPlaceId
            : undefined;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'emoji')) {
          next.emoji = typeof patch.emoji === 'string' ? patch.emoji : null;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'markerColor')) {
          next.markerColor = typeof patch.markerColor === 'string' ? patch.markerColor : null;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'meetAt')) {
          next.meetAt = typeof patch.meetAt === 'string' ? patch.meetAt : undefined;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'meetRedMinutes')) {
          next.meetRedMinutes = typeof patch.meetRedMinutes === 'number'
            ? patch.meetRedMinutes
            : undefined;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'latitude')) {
          next.coordinates = { ...next.coordinates, latitude: Number(patch.latitude) };
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'longitude')) {
          next.coordinates = { ...next.coordinates, longitude: Number(patch.longitude) };
        }
        return next;
      });
    } else if (operation.operationType === 'complete_destination') {
      destinations = destinations.map((destination) => destination.id === destinationId ? { ...destination, closedAt: new Date(operation.createdAt).toISOString() } : destination);
    } else if (operation.operationType === 'set_destination_meet_time') {
      destinations = destinations.map((destination) => destination.id === destinationId ? {
        ...destination,
        ...(Object.prototype.hasOwnProperty.call(payload, 'meetAt')
          ? { meetAt: typeof payload.meetAt === 'string' ? payload.meetAt : undefined }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, 'meetRedMinutes')
          ? { meetRedMinutes: typeof payload.meetRedMinutes === 'number' ? payload.meetRedMinutes : undefined }
          : {}),
      } : destination);
    } else if (operation.operationType === 'reorder_destinations' && Array.isArray(payload.updates)) {
      const updates = new Map((payload.updates as Array<Record<string, unknown>>).map((update) => [String(update.id), update]));
      destinations = destinations.map((destination) => {
        const update = updates.get(destination.id);
        if (!update) return destination;
        return {
          ...destination,
          order: typeof update.position === 'number' ? update.position : destination.order,
          ...(Object.prototype.hasOwnProperty.call(update, 'day')
            ? { day: typeof update.day === 'number' ? update.day : null }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'meetAt')
            ? { meetAt: typeof update.meetAt === 'string' ? update.meetAt : undefined }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'stayAnchor')
            ? { stayAnchor: update.stayAnchor === true }
            : {}),
        };
      }).sort((a, b) => a.order - b.order);
    }
  }
  return destinations;
}
