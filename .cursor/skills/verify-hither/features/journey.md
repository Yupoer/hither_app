# Shared navigation and offline recovery

A leader starts a shared destination, travelers see the same target, and location and journey operations persist through disconnection and restart. Ending navigation and completing a stop have distinct results.

## Sub-features

- `journey-start` starts a shared target using a fresh location and converges receiving travelers.
- `journey-end` pauses navigation without marking the itinerary stop complete.
- `journey-complete` closes a stop through arrival or an allowed manual completion.
- `journey-offline` persists work across an abrupt offline restart and reconciles after reconnection.
- `journey-location` refreshes location, honors sharing consent, and handles late acknowledgments and missed events.
- `journey-scheduled` starts the captain's saved destination when the explicit server scheduler processes its due occurrence.
- `journey-background-presence` retains sharing while idle and changes the background owner when navigation starts.

## How to get to it (user POV)

- Open a gathering card on Map and choose Start, End, or the available completion control.
- Walk to the destination with location sharing enabled and observe arrival state on other travelers.
- Use Map location refresh and sharing controls. Continue during a connection loss, reopen App, and reconnect.
- Leave App during active navigation and return. OS background behavior requires native verification beyond this headless recipe.

## Driving it with World

Preconditions:

- Doctor passes. A team and ordinary uncompleted destination exist. The actor's role permits the selected action.
- Supply a fresh external GPS sample after the Start watcher is ready. Use controlled clock advancement and condition waits from the existing scenario.

- **Recorded full path.** Run the skill's trip command. `map.journey.command` drives the actual gathering card, then external GPS enters through the real JS native wrapper. The `journey.start.reactions` and arrival observations must show matching shared targets and received notices. Read the recorded abrupt restart actions, device generations, durable queues before restart, reconciled snapshots, and final empty operation queues.
- **Manual End and completion entries.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual Map screen operations on|leader force completion on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path from the map index. Require the intended End or completion case to appear in the result. A paused shared session leaves an uncompleted destination. A permitted completion closes it and updates recipients.
- **Location and persistence contracts.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="headless multiplayer scenarios on|publishes iOS GPS into an Android" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. These use real hooks, SQLite, outbox, and services. They prove contract behavior at that layer, rather than a private Map callback.
- **Map location controls.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual Map controls on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. Require the `MAP-LOC` cases for refresh, denied permission, sharing, and platform background ownership. Check `presentation.resolved` along with `Platform.OS` behavior.
- **Offline navigation through Map.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual Map offline journey parent on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. Use actual gathering-card Start and End while offline, supply the fresh GPS event, abruptly restart the process, and reconnect. Require original operation IDs, FIFO dependencies, the terminal card state, accepted replay ownership, a paused peer, and an uncompleted itinerary stop.
- **Changed location exchange only.** Run `./test/headless/run.ps1 -Driver jest -ResourceReport "${verifySuiteOutput}.resources.json" --runTestsByPath src/__tests__/headlessLocationSyncScenario.test.ts --testNamePattern="changed location exchange on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. The offline Start case abruptly stops the owned process without React unmount, verifies the original durable operation and location IDs after boot, and requires both IDs in one `sync_group` call, item ACK settlement, a peer target and the returned peer coordinates in the requester snapshot. The passive case injects an external callback after 600 seconds and requires the backend receipt plus the peer's rendered coordinates after the real 250ms location debounce. It then saves the captain's meet time through `map.meet.open`, `map.meet.shortcut` and `map.meet.save`. `world.processMeetTimes()` explicitly invokes the fixture cron boundary. Clock advancement alone must not start navigation. Preserve the before-due assertion, invoke the scheduler at due, then advance the actual 300ms reload debounce. Require one scheduled session and the matching navigation push envelope, then a faster active background owner.

## Gotchas

- `perform()` can finish before the fresh fix or backend ACK. Wait for the expected durable row, accepted receipt, or peer projection. Do not use a mock call count as acceptance.
- A request waiting for GPS must begin before injecting the fix. The existing cases retain rejection handling while they supply the event, preventing a scenario deadlock.
- The trip's 24-hour gap is powered off and clock-controlled. It does not establish background tracking, battery behavior, notification timing, or sensor accuracy on a phone.
- Tokyo's abrupt restart preserves GPS work. The separate Map offline navigation case proves queued Start and End; keep those claims distinct.
- The actual manual-completion suite is a separate entry from automatic arrival. Missing permissions, scope, or a target must fail the corresponding journey rather than taking the other entry.
- The changed source uses ordinary positioning and sharing targets of precise 15 seconds/10 metres, general 60 seconds/100 metres and idle 300 seconds/300 metres. Background idle targets 600 seconds. The owning policy/sensor tests establish those options; World callback injection proves JS delivery and recipient convergence. Neither establishes an OS wake deadline, actual sensor accuracy, battery cost or Swift/Kotlin execution.
- The changed-location Map case injects `locationError` through the Expo watch error callback, checks visible interruption text, then supplies external GPS to clear it. Actual Start and automatic arrival must remove the personal route while later GPS still reaches the backend without new route requests. Route cadence remains covered by the owning hook tests. Foreground GPS on both platforms uses Expo; MapKit user-location events no longer feed MapScreen location state.
- `backend-sync.cjs` models the migration's typed envelope and original location receipt time. `backend-schedule.cjs` models only the explicit scheduler boundary. They do not execute Postgres or prove deployed cron, RLS, APNs or locked-device Live Activity start. The scoped integrated-source drive passed; its recorded commit and evidence index are in the canonical skill.
