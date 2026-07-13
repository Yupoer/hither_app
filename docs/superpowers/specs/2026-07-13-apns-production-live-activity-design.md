# Hither 正式 APNs、背景定位與 Live Activity 設計

日期：2026-07-13

## 1. 目標

把既有的本機通知與前景 Live Activity 原型接到正式多人環境，供下一個 session 直接執行 EAS production build 與 TestFlight submit。

本次涵蓋：

- App 內 Quick Commands、自訂指令、出發／暫停、脫隊及抵達事件的 APNs 通知。
- 使用 Supabase Edge Function Secrets 保存 APNs `.p8`，私鑰不進 repo 或 App bundle。
- App 在導航期間進入背景或鎖定螢幕後，持續更新位置、距離、ETA 與 Live Activity。
- Lock Screen Live Activity 與 Dynamic Island 依提供的黑色膠囊設計重製。
- Supabase Auth production deep link、EAS production 設定及本機 fallback。

不涵蓋 Siri、iOS Shortcuts 或 App Intents；「快捷指令」只代表 App 內 Quick Commands。

## 2. 已確認的正式資料

- Supabase project：`htqrucnjafhhvxdqslbv`
- APNs Key ID：`YDV8WF53XN`
- Apple Team ID：`5LBPG5TUKP`
- Bundle ID：`app.hither.mobile`
- APNs environment：`production`
- Apple App ID 的 Push Notifications capability 已啟用。
- Supabase 已有成功建立的 Google identity；不新增 Google Cloud 設定。

Edge Function Secrets 使用：

- `APNS_KEY`
- `APNS_KEY_ID`
- `APNS_TEAM_ID`
- `APNS_BUNDLE_ID`
- `APNS_ENV`
- `PUSH_WEBHOOK_SECRET`

`PUSH_WEBHOOK_SECRET` 同時以 Supabase Vault 保存供資料庫 trigger 使用，避免把 service-role key 寫入 database setting。

## 3. 資料模型

### 3.1 目前導航目標

在 `groups` 增加：

- `active_destination_id uuid null references itinerary_items(id)`
- `journey_started_at timestamptz null`

隊長開始導航時原子設定 `journey_status = 'going'`、集合點及開始時間；暫停或結束時清除 active destination。每台裝置與後端都以這個欄位為唯一真實來源，不再各自猜測下一站。

### 3.2 Live Activity sessions

新增 `live_activity_sessions`：

- `id uuid primary key`
- `user_id uuid references auth.users(id)`
- `group_id uuid references groups(id)`
- `destination_id uuid references itinerary_items(id)`
- `activity_id text`
- `push_token text unique`
- `initial_distance_m double precision`
- `current_distance_m double precision`
- `eta_seconds integer`
- `travel_mode text check ('walk', 'transit', 'drive')`
- `last_progress_bucket integer`
- `expires_at timestamptz`
- `updated_at timestamptz`

RLS 僅允許使用者讀寫自己的 session；Edge Function 透過 runtime 自動提供的 service role 讀取 fan-out 資料。token 更新時 upsert，Activity 結束或 APNs 回報失效時刪除。

### 3.3 抵達狀態

`member_locations` insert／update 後，由資料庫以 Haversine 距離比較使用者位置與 `active_destination_id`：

- 距離 `<= 30m`：將該 membership 設為 `arrived`。
- 距離 `> 30m`：若尚未抵達則保持原狀。
- 同一個 active destination 一旦抵達即保持 sticky，避免 GPS 在 30m 邊界漂移造成反覆抵達／取消。
- 更換集合點或重新開始 journey 時，重設上一站的抵達狀態。

只有抵達人數或成員抵達旗標真的改變時，才觸發 Live Activity APNs fan-out。

## 4. 距離、ETA 與進度

每位成員開始導航時保存自己的 `initialDistance`：

1. 優先使用 MapKit route distance。
2. MapKit 暫時不可用時使用 Haversine 直線距離。

進度公式：

```text
progress = clamp(1 - currentDistance / initialDistance, 0, 1)
```

- `currentDistance` 同樣優先使用目前 MapKit route distance。
- ETA 優先使用 MapKit expected travel time；背景或路線暫時不可用時，依 walk／transit／drive 的現有速度估算 fallback。
- 只有跨越進度 bucket、距離變動達門檻或 ETA 明顯改變時才更新，避免 GPS jitter 與 APNs spam。

## 5. 背景位置

導航開始時啟動 Expo background location task；導航暫停、結束、離隊或登出時停止。

iOS 設定：

- `UIBackgroundModes`: `location`, `remote-notification`
- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription`
- 顯示背景定位 indicator。

背景 task 會：

1. 節流後更新 `member_locations`。
2. 更新該使用者的 `live_activity_sessions` 距離、ETA 與進度 bucket。
3. 更新本機 ActivityKit content state。

定位權限遭拒時不終止 journey；App 顯示清楚提示，Live Activity 保留最後距離，隊友抵達狀態仍可由 APNs 更新。

## 6. APNs 與 Edge Function

沿用並擴充單一 `send-push` Edge Function，避免新增另一套推播服務。

### 6.1 一般通知

支援：

- Quick Commands 與 custom command
- journey going／paused
- 脫隊事件
- 抵達事件
- 新增集合點

收件人必須是同群組有效成員，排除 sender、Solo 與不相關 subgroup，並套用 notification preferences。正式 build 停用 Realtime 本機群組通知替代層；sender 的立即本機確認保留。

### 6.2 Live Activity remote update

ActivityKit request 使用 `pushType: .token`，監聽 `pushTokenUpdates` 並同步 Supabase。

APNs request：

- `apns-push-type: liveactivity`
- `apns-topic: app.hither.mobile.push-type.liveactivity`
- production host：`api.push.apple.com`
- payload 包含 `timestamp`、`event` 與完整 `content-state`

活動 token rotation 立即 upsert；APNs 回傳 `410`、`BadDeviceToken` 或 `Unregistered` 時刪除 token。

## 7. Live Activity／Dynamic Island UI

視覺以提供的黑色圓角膠囊為基準，不重新發明另一套風格。

### 7.1 Expanded／Lock Screen

- 背景：純黑／接近純黑，大圓角膠囊。
- 左上：深綠圓角方塊與 Hither crook mark。
- 標題區：綠色小型 uppercase `前往集合點 · GATHERING AT`，下方白色 semibold 集合點名稱，單行截斷。
- 右上：大型白色 ETA；下方灰色距離。
- 中段：細長 progress track，已完成部分使用主題綠色。
- 底部左側：最多四個圓形成員頭像；已抵達正常亮度，未抵達降低 opacity／飽和度。狀態以逐人 boolean 呈現，不再假設「前 N 人已抵達」。
- 底部右側：`已抵達人數 / 總人數 已抵達`。
- 交通方式使用 walk／drive／transit SF Symbol，與 ETA 放在同一資訊層級，避免重複顯示兩份時間。

### 7.2 Dynamic Island

- Expanded：與 Lock Screen 相同資訊與明暗頭像狀態，依區域重新排列。
- Compact leading：crook mark + 交通方式 icon。
- Compact trailing：短 ETA；ETA 不可用時顯示距離。
- Minimal：只顯示 crook mark。

Swift `ContentState` 增加逐人成員資料，例如 avatar emoji 與 arrived boolean 陣列；App module 與 widget target 的共享型別保持完全一致。

## 8. Auth 與 EAS

App OAuth callback 固定為：

```text
hither://auth/callback
```

Supabase Auth：

- Site URL：`hither://auth/callback`
- Additional Redirect URLs 保留 `hither://auth/callback`、`hither://**` 與既有 `exp://` 本機網址。

新增 production `eas.json`，使用 App Store production profile。移除程式中固定的 APNs development 假設；`expo-notifications`、location background mode、Live Activity target 與 production entitlement 由 app config／EAS signing 一致產生。

EAS project link、production environment variables、ASC App ID 與 TestFlight submit 由下一個部署 session 完成。

## 9. 錯誤處理與安全

- Edge Function 先驗證 Vault／Edge Secret 共用的 webhook secret，再處理 DB trigger payload。
- APNs private key、webhook secret、service-role key 不寫入 log、migration 或 client bundle。
- 所有 public schema 新表啟用 RLS；Live Activity token 僅 owner 與 service role 可見。
- APNs 單一 token 失敗不阻斷其他收件人；永久失效 token 自動清除。
- background task 重複啟動、App crash 或 token rotation 都以 idempotent upsert 收斂。
- journey 結束會 end Activity、停止背景定位並清除 session。

## 10. 驗證

採 TDD：

- 30m 抵達邊界：29.99m、30m、30.01m。
- sticky arrival 與更換 destination reset。
- 個人進度公式、clamp 與 initial distance reset。
- custom command DB constraint 與 APNs message。
- Solo／subgroup／notification preference fan-out。
- Live Activity APNs headers、topic、production host 與 payload。
- 成員頭像逐人明暗狀態。
- background task 啟停與權限拒絕 fallback。

完成後執行 Jest、TypeScript、lint、Supabase security/performance advisors、Edge Function deploy 與 remote schema／trigger 查證。Windows 本機不能編譯 iOS target；Swift、entitlements 與 provisioning 的最終驗證由下一個 EAS production build 完成。

## 11. 已知風險

- background location 增加耗電及 App Store 隱私審查要求。
- GPS 精度低於 30m 時可能提早抵達；sticky 規則避免狀態反覆，但不能消除首次誤判。
- Live Activity remote update 受 APNs 排程與系統更新頻率控制，不保證逐秒刷新。
- 每位成員的距離與 ETA 不同，不能改成單一 group broadcast payload。
