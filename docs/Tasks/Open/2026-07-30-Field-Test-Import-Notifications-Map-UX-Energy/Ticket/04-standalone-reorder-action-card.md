# 04 — 將調整集合點順序改為獨立操作框

**What to build:** 路線區塊中的「調整集合點順序」成為獨立、可辨識的 framed action，不再與抵達管理、例外與協調、匯入及歷史等一般列表列混在同一區塊。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 「調整集合點順序」位於一般列表群組之外，具有獨立邊框、留白與完整可點擊區域。
- [ ] 沿用現有 glass、spacing、色彩與 Amicro 編輯動畫，不新增 UI 或動畫套件。
- [ ] 編輯動畫仍停在完成格直到路線編輯頁完全開啟，再回到起始狀態。
- [ ] destinations 為空、無編輯權限及不同 Dynamic Type 大小時，版面與操作語意仍正確。
- [ ] 按鈕具備清楚 accessibility label、button role、disabled state 與至少 44×44 的可點擊區域。
- [ ] 抵達管理、例外與協調、匯入及歷史的既有行為與順序不被改變。
- [ ] UI 行為測試驗證獨立操作框、動畫生命週期與開啟路線編輯頁的單次動作。
