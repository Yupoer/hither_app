# Members and notifications

Travelers see current teammates and their shared locations, change participation, and receive allowed notices when group activity changes. Settings and confirmation flows must preserve role and privacy boundaries.

## Sub-features

- `members-roster` projects identities and exact shared coordinates to other travelers.
- `members-participation` changes solo mode, split or merge scope, invitations, and departure.
- `members-notices` delivers the expected category and sender to recipients, and honors a muted category.
- `members-settings` saves profile, group avatar, preference, and tour controls through Map.
- `members-permissions` restricts kick, group edits, signout, and leave to their actual authorized and confirmed paths.
- `members-refresh` reads backend state independently of self GPS and reports exact peer-request acknowledgments separately from cached coordinates.
- `members-separation` calculates and reports separation only during active shared navigation.
- `members-inbox` groups Start requests, destination suggestions, notices, and votes by member. The badge counts unread notices and unresolved approvals; reading a notice does not resolve a request.

## How to get to it (user POV)

- On Android, expand Map and choose Members. Use the member row for the inbox and the upper-right button to refresh.
- On iOS, open Team using the bottom Map control. Opening or reopening Team requests refresh. Open a badged member's action menu and choose the inbox.
- For a peer refresh, keep the other actor connected. Check receipt of the exact request separately from the arrival of ordinary GPS data.
- Choose solo mode, a split or merge action, a pending invitation, or a member's available action.
- On Android, use the Map avatar to edit profile and Map Settings for preferences. On iOS, choose Profile or Notifications in You, and use the Team gear for team identity. In iOS Advanced, resetting travel preferences is separate from resetting all display and notification preferences.
- Use the invite control in Members on Android or the Team header on iOS. Use Map Settings on Android or the corresponding You and team controls on iOS to leave or sign out. Confirm destructive actions in their dialog.

## Driving it with World

Preconditions:

- Doctor passes. The recorded trip starts signed out and joins three travelers to the same group. Focused Worlds use their own fixture identities.
- Keep each actor's external notification receipts separate. A sender's empty queue does not prove recipient delivery.

- **Recorded recipients.** Run the recorded trip. Check `trio.roster`, `initial.location-recipient-reactions`, the Android leader's `suggestion.approval.reactions`, solo and follow, and `leave.reactions`. Check exact peer times, allowed notice recipients and senders, and suppression of the add-place notice for the solo traveler. After leave, require `RoleSelect` for the leaver and two members plus the named notice for the other actors.
- **Map control entries.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="legacy Android Map controls|D6 iOS team and commands through Map|D6 You from the real Map screen" --json --outputFile="$verifySuiteOutput"` with a fresh result path. Select the named platform case for invitation, solo, subgroup, kick, profile, avatar, or settings. Compare the rendered outcome with membership or preference data.
- **Tutorial entry.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="legacy Android contextual tours|iOS D6 contextual entry" --json --outputFile="$verifySuiteOutput"` with a fresh result path. Android tour completion must survive restart without creating a destination or journey. iOS opens Itinerary and Place directly without the legacy tour.
- **Notification settings parent.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual member parent entries on|N03 N09 N10 N11 N12 N13 N14" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. The Map case enters `settings.notifications`, loads and changes the real category controls, persists the actor-owned values, and returns to Map. The notification policy case separately proves that muting add-gathering still permits a later journey notice with the expected sender and recipient.
- **Member inbox entries.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual member notice|offline member Start request|actual follower KML submits a request|queues an offline start request" --json --outputFile="$verifySuiteOutput"` with a fresh result path. On Android, check notice read state across restart and the leader's approval. On iOS, open the member menu and require its offline Start request to remain pending until approval creates the shared session. Use the [itinerary map](itinerary.md) for suggestion results.
- **Changed refresh only.** Run `./test/headless/run.ps1 -Driver jest -ResourceReport "${verifySuiteOutput}.resources.json" --runInBand --runTestsByPath src/__tests__/headlessLocationSyncScenario.test.ts --testNamePattern="changed location exchange on.*actual members refresh" --json --outputFile="$verifySuiteOutput"` with a fresh result path. With self GPS denied, a fresh peer requires no wake request. Advance 180 virtual seconds, disable both actors' Realtime, background the peer, and refresh again. Require the stale peer in the durable request. An ordinary newer GPS upload must leave its ACK empty. Inject the existing silent-push refresh task and require the exact request ACK plus updated coordinates and time in the requester's member row. Android also checks rendered age text. No result Alert is shown. Immediate retry preserves cooldown.

## Gotchas

- Native notifications are captured scheduling and content receipts. The fixture outbox records routing. Neither proves APNs or FCM delivery.
- Before choosing a confirmation index in a new drive, observe the actual alert and its buttons. For the recorded trip, check the leave alert in the `map.group.leave` observation before `external.leave-confirmation`.
- Profile and account component tests do not prove Map parent navigation. Use the avatar integration and actual settings account entry respectively.
- A muted add-gathering category must not suppress unrelated journey or departure notices. Assert the intended recipient and category, rather than a total notification count.
- Preserve the exact ISO `requestedAt` token, sensor `capturedAt` and original server `receivedAt`. A duplicate upload keeps its original receipt and cannot make an old fix satisfy a later request. The owning accepted-sample race checks are separate from the members button integration.
- The passive/scheduled case in [journey](journey.md) requires no new straggler report while idle. The focused separation hook tests and SQL proof cover active/paused gating; the World fixture also rejects idle reports. Native delivery, actual SQL permission enforcement and a deployed schedule remain separate evidence.
