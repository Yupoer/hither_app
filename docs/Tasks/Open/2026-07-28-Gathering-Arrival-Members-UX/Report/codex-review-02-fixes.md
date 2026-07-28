# Codex review-02 fixes (2026-07-28)

Source: `Code Review/review-02.md`

## P1 — fixed

| Issue | Fix |
|-------|-----|
| Remote final arrival does not auto-complete | Leader `useEffect` watches `destinationArrivals` + scoped members; when all scoped arrived and stop open → `runCompleteGatheringStop` + this-device notify. Guarded by `remoteAutoCompleteDestIdsRef` + `completingDestIdsRef`. |
| Arrival counts not scoped | `deriveScopedArrivalCounts` / `membersInDestinationScope` — same subgroup rule as arrival-manage UI. Main stop only counts main-group members. |
| Auto-complete before arrival write | Celebrate with `promptComplete: false` first; only after `setDestinationArrival(At)` + workflow reload succeeds call `promptComplete: true`. Failed write never schedules complete. |

## P2 — fixed

| Issue | Fix |
|-------|-----|
| iOS notification path | Explicit `Platform.OS === 'android' \| else` this-device notify. Leader is excluded from `complete_gathering_stop` APNs; both platforms use local presentation for the actor device (documented in code). |
| External-map failures swallowed | `presentExternalMapsChooser` alerts `map.externalMapsOpenFailed` when open rejects. |
| Member pull failures hidden | `refreshAllLocations` **awaits** `refresh()` after accepted fan-out; pull failure shows set-failed Alert; spinner stays until pull finishes. |

## P3 smell (light)

- Removed unused `defaultMapsProviderForPlatform`.
- Maps open-failure path no longer silent.

## Verification

```text
npx jest --testPathPattern="gatherCommand|externalNavigation|locationRefresh|arrivalFeedbackContract|mapUiContracts" --no-coverage
# 5 suites, 80 tests passed

npx tsc --noEmit -p tsconfig.json
# exit 0
```
