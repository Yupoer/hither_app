import type { Destination, GroupState } from '../types';
import type { CoreOperation } from '../types/coreData';
import { insertFirstStop } from '../utils/firstStopInsertion';

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
        const destination: Destination = {
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
        };
        destinations = payload.placement === 'firstStop'
          ? insertFirstStop(destinations, destination) : [...destinations, destination];
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

/** Reapply pending trip/stay edits after authoritative refresh or receipt. */
export function projectOperationGroupState(state: GroupState, operations: CoreOperation[],
  protectedDestinationIds: readonly (string | null | undefined)[] = [],
): GroupState {
  let group = { ...state.group };
  let members = [...(state.members ?? [])];
  let dailyAccommodations = [...(state.dailyAccommodations ?? [])];
  let destinations = [...state.destinations];
  for (const operation of operations.filter(op => ['pending', 'failed', 'inflight'].includes(op.status))
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.createdAt - b.createdAt)) {
    destinations = projectOperationDestinations(destinations, [operation]);
    const payload = operation.payload;
    if (operation.operationType === 'set_solo') {
      members = members.map(member => member.userId === operation.actorId
        && member.userId === payload.userId ? { ...member, solo: payload.solo === true } : member);
    } else if (operation.operationType === 'set_trip_details') {
      group = { ...group, tripDays: Number(payload.tripDays), departureDate: String(payload.departureDate) };
    } else if (operation.operationType === 'set_daily_accommodation' || operation.operationType === 'clear_daily_accommodation') {
      const stayDate = String(payload.stayDate);
      const previous = dailyAccommodations.find(daily => daily.stayDate === stayDate);
      dailyAccommodations = dailyAccommodations.filter(daily => daily.stayDate !== stayDate);
      if (operation.operationType === 'set_daily_accommodation') {
        const nextStay = payload.daily as unknown as NonNullable<GroupState['dailyAccommodations']>[number];
        if (previous) {
          // Replace only open copies of the old daily stay. Independent hotels,
          // other dates/scopes and completed history retain their identity/data.
          const day = typeof payload.day === 'number' ? payload.day
            : group.departureDate ? Math.round((Date.parse(stayDate) - Date.parse(group.departureDate.slice(0, 10))) / 86_400_000) + 1 : 1;
          destinations = destinations.map(destination => !destination.closedAt && !destination.subgroupId
            && destination.id !== group.activeDestinationId
            && !protectedDestinationIds.includes(destination.id)
            && destination.kind === 'accommodation' && destination.day === day
            && destination.title === previous.title
            && Math.abs(destination.coordinates.latitude - previous.coordinates.latitude) < 0.000001
            && Math.abs(destination.coordinates.longitude - previous.coordinates.longitude) < 0.000001
              ? { ...destination, title: nextStay.title, address: nextStay.address,
                coordinates: nextStay.coordinates, providerPlaceId: undefined, stayAnchor: false }
              : destination);
        }
        dailyAccommodations.push(nextStay);
        group = { ...group, accommodationAutoAdd: false };
      }
      if (previous || operation.operationType === 'clear_daily_accommodation') {
        destinations = destinations.map(destination => !destination.subgroupId && destination.kind === 'accommodation'
          && (destination.day ?? 1) === (payload.day ?? 1) ? { ...destination, stayAnchor: false } : destination);
      }
    }
  }
  return { ...state, group, members, destinations, dailyAccommodations: dailyAccommodations.sort((a, b) => a.stayDate.localeCompare(b.stayDate)) };
}
