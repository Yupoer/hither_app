# 即時本機操作、原生定位與 iOS 系統封面修復

日期：2026-10-08（Asia/Taipei）。直接在本機 master 工作；先 fast-forward pull 至 `164ca5ce3476753a5d86ae0cc679fb841ec58414`。保留既有 `.tmp/` 與 `.wrangler/`。

## 正式環境診斷

Supabase Hither 的最近 24 小時紀錄（本次約 02:00 台北時間查詢）：

- `core_operations`：4 筆新增、4 筆刪除、2 筆開始集合、1 筆抵達、1 筆完成目的地，均為 accepted，沒有 terminal_reason。
- `apply_core_operation_v3`：11 次 HTTP 200，平均約 248ms，最大 419ms。
- `core_entity_versions`：44 次 HTTP 200，平均約 100ms，最大 912ms。
- `navigation_sessions`：41 次 HTTP 200，平均約 113ms，最大 371ms。
- 新增操作 occurred_at 到 received_at：平均 227ms、最大 300ms；開始集合平均 187ms、最大 202ms。這個時間不包含建立操作紀錄之前的本機等待。
- API 的錯誤狀態只有 5 次 `/auth/v1/health` 401，不是新增或開始集合失敗。
- Postgres 的 parsed error severity 沒有 ERROR/FATAL/PANIC；有各一筆連線類代碼 08006 與 08P01，severity 為 LOG，沒有證據連結到上述操作。
- `diagnostic_events` 沒有當日事件。`performance_events` 只有 9 筆 energy startup/resume/sample；可見的 thermalState 為 nominal，沒有足夠 frame/JS lag 紀錄量化使用者觀察的卡頓。

查詢只讀；不修改正式資料、資料庫權限或記錄。沒有把後端成功視為裝置 UI 已即時更新。

## 已確認來源問題

1. 粒子 x 遞減，方向右往左；隨機 y 可群聚。改為 x 遞增、半徑乘 0.5、發射間隔乘 0.5，每 12 顆覆蓋 12 個高度帶，保留速度、淡入淡出與暫停進度。
2. 本機身分讀取雖不請求網路，仍會等待 credential write serial / SecureStore flush。新增 draft-only cached read；網路授權仍走既有 auth recovery，logout tombstone 與換帳號隔離仍有效。
3. 本機 snapshot 更新曾先等待 outbox metadata；舊 remote recovery 也可能覆蓋已提交的本機投影。修復本機 paint 與 remote reconciliation 的等待及競態。
4. 開始行程的本機 intent 與重複點擊處理延後，可能對同目標重複提交 invalid_transition。修復立即回饋及同目標操作去重，保留 durable enqueue 與 silent retry。
5. iOS inactive 曾被當成隱藏 UI，卸載 MapView 與 Skia Canvas，並切換 GPS owner。分開 visible UI 與 optional motion：inactive 保留地圖、背景、鏡頭與定位，粒子停止；真正 background 沿用既有節能規則。
6. 暫停旅程時自製 passive blue marker 代替 native user location。移除自製 marker；有位置分享權限與會員資格時使用 MapKit `showsUserLocation`，保留單一前景 GPS owner 與資料上傳 cadence。

## 發布相容基準

Mac 的 `release-artifacts/issue-293-164ca5c-20261006-293/release-receipt.json` 與 IPA 已唯讀核對：來源 164ca5ce3476753a5d86ae0cc679fb841ec58414、版本/runtime 0.1.11、build 76、production channel；Apple VALID、internal IN_BETA_TESTING。重新計算 IPA SHA-256 與 receipt 相符。本次修復若維持 JS/TS 差異，可發布 iOS production OTA；不將舊 EAS build 51 或 runtime 0.1.10 OTA 當成當前 binary 基準。

## 驗證邊界

回歸測試涵蓋本機寫入/憑證寫入停滯/舊快照競態（包括 ACK 刪除 receipt 後的舊回應）、開始連點、同一 render 的 End→Start、切換目的地 session 隔離、失敗本機保存回復、30 次 inactive→active 原生地圖保持、真 background 節能，以及粒子方向/尺寸/雙倍数量/均勻分布/暫停恢复。測試與發布結果由本次交付回報記錄。

Jest、typecheck、bundle 或 OTA 成功不等於實體 iPhone 已驗收；本次未取得使用者裝置套用 update ID、畫面錄影或真機操作延遲量測。
## 本機靜態 gates 與 Expo 上游提示

`test:meta`、`verify:runtime`、TypeScript 與 lint 已通過（lint 0 errors；既有大量 warnings）。線上 `expo install --check` / Expo Doctor 提示 8 個較新 patch：@expo/ui、expo、expo-asset、expo-auth-session、expo-constants、expo-notifications、expo-sqlite、expo-updates；Doctor 19/20，版本檢查未通過。這些依賴與 package-lock 相對 164ca5c 沒有變更。

已安裝 expo@57.0.26 的 bundledNativeModules.json 與既有依賴相符。使用單次 `EXPO_OFFLINE=1 npx expo install --check` 真正校驗已安裝 SDK 的依賴，結果 Dependencies are up to date；此結果是 build 76 原生相容性的補充證據，不冒充線上新 patch advisory 或 CI 已通過。沒有跳過 doctor gate、加入 validation exclude、修改 CI 或升級原生依賴。