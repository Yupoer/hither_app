Verdict: FAIL

# Supabase Performance Stability first review — repair round 2

## Resolved in worktree

- `20260726000300_diagnostic_events_performance_stability.sql` now allows the performance/stability events emitted by mobile, plus the three existing emitted diagnostic events that were also absent from the original CHECK.
- `supabase/functions/google-maps/index.ts` now converts missing or malformed admin-key configuration into `503 { error: "missing_config" }`.

## Remaining closure blockers

- **P1 — release-like device evidence is still absent.** Realtime lifecycle, iOS background watchdog/MetricKit, and symbolication/profiling acceptance has not been executed on a device/release-like build.
- **P1 — controlled staging 503 evidence is still absent.** The maps fallback/retry/dedupe/telemetry path has only contract coverage, not the required controlled failure run.
- **P1 — database evidence is still absent.** The spec requires representative before/after EXPLAIN and RLS owner/non-owner checks for each migration; no live Supabase evidence is present.

## Verification

The code repair report records 5 suites / 41 tests and typecheck passed. The remaining findings require external device, staging, and Supabase project access; they cannot be proven by local source tests. Keep this task open and do not merge or release until those gates are attached.

