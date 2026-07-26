Reading the implement skill first, then the task docs.Implement skill loaded. Next: Spec + Ticket docs (no commit/push).All 5 tickets ready, no blockers. Inspecting map sheet / settings / tools code next.Contract tests look ahead of the code — running them and inspecting key sections.Contracts pass. Checking whether implementation is already complete vs. only partial vs. missing pieces.Implementation already exists as uncommitted work. Verifying acceptance gaps and leftover straggler UI.Polishing remaining gaps: dead code, stale comments, missing deps.Implementation is mostly done in the worktree. Cleaning dead `switchGroup`, stale straggler comment, and tools deps.Wrapping `handleSharingEnabledChange` in `useCallback` so the tools pane memo stays stable.# Grok Implementation Report

## Summary

All **5 ready tickets** are implemented in the feature worktree (uncommitted). Sheet ⋯ opens Settings in one tap; Settings personal area is simplified; map/journey prefs live at the top of Tools; straggler config UI is gone; Members/Route/Tools uses Liquid Glass opt-in.

**Next (for Codex owner):** review diff, then commit/push/OTA when ready. Do **not** expect this agent to ship.

## Changed

| Area | What |
|------|------|
| `MapScreen.tsx` | Direct `openSettingsFromSheet`; Tools prefs order; straggler UI/state removed; glass-wrapped main selector; dead `switchGroup` removed |
| `SettingsOverlay.tsx` | One **回到主畫面** row; **離開群組** in personal; Map & journey + straggler deep-link removed |
| `Segmented.tsx` | Opt-in `unstyledTrack` for glass parent; a11y label/state kept |
| Contract tests | map UI, passive companion, Android menu, button inventory, diagnostics location-sharing |

**Ticket → behavior**

1. **01** — ⋯ → `runUiAction('map.open_settings')` → `setOverlay('settings')` (no ActionSheet/Alert)
2. **02** — Personal: Account / Pro / 回到主畫面 / 離開群組 / 登出; leave still role-based confirm
3. **03** — Tools order: passive → sharing → oblique → Live Activity → expand → marquee (+ speed if on) → arrival → commands
4. **04** — No `StragglerConfigSection` / optimistic UI; detection still uses `group.stragglerAlerts` / threshold
5. **05** — Main selector only: `liquidGlass.GlassView` + `unstyledTrack`; Settings Segmented unchanged

## Verification

```
PASS mapUiContracts, passiveCompanion, glassChrome, androidGroupMenu,
     buttonInventory, diagnosticsUi, straggler  (78 tests)
PASS npm run typecheck  (tsc --noEmit)
```

Not run: full `npm test` suite; device/Expo Go manual check for Liquid Glass material.

## Remaining Risks

1. **Liquid Glass** — contracts assert wiring only; real iOS 26 material needs a supported device check; older iOS/Android use existing fallback.
2. **Leader “Leave group” label** — still runs end-group confirm for leaders (product note in spec).
3. **Uncommitted** — 8 app files vs `origin/master`; task docs untracked under `docs/Tasks/...`.
4. **No on-device UI pass** — sheet/settings/tools layout not exercised in Expo Go here.