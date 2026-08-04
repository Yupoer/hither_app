# 02 — 把 60 秒群組完整同步合併為單一 Snapshot

**What to build:** 保留 Realtime 即時同步與每 60 秒 missed-event recovery，但讓一次保底更新只呼叫一個 server snapshot，而不是同時重抓多個群組 endpoint。

**Blocked by:** 01 — 建立啟動能耗觀測與 Instruments 基線。

**Status:** ready-for-agent

- [ ] 單一 snapshot 回傳目前群組畫面需要的 group、membership、profiles、subgroups、itinerary、locations 與版本資訊。
- [ ] Realtime 仍是一般前景主路徑，60 秒保底 cadence 不變。
- [ ] 同一個 recovery window 不再發出原本約七個獨立完整資料請求。
- [ ] snapshot 具有版本或 freshness marker，舊 response 不得覆蓋較新的 Realtime state。
- [ ] pending optimistic mutation 不會被 snapshot 暫時回覆的舊值覆寫。
- [ ] 強制重新整理仍立即執行，不需等待下一個 60 秒週期。
- [ ] before／after 證據記錄相同情境下的 request count、payload size、duration 與失敗恢復結果。
- [ ] server、client projection、Realtime race 與 optimistic merge 有端到端回歸測試。
