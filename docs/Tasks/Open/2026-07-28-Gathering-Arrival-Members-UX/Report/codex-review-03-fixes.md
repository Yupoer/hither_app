# Codex review-03 fixes (2026-07-28)

Source: `Code Review/review-03.md`

## P1 — fixed

| Issue | Fix |
|-------|-----|
| Arrival write fail still allows auto-complete via manual Complete | On geofence arrival write failure: clear `autoArrivedDestId`, `autoArrivalMarkedRef`, local arrival patch, celebrate. `promptCompleteAfterArrival` defaults **`includeSelf: false`**; only post-write path passes `includeSelf: true`. Manual Complete no longer invents a self arrival. |

## P2 Spec — fixed

| Issue | Fix |
|-------|-----|
| iOS notification path | `native/notifications.notifyThisDeviceAutoComplete`: Android → local; iOS with push token → `remote_expected` (APNs via complete RPC); iOS without token → local fallback. |
| Leader APNs delivery | Migration `20260728120000_complete_stop_notify_leader.sql` notifies acting leader with `target_user_id`. `send-push` honors `target_user_id` (may include sender). |
| Member pull silent fail | `useGroupState.load` returns **`false`** on remote failure even when cache restores. `refreshAllLocations` checks `const pulled = await refresh()` and alerts if false. |
| Card x/x unscoped | Gathering card people chip uses `deriveScopedArrivalCounts` (`cardArrival.arrivedCount` / `totalCount`). |

## Standards — fixed

| Issue | Fix |
|-------|-----|
| UI `Platform.OS` hard violation | Removed from MapScreen; platform branch only in `src/native/notifications.ts`. |
| Duplicated auto-complete flow | Shared `executeAutoCompleteStop` for prompt + remote effect. |

## Verification

```text
npx jest --testPathPattern="gatherCommand|externalNavigation|locationRefresh|arrivalFeedbackContract|mapUiContracts|notificationsBoundary|groupSyncContract" --no-coverage
# 7 suites, 86 tests passed

npx tsc --noEmit -p tsconfig.json
# exit 0
```

## Deploy note

Apply migration `20260728120000_complete_stop_notify_leader.sql` and redeploy `send-push` edge function for iOS APNs this-device path to work in production.
