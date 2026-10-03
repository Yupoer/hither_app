# BLOCKER-001：位置上傳 sequence 契約修復

基準：`a0f823f3db3c06727ca1292cf34c310fc32a48a8`，直接在 master 修正。

GPS 毫秒時間可含小數。原本 outbox 預設讓 sequence 等於 capturedAt，
而 `public.ingest_location_batch(jsonb)` 以文字直接轉 bigint，導致 invalid_event。

## 修正

- sequence 統一截去小數，必須是 JavaScript 可精確表示的非負整數。
- capturedAt 保留原感測小數，伺服器仍依 captured_at 排序，事件 ID 保持不變。
- 前景 enqueue、完整背景事件、舊 AsyncStorage 匯入都套用相同規則。
- RPC 邊界再正規化，涵蓋更新前已儲存的 SQLite rows 與直接呼叫者。
- 不合法 sequence 按事件拒收，不阻止同批其他有效事件上傳。
- 不改 schema、伺服器函式、身份／分享權限、TTL 或重試節奏。

## QA 伺服器驗證

2026-10-03，對交接指定的 Supabase QA 專案 `htqrucnjafhhvxdqslbv`
執行 transaction/subtransaction 回滾驗證。使用原三名 QA 成員的 authenticated
角色與原團隊；capturedAt 採伺服器當下毫秒加 `.424`，避免交接舊樣本超過 TTL。

| 驗證 | A | B | C |
|---|---|---|---|
| 小數 sequence 重現 | invalid_event | invalid_event | invalid_event |
| 僅 sequence 改整數 | accepted | accepted | accepted |
| 相同 ID 再送一次 | accepted | accepted | accepted |
| 各讀其他兩名成員的座標 | 2 人 | 2 人 | 2 人 |

讀取同時核對 sequence 與 captured_at；小數捕獲時間保留（毫秒誤差 < 0.001）。
測試寫入全部回滾，member_locations 計數 0 → 0，新 probe events 為 0。
此結果證明 RPC 接受與六方向資料讀取，不能代替三台模擬器地圖 UI 驗收。

## 獨立審查與本地驗證

分別由額外 code review 與 test subagent 執行，提交前完成。
Code review（含新增整合測試）沒有 actionable findings。

- 全套 Jest：313 suites / 2,495 tests 通過。
- 明確收集三個修改產品檔案的覆蓋率：functions 90.16%（55/61），高於 85% 門檻；lines 91.82%。
- 分檔函式覆蓋率：LocationService 100%、locationOutbox 87.5%、locationSequence 100%。
- TypeScript、lint、test:meta 通過；全樹 lint 有 762 個既有警告，0 errors。
- 新增 6 個整合案例串接正式 outbox、SQLite row decoder 與 LocationService。
  以隔離舊版本執行同份案例有 3 個失敗：前景／背景仍儲存小數 sequence，
  舊 durable row 離線重試仍送出小數；修復版本為 6/6 通過。

SQLite driver、RPC transport 和感測輸入在本地整合測試中仍是 mock。
此證據不代表真實 SQLite、OS 背景任務、模擬器或真機旅遊驗收。

## 重測界線

Mac Metro 必須載入這次提交的 JS 後，先以含小數 capturedAt 的 OS 感測輸入
確認三方上傳成功、三筆 member_locations 與六方向地圖顯示，再繼續鎖屏、
分享關閉、斷網恢復、抵達與通知。此次沒有 OTA 或 binary 發布。

永久拒收仍依既有策略清除，手動同步仍要求該事件出現在 acceptedIds。
被動上傳錯誤提示、guest Login 導頁、背景分享範圍與資源警告仍是後續項目；
本次沒有把這些未驗收項目記作通過。
