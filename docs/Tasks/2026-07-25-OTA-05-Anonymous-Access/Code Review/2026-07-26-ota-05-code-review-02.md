Verdict: FAIL

# OTA-05 second code review

## Finding

- **P1 — anonymous expiry is not a server-wide authorization rule.** `supabase/migrations/20260726000000_anonymous_expiry_is_member.sql` updates selected `extensions.is_member` paths, but the SECURITY DEFINER RPCs still authorize through raw `public.memberships`: `20260725090000_coordination_requests.sql:694-700,842-849,1005-1010` and `20260715133351_location_refresh.sql:26-32`. An expired anonymous member can still create/override/cancel coordination requests or request a group location refresh.

## Verification

Focused relevant Jest suites passed and typecheck passed, but the SQL authorization gap is material and is not covered by the existing contract tests.

## Required fix

Route every shared-group SECURITY DEFINER read/mutation guard through the expiry-aware authorization helper, add SQL contract coverage for coordination and location refresh, then rerun the Supabase contract tests. Do not close OTA-05 while this remains a known residual.

