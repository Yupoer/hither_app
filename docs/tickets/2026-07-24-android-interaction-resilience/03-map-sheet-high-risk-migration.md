# 03 — 完成 Map／Sheet 高風險入口遷移

**What to build:**

讓 Map 與 Sheet 中的主要非同步操作具備一致的 single-flight、timeout、錯誤 recovery 與 late-result 防護，避免搜尋、目的地操作或 route action 重複提交後留下永久 loading 或錯誤狀態。

**Blocked by:** 01 — Action timeout、retry 與 stale-result 防護

**Status:** ready-for-agent

- [ ] 搜尋與提交操作可在 error／timeout 後 retry 或 cancel
- [ ] 目的地新增、刪除、重排與 route action 不會重複提交
- [ ] recenter、overlay close、sheet action 的副作用入口有明確 safe handler
- [ ] 失敗不清空既有資料或畫面狀態
- [ ] 相關主要入口納入 inventory 與 contract test

