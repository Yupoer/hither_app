# Hither verification map

This map describes user paths and observable proof for the headless React and JavaScript runtime. Read the [skill](../SKILL.md) for launch, doctor, retained evidence, and cleanup. The map seeds five feature areas. It does not claim full product, visual, native, or live backend coverage.

| Feature ID | Recipe | Recorded trip coverage | Additional entry points |
| --- | --- | --- | --- |
| `teams` | [Accounts and teams](teams.md) | Welcome, anonymous create and join, saved-team restore, leave. | Login, signup, recovery, OAuth, account upgrade, profile, iOS team switching. |
| `itinerary` | [Destinations and itinerary](itinerary.md) | Android pins, two days, hotel, move to day, and closed stops. iOS pin suggestion. | Search, coordinate flows, favorites, KML, iOS day and order editing, subgroup, bulk changes. |
| `journey` | [Shared navigation and offline recovery](journey.md) | Android Start, pause, and completion, peer targets, abrupt offline restart, powered-off clock gap. | Offline Start and End, iOS Finish, force completion, passive uploads, scheduled Start, consent, Android precision switch, native adapter branch. |
| `members` | [Members and notifications](members.md) | Trio roster, coordinates, member suggestion inbox approval, solo and rejoin, add-place notices suppressed while solo, departure notices. | Backend/peer refresh, unread and pending-request badges, navigation-only separation, invitations, split and merge, kick, profile, individual category preferences, route tour. |
| `store` | [Store and Premium](store.md) | None. | Map store, rewarded ad, redemption, Premium plans, purchase, restore, promo. |

## Baseline preconditions

- Use Node >=22.16.0 and independent dependencies installed from this checkout's lockfile with postinstall patches.
- Start a new `World` and output path for each scenario. `world.device()` initializes isolated durable storage and fixtures automatically.
- A scenario can seed an identity to test later behavior. Use an App scenario starting signed out when verifying the authentication path. The recorded trip enters from Welcome.
- Every feature reports the exact route and entry point driven, the platform, command, source SHA and dirty state, and evidence directory.
- Select the cases that drive each platform's actual controls. The recorded trip uses an Android leader, iOS member A, and Android member B. A mixed trip does not show that every action ran on both platforms.

## Driving conventions

Read the corresponding production entry and existing scenario before extending a recipe. Prefer registry names and `testID` hosts to text matching. Preserve guards, confirmation alerts, and fixture errors. Wait for committed state, acknowledgment, or the receiving actor instead of counting mock calls.

Use an English iOS test locale for cases with English labels, including scheduled Start, offline Start requests, member votes, and itinerary arrival management. Without a native language fixture, the actor can inherit the host's `Intl` locale. On a non-English host, preserve the original report if the label fails and record any replay's locale.

The Windows recipes use `test/headless/run.ps1` with the default 4.5% CPU rate for the owned launch. Save its resource report alongside the Jest result. The cap retains every scenario and separate device process. Use virtual time and completion events as described in the skill; do not add human reaction delays. A resource cap and a reduction in CPU work are different measurements, so retain CPU time and elapsed time together with host CPU share.

The recorded trip emits detailed action and state evidence. A Jest JSON report lists executed assertions. Set `HITHER_HEADLESS_EVIDENCE` before other scenario commands to also capture their existing commands, observations, final backend state and cleanup under one directory per World. `world.json` links each record to its exact Jest case. Never infer that an additional entry point passed from the trip.

Before each additional Jest command, allocate a new result path from `apps/mobile`. The feature commands use this variable so a retry cannot overwrite a prior proof.

```powershell
$verifySuiteId = [guid]::NewGuid().ToString('N')
$verifySuiteDirectory = Join-Path $PWD ('test-artifacts/verify-hither/' + $verifySuiteId)
New-Item -ItemType Directory -Path $verifySuiteDirectory -Force | Out-Null
$verifySuiteOutput = Join-Path $verifySuiteDirectory 'jest.json'
$env:HITHER_HEADLESS_EVIDENCE = Join-Path $verifySuiteDirectory 'worlds'
[ordered]@{
	revision = (git rev-parse HEAD)
	dirty = @(git status --porcelain)
	node = (node --version)
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $verifySuiteDirectory 'source.json')
```

Save the selected command, stdout, stderr, and exit code alongside the source record. Require the intended case names, their declared platforms, and no failures. A skipped entry point stays unexecuted. Inspect the World receipts after the suite closes. Use the full headless command in the skill to report the scenario denominator; keep separate helpers and native acceptance separate.

## Proof and skip reporting

For a request limited to location sync, use the selected cases in [journey](journey.md), [members](members.md), and the affected [itinerary recovery](itinerary.md). Use the full skill's maintenance recipe for a pass over all five maps. A partial Jest report cannot establish the complete denominator.

Report each entry point as passed, failed, or unexecuted. If a fixture precondition is missing, record the failed path and the reason in the run notes. Add reusable preconditions to the feature's Gotchas. Do not weaken the journey or change its entry point to pass it. Keep failure artifacts after cleanup.

The [operation inventory](../../../../apps/mobile/test/headless/operation-inventory.json) and [functional scenario denominator](../../../../apps/mobile/test/headless/functional-scenarios.json) support this user-facing map. Neither substitutes for the map or actual execution. Source fingerprints require source review when behavior changes; do not regenerate them to erase a mismatch.
