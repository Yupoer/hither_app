# 02 — 安全 Token Wallet、Ledger 與 SSV 入帳

**What to build:** 讓已註冊使用者取得 server-authoritative token wallet，並讓每個有效、完成且通過 Google SSV 的 Rewarded Ad transaction 恰好增加 1 token；連續觀看不受每日或 24 小時上限限制。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] server 建立 user-scoped wallet、append-only ledger、短效 reward session 與固定商品 catalog，並以 migration／RLS 阻止 client 直接寫入。
- [ ] 已註冊使用者可取得商店 snapshot；匿名帳號不能建立 reward session，且只能讀取註冊需求結果。
- [ ] 每個帳號同一時間只能有一個 active reward session；完成、失敗或過期後可立即建立下一個，不存在每日、24 小時或累積次數限制。
- [ ] reward session 使用不透明 reference 與 platform/ad-unit 綁定，不把 Supabase access token 或 client 指定獎勵數量交給 Google。
- [ ] SSV callback 驗證 Google ECDSA signature、key ID、session、platform、allow-listed ad unit、`1 hither_token` reward 與 transaction ID。
- [ ] callback 只接受已核定的 iOS／Android Rewarded Ad Unit ID；未知 ad unit 或錯誤 reward 不入帳。
- [ ] Google transaction ID 具有唯一約束；同一 callback 重播或並行抵達只入帳一次，重試仍取得可接受結果。
- [ ] wallet balance 與 ledger credit 在同一資料庫交易內更新；任何驗證或寫入失敗都不產生半套入帳。
- [ ] 商店 snapshot 可在 callback 延遲、App 重開與跨裝置登入後收斂到正確餘額。
- [ ] diagnostics 只保存 allow-listed outcome 與 latency bucket，不記錄簽章、完整 query、raw session reference、token 或未雜湊個人資料。
- [ ] SQL／RPC／Edge Function tests 涵蓋有效 SSV、無效簽章、未知 key、錯誤 ad unit、錯誤 reward、session 過期、transaction 重播、並行 callback 與無觀看上限。
