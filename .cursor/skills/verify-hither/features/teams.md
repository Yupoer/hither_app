# Accounts and teams

A traveler enters through onboarding or Login, chooses a role, creates or joins a group, and can return to that group with the same identity.

## Sub-features

- `teams-guest` confirms or cancels the guest warning before entering role selection.
- `teams-auth` handles email sign-in, signup confirmation, recovery, Google, and Apple through their actual controls.
- `teams-create-join` creates a named group, joins its invite code, and converges all rosters.
- `teams-return` uses My teams to reenter, leave, or clear saved groups, retries loading, and preserves the traveler's identity.
- `teams-account` edits a profile or upgrades an anonymous account without transferring group ownership.

## How to get to it (user POV)

- Start App, skip or finish onboarding, then choose guest, email, Google, or Apple on Login.
- Choose Create or Join in role selection. Enter a display name plus a group name or invite code.
- Open My teams from role selection, choose the team card, and enter the group.
- In My teams, confirm leaving one team or clearing all teams; retry a failed load, or use Create and Join when the list is empty. Role selection has a separate sign-out confirmation.
- Open profile from the Map header avatar, or account controls from Map settings.

## Driving it with World

Preconditions:

- Doctor passes. The recorded trip starts each actor with `userId: null` and `mode: 'app'`, then creates its group through the UI.
- Focused suites can seed the required identity and group with `LEADER`, `PEER`, `GROUP_ID`, and `TEST42` from the fixture backend.

- **Guest and group proof.** Run the skill's recorded trip command. Its `onboarding-skip`, `login-guest`, `guest-confirm-button`, `role-create`, `role-join`, `team.name`, `team.group-name`, `team.code`, `team.create`, and `team.join` operations must reach `Map`. Read `membership.confirmed` and `trio.roster` in `observations.jsonl`. Compare the three actor IDs from `membership.confirmed` to each actor's durable roster at `trio.roster`. Check the successful `create_group` and `join_group` receipts in `backend-evidence.json`. Its final membership rows come after member B leaves, so only the leader and member A remain in the created group.
- **Return proof.** The trip uses `role-my-teams`, `team-card-<created-group-id>`, and `team-enter`. Use the ID captured from that run, rather than a guessed fixture ID. Day-two observations must preserve the traveler display identities and group membership after restart.
- **Background and cold launch.** The real-navigator case in `headlessAuthScenario.test.ts` enters a saved team through My teams and retains Map and membership across inactive/background/active events and a transient refresh failure. A process restart returns to RoleSelect. A kick or deleted group clears membership while retaining the identity. For the separate OTA boundary, run `./test/headless/run.ps1 -Driver jest -ResourceReport "${verifySuiteOutput}.resources.json" --runTestsByPath src/__tests__/otaUpdates.test.ts --json --outputFile="$verifySuiteOutput"` with a fresh suite path. Require the startup check, all three late-download defer cases, and explicit manual reload. The default headless driver does not select this file; these SDK boundary assertions do not provide World or device evidence.
- **Auth entry points.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="headless authentication operations on" --json --outputFile="$verifySuiteOutput"` after allocating a fresh suite path as described in the map index. Existing cases drive `auth.email.edit`, `auth.password.edit`, `auth.email.submit`, signup, guest cancellation, legal links, recovery, and configured OAuth callbacks. Require actual route and session outcomes plus the corresponding SDK contract receipts.
- **Account and profile entry points.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="headless account operations on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. The tests distinguish component receipts from parent App navigation, preserve UID and memberships on upgrade, and exercise cancellation and persistence.
- **Actual App and Map parents.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual App team entry boundaries on|real App native host foundation on|MAP-PROFILE-01" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. Complete onboarding into Login without restarting, present password recovery through App's actual deep-link route, enter a saved group through My teams, save a profile through the Map avatar, and upgrade an anonymous leader through Map settings. Require the same UID, exact memberships, leader role, and group creator after upgrade. Standalone account tests above cover the distinct social-link, cancellation, and failure contracts.

## Gotchas

- OAuth, email delivery, and guest auth use explicit external contracts. They do not prove a real identity provider or inbox.
- A seeded identity can prove later App or screen behavior. To prove sign-in, drive Login.
- A profile overlay mounted directly can prove its callback and provider effect. Use the actual Map avatar path before claiming the parent screen integration.
- Reusing a prior output directory fails before launch. Use the current run's source record and retain its failure.
