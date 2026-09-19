jest.mock('../api/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), auth: { getSession: jest.fn() } },
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'test-device-id') }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

import * as client from '../api/client';

// The compatibility barrel must preserve function identity: replacing an export
// with a wrapper can bypass the shared auth controller or change error identity.
const sources: Record<string, unknown>[] = [
  require('../api/services/_helpers'),
  require('../utils/operationError'),
  require('../api/authRecovery'),
  require('../api/authenticatedTransport'),
  require('../api/authLifecycle'),
  ...[
    'GroupService', 'DestinationService', 'EntitlementService',
    'DailyAccommodationService', 'FavoritePlacesService', 'WaypointService',
    'GatheringWorkflowService', 'CoordinationRequestService', 'ProfileService',
    'StoreService', 'CoreDataService', 'SubgroupService', 'NotificationService',
    'LocationService', 'LiveActivityService',
  ].map(name => require(`../api/services/${name}`)),
];

it('keeps every public API binding identical to its domain export', () => {
  const entries = Object.entries(client);
  expect(entries.map(([name]) => name)).toEqual(expect.arrayContaining([
    'requireLocalActorId', 'requireAuthenticatedSession', 'addDestination',
    'applyCoreOperation', 'getOperationErrorMessage', 'setDestinationArrivalAt',
  ]));
  for (const [name, binding] of entries) {
    const owner = sources.find(source => Object.prototype.hasOwnProperty.call(source, name));
    expect({ name, hasOwner: Boolean(owner) }).toEqual({ name, hasOwner: true });
    expect(binding).toBe(owner![name]);
  }
});
