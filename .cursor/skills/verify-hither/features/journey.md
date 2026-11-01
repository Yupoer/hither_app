# Shared navigation and offline recovery

A leader starts a shared destination, travelers see the same target, and location and journey operations persist through disconnection and restart. Ending navigation and completing a stop have distinct results.

## Sub-features

- `journey-start` starts a shared target using a fresh location and converges receiving travelers.
- `journey-end` pauses navigation without marking the itinerary stop complete.
- `journey-complete` closes a stop through arrival or an allowed manual completion.
- `journey-offline` persists work across an abrupt offline restart and reconciles after reconnection.
- `journey-location` refreshes location, honors sharing consent, and handles late acknowledgments and missed events.

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
- **Manual End and completion entries.** Run `node test/headless/run.cjs --testNamePattern="actual Map screen operations on|leader force completion on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path from the map index. Require the intended End or completion case to appear in the result. A paused shared session leaves an uncompleted destination. A permitted completion closes it and updates recipients.
- **Location and persistence contracts.** Run `node test/headless/run.cjs --testNamePattern="headless multiplayer scenarios on|publishes iOS GPS into an Android" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. These use real hooks, SQLite, outbox, and services. They prove contract behavior at that layer, rather than a private Map callback.
- **Map location controls.** Run `node test/headless/run.cjs --testNamePattern="actual Map controls on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. Require the `MAP-LOC` cases for refresh, denied permission, sharing, and platform background ownership. Check `presentation.resolved` along with `Platform.OS` behavior.
- **Offline navigation through Map.** Run `node test/headless/run.cjs --testNamePattern="actual Map offline journey parent on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. Use actual gathering-card Start and End while offline, supply the fresh GPS event, abruptly restart the process, and reconnect. Require original operation IDs, FIFO dependencies, the terminal card state, accepted replay ownership, a paused peer, and an uncompleted itinerary stop.

## Gotchas

- `perform()` can finish before the fresh fix or backend ACK. Wait for the expected durable row, accepted receipt, or peer projection. Do not use a mock call count as acceptance.
- A request waiting for GPS must begin before injecting the fix. The existing cases retain rejection handling while they supply the event, preventing a scenario deadlock.
- The trip's 24-hour gap is powered off and clock-controlled. It does not establish background tracking, battery behavior, notification timing, or sensor accuracy on a phone.
- Tokyo's abrupt restart preserves GPS work. The separate Map offline navigation case proves queued Start and End; keep those claims distinct.
- The actual manual-completion suite is a separate entry from automatic arrival. Missing permissions, scope, or a target must fail the corresponding journey rather than taking the other entry.
