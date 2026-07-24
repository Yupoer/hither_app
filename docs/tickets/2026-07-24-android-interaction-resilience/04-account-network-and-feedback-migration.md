# 04 — 完成帳務、feedback 與診斷操作遷移

**What to build:**

讓登入、升級、兌換、feedback 與診斷上傳等網路操作在失敗、逾時、離開畫面或重新登入後仍能安全恢復，不會以晚到結果覆蓋新 session 或新 screen。

**Blocked by:** 01 — Action timeout、retry 與 stale-result 防護

**Status:** ready-for-agent

- [ ] Login、升級與兌換操作具備 timeout、error recovery 與 retry／cancel
- [ ] feedback 與診斷上傳不會永久 loading
- [ ] screen unmount 或 session 改變後，晚到結果不更新舊畫面
- [ ] 錯誤 telemetry 不包含 token、使用者資料、座標或 raw stack
- [ ] 主要入口納入 inventory 與 contract test

