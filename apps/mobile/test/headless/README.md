# Headless multi-device client tests

Run from `apps/mobile` on Node >=22.16.0.

```sh
npm run test:headless -- --list
npm run test:headless
npm run test:headless -- --testNamePattern="offline GPS"
```

The list is generated from the callable registry in `actions.cjs`. The current registry exposes 9 actions. Each entry names its actual production hook or service, input and completion condition. The same two parent suites also run in the ordinary `npm test` CI lane. The separate actor config only runs one device and cannot recursively discover the parent suites.

Each device is a child Jest process with an independent production module graph, auth storage, file-backed AsyncStorage/SecureStore and real `node:sqlite` database. The null React root mounts real `useGroupState`, `useNavigationSession`, `useDeviceLocation` and `useJourneyNavigation` hooks. Every `src/**` module is real, including the native barrel, auth wrappers, privacy fences, location/core outboxes, services and SQL statements. No simulator, screen, browser or GPU is created.

External substitutes are explicit React Native/Expo package capabilities, the native SQLite open call and a narrow Supabase SDK/backend contract. GPS inputs travel through Expo `watchPositionAsync` and the real native wrapper. This is the Expo fallback path, not a MapKit delegate test. The backend returns fixture wire rows and receipts; it does not execute Postgres functions, RLS, triggers or an actual Realtime service. Unsupported external methods, RPCs, tables, query shapes, actions and accidental network attempts remain fatal even when production catches them.

## Programmatic scenarios

The JavaScript API is usable directly from Node, independently of the canned Jest assertions. It owns child processes and durable directories.

```js
const { World } = require('./test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID } = require('./test/headless/backend.cjs');

async function scenario() {
  const world = new World();
  try {
    const a = await world.device({ id: 'leader', userId: LEADER });
    const b = await world.device({ id: 'peer', userId: PEER, platform: 'android' });
    await a.perform('group.observe', { groupId: GROUP_ID });
    await b.perform('group.observe', { groupId: GROUP_ID });
    await world.waitFor(b, observation => observation.group.dataSource === 'remote');
    world.hold('ingest_location_batch');
    await a.gps(25.033, 121.565);
    const pending = await world.waitFor(a, observation => observation.durable.locations.length === 1);
    await world.release('ingest_location_batch');
    await world.advance(250);
    return { pending, peer: await b.observe() };
  } finally {
    await world.close();
  }
}
```

`perform(name, input)` dispatches only registry actions. Start resolves when its callback schedules work. Use `waitFor` to observe the durable operation, hook target and accepted receipt. Group create/join are outside the enabled contract; the backend seeds one group with a leader, member and ordinary stop. Destination service actions cover ordinary stop add/reorder/delete with a hydrated local snapshot. Accommodation, first-stop placement, active-stop deletion and destination switching are deliberately unsupported backend fixtures.

`location.refresh` exposes the existing production outcome tracked in [issue 318](https://github.com/Yupoer/hither_app/issues/318), reproduced against baseline `29da030`. With the continuous watch active, broadcasting a fresh fix can let the watch accept/upload it before the one-shot callback; the required-upload refresh then rejects `no_new_location_sample`. The suite asserts that rejection alongside the real durable upload and peer state. This is a callable action, not evidence of a successful manual refresh. It returns null when permission is denied. `journey.stop` invokes the actual callback; a follower clears a personal route while an active shared team target remains.

`device.input` accepts independent external inputs.

| Input | Shape | Boundary |
| --- | --- | --- |
| GPS | `{kind:'gps', latitude, longitude, accuracy?, timestamp?}` | Current Expo callbacks. `gps(lat,lng,options)` is shorthand. |
| Retired GPS | `{kind:'retiredGps', latitude, longitude, timestamp?}` | Deliberately delivers an old removed OS callback for fencing tests. |
| App state | `{kind:'appState', value:'active'|'inactive'|'background'}` | Actual AppState subscribers. |
| Permission | `{kind:'permission', status:'granted'|'denied'}` | Expo foreground/background permission response. |
| Consent context | `{kind:'consentContext', enabled:boolean}` | Real privacy API and hook input seam. This does not invoke the private MapScreen sharing button. |
| Account | `{kind:'account', userId}` | Writes fixture session through real auth storage, then updates mounted actor context. This does not test login UI. |
| Alert choice | `{kind:'alert', index}` | Explicit response to a captured native Alert; never auto-confirms. |

Set `device.online = false` to reject external SDK requests and suppress delivery. Set `device.realtime = false` to drop Realtime only. `restart()` replaces the process while preserving that device's files, connection controls and observed group. `observe()` returns actual committed hook values plus read-only durable rows, actor identity, clock and external resource counts. The backend trace is supporting wire evidence, not a replacement for those observations.

`world.hold(rpcName, {deviceId?, phase:'execution'|'delivery'})` delays a selected external request. Execution is the default and keeps GPS pending before server acceptance. Delivery captures the response immediately and releases that exact older response later. `release` releases existing holds and lets later calls proceed normally.

`advance(ms)` advances all device fake clocks by a bounded amount. IPC, watchdogs and React task scheduling stay on real time. `settle()` drains tracked external responses, events and React turns without advancing time or running infinite polling timers. Thirty rounds is a failure. A pending held request is allowed. Test command, boot and exit watchdogs bound wedged children. Close unmounts React, cancels pending SDK work, checks native listeners/channels, closes SQLite and clears device-owned timers before exit. A missing disposal receipt or crash fails the scenario and terminates only that world's child.

Each device serializes React `act` scopes while continuing to receive IPC and await transport outside that queue. Concurrent commands therefore cannot overlap foreground effects with unmount. React's unsupported-overlap warning remains a sticky harness failure.

## Evidence and limits

The functional scenario suite runs in both iOS and Android mocked platform modes. A separate mixed-platform scenario publishes from iOS to an Android peer. These verify GPS pending-before-ACK and peer projection, missed-event repair at the subscribed 120 second fallback poll, offline persistence/restart/retry, offline snapshot restoration, stale fixes, consent/account fences, late older recovery, background reconnection, service lazy imports, and real journey Start/End including held Start followed by End and offline Start/End replay after restart. The probe renders the four production hook lifecycles in the same order as MapScreen. Contract tests cover isolation, sticky failures, registry dispatch, SQL rollback and crash/hung-shutdown cleanup.

The private MapScreen sharing/arrival/self-arrival/reorder closures are not extracted or claimed. Map rendering, native sensor accuracy, OS background operation, pushes, purchases, real Supabase security/SQL and physical iPhone behavior require separate verification. Child Jest coverage is not merged into the parent coverage report; this suite makes no changed-function coverage claim for child-loaded modules. No production code, dependency or CI configuration is changed.

The location fixture follows the bounded ingestion contract in `supabase/migrations/20260929173500_location_rejection_idempotency.sql`. A new event must have a strictly newer captured timestamp; an equal timestamp returns `stale_sample`. An existing accepted event ID with the same actor, group, captured timestamp and coordinates is ACKed without another Realtime update. Device-local sequence is not a cross-device ordering authority.
