# Code Review (Re-review) — Gathering Arrival Members UX (2026-07-28)

**Reviewer role:** Code reviewer (no fixes applied)  
**Spec:** `hither_app/docs/Tasks/Open/2026-07-28-Gathering-Arrival-Members-UX/Spec/gathering-arrival-members-ux-spec-2026-07-28.md`  
**Impl summary:** `C:\Users\alexs\AppData\Local\Temp\grok-MDs\grok-impl-summary-322e5558.md`  
**Workspace:** `hither_app/apps/mobile`  
**Pass:** Post-implementer fix re-review

## Verdict

**Approve — zero open issues.**

All six prior review findings were verified fixed in source. Ticket acceptance for 01–06 remains met. Focused pure helpers and MapScreen wiring stay consistent; no regressions introduced by the fix pass that warrant new open issues.

### Fix verification (previous issues — closed)

| ID | Status | Verification |
|----|--------|----------------|
| BUG-1 Empty-roster auto-complete | **Fixed** | `gatherCommand.ts:276-278` returns `none` when `totalCount <= 0`; no total→1 coercion; `shouldAutoCompleteStop` gets real `totalCount`. Test: empty roster + mis-set `allArrived: true` → `none` (`gatherCommand.test.ts:249-270`). |
| SUG-1 Complete confirm i18n | **Fixed** | Result exposes `arrivedCount`/`totalCount`; MapScreen Alert uses `t('gathering.completeMissingTitle|Message|Confirm')` + `t('common.cancel')` and member-done keys. zh/en present in `i18n/index.ts`. |
| SUG-2 Double complete race | **Fixed** | `completingDestIdsRef` Set; `runCompleteGatheringStop` early-returns if in-flight, adds on entry, deletes in `finally` (`MapScreen.tsx:1194`, `:2319-2337`). Covers auto + manual confirm (same runner). |
| SUG-3 Notif permission soft-fail | **Fixed** | `scheduleLocalNotification` requests permission first, returns `null` on deny/fail, never throws (`notifications.ts:120-134`). Complete path still `void` + does not block. |
| NIT-1 Dead Settings prop | **Fixed** | `onOpenCustomQuickCommand` removed from `SettingsOverlayProps` and MapScreen call site. Full sheet still uses `onConfigureCustom={openCustomQuickCommand}`. |
| NIT-2 Empty Alert title | **Fixed** | Missing-members title via `t('gathering.completeMissingTitle')` / helper default `完成集合點`. |

### Regression / new-issue scan

- **Return type** `scheduleLocalNotification` → `Promise<string | null>`: call sites (`MapScreen`, `useGroupNotifications`, `useSubgroupInvites`) do not depend on a non-null id; `tsc --noEmit` clean.
- **Permission prompt on every local notify:** intentional parity with `scheduleLocalNotificationAt`; best-effort callers already catch; no correctness bug.
- **Post-flight sequential double-tap** after first complete finishes (ref cleared) still relies on `closedAt` rebind — acceptable residual; concurrent path is guarded.
- Pure-helper zh string defaults retained for contract tests; UI path correctly prefers i18n.

### Verification run (this re-review)

```text
cd hither_app/apps/mobile
npx tsc --noEmit -p tsconfig.json   # exit 0
# Jest suites including gatherCommand, mapUiContracts, notificationsBoundary,
# locationRefresh, externalNavigation (and broader suite) — all passed
```

---

## Review Issues

**Zero open issues.**

No bugs, suggestions, or nits remain open from this re-review.

---

## Spec / ticket coverage (final)

| Ticket | Status |
|--------|--------|
| 01 Completed marker drop active shadow | Met |
| 02 Arrive auto current time | Met |
| 03 Complete auto + manual prompt | Met (empty-roster + i18n + in-flight + notify permission closed) |
| 04 Members refresh push+pull self row | Met |
| 05 External maps chooser | Met |
| 06 Passive / settings / create team | Met |

**Recommendation:** Ready to close the task pack from a code-review perspective; device smoke (full-team vs partial complete, Arrive one-tap, members refresh self label, maps chooser, passive type scale) remains optional QA outside this review.
