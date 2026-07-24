# Implementation Report: Android Interaction Resilience

> Date: 2026-07-24  
> Status: **Code + contract tests shipped**. Pixel device acceptance (plan Task 5–6) **not run** in this pass.  
> Audience: code reviewers

## 1. Summary

Pixel re-entry black-screen risk was treated as a **navigation + interaction boundary** problem, not a one-off map hack. This change (1) makes “back to create/join home” a stack **`reset`** so old `Map` routes cannot accumulate, (2) introduces a shared **`runUiAction`** runner (single-flight, timeout, sanitized telemetry, optional recovery banner), (3) migrates **high-risk nav/session** entry points through that runner, and (4) adds **root action-error banner** + **map subtree Error Boundary** with a **one-shot** surface remount. Original plan/spec files were **not** rewritten.

**Not claimed fixed without device evidence:** native Google Maps surface black, GPU/ANR, or process death. JS contracts pass; Pixel 0/10 black-screen gate is still required for full Definition of Done.

## 2. Traceability (plan / spec → code)

| Plan / Spec | Delivered? | Primary files / tests |
|---|---|---|
| Spec §5.1 / Plan Task 1 — go home uses `reset` | Yes | `MapScreen.tsx` `goHomeCreateOrJoin`; `navigationInteractionContract.test.ts`; `mapUiContracts.test.ts` |
| Spec §4.1 / Plan Task 2 — `runUiAction` | Yes | `utils/uiAction.ts`; `uiActionContract.test.ts` |
| Spec §4.2 — `SafePressable` | Yes (available) | `components/SafePressable.tsx` (wired for press paths; Alert/ActionSheet call `runUiAction` directly) |
| Plan Task 3a — nav/session migration | Yes | Map go-home / switch / leave / sign-out / group menu; RoleSelect sign-out; Auth create/join; MyTeams enter/leave/clear |
| Plan Task 3b — map/sheet batch | Partial | Group menu + settings open + go-home path; **not** every search/dest reorder/submit path |
| Plan Task 3c–3d — account/network + pure UI | Deferred | Account upgrade/redeem, login, feedback, most pure `setState` presses still local |
| Spec §4.3 / Plan Task 4 — recovery UI | Yes | `InteractionRecoveryBanner.tsx` in `App.tsx`; `AppErrorBoundary` retry remount + events |
| Spec §5.3 — map fallback finite state | Yes | `GroupMap.tsx` `MapSubtreeBoundary`, one remount, then go-home only |
| Spec §6 — telemetry events | Yes (subset) | `ui_action_*`, `navigation_reset`, `map_surface_failure` / `map_surface_retry`; existing `android_map_*` retained |
| Spec §7.1 contract tests | Yes | New: `navigationInteractionContract`, `uiActionContract`, `buttonInventoryContract`; existing map/perf contracts green |
| Plan Task 5–6 device QA | **No** | Needs Pixel + ADB artifacts under `.qa-runtime/android-interaction-2026-07-24/` |

## 3. Behavior changes (before → after)

### 3.1 Go home (create/join)

| | Before | After |
|---|---|---|
| Navigation | `navigation.navigate('RoleSelect')` (keeps Map under stack) | `navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] })` |
| Overlay | Caller sometimes cleared | Always `setOverlay(null)` inside the action |
| Membership | Not cleared | Still **not** cleared (`leaveGroup` / `signOut` forbidden in this path) |
| Double-tap | Unbounded | Single-flight via `runUiAction('map.go_home_create_or_join')` |
| Telemetry | `settings_go_home_create_or_join` | + `navigation_reset` + `ui_action_*` |

Re-entry remains: `RoleSelect → Auth|MyTeams → replace('Map')` (unchanged; still the single-current-Map path).

### 3.2 Shared action runner

`runUiAction(actionId, task, { screen, timeoutMs?, onBusyChange?, onError?, suppressBanner? })`:

- Default timeout **15s**
- Same `actionId` while in-flight → ignored (`ui_action_ignored`)
- Sync throw / reject → `ui_action_error` (+ `logError`), optional banner
- Timeout → `ui_action_timeout`, busy cleared; does **not** cancel underlying Promise
- Task receives `token.isCurrent()`; current only while generation owns in-flight slot (late work after finish/timeout is stale)
- Payloads: `actionId`, `screen`, `durationMs`, `timeoutMs` only — no tokens, user ids, coords, stacks

### 3.3 Recovery surfaces

| Surface | Behavior |
|---|---|
| `InteractionRecoveryBanner` | Root banner on action error/timeout; dismiss clears; Auth uses `suppressBanner` (keeps its own Alert) |
| `AppErrorBoundary` | Retry remounts children via key; logs `react_render` + `react_render_boundary` / `react_render_retry` |
| Map local boundary | Map React subtree errors → map-only fallback; **one** user remount; second failure keeps fallback + go home; **no** timer remount |

## 4. File changelog

### Created

| Path | Role |
|---|---|
| `apps/mobile/src/utils/uiAction.ts` | Shared runner + failure pub/sub |
| `apps/mobile/src/components/SafePressable.tsx` | Pressable → `runUiAction` |
| `apps/mobile/src/components/InteractionRecoveryBanner.tsx` | Global error/timeout banner |
| `apps/mobile/src/__tests__/navigationInteractionContract.test.ts` | Go-home / re-enter contracts |
| `apps/mobile/src/__tests__/uiActionContract.test.ts` | Runner unit contract |
| `apps/mobile/src/__tests__/buttonInventoryContract.test.ts` | High-risk wiring inventory |
| `docs/superpowers/reports/2026-07-24-android-interaction-resilience-implementation.md` | This report |

### Modified

| Path | Change |
|---|---|
| `apps/mobile/src/screens/MapScreen.tsx` | Reset go-home; `runUiAction` on nav/session/menu; `GroupMap` `onRequestGoHome` |
| `apps/mobile/src/screens/AuthScreen.tsx` | Submit via `runUiAction` |
| `apps/mobile/src/screens/RoleSelectScreen.tsx` | Sign-out via `runUiAction` |
| `apps/mobile/src/screens/MyTeamsScreen.tsx` | Enter / leave / clear via `runUiAction` |
| `apps/mobile/src/components/GroupMap.tsx` | Local boundary + finite remount fallback |
| `apps/mobile/src/components/AppErrorBoundary.tsx` | Retry remount + extra events |
| `apps/mobile/App.tsx` | Mount `InteractionRecoveryBanner` |
| `apps/mobile/src/i18n/index.ts` | `interaction.*` strings (zh/en) |
| `apps/mobile/src/__tests__/mapUiContracts.test.ts` | Expect `reset` instead of `navigate` |

### Intentionally untouched

- `docs/superpowers/plans/2026-07-24-android-interaction-resilience.md`
- `docs/superpowers/specs/2026-07-24-android-interaction-resilience-design.md`
- Map Android provider / location-callback ownership / `mapInitialCenter` lock (must not regress)
- No new crash SDK, no renderer flip, no auto MapView remount timer

## 5. Test evidence

### Commands run (2026-07-24)

```powershell
cd apps/mobile
npx jest --runInBand `
  src/__tests__/navigationInteractionContract.test.ts `
  src/__tests__/uiActionContract.test.ts `
  src/__tests__/androidMapContract.test.ts `
  src/__tests__/mapUiContracts.test.ts `
  src/__tests__/buttonInventoryContract.test.ts `
  src/__tests__/appErrorBoundary.test.ts `
  src/__tests__/performanceRegression.test.ts

npx tsc --noEmit
```

### Results

| Check | Result |
|---|---|
| Focused Jest suites | **7 passed**, 72 tests |
| `tsc --noEmit` | **Pass** |
| Pixel re-entry 10× / logcat / exit-info | **Not run** |

## 6. Migration coverage

| Batch | Status | Notes |
|---|---|---|
| **3a** Navigation / session | **Done** | go-home, switch group, leave, sign-out (Map + RoleSelect), Auth create/join, MyTeams enter/leave/clear |
| **3b** Map / sheet | **Partial** | Group menu + open settings; sheet search / dest mutate / recenter **not** fully migrated |
| **3c** Network / account | **Deferred** | AccountSheet upgrade/redeem, Login, feedback upload still local try/catch or bare async |
| **3d** Pure UI | **Deferred** | Tabs, backdrop, many sync setState presses — acceptable per plan for pure setState |

Inventory gate (`buttonInventoryContract`) only locks **already migrated high-risk** actionIds; it is not a full-app Pressable scan.

## 7. Risks and residual work

1. **Device acceptance missing** — black Map / Activity death still need Pixel proof; do not merge as “Pixel fixed” without logcat/exit-info.
2. **Incomplete button migration** — leftover bare `void async…` on account/search/dest paths can still double-submit or hang spinners.
3. **Timeout does not abort network** — by design; callers must use `token.isCurrent()` before setState after await (MyTeams/Auth do; not all legacy paths).
4. **Map fallback is React-subtree only** — native black surface without a JS throw will **not** auto-enter fallback; still needs native diagnostics if QA sees map-only black.
5. **Theme remount still uses MapView `key`** — pre-existing; user remount adds `surfaceKey` only after failure path.
6. **Auth rethrows after Alert** — records `ui_action_error` correctly; double UX avoided via `suppressBanner`.

### Suggested follow-ups (priority)

1. Pixel 10× home → re-enter map with artifacts (plan §5 commands).
2. Finish 3b/3c high-risk async handlers through `runUiAction`.
3. If map-only black remains with clean JS lifecycle: native A/B (one variable), not more JS wrappers.

## 8. Reviewer checklist

- [ ] `goHomeCreateOrJoin` uses **`reset`**, not `navigate('RoleSelect')`, and does **not** call `leaveGroup` / `signOut`.
- [ ] `Auth` / `MyTeams` still **`replace('Map')`** (single Map after re-entry).
- [ ] `runUiAction` single-flight + timeout + `finally` busy clear look correct; token stale after finish.
- [ ] Telemetry payloads stay sanitized (no tokens, coords, raw stacks).
- [ ] `AppErrorBoundary` is **not** treated as catching native crash/ANR or event handlers.
- [ ] Map fallback allows **at most one** remount; no interval/timer remount of MapView.
- [ ] `InteractionRecoveryBanner` is root-mounted; Auth suppress path still shows local Alert.
- [ ] Existing Android map contracts still hold: `PROVIDER_GOOGLE`, iOS-only location callback bridge, `mapInitialCenter` lock.
- [ ] Deferred migrations (3b partial, 3c/3d) are acceptable for this PR or tracked as follow-up.
- [ ] Do not accept “black screen fixed” without device evidence if that is the release gate.

## 9. Links

| Doc / code | Path |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-24-android-interaction-resilience-design.md` |
| Plan | `docs/superpowers/plans/2026-07-24-android-interaction-resilience.md` |
| This report | `docs/superpowers/reports/2026-07-24-android-interaction-resilience-implementation.md` |
| Runner | `apps/mobile/src/utils/uiAction.ts` |
| Go-home | `apps/mobile/src/screens/MapScreen.tsx` (`goHomeCreateOrJoin`) |
| Map boundary | `apps/mobile/src/components/GroupMap.tsx` |
| Tests | `apps/mobile/src/__tests__/navigationInteractionContract.test.ts`, `uiActionContract.test.ts`, `buttonInventoryContract.test.ts` |
