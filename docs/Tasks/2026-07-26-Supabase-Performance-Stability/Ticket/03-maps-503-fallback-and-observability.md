# 03 — Maps 503 fallback 與 bounded recovery

**What to build:** 將 Google Maps proxy 的 503 分成 quota/configuration/upstream/network 類型，維持 fallback route 可用，並讓使用者 retry 不會造成無限重試或重複扣 quota。

**Blocked by:** None — can start immediately

**Status:** partial — code complete; staging/device controlled 503 pending

- [x] 為 Edge Function 503 建立明確 error class / diagnostic fields：quota RPC、missing config/API key、Google upstream status、timeout/network。
- [x] 保留既有 in-flight sharing 與成功 TTL；同一路線的 concurrent request 只能共用一個 upstream attempt。
- [x] fallback route 在 upstream 503 時仍可完成 map rendering，並顯示可理解的 degraded state（getDirections → null → haversine/估算）。
- [x] 若需要 user retry，限制為 bounded retry/cooldown，且不對已知 quota failure 自動重試。
- [ ] 以 controlled 503 測試 fallback、retry、dedupe、telemetry；Acceptance：單次 upstream failure 不導致 blank map、React boundary 或無限 request。

**Response:** Edge + client classify `quota_rpc_failed` / `missing_config` / `upstream_unavailable` / `network` / `quota_exceeded`; failure cooldown map; Jest contracts green.
