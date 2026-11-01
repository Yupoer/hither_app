# Destinations and itinerary

A leader turns map places into an ordered trip with days and stays. A member submits a suggestion for approval. Drafts and cancelled confirmations must not create destinations.

## Sub-features

- `itinerary-add` opens a place from a pin, search, manual coordinates, favorite, or KML import.
- `itinerary-confirm` adds a first stop or pool stop, or sends a member suggestion for leader approval.
- `itinerary-edit` moves, selects, deletes, and annotates route stops within the correct scope.
- `itinerary-days` edits trip days, moves a stop to a day, and selects or creates an overnight stay.
- `itinerary-history` retains completed stops while future route drafts change.

## How to get to it (user POV)

- On Map, drop a pin or search for a place, open its editor, and choose first stop or pool.
- Use the favorite list or KML importer to choose places.
- Open Map search and choose Add gathering point by coordinates to enter a name, latitude, and longitude.
- Open the itinerary tab and route editor. Use a stop's menu, selection mode, day control, or stay control.
- A member submits a place or KML suggestion. A leader opens the request inbox and approves it.

## Driving it with World

Preconditions:

- Doctor passes. A real Map has loaded the actor's group with the correct role.
- In the trip, the leader creates Asakusa, Skytree, a hotel, and Ueno through `map.pin.drop` and `map.place.rename` before route editing.

- **Recorded itinerary.** Run the skill's trip command. `map.place.first-stop`, `map.route.trip.more-days`, `map.route.move.open`, `map.route.move.day`, `map.route.stay.set`, `map.route.stay.select`, and `map.overlay.done` must produce the two-day itinerary and hotel. Read `itinerary.two-days-hotel`, the action inputs, and each recipient's `durable.snapshot.destinations`. Compare the fixture itinerary rows and closed history after arrivals.
- **Other reachable Map entries.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual Map screen operations on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path from the map index. The suite exercises the actual search, favorites, KML, suggestion approval, main and subgroup route editor, bulk selection, deletion cancellation, and stay draft controls. Require the relevant named case to execute on both platforms. This command also runs the suite's other Map behavior; report which cases support the requested feature.
- **Map coordinates and standalone form.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual Map coordinate entry on|Q05 runs real coordinate validation" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. The Map entry uses `map.coordinates.open` at `place-search-coordinates`, then the existing field, submit and cancel commands. Require device-coordinate prefill, no invalid or cancelled write, one leader pool stop before held ACK, a follower suggestion instead of an itinerary mutation, and visible quota handling. The standalone form remains a separate input-contract proof.
- **Other route entry variants.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual itinerary entry variants on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. Exercise follower search and favorite suggestions, successful owner favorite deletion, move to pool, parent KML retry, platform date selection, locked mode, and drag cancellation and release. PanResponder events target `route-drag-<destination-id>` and invoke the rendered row's real callbacks with both event and gesture state. Check committed date and order only after their owning save or release action.

## Gotchas

- `map.place.first-stop` and `map.place.pool` are different user entries. The trip uses the former; do not claim the pool confirmation from that proof.
- A route or stay edit can remain a draft until Done. Assert durable state after Done, and verify cancellation writes nothing.
- Preserve scope and closed history. A correct-looking main route does not prove subgroup isolation or historical stop protection.
- Editor quota is checked before opening the coordinate draft. If quota becomes exhausted while the form is already open, submission shows a native Alert and retains the fields. A follower can still submit a suggestion. Neither quota path may insert a destination.
- KML and search use external file and provider fixtures. If an expected input, selected batch, entitlement, or target host is missing, fail that path and record the unmet precondition here.
