Reading the code review and task Spec/Ticket docs next, then fixing findings at root cause.Root cause is clear: coordination/location DEFINER RPCs still bypass expiry-aware `is_member`. Inspecting those migrations and existing tests.Scanning for other DEFINER RPCs that still use raw memberships, and reading full function bodies to patch.Reading full function bodies for the migration replace.Creating the migration and updating tests.# Grok Implementation Report

## Summary

Fixed the **P1** from `2026-07-26-ota-05-code-review-02.md`: coordination and location-refresh SECURITY DEFINER RPCs authorized on raw `public.memberships` rows, so an **expired anonymous** member could still create/override/cancel/respond to coordination and request group location refresh.

New migration `20260726000200_anonymous_expiry_definer_rpcs.sql` routes those guards through **`extensions.is_member`** / **`anonymous_access_is_active`**. SQL + Jest contract coverage extended for those paths.

**Do not commit** (per task mode). ~15 min for deploy + re-review.

## Changed

| Path | Change |
|---|---|
| `supabase/migrations/20260726000200_anonymous_expiry_definer_rpcs.sql` | **New** — patch create/override/cancel/respond/resolve coordination + `request_group_location_refresh`; eligibility helper also requires active access |
| `supabase/tests/anonymous_expiry_is_member.test.sql` | +6 deny cases (location refresh, respond, create/cancel/override for expired anon leader) |
| `apps/mobile/src/__tests__/anonymousAccessContract.test.ts` | Contract asserts migration order + DEFINER guards + SQL test strings |

**Auth pattern (leader mutations):**
```sql
if not extensions.is_member(group_id)
   or not exists (… role = 'leader' …) then
  raise exception 'leader membership required' …;
end if;
```

**Auth pattern (member mutations):**
```sql
if not extensions.is_member(p_group_id) then
  raise exception '…' …;
end if;
```

## Verification

| Check | Result |
|---|---|
| `jest --testPathPattern=anonymousAccess` | **Pass** (42 tests) |
| `npm run typecheck` (apps/mobile) | **Pass** |
| pgTAP SQL harness against live DB | **Not run here** (in-repo only) |

## Remaining Risks

1. **Other DEFINER RPCs** (gathering, navigation, straggler, etc.) may still use raw `memberships` for authz. OTA-05 review gap for coordination + location refresh is closed; residual paths are separate hardening.
2. Migration **must be applied** to Supabase before production enforces the fix.
3. Full pgTAP suite not executed against a live DB in this session.

**Next:** apply `20260726000200_anonymous_expiry_definer_rpcs.sql`, then re-run code review.