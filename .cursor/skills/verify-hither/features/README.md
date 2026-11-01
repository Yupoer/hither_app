# Hither verification map

This map describes user paths and observable proof for the headless React and JavaScript runtime. Read the [skill](../SKILL.md) for launch, doctor, retained evidence, and cleanup. The map seeds five feature areas. It does not claim full product, visual, native, or live backend coverage.

| Feature ID | Recipe | Recorded trip coverage | Additional entry points |
| --- | --- | --- | --- |
| `teams` | [Accounts and teams](teams.md) | Guest confirmation, create, join, reenter, leave. | Email, signup, recovery, OAuth, account upgrade, profile. |
| `itinerary` | [Destinations and itinerary](itinerary.md) | Dropped pins, two days, hotel, move to day, close history. | Search, favorites, KML, member suggestions, subgroup, bulk changes. The coordinate form has no reachable Map opener. |
| `journey` | [Shared navigation and offline recovery](journey.md) | Actual Start and arrival, peer targets, offline abrupt restart, powered-off clock gap. | Manual End and completion, location refresh, consent, missed events, native adapter branch. |
| `members` | [Members and notifications](members.md) | Trio roster, coordinates, solo and rejoin, departure notices, muted category. | Invitations, split and merge, kick, profile, preference controls, route tour. |
| `store` | [Store and Premium](store.md) | None. | Map store, rewarded ad, redemption, Premium plans, purchase, restore, promo. |

## Baseline preconditions

- Use Node >=22.16.0 and independent dependencies installed from this checkout's lockfile with postinstall patches.
- Start a new `World` and output path for each scenario. `world.device()` initializes isolated durable storage and fixtures automatically.
- A screen-level scenario can seed a fixture identity. A full App proof begins signed out and uses actual onboarding and auth callbacks.
- Every feature reports the exact route and entry point driven, the platform, command, source SHA and dirty state, and evidence directory.
- Use `describe.each(['ios', 'android'])` suites for platform-specific assertions. The recorded trip uses an iOS leader, Android member A, and iOS member B. A mixed trip does not prove that every action ran on both platforms.

## Driving conventions

Read the corresponding production entry and existing scenario before extending a recipe. Prefer registry names and `testID` hosts to text matching. Preserve guards, confirmation alerts, and fixture errors. Wait for committed state, acknowledgment, or the receiving actor instead of counting mock calls.

The recorded trip emits detailed action and state evidence. A Jest JSON report lists executed assertions but does not by itself contain a chronological screen transcript. For an additional entry point that needs reviewable action and state proof, record `World({ recordInput })`, `device.observe()`, and relevant backend receipts in the same manner as `tokyo-trip.cjs`, outside `world.directory`. Never infer that entry point passed from the trip.

Before each additional Jest command, allocate a new result path from `apps/mobile`. The feature commands use this variable so a retry cannot overwrite a prior proof.

```powershell
$verifySuiteId = [guid]::NewGuid().ToString('N')
$verifySuiteDirectory = Join-Path $PWD ('test-artifacts/verify-hither/' + $verifySuiteId)
New-Item -ItemType Directory -Path $verifySuiteDirectory -Force | Out-Null
$verifySuiteOutput = Join-Path $verifySuiteDirectory 'jest.json'
[ordered]@{
	revision = (git rev-parse HEAD)
	dirty = @(git status --porcelain)
	node = (node --version)
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $verifySuiteDirectory 'source.json')
```

Save the selected command, its stdout, stderr, and exit code alongside that JSON. Require a nonzero executed test count, no failed cases, and both declared platform cases. A skipped entry point stays unexecuted. The suites close each owned World in `finally`; retain the JSON and any action records after they finish.

## Proof and skip reporting

Report each entry point as passed, failed, or unexecuted. Record a missing fixture precondition as a failed journey with the reason in the feature's `Gotchas`. Do not weaken the journey or change its entry point to pass it. Keep failure artifacts after cleanup.

The [operation inventory](../../../../apps/mobile/test/headless/operation-inventory.json) and [functional scenario denominator](../../../../apps/mobile/test/headless/functional-scenarios.json) support this user-facing map. Neither substitutes for the map or actual execution. Source fingerprints require source review when behavior changes; do not regenerate them to erase a mismatch.
