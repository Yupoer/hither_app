Verdict: FAIL

# Supabase Performance Stability first code review

## Findings

- **P1 — diagnostic event schema rejects newly emitted performance events.** `supabase/migrations/20260716214247_team_navigation_sessions.sql:151-162` omits `background_op_timeline`, `background_op_near_watchdog`, `metric_payload_classified`, and `live_activity_token_register`, although the mobile code emits them. Remote diagnostic uploads therefore reject the telemetry required by Tickets 02/05.
- **P1 — required closure evidence is absent.** The task reports still mark release-like device background validation, controlled 503 validation, representative EXPLAIN/RLS validation, and symbolication/profiling as pending. These are explicit spec gates, not optional follow-up checks.
- **P2 — missing admin key can escape as HTTP 500.** `supabase/functions/google-maps/index.ts:12-20,78` parses/throws `readSupabaseAdminKey()` before the existing `missing_config` 503 handling.

## Verification

Relevant Jest suites: 11 suites / 201 tests passed. Typecheck passed. No live Supabase EXPLAIN, staging 503, or release-like device evidence was available in this worktree.

## Required fix / gate

Add the missing diagnostic event values and classify missing/malformed admin configuration as `missing_config` 503. Then complete the device, controlled-503, and DB EXPLAIN/RLS acceptance evidence before a PASS or merge.

