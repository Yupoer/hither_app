# 01 — 統一匿名期限與大型旅程註冊門檻

**What to build:** 讓匿名同行者以 14 天為一致有效期限，並在匿名 Leader 嘗試讓旅團增加到第 6 人前要求註冊，同時保留升級前的身份與旅團資料。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

Acceptance criteria:
- [x] 所有匿名 UI、授權與 cleanup 使用同一個 14 天 expiry。
- [x] 匿名使用者可建立／加入最多 5 人旅團（含 Leader）。
- [x] 第 6 人加入前，匿名 Leader 收到註冊要求且 server 拒絕未註冊 mutation。
- [x] 註冊升級保留 UID、membership、trip data 與有效 entitlement reference。
- [x] expiry cleanup 可重試且具 idempotency。
