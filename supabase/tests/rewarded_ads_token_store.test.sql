-- Rewarded Ads Token Store SQL contract notes (pgTAP-oriented).
-- Documents wallet / SSV credit / redeem / point-limit invariants enforced by
-- 20260730120000_rewarded_ads_token_store.sql.

-- plan: rls
-- 1. authenticated cannot insert/update token_wallets
-- 2. authenticated cannot insert token_ledger / reward_sessions / credits / user_entitlements
-- 3. authenticated can select own wallet and member trip credits

-- plan: reward session
-- 4. create_reward_session rejects anonymous
-- 5. second active session while first active → session_active
-- 6. after expire/credit, next create succeeds (no daily cap)
-- 7. session_ref is opaque (not JWT)

-- plan: ssv credit
-- 8. credit_rewarded_ad_transaction service_role only
-- 9. valid session + allow-listed ad unit + 1 hither_token → balance +1 once
-- 10. replay same google transaction_id → already_credited, balance unchanged
-- 11. bad ad unit / wrong reward / expired session → no credit

-- plan: redeem premium
-- 12. team_premium_1d/3d/7d debit + trip entitlement token_redemption
-- 13. stack extends expires_at when active token pass
-- 14. purchase/promo/lifetime active → not_applicable, no debit
-- 15. member_count outside 2–5 → not_applicable

-- plan: extra points
-- 16. redeem team_extra_points_3/10 increases trip_extra_point_credits
-- 17. open points < 5 insert free; open >=5 + credit consumes 1; open >=5 + 0 credit → P0004
-- 18. complete/delete frees free slots but never refunds credits
-- 19. temporary unlimited override superseded by credit-aware enforce

-- plan: live activity
-- 20. personal_live_activity_lifetime personal grant
-- 21. effective = personal OR group premium
-- 22. no auto-grandfather

select 'rewarded_ads_token_store contract documented' as note;
