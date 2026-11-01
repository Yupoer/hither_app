# Members and notifications

Travelers see current teammates and their shared locations, change participation, and receive allowed notices when group activity changes. Settings and confirmation flows must preserve role and privacy boundaries.

## Sub-features

- `members-roster` projects identities and exact shared coordinates to other travelers.
- `members-participation` changes solo mode, split or merge scope, invitations, and departure.
- `members-notices` delivers the expected category and sender to recipients, and honors a muted category.
- `members-settings` saves profile, group avatar, preference, and tour controls through Map.
- `members-permissions` restricts kick, group edits, signout, and leave to their actual authorized and confirmed paths.

## How to get to it (user POV)

- Open a team Map and its member or presence controls.
- Choose solo mode, a split or merge action, a pending invitation, or a member's available action.
- Open the Map avatar to edit a profile. Open settings for group avatar, preferences, or the replay tutorial control.
- Open the group menu to share an invite, return home, leave, or sign out. Respond to the actual confirmation dialog.

## Driving it with World

Preconditions:

- Doctor passes. The recorded trip's three accounts have joined the same group.
- Keep each actor's external notification receipts separate. A sender's empty queue does not prove recipient delivery.

- **Recorded recipients.** Run the skill's trip command. Read `trio.roster`, `initial.location-recipient-reactions`, the solo and rejoin actions, `recipient.destination-reaction`, and `leave.reactions`. Compare every recipient's map member projection, exact coordinate timestamp, local notification deltas, category, sender, and content. The departing actor must return to `RoleSelect`, and remaining actors must have the two-member roster plus the named departure notice.
- **All Map control entries.** Run `node test/headless/run.cjs --testNamePattern="actual Map controls on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path from the map index. Existing cases drive invitation copy and share, solo and notification macros, split and merge, invitation acceptance and decline, kick cancel and confirm, profile, avatar, home, leave, signout, and route-tour completion. Verify backend membership or profile state together with the rendered provider projection.
- **Tutorial entry.** Run `node test/headless/run.cjs --testNamePattern="actual contextual tours on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path for the contextual group and add-place entry points. Completing a tour must survive restart without creating a destination or journey as a side effect.
- **Notification settings parent.** Run `node test/headless/run.cjs --testNamePattern="actual member parent entries on|N03 N09 N10 N11 N12 N13 N14" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. The Map case enters `settings.notifications`, loads and changes the real category controls, persists the actor-owned values, and returns to Map. The notification policy case separately proves that muting add-gathering still permits a later journey notice with the expected sender and recipient.

## Gotchas

- Native notifications are captured scheduling and content receipts. The fixture outbox records routing. Neither proves APNs or FCM delivery.
- Do not auto-accept an alert. The harness uses `device.input({ kind: 'alert', index: 1 })` only after the expected confirmation is visible.
- Profile and account component tests do not prove Map parent navigation. Use the avatar integration and actual settings account entry respectively.
- A muted add-gathering category must not suppress unrelated journey or departure notices. Assert the intended recipient and category, rather than a total notification count.
