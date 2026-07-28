# 10 — 啟用 Google Transit 並強化 Apple 大眾運輸顯示

**What to build:** Google 地圖在支援的城市預設顯示大眾運輸線路與車站；Apple 地圖預設保留大眾運輸 POI 並使用 transit 路線能力，在無資料或不支援時仍正常顯示基本地圖。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 確認實際打包的 Google iOS/Android native SDK 版本與 wrapper 是否暴露 transit layer。
- [ ] Google provider 預設啟用原生 transit layer；不支援時安全降級為 normal map。
- [ ] Apple provider 使用 standard configuration、public-transport POI 與 transit directions，不宣稱有不存在的 transit network layer toggle。
- [ ] 不新增第三方地圖 SDK、交通資料集或自製鐵道路網 overlay。
- [ ] provider contract、iOS/Android build 與有/無 transit coverage 的實機驗證通過。
