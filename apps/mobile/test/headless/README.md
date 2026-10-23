# Headless multi-device client tests

Run from `apps/mobile` on Node >=22.16.0.

```sh
npm run test:headless -- --list
npm run test:headless -- --inventory
npm run test:headless
npm run test:headless -- --testNamePattern="offline GPS"
```

The list is generated from the callable registry in `actions.cjs` and the domain `operations-*.cjs` files. Each entry names its production source, input, level and completion condition. The initial nine entries remain available, but are not a limit. `--inventory` checks the reviewed source families, automatic lifecycle entries and narrowly documented unreachable source. Registry counts measure available calls, not passed scenarios. The runner discovers all `src/__tests__/headless*.test.ts[x]` suites; ordinary `npm test` also runs them. The separate actor config only runs one device and cannot recursively discover parent suites.

Each device is a child Jest process with an independent production module graph, auth storage, file-backed AsyncStorage/SecureStore and real `node:sqlite` database. The default actor mounts real `useGroupState`, `useNavigationSession`, `useDeviceLocation` and `useJourneyNavigation` hooks. `mode: 'app'` mounts the actual App, while `screen: { name, params }` mounts an actual screen or component inside the real providers. External native views become in-memory host nodes. No simulator, operating system, browser or GPU is created. Every `src/**` module remains real, including native wrappers, auth, privacy fences, outboxes, services and SQL statements.

External substitutes are explicit React Native/Expo capabilities, map/search and file inputs, auth/OAuth, purchases, ads, notifications, Live Activity, updates, the native SQLite open call and a Supabase SDK/backend contract. GPS inputs travel through Expo `watchPositionAsync` and the real native wrapper. The backend returns fixture wire rows and receipts; it does not execute Postgres functions, RLS, triggers or an actual Realtime service. Unsupported external methods, RPCs, tables, query shapes, actions and accidental network attempts remain fatal even when production catches them.

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

`perform(name, input)` dispatches only registry actions. Start resolves when its callback schedules work. Use `waitFor` to observe the durable operation, hook target and accepted receipt. The backend starts with one group, a leader, a member and an ordinary stop. Domain contracts extend this state through actual group, itinerary, navigation, coordination and entitlement operations. Confirm authorization, original session identity and receipt semantics against current migrations when extending fixtures.

For screen operations, use a real screen device, for example `{ id: 'map', userId: LEADER, platform: 'ios', screen: { name: 'Map', params: { groupId: GROUP_ID } } }`. Registry entries call actual rendered callbacks through `device.host.call`; host events retain disabled/visibility guards. `observe().presentation` exposes committed host values, route, provider state and resolved production module paths. Standalone component callbacks may record receipts. Those tests establish component behavior only; the actual parent screen must also run before claiming its downstream business effects.

`location.refresh` exposes the existing production outcome tracked in [issue 318](https://github.com/Yupoer/hither_app/issues/318), reproduced against baseline `29da030`. With the continuous watch active, broadcasting a fresh fix can let the watch accept/upload it before the one-shot callback; the required-upload refresh then rejects `no_new_location_sample`. The suite asserts that rejection alongside the real durable upload and peer state. This is a callable action, not evidence of a successful manual refresh. It returns null when permission is denied. `journey.stop` invokes the actual callback; a follower clears a personal route while an active shared team target remains.

`device.input` accepts independent external inputs.

| Input | Shape | Boundary |
| --- | --- | --- |
| GPS | `{kind:'gps', latitude, longitude, accuracy?, timestamp?}` | Current Expo callbacks. `gps(lat,lng,options)` is shorthand. |
| Retired GPS | `{kind:'retiredGps', latitude, longitude, timestamp?}` | Deliberately delivers an old removed OS callback for fencing tests. |
| App state | `{kind:'appState', value:'active'|'inactive'|'background'}` | Actual AppState subscribers. |
| Focus | `{kind:'appFocus', value:'blur'|'focus'}` | Actual Android AppState focus subscribers. |
| Permission | `{kind:'permission', status:'granted'|'denied'}` | Expo foreground/background permission response. |
| Consent context | `{kind:'consentContext', enabled:boolean}` | Real privacy API and hook input seam. This does not invoke the private MapScreen sharing button. |
| Account | `{kind:'account', userId}` | Writes fixture session through real auth storage, then updates mounted actor context. This does not test login UI. |
| Alert choice | `{kind:'alert', index}` | Explicit response to a captured native Alert; never auto-confirms. |

Set `device.online = false` to reject external SDK requests and suppress delivery. Set `device.realtime = false` to drop Realtime only. `restart()` replaces the process while preserving that device's files, connection controls and observed group. `observe()` returns actual committed hook values plus read-only durable rows, actor identity, clock and external resource counts. The backend trace is supporting wire evidence, not a replacement for those observations.

`world.hold(rpcName, {deviceId?, phase:'execution'|'delivery'})` delays a selected external request. Execution is the default and keeps GPS pending before server acceptance. Delivery captures the response immediately and releases that exact older response later. `release` releases existing holds and lets later calls proceed normally.

`advance(ms)` advances all device fake clocks by a bounded amount. IPC, watchdogs and React task scheduling stay on real time. `settle()` drains tracked external responses, events and React turns without advancing time or running infinite polling timers. Thirty rounds is a failure. A pending held request is allowed. Test command, boot and exit watchdogs bound wedged children. Close unmounts React, cancels pending SDK work, checks native listeners/channels, closes SQLite and clears device-owned timers before exit. A missing disposal receipt or crash fails the scenario and terminates only that world's child.

Each device serializes React `act` scopes while continuing to receive IPC and await transport outside that queue. Concurrent commands therefore cannot overlap foreground effects with unmount. React's unsupported-overlap warning remains a sticky harness failure.

## Coverage and limits

Functional scenarios specify iOS and Android platform modes. The resolver selects production platform files as well as Platform.OS branches; inspect `presentation.resolved` when asserting this distinction. A mixed-platform scenario publishes from iOS to an Android peer. Existing location and journey cases cover pending-before-ACK, missed-event recovery at the subscribed 120 second fallback poll, offline persistence/restart/retry, account/privacy fences and Start/End ordering. Domain scenario suites add actual screen and provider operations. Run the current suites and report their results; historical test counts do not establish a new head's coverage.

`operation-inventory.json` records reviewed behavior families. Registry source anchors connect those families to actual entries. `source-inventory.json` fingerprints exported functions, callbacks and lifecycle owners so source changes require a fresh coverage review. Only refresh that snapshot after reviewing the changed behavior and its scenarios. It is a review gate, not execution coverage.

Map rendering, gestures, native sensor accuracy, Swift/Kotlin execution, OS background restrictions, real pushes/purchases, Supabase security/SQL and physical device behavior require separate verification. Child Jest coverage is not merged into the parent report; this suite makes no changed-function coverage claim for child-loaded modules. Stable test identifiers in production views identify actual callback hosts without replacing business logic.

The location fixture follows the bounded ingestion contract in `supabase/migrations/20260929173500_location_rejection_idempotency.sql`. A new event must have a strictly newer captured timestamp; an equal timestamp returns `stale_sample`. An existing accepted event ID with the same actor, group, captured timestamp and coordinates is ACKed without another Realtime update. Device-local sequence is not a cross-device ordering authority.
