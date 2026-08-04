# 10 — 固定 Apple Maps Logo 並完整露出羅盤

**What to build:** 讓 Apple Maps Logo 在 Peak／Stage 切換時保持固定且不跑入 sheet，同時讓使用者旋轉地圖後能完整看見並操作羅盤。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Logo 不再由已落定 detent 直接計算位置，Peak／Stage 切換時不會先跳再等待 sheet spring。
- [ ] Logo 固定在 map-bottom 基準，並由 Peak sheet 的層級與 clipping 自然遮罩，不出現在 sheet 內容區。
- [ ] 羅盤位置納入 safe area、右上收合卡片 footprint 與合理間距，旋轉時完整露出。
- [ ] 不再以只有 JavaScript prop 字串存在、但 native layout 未使用的 offset 當作完成證據。
- [ ] 若使用 native 修補，驗證 MapKit subview layout；若使用自繪羅盤，保留 heading、camera rotation、tap-to-north、accessibility 與 reduced-motion。
- [ ] iPhone 與 iPad、Peak 與 Stage 1、直向與可用橫向配置都有 layout／snapshot 檢查。
- [ ] release-like iOS 實機驗證前，報告明確標示 MapKit chrome 為 Unverified。

