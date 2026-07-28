# 01 — 建立 7/28 外出實測證據與後端外送清單

**What to build:** 針對 2026-07-28 09:00–13:00 台北時間建立可追溯的 crash/performance 報告，並列出所有會向後端寫入的主動與被動動作、頻率、批次、重試及喚醒成本，作為後續修正依據。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 使用 01:00–05:00 UTC 查詢並關聯 performance、diagnostic、MetricKit/native termination、update/runtime/build、screen/action、thermal、CPU、memory、frame stall 與 background timeline。
- [ ] 分開判定 intentional OTA reload、JS error、native signal、watchdog 與記憶體壓力，不把離開 App 一律視為 crash。
- [ ] 外送清單涵蓋 table/function、觸發條件、前景/背景、最小/heartbeat 頻率、batch、retry/backoff、GPS/radio 喚醒與資料類型。
- [ ] 報告指出最可能根因、反證、缺失證據與可量測修正門檻，不以猜測直接調低所有頻率。
- [ ] 報告不得包含精確座標、token 或未雜湊的個人識別資料。
