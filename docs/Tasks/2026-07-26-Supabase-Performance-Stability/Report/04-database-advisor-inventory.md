# Ticket 04 — Supabase performance advisor hot-path inventory

**Status:** evidence + plan only. **No migrations applied** in this implementer run (no production row counts / EXPLAIN available from agent environment).

Spec: 45 advisor notices — unindexed FKs, unused indexes, multiple permissive policies on `live_activity_sessions` / `navigation_member_states`. Do **not** batch-apply indexes.

## Multiple permissive policies (reviewed)

### `live_activity_sessions`

From `20260713190000_production_push_live_activity.sql`:

| Policy | Command | Predicate |
|--------|---------|-----------|
| `live_activity_sessions: select own` | SELECT | `user_id = auth.uid()` |
| `live_activity_sessions: write own` | ALL | using own user; with check own user **and** `is_member(group_id)` |

**Analysis:** Overlap is SELECT: both `select own` and `write own` (FOR ALL) can apply for SELECT. Semantics remain “own rows only”; write path is stricter on membership.

**Recommendation:** Keep as **reviewed exception** until RLS equivalence tests exist. Candidate merge (future, one migration):

- Keep SELECT policy as-is
- Change write policy to `FOR INSERT, UPDATE, DELETE` only (not ALL) so SELECT is single-policy

Do **not** merge without authenticated owner/non-owner contract tests.

### `navigation_member_states`

Policies:

| Policy | Command |
|--------|---------|
| `group members read` | SELECT (group membership via session) |
| `own insert` | INSERT |
| `own update` | UPDATE (own user_id) |
| `leaders update` | UPDATE (leader of session’s group) |

**Analysis:** Multiple permissive policies on UPDATE are intentional: member may update own state; leader may update members (shared progress / missed). Merging would require OR of predicates in one policy — equivalent but higher risk.

**Recommendation:** **Reviewed exception** — do not merge without proving leader-only transitions still work under invoker security.

## Unindexed FK candidates (priority classes)

Derived from migration FKs (not live advisor dump). Prioritize only if hot path + cardinality evidence.

### High interest (navigation / map hot path)

| Table.column | Likely queries | Suggested next step |
|--------------|----------------|---------------------|
| `navigation_sessions.group_id` | list active sessions by group | `EXPLAIN` on MapScreen session fetch |
| `navigation_sessions.destination_id` | close destination / join itinerary | EXPLAIN complete/close RPCs |
| `navigation_member_states.navigation_session_id` | seed/read member states | **Already** common path — check existing indexes |
| `navigation_member_states.user_id` | **Indexed** (`navigation_member_states_user_id`) | OK |
| `member_locations.navigation_session_id` | **Partial index exists** | OK |
| `live_activity_sessions.group_id` | **Indexed** `idx_live_activity_sessions_group_id` | OK |
| `live_activity_sessions.destination_id` | **Indexed** | OK |
| `destination_arrivals.group_id` / `destination_id` / `user_id` | Realtime filter `group_id=eq` | Confirm indexes; high read via Realtime |
| `location_upload_events.group_id` | outbox history | Low if append-only rare reads |
| `diagnostic_events.diagnostic_session_id` | batch upload | Write-heavy; index only if delete/cascade slow |

### Medium / low (membership graph, invites)

- `memberships.group_id`, `memberships.user_id` — usually already covered by PK/unique
- `subgroup_invites.*` — low write rate
- `activity_feedback`, `visited_waypoints` — non-nav
- `itinerary_items.closed_by_session_id` — rare FK lookups

### Process for each candidate (required before migration)

1. `select relname, n_live_tup from pg_stat_user_tables where relname = '…'`
2. Capture write rate from `pg_stat_user_tables` / app metrics
3. `EXPLAIN (ANALYZE, BUFFERS)` for the exact app SQL / RPC
4. One reversible migration: `create index concurrently if not exists …`
5. Re-run advisor + EXPLAIN; keep rollback SQL

## Unused index notices

**Do not drop** from a single snapshot. Re-check after representative navigation + map workload. Prefer leaving unused indexes as debt over write-path regressions.

## Recommended migration sequence (future)

1. Confirm `destination_arrivals(group_id)` index if Realtime filter seq-scans (EXPLAIN evidence)
2. Confirm `navigation_sessions(group_id, status)` composite if active-session lookup is hot
3. Optional RLS policy shape fix for `live_activity_sessions` write (FOR ALL → FOR INSERT,UPDATE, DELETE)
4. Never batch 26 FK indexes in one PR

## Acceptance residual

- [ ] Each shipped index has before/after plan
- [ ] RLS owner/non-owner tests for any policy change
- [ ] Remaining advisor notices listed as reviewed exceptions with owners
