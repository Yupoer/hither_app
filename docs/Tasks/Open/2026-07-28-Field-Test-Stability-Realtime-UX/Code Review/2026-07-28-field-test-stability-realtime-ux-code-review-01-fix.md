# Code Review 01 — Fix response

**Date:** 2026-07-28  
**Source:** `2026-07-28-field-test-stability-realtime-ux-code-review-01.md`

## Status by finding

| ID | Severity | Status | Change |
|----|----------|--------|--------|
| Standards P1 avatar clipping | P1 | **fixed** | Restored `MyTeamsScreen` UI baseline from `e4e6644`; re-applied enter guard only. `avatarBubble` / `detailAvatarBig` keep `overflow: 'hidden'`. |
| Standards P2 Platform in GroupMap | P2 | **fixed** | `defaultMapTransitProps()` in `src/native/maps.ts`; GroupMap spreads that helper. |
| Standards P3 TargetPulsePhase | P3 | **fixed** | Removed unused interface from `targetMarkerPulse.ts`. |
| Spec P1 Android Maps SDK | P1 | **fixed (packaging)** | patch pins `play-services-maps` default **20.0.0**; local `android/build.gradle` `ext.googlePlayServicesMapsVersion`. Needs native build to verify compile. |
| Spec P1 Force Refresh upload | P1 | **fixed** | `refreshDeviceLocation({ requireUpload: true })` — upload errors propagate; fan-out skipped; failure alert remains. |
| Spec P1 Device verification | P1 | **documented residual** | Checklist in Report/11; still **not signed** — task not release-complete until device QA. |
| Spec P2 5s progressClock loop | P2 | **fixed** | Single `setTimeout` to stale threshold while `journeyActive` + nav target only. |
| Spec P2 pulse after nav ends | P2 | **fixed** | `activeDestinationId={journeyActive && navTarget?.id ? navTarget.id : null}`. |
| Spec P2 freshness not shown | P2 | **fixed** | Card distance appends `locationUpdate.stale`; passive shows same when stale/unknown. |
| Spec P2 MyTeams redesign scope | P2 | **fixed** | UI restored to baseline; only enter lifecycle (guard + LA clear + timeout clear). |

## Tests

```
npm test -- --runInBand --testPathPattern "personalProgress|targetMarkerPulse|transitMapDefaults|otaTeamEntryLifecycle|otaUpdates|gatherCommand|locationRefresh|passiveCompanionPresentationContract|dynamicTypeContract|mapUiContracts"
```

**120 passed / 10 suites** (includes `dynamicTypeContract`).

`tsc --noEmit`: only pre-existing `history.test.ts` fixture error (unchanged).

## Still open for release

1. Physical release-like iOS/Android sessions (Report/11).
2. Native rebuild: Live Activity Swift + Maps SDK 20 transit layer.
3. Confirm Android `assembleRelease` compiles against `setTransitEnabled`.
