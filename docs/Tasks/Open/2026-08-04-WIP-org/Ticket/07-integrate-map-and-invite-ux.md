# 07 — 整合 Map 路線、Marker 與邀請 UX WIP

**What to build:** 保留完整道路幾何並依畫面縮放派生 route LOD，同時完成 Map chrome、集合點 marker optimistic update 與邀請按鈕在不同尺寸下的可靠版面。

**Blocked by:** 02 — 將已提交 Premium／Map 修正重播到最新 master。

**Status:** ready-for-agent

- [ ] Native map boundary 統一 provider 與平台 props，UI 不分散新增平台判斷。
- [ ] Provider raw geometry 保持 immutable；display projection 依 settled viewport 的 screen-space tolerance 連續派生。
- [ ] 縮近可恢復完整幾何，U-turn、roundabout 與 maneuver anchors 不被錯誤簡化。
- [ ] Apple Maps Logo 固定在 map 底部基準，compass 位於 safe area 且不被收合卡片遮擋。
- [ ] Emoji／marker color 確認後立即投影；成功只提交對應 mutation，失敗只 rollback 對應舊值，較舊 response 不覆蓋較新選擇。
- [ ] Share／Copy 按鈕具合理 icon inset，文字以整顆按鈕幾何中心置中，覆蓋中英文、動態字級、iPhone 與 iPad。
- [ ] 純函式、state harness 與 layout tests 通過；MapKit／Google Maps 真實 callback、路線視覺與 native layout 未實測時標成 Unverified。
- [ ] Map／UX 相關 tracked／untracked WIP 全部在清冊中有落點或明確排除。
