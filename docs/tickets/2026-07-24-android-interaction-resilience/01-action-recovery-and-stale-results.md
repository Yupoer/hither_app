# 01 — Action timeout、retry 與 stale-result 防護

**What to build:**

讓 Auth、leave group、sign-out 等高風險操作在失敗或逾時後停留於可恢復畫面，使用者可以 retry 或 cancel；底層晚到的結果不得改變 membership、session 或 navigation。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] timeout 與 error 都顯示可操作的 recovery，不只 dismiss
- [ ] Auth、leave group、sign-out 在每個 await 邊界檢查 action token
- [ ] late result 不會觸發過期 screen 的 state、membership 或 navigation 更新
- [ ] 保留 single-flight、busy cleanup 與 sanitized telemetry

