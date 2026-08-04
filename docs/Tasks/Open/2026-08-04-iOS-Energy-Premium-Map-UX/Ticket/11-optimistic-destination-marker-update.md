# 11 — 讓集合點 Marker 真正樂觀更新

**What to build:** 使用者確認 Emoji／marker color 後立即更新地圖，後端保存成功時平滑收斂，失敗時只回復該次修改並顯示可重試錯誤。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 確認 Emoji／color 後先保存 previous value、立即 patch optimistic destination 並關閉選擇器，不等待 network response。
- [ ] 地圖 marker、集合點列與相關可見投影使用同一份 optimistic state。
- [ ] 保存成功後以 server response／Realtime 合併，不閃回舊 marker。
- [ ] 保存失敗時回復該 mutation 的 previous value，並顯示共享 recovery UI。
- [ ] 較舊失敗 response 不得回復使用者之後已完成的新 mutation。
- [ ] 關閉外層 overlay 或按右上角完成不是 marker commit 條件。
- [ ] 本 ticket 不新增離線 outbox，失敗採已核准的 rollback 行為。
- [ ] success、failure、out-of-order、快速連續修改與 Realtime race 有行為測試。

