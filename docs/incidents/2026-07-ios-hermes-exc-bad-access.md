# 2026-07 iOS Hermes EXC_BAD_ACCESS

## Incidents

| Incident | Build | Device | OS | Signal | Hermes top frame |
|---|---|---|---|---|---|
| 2F71F112… | 0.1.3 (24) | iPhone13,3 | 26.5.2 | SIGBUS / KERN_PROTECTION_FAILURE | GCSymbolID::set → DictPropertyMap::findOrAdd |
| B5BC83CD… | 0.1.0 (17) | iPhone13,3 | 26.5.2 | SIGSEGV / KERN_INVALID_ADDRESS 0x11 | BasedPointer::operator bool → HiddenClass::findProperty |

## Confidence

- Confirmed: native Hermes VM property metadata access failure.
- Probable: RN 0.81.5 Hermes / iOS 26 Release runtime interaction; Reanimated/Worklets remains a candidate.
- Not proved: PAC-only root cause or a specific Hither JS function.

## Release gate

Candidate must complete the linked QA script on the original device with zero EXC_BAD_ACCESS crashes. Simulator and Debug results are informational only.

## Build matrix

| Role | Git SHA | Engine | Expo | RN | Reanimated | Worklets | Notes |
|---|---|---|---|---|---|---|---|
| Crash baseline | (TF 17/24) | hermes | 54.0.x | 0.81.5 | 4.1.1 | 0.5.1 | Original EXC_BAD_ACCESS reports |
| Control (Hermes) | master tip | hermes | 54.0.36 | 0.81.5 | 4.1.1 | 0.5.1 | Fingerprint OTA + breadcrumbs + CI gates; no claim of fix |
| JSC mitigation candidate | blocked | n/a | 54.0.36 | 0.81.5 | 4.1.1 | 0.5.1 | See A/B — not shippable on RN 0.81 |
| SDK 56 Hermes | master tip | hermes V1 | 56.x | 0.85.3 | Expo-aligned | 0.8.3 | In-repo; original-device gate pending |
## A/B results

### Task 4 JSC (static / CI pod install — not original device)

| Step | Result |
|---|---|
| Set `app.json` `ios.jsEngine` + `Podfile.properties` `expo.jsEngine` to `jsc` | done |
| macOS `pod install` (GH Actions run 29671431998) | completed; **still installed `hermes-engine`** (113 pods) |
| RN 0.81.5 `jsengine.rb` | Hermes is default; JSC moved to community support; `use_hermes` is true unless `USE_THIRD_PARTY_JSC=1` |
| Plan decision | **Stop JSC route.** Do not ship hand-stripped lock. Revert engine to Hermes with real Podfile.lock. |
| Original-device 50 cold launches / 30-min / 24h | not run (JSC candidate not produced) |

| Candidate | 50 cold launches | 30-min mixed flow | 24h TF crash count | Outcome |
|---|---|---|---|---|
| Hermes control | pending | pending | pending | — |
| iOS JSC | blocked (engine not available) | n/a | n/a | FAIL path — RN 0.81 keeps Hermes |

## In-repo mitigations (not a crash RESOLVED claim)

- `runtimeVersion` fingerprint policy (blocks incompatible OTA).
- `npm run verify:runtime` + required CI step.
- Bounded launch breadcrumbs + `previous_launch_incomplete` diagnostics.
- Blocking `expo-doctor` in CI.

## Status

Status: OPEN — Task 4 JSC blocked on RN 0.81. Task 5 **in-repo**: Expo SDK 56 / RN 0.85.3 / Hermes V1 (`hermes-engine 250829098.0.10`) with fingerprint OTA, launch breadcrumbs, and CI runtime gates. Original-device TestFlight Release gate has **not** been completed. Do not treat as RESOLVED.
