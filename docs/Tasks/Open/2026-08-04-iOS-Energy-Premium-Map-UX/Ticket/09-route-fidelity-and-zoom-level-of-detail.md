# 09 — 恢復道路完整幾何與縮放細節融合

**What to build:** 近距離路線完整沿著道路、圓環與 U-turn，縮遠時才依可視尺度平滑降低細節，且任何顯示簡化都不破壞 provider 原始 geometry 或導航計算。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] iOS MapKit 完整 route geometry 不再被固定 10 公尺 tolerance 無條件簡化。
- [ ] provider 原始 geometry 保持 immutable，距離、ETA、導航與重新縮近都使用或能恢復完整資料。
- [ ] 近距 fixture 中的圓環、U-turn、大彎道與道路凹角不被 chord 切穿。
- [ ] 遠距顯示從原始 geometry 依 viewport／zoom 的 screen-space tolerance 派生，細節隨縮放連續變化。
- [ ] 縮遠後點數可下降，縮回近距後與原始 geometry 一致。
- [ ] camera gesture 不會每個 frame 都在 JavaScript 重算整條路線；只有有效 tolerance／zoom band 變化時更新顯示 LOD。
- [ ] iOS 與共用 fallback 路線分別有圓環、連續彎道、U-turn 與長路線回歸測試。
- [ ] 實機 MapKit 視覺結果未驗證前，不以 unit test 宣稱道路呈現已通過。

