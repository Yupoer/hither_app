# Implementation Report: OTA-05 Anonymous Access

> Date: 2026-07-25  
> Status: **Code + contract/unit tests shipped**. Migration not applied to remote Supabase in this pass.  
> Audience: code reviewers

## Summary

Unified anonymous companion access to a **14-day** expiry shared by client messaging, server authorization, and scheduled cleanup. Anonymous Leaders may host up to **5 total members**; the **6th membership** is rejected until the Leader registers. Registration upgrade continues to use the same `auth.uid()` (email `updateUser` / Google·Apple `linkIdentity`) and clears `profiles.anonymous_expires_at` so cleanup never deletes an upgraded identity.

## Delivered

| Acceptance | Implementation |
|---|---|
| Shared 14-day expiry | `anonymousAccess.ts` constants; `profiles.anonymous_expires_at`; join trigger stamps `now()+14 days` |
| Anon create/join up to 5 | Membership insert allowed while count &lt; 5 for anonymous Leaders |
| 6th-member gate | `join_group` + BEFORE INSERT trigger raise `P0406`; Map invite UI blocks share/copy and prompts registration |
| Upgrade preserves UID/data | Existing `updateUser` / `linkIdentity` paths; clear expiry on upgrade; cleanup re-checks `is_anonymous` |
| Idempotent cleanup | `cleanup_expired_anonymous_accounts()` with per-row exception handling + final `is_anonymous` guard; optional daily cron |

## Primary files

- `supabase/migrations/20260725000000_anonymous_access_expiry_and_gate.sql`
- `supabase/migrations/20260725010000_anonymous_access_hardening.sql` (final `join_group` after paid_entitlement; write-lock; cleanup fallback)
- `apps/mobile/src/anonymousAccess.ts`
- `apps/mobile/src/api/services/GroupService.ts`
- `apps/mobile/src/state/useAuthFlow.ts`, `SessionContext.tsx`
- `apps/mobile/src/i18n/index.ts`, `AccountSheet.tsx`, `MapScreen.tsx`, `AuthScreen.tsx`, `LoginScreen.tsx`
- `docs/PRODUCT.md` (14-day anonymous lifecycle)
- Tests: `anonymousAccess.test.ts`, `anonymousAccessContract.test.ts`, `client.test.ts` (join + create error mapping)

## Post-review hardening

- Client cannot mutate `anonymous_expires_at` (BEFORE **INSERT OR** UPDATE trigger + GUC; INSERT forces NULL).
- Upgrade clears expiry only via `clear_anonymous_expiry_if_registered` when non-anonymous.
- Final `join_group` order: P0401 → P0406 → Free Plan P0003 → stamp.
- AuthScreen/AccountSheet re-hydrate expiry after join / on open.
- **Atomic `create_group` RPC** (no orphan groups under leader-only delete RLS); `delete_orphan_group` fallback.

## Tests run

```
npx jest --testPathPattern="anonymousAccess|anonymousSignOut|client\.test"
→ 4 suites, 85 tests passed
```

## Follow-ups

- Apply migrations to staging/production Supabase (including hardening `25010000`).
- Confirm pg_cron job `hither-cleanup-expired-anonymous` is present on the project (or schedule externally).
- Free Plan total member cap is OTA-08 (`FREE_LIMITS.groupMembers` = 5 client-side); this task adds the anonymous Leader registration gate (`P0406`) before Free Plan `member_limit`.
