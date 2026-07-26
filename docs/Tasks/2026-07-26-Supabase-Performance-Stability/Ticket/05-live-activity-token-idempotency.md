# 05 — Live Activity token conflict 降噪

**What to build:** 釐清 `device_live_activity_tokens` 的唯一約束與目前 upsert conflict target，讓同一 device/token 的註冊在 app restart 或 session refresh 時保持 idempotent，而不是產生可避免的 409。

**Blocked by:** None — can start immediately

**Status:** partial — code complete; release-like device validation pending

- [x] 查清 token、user/device pair 的 unique constraints 與目前 client upsert conflict target。
- [x] 對同一 token 重複 register、token rotation、同 device 多 user、sign-out/reinstall 分別定義預期結果。
- [x] 修正 conflict handling 或 migration，保留 user-scoped RLS 與 token 不落入 diagnostics payload 的限制。
- [x] 將 currently duplicate_key/409 註冊事件分成 benign idempotent retry 與真正 conflict，避免把正常 refresh 當成 crash signal。
- [x] Acceptance（unit）：合法重複註冊不再 throw；真正 foreign unique conflict 不覆寫其他 user 的 token。

**Response:** `upsertDeviceActivityToken` returns classified results; reclaim own-device tokens; foreign conflict soft-fail. Jest 6/6.
