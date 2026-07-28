# Implementation Summary — Gathering Arrival Members UX (2026-07-28)

## Scope

Implemented all six tickets from `hither_app/docs/Tasks/Open/2026-07-28-Gathering-Arrival-Members-UX` against the authoritative spec.

## Files changed

### Core / pure helpers
- `hither_app/apps/mobile/src/utils/gatherCommand.ts` — complete prompt rewrite (`auto_complete` vs missing confirm), `shouldAutoCompleteStop`, cancel/destructive labels
- `hither_app/apps/mobile/src/utils/locationFreshness.ts` — `resolveSelfAwareLastUpdated` for self-row freshness
- `hither_app/apps/mobile/src/utils/targetMarkerPulse.ts` — unchanged logic (already excluded completed); covered by stronger contracts
- `hither_app/apps/mobile/src/native/externalNavigation.ts` — provider-explicit URLs (`google` | `apple`), `presentExternalMapsChooser`

### UI / wiring
- `hither_app/apps/mobile/src/screens/MapScreen.tsx` — arrive now, complete auto/manual + local notif, self lastUpdated, create-team accent
- `hither_app/apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts` — external maps chooser
- `hither_app/apps/mobile/src/screens/MapScreen/components/SettingsOverlay.tsx` — removed custom quick-command Settings block
- `hither_app/apps/mobile/src/screens/MapScreen/components/PassiveCompanionPanel.tsx` — shared TYPE_BASE typography (no 28/800 hero)
- `hither_app/apps/mobile/src/components/GroupMap.tsx` — completed marker fully strips shadow/elevation residual
- `hither_app/apps/mobile/src/i18n/index.ts` — passive enter, auto-complete notif, Google/Apple labels (zh + en)

### Tests
- `src/__tests__/gatherCommand.test.ts`
- `src/__tests__/externalNavigation.test.ts`
- `src/__tests__/locationFreshness.test.ts`
- `src/__tests__/locationRefresh.test.ts`
- `src/__tests__/targetMarkerPulse.test.ts`
- `src/__tests__/mapUiContracts.test.ts`
- `src/__tests__/passiveCompanionPresentationContract.test.ts`

---

## Per-ticket changes

### 01 — Completed marker drop active shadow
- Strengthened `gatherMarkerCompleted` to override base shadow fully (`shadowColor: 'transparent'`, opacity/radius/offset 0, `elevation: 0`).
- Existing logic already sets `isActiveTarget = !isCompleted && …` and excludes completed IDs from pulse.
- Contract: completed chrome + MapScreen `teamCompletedDestinationIds` wiring.

### 02 — Arrive auto current time
- `handleSelfArrival` now always calls `submitArrivalWithTimestamp(..., new Date().toISOString())`.
- Removed multi-option Alert (leader time / now / automatic / cancel).
- Existing success UI (check, celebrate, complete path) and failure Alerts retained.

### 03 — Complete auto + manual prompt
- `resolveCompletePrompt`:
  - all arrived → `auto_complete` (empty UI fields)
  - missing → message `已抵達成員（x/x），是否要完成此集合點？`, confirm `完成`, cancel `取消`
  - already `closedAt` → `none` (no double complete)
- MapScreen: auto path runs `runCompleteGatheringStop` then `notifications.scheduleLocalNotification` (this device only); only notifies on success.
- Manual path: cancel first (`style: 'cancel'`), complete second (`style: 'destructive'`).
- `shouldAutoCompleteStop` pure helper table-driven in tests.
- Spec wins over old “已完成 / 先不要完成 / 所有隊員都已抵達” copy.

### 04 — Members refresh push + pull + self row
- Refresh order already: self `requireUpload` → `requestGroupLocationRefresh` → `refresh()`.
- Self flock row now uses `resolveSelfAwareLastUpdated({ isSelf, remoteLastUpdated, selfSampleAtMs: deviceCoordsAcceptedAtMs })` so a successful local sample never stays on「尚無位置更新」.
- Success remains silent; cooldown / permission / failure alerts unchanged.

### 05 — External maps chooser
- `buildNavigationUrl(provider, dest, mode)` with `ExternalMapsProvider = 'google' | 'apple'`.
- `presentExternalMapsChooser` shows Google Maps / Apple Maps / cancel, then opens selected provider.
- `useJourneyNavigation.openExternalNavigation` always presents chooser first.
- Cancel does not open any app; Linking failures are soft-caught.

### 06 — Passive / settings / create team polish
- i18n `passive.enter`: 「被動模式」 / `Passive mode` (not “進入…/Enter…”).
- Passive panel typography uses `TYPE_BASE` + normal weights (no exclusive 28px/800).
- Settings: custom quick-command section removed (sheet long-press edit remains).
- 「建立小隊」label uses theme `accent`.

---

## Design decisions

1. **Complete seam**: prefer pure `resolveCompletePrompt` / `shouldAutoCompleteStop` over new RPC or state machine.
2. **Auto-complete notify**: reuse existing `notifications.scheduleLocalNotification` (works iOS + Android local; no new channel).
3. **Maps API break**: first arg of `buildNavigationUrl` is provider not platform — all call sites/tests updated.
4. **Self freshness**: prefer local sample over empty/stale remote without inventing timestamps for peers.
5. **Settings prop**: `onOpenCustomQuickCommand` kept optional/deprecated so MapScreen call site can stay temporarily without a larger prop-plumb rewrite.
6. **Alert button order**: cancel then destructive matches product left-cancel / right-complete intent within RN Alert constraints.

---

## Verification

### Jest (all passed)

```text
npx jest --testPathPattern="gatherCommand|externalNavigation|locationFreshness|locationRefresh|targetMarkerPulse|mapUiContracts|passiveCompanionPresentationContract|personalProgress" --no-coverage
# 8 suites, 109 tests passed

npx jest --testPathPattern="mapRouteUiContract|androidMapContract|dynamicTypeContract" --no-coverage
# 3 suites, 28 tests passed
```

### TypeScript

```text
npx tsc --noEmit -p tsconfig.json
# exit 0
```

---

## Incomplete

None — all six tickets’ acceptance criteria implemented and covered by focused contracts.

---

## Post-review fix pass (review file `grok-review-322e5558.md`)

All 6 open review issues fixed:

| ID | Fix |
|----|-----|
| BUG-1 | No empty-roster auto-complete (`totalCount <= 0` → `none`; no total=1 coercion) |
| SUG-1 | Complete confirm i18n via `gathering.completeMissing*` / MapScreen `t()` |
| SUG-2 | `completingDestIdsRef` in-flight guard on `runCompleteGatheringStop` |
| SUG-3 | `scheduleLocalNotification` requests permission first (soft-fail null) |
| NIT-1 | Removed Settings `onOpenCustomQuickCommand` prop completely |
| NIT-2 | Missing-members Alert uses `gathering.completeMissingTitle` |

### Extra files / deltas
- `gatherCommand.ts` — counts on result, empty-roster guard, title default
- `MapScreen.tsx` — i18n Alert, completingDestIdsRef, drop Settings prop
- `SettingsOverlay.tsx` — prop removed
- `notifications.ts` — permission before immediate local schedule
- `i18n/index.ts` — complete confirm keys zh/en
- Tests: empty roster case; i18n + in-flight contracts

### Re-verify
- Jest 5 suites / 77 tests passed (gatherCommand, mapUiContracts, notificationsBoundary, locationRefresh, externalNavigation)
- `tsc --noEmit` clean
