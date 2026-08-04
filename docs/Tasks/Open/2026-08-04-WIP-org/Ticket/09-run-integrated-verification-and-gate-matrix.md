# 09 — 執行整合驗證並建立外部 Gate Matrix

**What to build:** 在最新 master 基準的整合結果上執行可用自動化與 runtime 驗證，將每一項結果分類為 Passed、Failed、Implemented locally、Unverified 或 Blocked，形成能決定是否進入 merge 的證據包。

**Blocked by:** 08

**Status:** partial — local gates green; external gates Unverified/Blocked

- [x] 執行各切片 focused Jest、完整 Jest、TypeScript typecheck、diff check 與相鄰 regression suites，保存命令、版本、結果與失敗輸出。
- [x] 執行 Deno tests、pgTAP／Supabase runtime tests；無 runtime 或 credentials 時標成 Unverified／Blocked，不以 source-string contract 取代。
- [ ] 比較相同情境下的 request count、deadline polling、CPU、memory、FPS、thermal 與可用 Instruments 指標。
- [ ] Apple sandbox 驗證 catalog、trial eligibility、purchase、durable grant before finish、unfinished recovery、restore 與 lifecycle notification；缺少條件逐項列 Blocked。
- [ ] release-like iOS／Android 驗證 route LOD、Map chrome、marker rollback 與邀請 layout；模擬或單元測試不得標成 native Passed。
- [ ] App Store Connect 商品、subscription group、introductory offer、agreements、tax／banking、server credentials 與 notification URL 各自列狀態。
- [x] Lint baseline 與本次新增問題分開；任何與本次變更相關的 Failed 都有處置或阻止 merge。
- [x] Gate matrix 分開列 native build、server deploy、migration、OTA、TestFlight 與 App Store submit，不把其中一項成功推論成其他項成功。
- [x] WIP manifest coverage 為完整，所有項目均有最終 disposition，才可讓 Ticket 10 開始。
