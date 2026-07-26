I'll start by reading the mandatory implement skill, then the ADHD output skill and the code-review findings.Next: read Spec, Tickets, and the Codex review so I know every finding to fix.Reading the migration constraint, maps Edge Function, and reports for root-cause fixes.Implementing the two code fixes next: diagnostic event CHECK expansion and maps admin-key → `missing_config` 503.Writing the migration and the maps admin-key fix.Adding contract tests for the migration and admin-key handling.# Grok Implementation Report

## Summary

Fixed Codex review **FAIL** findings at root cause (no commit/push/OTA).

| Finding | Fix |
|--------|-----|
| **P1** schema rejects new diagnostic events | Migration expands `diagnostic_events.event` CHECK (4 review events + 3 already-emitted gaps) |
| **P2** missing admin key → HTTP 500 | `readSupabaseAdminKey()` returns `null`; handler responds `missing_config` 503 |
| **P1** device/EXPLAIN evidence | Still open (needs device/staging; not inventable in this worktree) |

**State:** code fixes done · tests green · remote migration + device gates still blocked

## Changed

1. `supabase/migrations/20260726000300_diagnostic_events_performance_stability.sql`  
   - Drop/re-add `diagnostic_events_event_check`  
   - Adds: `background_op_timeline`, `background_op_near_watchdog`, `metric_payload_classified`, `live_activity_token_register`  
   - Also: `previous_launch_incomplete`, `navigation_terminal_conflict`, `location_upload_discarded` (same rejection class)

2. `supabase/functions/google-maps/index.ts`  
   - Admin key: null on missing/malformed (no throw)  
   - `JSON.parse` try/catch  
   - Early `503 { error: "missing_config" }`

3. `apps/mobile/src/__tests__/diagnosticEventsAllowList.test.ts` (new)  
   - Migration exists + client-emitted events ⊆ CHECK

4. `apps/mobile/src/__tests__/googleMapsProxyCache.test.ts`  
   - Contract: admin key → `missing_config` 503, not throw/500

## Verification

```
npm test -- --testPathPattern="diagnosticEventsAllowList|googleMapsProxyCache|backgroundOpTiming|activityTokenService|apiErrorClassificationContract"
→ 5 suites / 41 tests passed

npm run typecheck
→ passed
```

Not run (out of scope / no access): live Supabase migration apply, staging controlled-503, release device, EXPLAIN/RLS.

## Remaining Risks

1. **Migration not applied remotely** — local SQL only; until applied, remote uploads still reject new events.  
2. **Edge Function not redeployed** — admin-key fix needs `supabase functions deploy google-maps`.  
3. **Review evidence gates still open** — device Realtime/watchdog, controlled 503, DB EXPLAIN (tickets 01–04).  
4. **Unnamed legacy CHECK name** — uses `diagnostic_events_event_check` (Postgres default); if production was renamed, `drop constraint if exists` is safe no-op and re-add may conflict (inspect `pg_constraint` if apply fails).

**Next (≤2 min):** apply migration to project `htqrucnjafhhvxdqslbv`, then redeploy `google-maps`.