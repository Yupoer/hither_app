-- OTA-08 paid entitlement SQL contract notes (pgTAP-oriented).
-- Documents the isolation / revoke / eligibility invariants enforced by
-- 20260725000100_paid_entitlement.sql. Run with a Supabase SQL test harness
-- when available; until then, client migration contract tests assert the DDL.

-- plan: trip isolation
-- 1. group_has_active_premium(G1) true after small_trip_pass on G1
-- 2. group_has_active_premium(G2) false for same leader without G2 row
-- 3. profiles.pro is NOT written for small_trip_pass
-- 4. profile_has_lifetime_premium only when pro and pro_expires_at is null

-- plan: eligibility
-- 5. apply_verified_purchase rejects member_count < 2 or > 5
-- 6. redeem small_trip_pass same

-- plan: concurrency
-- 7. join_group locks groups row for update before count
-- 8. itinerary trigger locks groups row for update before count

-- plan: revoke / refund / duplicate
-- 9. revoke_trip_entitlement(..., 'refunded') → status refunded
-- 10. duplicate transaction_id → error duplicate
-- 11. apply_verified_purchase not executable by authenticated

select 'paid_entitlement contract documented' as note;
