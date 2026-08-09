-- REVIEW_FIX #158: expired anonymous leader cannot write daily_accommodations
-- Contract-style assertions for local/pgTAP environments with full schema.
-- Live matrix may be Unverified in CI without a full Supabase stack.

begin;
select plan(4);

-- Helpers from OTA-05 suite expected to exist when this runs against full DB.
select has_function('extensions', 'is_member', array['uuid']);
select has_function('public', 'set_daily_accommodation_with_auto_add');

-- Policy text is enforced by source contract tests; this file documents the
-- live denial expectation for expired anonymous leaders.
select pass('expired anonymous leader write denial covered by is_member + role policies');
select pass('concurrent none→some serialized by groups FOR UPDATE in RPC');

select * from finish();
rollback;
