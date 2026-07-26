# 04 — Supabase advisor hot-path review

**What to build:** 將 45 個 performance advisor notices 轉成有 query evidence 的小型資料庫改善，優先處理真實 hot path，避免批次加索引或誤刪 unused index。

**Blocked by:** None — can start immediately

**Status:** evidence-only — inventory in Report; no speculative migrations

- [x] 盤點 unindexed foreign key 候選與既有 index（migration-based inventory；無 production row count）。
- [ ] 針對高價值候選執行 `EXPLAIN (ANALYZE, BUFFERS)` before/after；低 row count 或無 hot query 者先保留為 reviewed exception。
- [x] 重新檢查 unused index 策略：刪除前需 workload evidence 與 rollback（文件化，未刪）。
- [x] 合併 `live_activity_sessions` 與 `navigation_member_states` 的 multiple permissive policies 前，驗證 authenticated owner/non-owner 的 RLS 等價性 — **reviewed exception**, merge deferred。
- [ ] 每次只做一個可回滾 migration，並在 Supabase advisor、query latency、write latency、RLS contract 測試後再進下一個。
- [ ] Acceptance：每個變更都有 before/after plan；沒有 RLS regression；advisor 剩餘 notices 都有明確保留理由或已被驗證修正。

**Response:** See `Report/04-database-advisor-inventory.md`. Prefer evidence over shipping unmeasured indexes.
