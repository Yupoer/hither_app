# Report: OTA-05 Code Review Fix

> Date: 2026-07-26  
> Status: **Code review P1 addressed** (pending re-review / migration deploy)  
> Source: `Code Review/2026-07-26-ota-05-code-review.md`  
> Prior implementation: `2026-07-25-ota-05-anonymous-access-implementation.md`

## 1. Summary

Fixed the P1 that blocked OTA-05: **14-day expiry only gated join/create**, so expired anonymous members could keep reading and mutating shared group data until optional cleanup ran.

Authorization now enforces expiry on the shared membership choke-point used by RLS and critical RPCs. Cleanup remains data hygiene only.

## 2. Findings → delivery

| Finding | Severity | Fix |
|---|---|---|
| Expiry did not block ongoing access for existing anonymous members | P1 | `extensions.is_member` requires `anonymous_access_is_active`; policies + key DEFINER RPCs updated |

## 3. Behavior

### `public.anonymous_access_is_active(uid)`

| Identity | Result |
|---|---|
| Registered / upgraded (non-anonymous) | Always active |
| Anonymous with `profiles.anonymous_expires_at > now()` | Active |
| Anonymous past expiry | Inactive |
| Anonymous with null stamp | Fallback: `min(memberships.created_at) + 14 days` (same rule as join/create/cleanup) |

### `extensions.is_member(gid)`

- Still requires a `memberships` row **and**
- `anonymous_access_is_active(auth.uid())`

Expired anonymous members therefore fail group / itinerary / memberships / location / navigation reads that go through `is_member`.

### Policy / RPC hardening

- Groups SELECT: `created_by` no longer bypasses expiry without active access.
- `member_locations` UPDATE: requires `is_member`, not only `user_id` match.
- `set_solo`, `self_split`, `self_merge`, `get_trip_entitlement` use `extensions.is_member`.
- `apply_core_operation` membership check uses `extensions.is_member` (also set in OTA-01/04 hardened migration `20260726000100`).

### Unchanged product rules

- 14-day stamp on anonymous access start
- 5-member anonymous leader gate (P0406)
- Registration upgrade clears expiry and preserves UID
- Cleanup remains idempotent optional hygiene

## 4. Files

| Path | Change |
|---|---|
| `supabase/migrations/20260726000000_anonymous_expiry_is_member.sql` | **New** — active helper + is_member + policies + RPC patches |
| `supabase/tests/anonymous_expiry_is_member.test.sql` | **New** — pgTAP (expired anon cannot read/mutate) |
| `apps/mobile/src/__tests__/anonymousAccessContract.test.ts` | Contract coverage for migration |

## 5. Verification

| Command | Result |
|---|---|
| `jest --testPathPattern=anonymousAccess` | Pass |
| `jest --testPathPattern=entitlementContract` | Pass (run during fix agent) |
| `npm run typecheck` (apps/mobile) | Pass |
| pgTAP SQL harness | In-repo; not run against live DB here |

## 6. Residual risks

1. Some SECURITY DEFINER RPCs may still auth via raw `memberships` lookups (coordination, gathering, location_refresh, etc.). Highest-impact shared paths covered; remaining routes should gradually switch to `extensions.is_member`.
2. Dynamic patch of older `apply_core_operation` in `20260726000000` is followed by full replace in `20260726000100` which already inlines `extensions.is_member`.
3. Deploy order: apply `20260726000000` before dependent migrations.

## 7. Re-review checklist

- [ ] Expired anonymous member SELECT on groups/itinerary → denied by RLS
- [ ] Expired anonymous mutation path using `is_member` → denied
- [ ] Registered / upgraded user past former anonymous stamp → still allowed
- [ ] Cleanup not required for authorization to take effect
