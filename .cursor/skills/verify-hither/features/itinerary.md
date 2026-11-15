# Destinations and itinerary

A leader turns map places into an ordered trip with days and stays. A member submits a suggestion for approval. Drafts and cancelled confirmations must not create destinations.

## Sub-features

- `itinerary-add` opens a place from a pin, search, manual coordinates, favorite, or KML import.
- `itinerary-confirm` adds a first stop or pool stop, or sends a member suggestion for leader approval.
- `itinerary-edit` moves, selects, deletes, and annotates route stops within the correct scope.
- `itinerary-days` edits trip days, moves a stop to a day, and selects or creates an overnight stay.
- `itinerary-history` retains completed stops while future route drafts change.

## How to get to it (user POV)

- On Android Map, drop a pin or search for a place. Edit the draft and choose first stop or pool. For numeric entry, open Map search and choose Add gathering point by coordinates. Use the itinerary tab and route editor to edit stops, days, and stays.
- On iOS, open Itinerary with the upper grabber. Choose the day and tap Place to search, drop a pin, or choose Coordinates. Set the pin, optionally rename it, then confirm Add on the selected day. Use the itinerary menu for KML import, selection, and date controls.
- Use the favorite list when the platform's place picker offers it. A member submits a suggestion for leader review.
- To review a member's suggestion, open their inbox from Members or Team. The iOS itinerary also presents pending suggestions for inline review.

## Driving it with World

Preconditions:

- Doctor passes. A real Map has loaded the actor's group with the correct role.
- In the trip, the Android leader adds four named pins, then edits the trip. The iOS member opens the Itinerary place picker and submits a pin through `confirm-place-add`.

- **Recorded itinerary.** Run the skill's trip command. `map.place.first-stop`, `map.route.trip.more-days`, `map.route.move.open`, `map.route.move.day`, `map.route.stay.set`, `map.route.stay.select`, and `map.overlay.done` must produce the two-day itinerary and hotel. At `itinerary.two-days-hotel`, check the saved trip length and Ueno's day in each recipient's durable snapshot. Compare the hotel's `dailyAccommodations` stay date with the group's departure date. Check the fixture itinerary rows and recipients' closed history after arrivals.
- **Android Map and route entries.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual Map screen operations on Android|actual itinerary entry variants on Android" --json --outputFile="$verifySuiteOutput"` with a fresh result path. Select the named search, favorite, KML, suggestion, date, selection, or drag case for the path under review. Check the saved scope and order after the owning save or release action.
- **Map coordinates and standalone form.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual Map coordinate entry on|Q05 runs real coordinate validation" --json --outputFile="$verifySuiteOutput"` with a fresh result path. Android presses `place-search-coordinates`, prefills the numeric form from device GPS, and saves a pool stop. iOS chooses `d6-add-coordinates`, drops a pin, and confirms `confirm-place-add` for the selected day. Check invalid input, cancel, both quota paths, the pending local stop before ACK, and the follower suggestion without an itinerary mutation. Standalone numeric form proof is separate.
- **iOS itinerary.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="D6 itinerary on the actual iOS Map screen|actual D6 iOS navigation and import safety.*(?:imports a selected KML batch|keeps subgroup reorder confined)" --json --outputFile="$verifySuiteOutput"` with a fresh result path. Verify the selected date range and history, stop rescheduling, selection deletion, inline suggestion approval, KML selection, or subgroup reorder in the named case. D6 saves the range when both dates are picked and commits reorder on release.
- **Authoritative empty recovery.** Run `./test/headless/run.ps1 -Driver jest -ResourceReport "${verifySuiteOutput}.resources.json" --runInBand --runTestsByPath src/__tests__/headlessMapArchiveScenario.test.ts --testNamePattern="actual development Map archive on" --json --outputFile="$verifySuiteOutput"` with a fresh result path. This development-only control must attempt history writes, clear backend and SQLite destinations, drain operations, and cancel navigation on both platforms, including after rejected history. To claim an empty screen, separately close Settings and check the current platform's itinerary. Legacy `gather-card-*` hosts are Android only. The recovery race tests separately guard pending edits and older replies.

## Gotchas

- In the recorded trip, the Android leader adds first stops and a pool idea. The iOS member suggests a pin through `confirm-place-add`. Check the pending request, `map.member.inbox`, and `suggestion.approval.reactions` before counting the resulting stop.
- Android route-sheet Done and swipe dismissal flush the route draft. D6 edits commit at their own controls. Form cancellation and drag cancellation must preserve the prior state.
- Preserve scope and closed history. A correct-looking main route does not prove subgroup isolation or historical stop protection.
- At quota, Android can open the Paywall before the numeric draft; if the limit is reached during editing, an Alert preserves the fields. On iOS the Add draft offers Unlock more stops and opens Store. A follower can still submit a suggestion. No quota path may insert a destination.
- KML and search use external file and provider fixtures. If an expected input, selected batch, entitlement, or target host is missing, record the failed path and unmet precondition in the run notes.
- Live text search needs a working provider. Android's native search returns no places, the checked-in [Maps proxy](../../../../supabase/functions/google-maps/handler.ts) returns `upstream_unavailable`, and Android production disables the public geocoder fallback. The fixture search proves the UI path with results supplied. Numeric coordinates and locally decoded Plus Codes have separate paths.
