# Ticket 05 — Live Activity token idempotency

## Constraints (schema)

From `20260716214247_team_navigation_sessions.sql`:

- PK: `(user_id, device_id)`
- Unique partial index on `push_to_start_token` where not null (global)
- RLS: own rows only

## Client upsert

- `onConflict: 'user_id,device_id'` (unchanged intentional target)
- 23505 on PK / non-token unique → `benign_idempotent` (soft return)
- 23505 on token unique:
  1. SELECT rows with that token
  2. Own other devices → clear (check update errors) then re-upsert → `reclaimed_own_token`
  3. Foreign ownership → `foreign_token_conflict`
  4. Empty select (RLS-hidden foreign or race) → `token_unique_unresolved`
  5. Clear-update failure → `unknown_error` (no pretend reclaim)

## Expected outcomes

| Scenario | Result |
|----------|--------|
| Same user/device re-register same token | upserted / no error |
| Token rotation on same device | upserted |
| Same user, new device_id, same token | reclaimed_own_token |
| Other user holds token | foreign_token_conflict |
| Token unique, no visible owners (RLS) | token_unique_unresolved |
| Reclaim clear fails | unknown_error |

## Observability

- Call sites record non-quiet results as diagnostics `live_activity_token_register` with `errorCode`/`reason` = result enum only (never the token)
- Quiet `upserted` / `benign_idempotent` skip diagnostics noise

## Privacy

- Tokens never logged in diagnostics
- `traceApi` still owns residual API 23505 telemetry without raw token values

## Tests

`activityTokenService.test.ts` — 8 cases: reclaim, foreign, unresolved, clear-fail.
