# 08 — 以 CoverFlow 取代 Tab 並隔離橫向／縱向手勢

**What to build:** 讓使用者一次看見成員、路線、工具、商店四張疊層卡片，只用左右滑動切換並在每次跨格時收到震動；同時保證 CoverFlow 橫滑不移動 Bottom Sheet，Sheet 縱滑也不切換 Tab。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 成員、路線、工具、商店四張長方形卡片在 CoverFlow 區域同時可見，商店不再依賴先切到工具才被發現。
- [ ] 中央選取卡片位於最前方，其他卡片依相對距離減少露出範圍，並以既有陰影、位移與縮放呈現層級。
- [ ] 卡片寬度沿用目前 Tab target 尺度，CoverFlow 沒有外部框線、視覺箭頭或頁面圓點。
- [ ] 一般觸控操作只能在 CoverFlow 區域左右滑動切換，不以點擊卡片切換。
- [ ] 原本整個 Pane 的 raw touch swipe 判定不再與內容滾動競爭；CoverFlow 使用專屬橫向手勢。
- [ ] 橫向位移勝出時只由 CoverFlow 處理，Bottom Sheet 的高度、detent 與垂直位置不改變。
- [ ] 縱向位移勝出時只由 Bottom Sheet 處理，CoverFlow 的選取索引不改變。
- [ ] 斜向、快速反向、短距離與取消手勢會穩定吸附到唯一索引，不會同時觸發兩種結果。
- [ ] 每次跨越或吸附到新索引只觸發一次選擇震動；停留或回彈到原索引不重複震動。
- [ ] Tab 字體使用既有較大文字層級，動態字級與 Bold Text 下仍可辨識四個名稱與選取狀態。
- [ ] 讀屏將 CoverFlow 暴露為可調整控制，提供增加／減少操作切換相鄰索引，不增加視覺箭頭。
- [ ] Reduced Motion 開啟時降低透視與位移幅度，但仍清楚呈現選取項目與四個入口。
- [ ] 使用既有 Reanimated、Gesture Handler 與 Haptics，不新增 carousel 或手勢相依套件。
- [ ] 自動化手勢測試明確斷言橫滑不移動 Sheet、縱滑不切 Tab、一次索引一次震動及快速反向滑動後索引正確。
- [ ] iOS 與 Android 可用環境完成 Bottom Sheet／CoverFlow 整合互動檢查；無裝置證據時不宣稱原生手勢已通過。
