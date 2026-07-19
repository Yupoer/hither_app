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
| Control (Hermes) | pending EAS | hermes | 54.0.36 | 0.81.5 | 4.1.1 | 0.5.1 | Same device matrix, no claim of fix |
| JSC mitigation candidate | pending EAS | jsc (iOS only) | 54.0.36 | 0.81.5 | 4.1.1 | 0.5.1 | Android remains hermes; New Arch on |
| SDK 56 Hermes | not started | hermes | 56.x | 0.85.x | Expo-aligned | Expo-aligned | Separate hypothesis after JSC path |

## A/B results (original device)

| Candidate | 50 cold launches | 30-min mixed flow | 24h TF crash count | Outcome |
|---|---|---|---|---|
| Hermes control | pending | pending | pending | — |
| iOS JSC | pending | pending | pending | — |

## Status

Status: OPEN — static runtime gates, fingerprint OTA policy, launch breadcrumbs, and iOS JSC mitigation config are in-repo; original-device TestFlight Release gate has **not** been completed. Do not treat as RESOLVED.
