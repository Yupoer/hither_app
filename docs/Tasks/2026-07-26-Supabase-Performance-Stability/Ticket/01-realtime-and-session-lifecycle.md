# 01 — Realtime 與 navigation session lifecycle 穩定化

**What to build:** 讓 MapScreen 的 gathering workflow Realtime channel 在每個 effect instance 使用唯一 topic，並讓 background journey / energy monitor 只在 session identity 改變時重啟。

**Blocked by:** None — can start immediately

**Status:** partial — code re-verified 2026-07-26; release-like device verification pending

- [x] workflow channel 加入 instance sequence，避免 `subscribe()` 後重複註冊 callback。
- [x] background journey 改用 stable `navigationSessionId` / `hasNavigationSession` dependency。
- [x] energy monitor 改用 stable session scalar，不因 session version/object 更新重啟。
- [x] 保留既有 cleanup、single-flight、pending rerun 與 2.5 秒 reload throttle。
- [x] 3 個關鍵 Jest suites 通過，共 22 tests；TypeScript typecheck 通過。
- [ ] 在 group enter、group switch、background return、effect remount 實機確認每次只有一個 active subscription。
- [ ] 確認同一 navigation session 的 version 更新不產生額外 energy `end` event 或 background controller restart。
