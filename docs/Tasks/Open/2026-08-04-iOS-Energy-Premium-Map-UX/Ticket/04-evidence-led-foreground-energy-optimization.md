# 04 — 依實機證據處理剩餘前景熱源

**What to build:** 在移除已知 request burst 後，以固定 Instruments A/B 找出仍然主導耗電或記憶體成長的前景 owner，並只修正被證據指向的最高成本共享接縫。

**Blocked by:** 02 — 把 60 秒群組完整同步合併為單一 Snapshot；03 — 將協調請求 Deadline 移到伺服器。

**Status:** ready-for-agent

- [ ] 在可用的 release-like iOS 實機環境執行已核准的 A/B protocol，保存去識別化 Instruments trace 與條件表。
- [ ] 報告分開列出 CPU stack、GPU／MapKit、Core Location、network wakeup、render hitch 與 allocation／VM 結果。
- [ ] 約 500–700 MB footprint 被區分為穩定 MapKit cache、可回收資源或持續成長的 allocation owner，不直接以單次數值宣稱 leak。
- [ ] 若最高成本 owner 是定位、MapScreen render、route recalculation、marker bitmap tracking 或其他共享接縫，修正在該共享接縫完成，不散佈 per-screen guard。
- [ ] 若沒有足夠實機證據，不進行推測性 memoization、關閉定位、移除 marker 動畫或降低必要同步；報告標示 Unverified。
- [ ] 修正後以同裝置、同 build 類型與同條件重跑 before／after。
- [ ] 自動化測試防止修正破壞 Realtime 即時、60 秒保底、30／60 秒被動定位 cadence 與明確操作立即性。
