const assert = require('node:assert/strict');

const actions = {
  'group.observe': {
    entry: 'useGroupState(groupId, { myUserId })', level: 'hook', input: '{ groupId: string | null }',
    completion: 'Mount context; use observe/waitFor to await hydration.',
    run: async (app, { groupId }) => {
      assert(groupId === null || typeof groupId === 'string');
      app.groupId = groupId;
      await app.render();
    },
  },
  'group.refresh': {
    entry: 'useGroupState.refresh', level: 'hook', input: '{}', completion: 'Recovery completes or exposes its real error.',
    run: app => app.group.refresh(),
  },
  'location.refresh': {
    entry: 'useDeviceLocation.refreshDeviceLocation', level: 'hook', input: '{}',
    knownIssue: 'https://github.com/Yupoer/hither_app/issues/318',
    completion: 'Supply GPS while pending. The existing continuous-watch race may reject no_new_location_sample after the watch publishes the fix.',
    run: app => app.location.refreshDeviceLocation({ requireUpload: true }),
  },
  'journey.start': {
    entry: 'useJourneyNavigation.startNavigation', level: 'hook', input: '{ destinationId: string }',
    completion: 'Callback schedules work; await hook target, durable row and transport receipt.',
    run: (app, { destinationId }) => {
      const index = app.group.state?.destinations.findIndex(d => d.id === destinationId) ?? -1;
      assert(index >= 0, `Unknown destination ${destinationId}`);
      return app.journey.startNavigation(app.group.state.destinations[index], index);
    },
  },
  'journey.end': {
    entry: 'useJourneyNavigation.requestTeamEnd', level: 'hook', input: '{}',
    completion: 'Await durable operation acceptance and both devices losing the target.',
    run: app => {
      const index = app.group.state?.destinations.findIndex(d => d.id === app.journey.navTargetId) ?? -1;
      assert(index >= 0, 'No active journey destination');
      return app.journey.requestTeamEnd(app.group.state.destinations[index], index);
    },
  },
  'journey.stop': {
    entry: 'useJourneyNavigation.stopNavigation', level: 'hook', input: '{}', completion: 'Leader enqueues team End; follower clears personal route while the shared team target remains.',
    run: app => app.journey.stopNavigation(),
  },
  'destination.add': {
    entry: 'DestinationService.addDestination', level: 'service', input: 'Parameters<typeof addDestination>',
    completion: 'Durable enqueue; await actual hook projection and transport separately.',
    run: (app, { args }) => app.destinationService.addDestination(...args),
  },
  'destination.delete': {
    entry: 'DestinationService.deleteDestination', level: 'service', input: 'Parameters<typeof deleteDestination>',
    completion: 'Durable enqueue; await actual hook projection and transport separately.',
    run: (app, { args }) => app.destinationService.deleteDestination(...args),
  },
  'destination.reorder': {
    entry: 'DestinationService.reorderDestinations', level: 'service', input: 'Parameters<typeof reorderDestinations>',
    completion: 'Durable enqueue; await actual hook projection and transport separately.',
    run: (app, { args }) => app.destinationService.reorderDestinations(...args),
  },
};

exports.catalog = () => Object.entries(actions).map(([name, { run, ...description }]) => ({ name, ...description }));
exports.has = name => Object.hasOwn(actions, name);
exports.perform = (app, name, input = {}) => {
  assert(Object.hasOwn(actions, name), `Unsupported action ${name}`);
  return actions[name].run(app, input);
};
exports.gaps = [
  'MapScreen private sharing switch, arrival/self-arrival and screen-only destination closures.',
  'Map rendering, route search, purchases, notifications and physical background/native lifecycle.',
  'Group create/join are not enabled in this bounded backend contract; seed membership fixtures explicitly.',
];
