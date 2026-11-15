# Accounts and teams

A traveler opens Welcome, creates a team or joins by code, and can return to Map with the same identity. Login is available from Welcome.

## Sub-features

- `teams-guest` signs in anonymously when a traveler without a session submits Create or Join.
- `teams-auth` handles email sign-in, signup confirmation, recovery, Google, and Apple through their actual controls.
- `teams-create-join` creates a named group, joins its invite code, and converges all rosters.
- `teams-return` uses My teams to reenter, leave, or clear saved groups, retries loading, and preserves the traveler's identity.
- `teams-account` edits a profile or upgrades an anonymous account without transferring group ownership.

## How to get to it (user POV)

- On Welcome, choose Create and name the team, or enter its six-character code and confirm Join. An invite link can also open Join. Use Login from Welcome for email, Google, or Apple.
- A returning traveler can tap a saved team card to open Map. If the last active team still qualifies on cold launch, App opens its Map directly.
- On iOS Map, open You from the avatar, choose My teams, and select another card. Tap Confirm switch to replace the active Map. Selecting a card alone leaves the current team unchanged.
- On the saved-teams screen, swipe a card to Leave or use its accessibility action. Confirm before leaving or clearing teams. Use Retry if the list fails to load. The entry screen has a separate sign-out confirmation for registered accounts.
- On Android, open the Map avatar to edit profile or Map Settings for the account. On iOS, open the avatar and choose Profile or Account in You.

## Driving it with World

Preconditions:

- Doctor passes. The recorded trip starts each actor with `userId: null` and `mode: 'app'`, then creates its group through the UI.
- Focused suites can seed the required identity and group with `LEADER`, `PEER`, `GROUP_ID`, and `TEST42` from the fixture backend.

- **Welcome and group proof.** Run the recorded trip. The signed-out leader creates from Welcome, then saves a nickname through Map Profile. The other travelers enter the invite code, set nicknames, and join. Compare the actor IDs from `membership.confirmed` to each durable roster at `trio.roster`. Check the successful `create_group` and `join_group` receipts in `backend-evidence.json`. Final membership rows contain only the leader and member A because member B has left.
- **Return proof.** The trip keeps a restored Map or taps `team-card-<created-group-id>` if App shows saved teams. Check durable membership and display identities at `day-two.identity-preserved`.
- **iOS switch.** Run `./test/headless/run.ps1 -Driver jest -ResourceReport "${verifySuiteOutput}.resources.json" --runInBand --runTestsByPath src/__tests__/headlessTeamSwitchLifecycle.test.ts --testNamePattern="replaces Map through App settings 100 times without accumulating retired team resources" --json --outputFile="$verifySuiteOutput"` with a fresh result path. Confirm selection leaves membership and route alone; Confirm switch must replace Map and leave one Map route without accumulating the retired team's subscriptions.
- **Background and cold launch.** The real-navigator case in `headlessAuthScenario.test.ts` retains Map and membership across lifecycle events and a transient refresh failure. Cold launch restores a valid selected Map. A kick or deleted group clears membership while retaining identity. For the separate OTA boundary, run `./test/headless/run.ps1 -Driver jest -ResourceReport "${verifySuiteOutput}.resources.json" --runTestsByPath src/__tests__/otaUpdates.test.ts --json --outputFile="$verifySuiteOutput"` with a fresh result path. These SDK checks cover deferred automatic reload and manual apply. They provide no World or device evidence.
- **Auth entry points.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="headless authentication operations on" --json --outputFile="$verifySuiteOutput"` with a fresh result path. Check Login dismissal without auth, email, signup, legal links, recovery, OAuth, and invite confirmation. Require the named case's route, session, and SDK receipts.
- **Account and profile entry points.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="headless account operations on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. The tests distinguish component receipts from parent App navigation, preserve UID and memberships on upgrade, and exercise cancellation and persistence.
- **Actual App and Map parents.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual App team entry boundaries on|real App native host foundation on|MAP-PROFILE-01|D6 You from the real Map screen.*keeps a saved nickname" --json --outputFile="$verifySuiteOutput"` with a fresh result path. Check Welcome before optional Login, explicit survey replay back to entry, and the App recovery deep link. Check Android profile save and iOS You profile persistence separately. After an anonymous account upgrade, require unchanged UID, memberships, leader role, and group creator.

## Gotchas

- OAuth, email delivery, and guest auth use explicit external contracts. They do not prove a real identity provider or inbox.
- A seeded identity can prove later App or screen behavior. To prove registered sign-in, drive Login.
- A profile overlay mounted directly can prove its callback and provider effect. Use the actual Map avatar path before claiming the parent screen integration.
- Reusing a prior output directory fails before launch. Use the current run's source record and retain its failure.
