# 02 — 統一本機、Realtime 與遠端通知政策

**What to build:** 同一個事件不論透過本機操作回饋、Realtime fallback 或 APNs／FCM 傳送，都使用一致的角色、scope、sender、偏好與去重規則；開始行程成功後，操作者自己的裝置會得到一次本機確認。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 建立可測試的通知政策矩陣，輸入事件、sender、成員角色、主隊／小隊／solo scope 與通知偏好，輸出唯一 recipient set 與 delivery kind。
- [ ] 開始行程成功後由執行操作的 client 產生一次操作者本機確認，不依賴資料庫 update payload 推斷 sender。
- [ ] 快捷指令、一般例外與協調通知排除 sender，並只送達正確主隊／小隊 scope；solo 成員依既有產品規則保持靜音。
- [ ] 成員提出的路線要求只通知該 group 的有效隊長。
- [ ] 本機 Realtime fallback 與遠端推播同時可用時，以穩定 event identity 去重，不因存在 push token 就直接捨棄 fallback。
- [ ] 通知偏好仍由 server authoritative 過濾；操作者本機成功確認不被一般 sender 排除規則誤擋。
- [ ] 測試涵蓋隊長／成員、主隊／小隊、solo、sender、有／無 push token、Realtime 與遠端同時可用及事件重播。
- [ ] 不因統一政策而移除現有 Realtime fallback；遠端 killed-app delivery 保持可用。
