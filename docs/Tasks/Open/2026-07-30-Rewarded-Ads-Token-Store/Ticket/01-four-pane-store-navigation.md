# 01 — 四分頁商店入口與滑動操作

**What to build:** 讓地圖 Bottom Sheet 以「成員、路線、工具、商店」四個區塊運作；使用者可點擊分頁或左右滑動內容切換，一次只顯示三個分頁標籤，且不破壞既有垂直拖曳、內容捲動或路線排序。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 分頁順序固定為成員、路線、工具、商店，所有入口共用同一 selected-pane state。
- [ ] 分頁 viewport 一次只顯示三個等寬項目；使用者可滑動分頁列露出並點擊原本隱藏的商店。
- [ ] 點擊 viewport 外的分頁或內容 swipe 切到該頁時，選中標籤會自動捲動到完整可見。
- [ ] 內容可左右 swipe 前後切頁，第一頁與第四頁不循環也不超出範圍。
- [ ] 水平手勢不接管主要垂直移動，不影響 Bottom Sheet 展開／收合及內容垂直捲動。
- [ ] 路線拖曳排序進行中不觸發水平切頁，原有排序與編輯結果保持不變。
- [ ] 商店頁先提供 balance、廣告 CTA 與商品區塊的 loading／empty shell，後續 tickets 可直接接入資料。
- [ ] 分頁、選中狀態與商店 shell 具備 accessibility role／state，並通過既有 Dynamic Type、Bold Text 與 reduced-motion UI contract。
- [ ] focused UI tests 驗證點擊、swipe、三格 viewport、自動捲動、邊界與手勢衝突；TypeScript typecheck 通過。
