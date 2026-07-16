# Hither 多人導航與 TestFlight 診斷完整設計

日期：2026-07-17  
狀態：已核准（方案 A：Session-first）

## 目標

將目前以 `groups.journey_status` 為主的群組導航，升級為可持久化、可重送、可診斷的 Navigation Session。隊長啟動導航後，在線成員透過 Realtime 收到事件，背景成員透過 APNs／ActivityKit 收到通知；每台裝置依權限、AppState 與導航狀態選擇定位模式，可靠上傳定位並更新 Live Activity。TestFlight 診斷版保留完整事件，production 僅保留必要錯誤與聚合資料。

## 核心原則

1. PostgreSQL 是導航狀態的唯一真實來源；建立、取消、完成與 ACK 由 SECURITY INVOKER RPC 在交易內處理。
2. Realtime 負責低延遲同步，APNs 負責喚醒與通知；任一通道失敗都不改變 session 的正確性。
3. 定位 callback 只寫入本機 SQLite outbox，不直接依賴網路；批次上傳使用事件 ID 與 sequence 冪等。
4. ActivityKit 是呈現層，不是導航真實來源。iOS 16.1+ 支援 Live Activity；push-to-start 僅在系統支援時啟用。
5. 分享關閉是最高優先級：停止定位、清除待上傳位置，且後端拒絕新的 location row。

## 資料模型與後端

新增 `navigation_sessions`、`navigation_member_states`、`device_live_activity_tokens`、`location_upload_events`、`diagnostic_sessions`、`diagnostic_events` 與 `metric_payloads`。沿用既有 `groups`、`group_members`、`member_locations`、`device_push_tokens`、`live_activity_sessions` 與 push webhook。

- `start_navigation_session(group_id, destination_id, request_id)`：驗證隊長、目的地與群組 membership；同一 request ID 回傳同一 session；同群組同時只能有一個 active session。
- `cancel_navigation_session(session_id)`、`complete_navigation_session(session_id)`：驗證隊長與 version，原子更新狀態。
- `ack_navigation_session(session_id, status, detail)`：成員 upsert 自己的接收、追蹤、權限或抵達狀態。
- `ingest_location_batch(events)`：驗證登入者、分享設定與 active membership，以 event ID 去重並更新 latest location。
- `ingest_diagnostic_batch(events)`：限制 payload 大小、事件種類與擁有者；production 採樣。

所有 public tables 啟用 RLS、明確撤銷預設權限後只授予必要操作。敏感 token 僅 owner 寫入、service role 讀取。DB webhook 在 session insert/update 後呼叫既有 `send-push` Edge Function；Edge Function 保持短命、冪等，記錄 APNs 回應並停用 410／Unregistered token。

## App 導航與定位

保留現有 `TrackingMode` resolver，完整模式為 `hidden`、`passiveBackground`、`foreground`、`teamNavigation`、`navigationMax`、`manualHighAccuracy`。單一 coordinator 套用模式，避免重複 TaskManager task 或 AppState 抖動。背景 task 定義維持在 module scope。

定位事件先寫入 SQLite outbox，再由單一 flush worker 批次送入 RPC。outbox 保存 event ID、session ID、capturedAt、sequence、重試次數與 TTL；成功後刪除，暫時錯誤指數退避，永久錯誤移入診斷事件。SQLite 同時承載 bounded diagnostics：最多 10,000 筆、72 小時、每批 100 筆。

抵達判定採 Haversine 距離、水平精度與連續兩次有效 fix：距離小於目的地半徑、accuracy 不超過 50m 才累積；任一條件失敗即重置。抵達後 ACK 後端、更新／結束 Live Activity，並將 tracking mode 降回一般分享模式。

## ActivityKit 與 APNs

擴充既有 `HitherLiveActivity` module：

- 監聽 `pushToStartTokenUpdates` 並將 token rotation 傳回 JS／Supabase。
- 監聽每個 activity 的 update token，保存 activity ID 與 session ID 對應。
- 支援本機 start/update/end，以及後端 `start`、`update`、`end` APNs payload。
- APNs 使用 `apns-push-type: liveactivity` 與 `app.hither.mobile.push-type.liveactivity` topic。
- 不支援 push-to-start、Live Activity 被關閉或 token 不可用時，降級為一般通知與 App 內導航。

Phase 5 先使用既有 remote-notification background mode 與 location refresh request。Location Push Service Extension 需要 Apple 核准的 `com.apple.developer.location.push` entitlement；程式與 target 只有在 entitlement 可簽署時加入 production build，避免建立無法簽章的假能力。

## 診斷與 MetricKit

App 診斷事件涵蓋 task 註冊、callback、拒絕原因、outbox、上傳、mode、Realtime、session ACK、Live Activity、抵達、權限與 refresh。診斷畫面顯示目前 session、callback／upload 統計、最後錯誤、Live Activity 狀態，並可匯出匿名化 JSON。

原生 iOS module 註冊 `MXMetricManagerSubscriber`。MetricKit payload 先寫入 Application Support 的 bounded files，JS 啟動後匯入 SQLite 並批次上傳；成功後刪除。此隔離方式支援目前 iOS 15.1 deployment target，也方便未來替換新版 MetricKit API。

## 錯誤與安全

- 所有 client request 使用 UUID 冪等；網路失敗不丟失本機位置。
- Navigation Session 過期由 DB 條件與清理 job 處理，client 同步時亦忽略 expired session。
- 位置及診斷資料不進 console、APNs payload 或錯誤訊息；匯出前移除 token、精確使用者識別與不必要座標。
- sharing disabled、退出群組與帳號刪除均使後端 ingestion 拒絕資料。
- background callback、flush worker 與 mode coordinator 各自維持單例，並以小型鎖避免重入。

## 驗證與發布

每個非平凡行為先寫失敗測試，再寫最小實作。驗證包含 resolver、outbox retry／TTL、session RLS／RPC 冪等、ACK、arrival 邊界、APNs headers／payload、token rotation、diagnostic retention／redaction 與既有回歸測試。完成後執行 TypeScript typecheck、Jest、lint、Supabase migration reset／DB tests、security/performance advisors 與 iOS native build 檢查。

原生 module、target、entitlement、package 或 app config 有變更，因此最終 release 不符合純 OTA。依 `hither-commit-push-ota` 明確 staging、commit、push 與整合後，使用 Expo EAS production profile 建置 iOS，`autoIncrement` build number，成功後 submit 到 App Store Connect/TestFlight；只有與 runtime 相容的後續 JS 修正才發 OTA。

## 不納入本次

路線偏離、隊長自動交接、Android 原生前景服務與 Apple entitlement 的核准流程不影響 Phase 1～6 主流程；前兩項留待有真實使用需求時加入，Android 維持現有 Expo 能力，Location Push Extension 則以 Apple 帳號實際核准狀態為準。
