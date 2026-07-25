# 02 — Paywall、兌換碼與權益恢復

**What to build:** 讓使用者在 Paywall 看到正確方案，能使用既有兌換碼入口解鎖授權，並在交易驗證或重新安裝後恢復 server-valid entitlement。

**Blocked by:** 01 — 建立正式方案權益與限制；BUILD-02 — 提供已驗證的 StoreKit／Play Billing 交易結果（僅付款購買路徑）

**Status:** done

- [x] Paywall 顯示 Free 與 Small Trip Pass 的限制、期限與目前 trip 適用性。
- [x] 兌換碼成功、已使用、過期、無效與不適用時顯示明確結果。
- [x] 兌換碼授權寫入同一套 server entitlement，不建立獨立 Early Access 狀態。
- [x] purchase、restore 與重新安裝後以 server entitlement 還原 UI。
- [x] 付款未完成或驗證失敗時不解鎖 Premium。
