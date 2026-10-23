const assert = require('node:assert/strict');

const actions = {
  'group.observe': {
    support: true, sources: [{ file: 'src/state/useGroupState.ts', symbol: 'useGroupState' }],
    entry: 'useGroupState(groupId, { myUserId })', level: 'hook', input: '{ groupId: string | null }',
    completion: 'Mount context; use observe/waitFor to await hydration.',
    run: async (app, { groupId }) => {
      assert(groupId === null || typeof groupId === 'string');
      app.groupId = groupId;
      await app.render();
    },
  },
  'group.refresh': {
    support: true, sources: [{ file: 'src/state/useGroupState.ts', symbol: 'refresh' }],
    entry: 'useGroupState.refresh', level: 'hook', input: '{}', completion: 'Recovery completes or exposes its real error.',
    run: app => app.group.refresh(),
  },
  'location.refresh': {
    inventory: ['MAP-LOC-03'], sources: [{ file: 'src/screens/MapScreen/hooks/useDeviceLocation.ts', symbol: 'refreshDeviceLocation' }],
    entry: 'useDeviceLocation.refreshDeviceLocation', level: 'hook', input: '{}',
    knownIssue: 'https://github.com/Yupoer/hither_app/issues/318',
    completion: 'Supply GPS while pending. The existing continuous-watch race may reject no_new_location_sample after the watch publishes the fix.',
    run: app => app.location.refreshDeviceLocation({ requireUpload: true }),
  },
  'journey.start': {
    inventory: ['MAP-NAV-01'], sources: [{ file: 'src/screens/MapScreen/hooks/useJourneyNavigation.ts', symbol: 'startNavigation' }],
    entry: 'useJourneyNavigation.startNavigation', level: 'hook', input: '{ destinationId: string }',
    completion: 'Callback schedules work; await hook target, durable row and transport receipt.',
    run: (app, { destinationId }) => {
      const index = app.group.state?.destinations.findIndex(d => d.id === destinationId) ?? -1;
      assert(index >= 0, `Unknown destination ${destinationId}`);
      return app.journey.startNavigation(app.group.state.destinations[index], index);
    },
  },
  'journey.end': {
    inventory: ['MAP-NAV-03'], sources: [{ file: 'src/screens/MapScreen/hooks/useJourneyNavigation.ts', symbol: 'requestTeamEnd' }],
    entry: 'useJourneyNavigation.requestTeamEnd', level: 'hook', input: '{}',
    completion: 'Await durable operation acceptance and both devices losing the target.',
    run: app => {
      const index = app.group.state?.destinations.findIndex(d => d.id === app.journey.navTargetId) ?? -1;
      assert(index >= 0, 'No active journey destination');
      return app.journey.requestTeamEnd(app.group.state.destinations[index], index);
    },
  },
  'journey.stop': {
    inventory: ['MAP-NAV-03'], sources: [{ file: 'src/screens/MapScreen/hooks/useJourneyNavigation.ts', symbol: 'stopNavigation' }],
    entry: 'useJourneyNavigation.stopNavigation', level: 'hook', input: '{}', completion: 'Leader enqueues team End; follower clears personal route while the shared team target remains.',
    run: app => app.journey.stopNavigation(),
  },
  'destination.add': {
    inventory: ['MAP-DEST-04'], sources: [{ file: 'src/api/services/DestinationService.ts', symbol: 'addDestination' }],
    entry: 'DestinationService.addDestination', level: 'service', input: 'Parameters<typeof addDestination>',
    completion: 'Durable enqueue; await actual hook projection and transport separately.',
    run: (app, { args }) => app.destinationService.addDestination(...args),
  },
  'destination.delete': {
    inventory: ['MAP-ROUTE-08'], sources: [{ file: 'src/api/services/DestinationService.ts', symbol: 'deleteDestination' }],
    entry: 'DestinationService.deleteDestination', level: 'service', input: 'Parameters<typeof deleteDestination>',
    completion: 'Durable enqueue; await actual hook projection and transport separately.',
    run: (app, { args }) => app.destinationService.deleteDestination(...args),
  },
  'destination.reorder': {
    inventory: ['MAP-ROUTE-03'], sources: [{ file: 'src/api/services/DestinationService.ts', symbol: 'reorderDestinations' }],
    entry: 'DestinationService.reorderDestinations', level: 'service', input: 'Parameters<typeof reorderDestinations>',
    completion: 'Durable enqueue; await actual hook projection and transport separately.',
    run: (app, { args }) => app.destinationService.reorderDestinations(...args),
  },
};

const lifecycle = [];
const unreachable = [];
for (const module of ['./operations-account.cjs', './operations-map.cjs', './operations-store.cjs']) {
  const domain = require(module);
  for (const [name, definition] of Object.entries(domain.operations)) {
    assert(!Object.hasOwn(actions, name), `Duplicate action ${name}`);
    actions[name] = definition;
  }
  lifecycle.push(...(domain.lifecycle ?? []).map(entry => ({ ...entry, level: 'lifecycle' })));
  unreachable.push(...(domain.unreachable ?? []));
}

exports.catalog = () => Object.entries(actions).map(([name, { run, ...description }]) => ({ name, ...description }));
exports.inventoryEntries = () => [...exports.catalog(), ...lifecycle];
exports.exclusions = () => unreachable.flatMap(entry => entry.inventory.map(id => ({
  id, kind: 'unreachable', reason: entry.reason, source: entry.sources[0],
})));
exports.has = name => Object.hasOwn(actions, name);
exports.perform = (app, name, input = {}) => {
  assert(Object.hasOwn(actions, name), `Unsupported action ${name}`);
  return actions[name].run(app, input);
};
exports.gaps = [
  'Native rendering, gesture physics, Swift/Kotlin execution, sensor accuracy and OS background restrictions.',
  'Real Supabase SQL/RLS, real push delivery, store receipts and advertising reward verification.',
  'Source paths without a production caller are documented separately by --inventory.',
];
