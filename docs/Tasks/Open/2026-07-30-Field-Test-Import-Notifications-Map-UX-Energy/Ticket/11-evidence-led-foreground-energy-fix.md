# 11 — 修正實證確認的前景耗能主因

**What to build:** 根據 Ticket 08 的最高耗能證據，修正真正造成原地前景發熱的定位 owner、地圖／路線更新、React render、Realtime callback 或其他單一主要路徑，並證明不破壞地圖與協調即時性。

**Blocked by:** 08 — 建立原地發熱的可比較效能基線.

**Status:** ready-for-agent

- [ ] 開始修改前記錄 Ticket 08 指向的主要 owner、呼叫頻率、CPU／frame／thermal 影響與所有共享 callers。
- [ ] 修正位於所有相關 callers 共用的最低正確 seam，不在每個畫面加入重複 guard。
- [ ] 若主因是定位，維持單一前景定位 owner、系統 blue dot 與 accuracy-aware arrival，不全面關閉定位。
- [ ] 若主因是地圖／路線，只在座標或時間 gate 成立時重算，不因一般 parent render 重建 route 或 marker。
- [ ] 若主因是 React render／Realtime，合併等價事件並穩定 shared state，不以全畫面 memoization 掩蓋不必要狀態更新。
- [ ] 若 Ticket 08 證明前景 UI／定位不是主要來源，本票不得進行 speculative refactor；改為記錄不需修改的證據與真正 owner。
- [ ] 最小回歸測試會在被移除 guard 或節流時失敗，並涵蓋相關生命週期與明確操作立即更新。
- [ ] 使用 Ticket 08 相同 build 類型與情境重測，證明 CPU／thermal／frame 指標改善且 30 秒至 1 分鐘被動同步沒有退化。
- [ ] 無實機 thermal 與 frame evidence 時不得宣稱已解決手機發熱。
