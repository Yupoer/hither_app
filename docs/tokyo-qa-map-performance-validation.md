# Tokyo QA：地圖動畫與長時間資源修復驗證

來源：`qa-runs/2026-10-03-tokyo-blocker002-fix-validation` 的 SHORT-1S-PIXEL-MOTION、SMOOTH-MOTION-MEASUREMENT-RESULT、LONG-RUN-RESOURCE-OBSERVATION、FINAL-RESOURCE-OBSERVATION。

## 已確認來源缺陷與修復

- `GroupMap.MemberMarker` 同時把新座標傳給 React Marker coordinate prop，再於 effect 呼叫原生動畫。這會允許 prop 在動畫 command 前直接寫終點。舊 sample 的 effect 即使 return，prop 仍可能把 marker 寫回舊位置。改為固定初始 coordinate prop，後續僅原生 command 擁有座標；所有狀態均拒絕舊/相同 timestamp，前背景/電力模式切換僅 snap 到最後接受的真實 endpoint。
- `useMapKitRoutes` 有無界 promise/geometry cache，行走與切換目的地可持續累积。改為最多 24 entries、24,000 geometry points、5 分鐘有效期的近期使用快取；過大 route 仍可顯示，但不在 cache 中保留。失敗結果不保留。
- `useMapKitRoutes` 原 effect cleanup 在同 key 的 GPS/object 重 render 後使原在途 request 失效，後續又因 key 相同不補新 request。保留主工作樹 697713f 既有修正：以有效 request generation 判斷 completion、以 exact target identity 隔離不同目的地幾何及 ETA。

## 可重現結果

執行 `npm --prefix apps/mobile test -- --runInBand --silent src/__tests__/mapKitRoutes.test.ts src/__tests__/routeRequestCache.test.ts src/__tests__/memberMarkerMotion.test.ts src/__tests__/locationPrivacyMotion.test.ts`。

- baseline f511489 的 useMapKitRoutes 搭配新增的目的地/在途回歸：4 項 FAIL、12 項 PASS。修復版本全部通過。
- route cache 壓力測試：2,000 個獨立 routes、每筆 1,000 points，無界 Map 會保留 2,000 entries / 2,000,000 points；新快取保留 24 entries / 24,000 points。再讀最近 route 不新增 request；讀已淘汰 route 新增 1 次。這是 retained geometry 上限比較，不是整個 App RAM 減少比例。
- 30 個各 5,000 points 的 routes 最終保留 4 entries / 20,000 points；24,001 points 的 route 仍返回 caller，但不保留 cache。
- Marker hook：連續三筆真實 sample 的 React coordinate prop 保持同一初始物件；兩個後續 sample 各呼叫 6,000ms 原生動畫。重播/舊sample/相同time不同coords不增加 command；power/lifecycle disable 只以 duration=0 寫最後接受 endpoint。
- 既有 map UI/performance/energy/starfield 4 suites / 31 tests 通過。

## 驗證限制

沒有重新編譯/錄影此 binary，故不宣稱六方向 marker 像素平滑已 PASS。修復直接消除 prop/command 相互寫入與過期時間倒退路徑，原生 overlap/30fps patch 已存在來源，但需包含該 patch 的新 binary 重測。

QA 的長期 footprint 增長混合 Debug、MapKit、錄影與 host swap，沒有 heap/memgraph；路線無界 cache 是確認的來源持有問題，但不能據此把 2.8GiB 全部歸給它。未測實體 iPhone 功耗、溫度、電池、GPU，不能從 Simulator 結果推算散熱改善。

既有 starfield 有 20fps、前背景、低電量/thermal gate；主工作樹充電粒子的 UI 重寫屬另一份 WIP，此修復不移植其視覺行為。
