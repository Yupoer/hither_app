# 03 — 全員自動完成＋未齊員手動完成提示

**What to build:** 全員抵達時自動完成集合點並對本機發 APNs／Android local notification、不跳確認；尚有人未抵達時手動「完成」才跳確認，文案為「已抵達成員（x/x），是否要完成此集合點？」，按鈕左右為「取消｜完成（紅色）」。

**Blocked by:** None — can start immediately.（與 02 可並行；若同一 PR 改 complete-after-arrival 流程，建議先合 02 或同 PR 一併驗收。）

**Status:** ready-for-agent

- [ ] `arrivedCount === totalCount` 時自動跑既有 complete-stop，不顯示完成詢問。
- [ ] 自動完成後本機收到通知（iOS APNs 或既有 push 路徑；Android local notification 可接受）。
- [ ] 已 `closedAt` 時不重複 complete／不重複通知。
- [ ] 有人未抵達且手動完成時，訊息為「已抵達成員（x/x），是否要完成此集合點？」。
- [ ] 確認動作為取消（dismiss）與完成（destructive／紅色），盡量左右擺放。
- [ ] 取消後集合點保持可再按「完成」；完成後走既有 complete RPC／刷新。
- [ ] 純函式／contract 覆蓋 auto vs manual 決策與新文案；舊 all-arrived 詢問文案不再出現。
