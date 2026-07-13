# Hither 正式 APNs、背景定位與 Live Activity 實作計畫

> 依據已核准規格：`docs/superpowers/specs/2026-07-13-apns-production-live-activity-design.md`

**目標：** 把 App 內 Quick Commands、旅程、脫隊、抵達、背景位置與 Live Activity 接到 Supabase 正式多人資料流，並準備好下一個 session 的 EAS production/TestFlight build。

**原則：** Supabase 的 `groups.active_destination_id` 是導航目標唯一真實來源；30 公尺內由資料庫做 sticky 抵達判定；個人進度使用 `clamp(1 - currentDistance / initialDistance, 0, 1)`；一般 APNs 與 Live Activity APNs 共用 `send-push` Edge Function。APNs `.p8` 只放 Supabase Edge Function Secrets，絕不進 repo、migration 或 App bundle。

**技術棧：** Expo SDK 54 / React Native / TypeScript / Jest / Expo Location + TaskManager / Swift ActivityKit + WidgetKit / Supabase Postgres + Realtime + Edge Functions / APNs token auth。

---

## Task 1：先鎖定距離、進度與抵達資料契約

**檔案：**

- 新增：`apps/mobile/src/utils/journeyProgress.ts`
- 新增：`apps/mobile/src/__tests__/journeyProgress.test.ts`
- 修改：`apps/mobile/src/types/index.ts`
- 修改：`apps/mobile/src/api/services/GroupService.ts`

**步驟：**

1. 先寫失敗測試，覆蓋 `29.99m`、`30m`、`30.01m`，以及 initial distance 為零、GPS 反向移動、超過初始距離等 clamp 邊界。
2. 執行 `npm test -- --runInBand src/__tests__/journeyProgress.test.ts`，確認因 helper 尚不存在而失敗。
3. 實作最小純函式：

   ```ts
   export const ARRIVAL_RADIUS_M = 30;

   export function hasArrived(distanceM: number): boolean {
     return Number.isFinite(distanceM) && distanceM <= ARRIVAL_RADIUS_M;
   }

   export function journeyProgress(initialM: number, currentM: number): number {
     if (!Number.isFinite(initialM) || initialM <= 0) return 0;
     return Math.min(1, Math.max(0, 1 - currentM / initialM));
   }
   ```

4. 擴充 `Group` mapping，加入 `activeDestinationId` 與 `journeyStartedAt`；新增 `setJourneyTarget(groupId, destinationId | null)`，讓開始／暫停以同一個 API 原子更新 journey 狀態與目標。
5. 再跑單檔測試，確認通過。

## Task 2：建立正式多人 journey 與 Live Activity schema

**檔案：**

- 新增：`supabase/migrations/20260713190000_production_push_live_activity.sql`
- 新增：`apps/mobile/src/__tests__/productionPushMigration.test.ts`

**步驟：**

1. 先寫靜態 migration contract 測試，要求：
   - `groups.active_destination_id`、`groups.journey_started_at`
   - `live_activity_sessions` 與 owner-only RLS
   - command constraint 包含 `custom`
   - Haversine 判定使用 `<= 30`
   - `arrived` 只在 active destination 切換時 reset
   - DB webhook 從 Vault 讀 `push_webhook_secret`，不讀 service-role database setting
2. 執行單檔 Jest，確認失敗。
3. 寫 migration：新增欄位、table、index、RLS、grant、Realtime publication 與 idempotent triggers。
4. 新增 `extensions.distance_meters(...)` 與 `public.on_member_location_arrival()`；僅當 journey 為 `going` 且有 active destination 時判定，同一站抵達後不回退。
5. 新增 `public.set_journey_target(group_id, destination_id)` RPC，以 membership leader 權限檢查原子設定 target、started_at、journey_status，並 reset 該群組的 `arrived` membership。
6. 改 `extensions.notify_push`：從 Vault 取得 webhook secret，送 `x-hither-webhook-secret`；若 secret 或 URL 不存在則 no-op，不保存 service-role key。
7. 加入 membership 抵達／脫隊事件 payload 與 live activity fan-out payload。
8. 跑 migration contract test。
9. 以 Supabase migration tool 套用到 `htqrucnjafhhvxdqslbv`，再用 SQL 查證欄位、RLS、constraint、trigger、30m 邏輯與 Vault secret 名稱；不在輸出顯示 secret value。

## Task 3：背景定位生命週期與個人 session 同步

**檔案：**

- 修改：`apps/mobile/package.json`
- 修改：`apps/mobile/package-lock.json`
- 修改：`apps/mobile/app.json`
- 修改：`apps/mobile/index.ts`
- 新增：`apps/mobile/src/state/backgroundJourney.ts`
- 新增：`apps/mobile/src/api/services/LiveActivityService.ts`
- 修改：`apps/mobile/src/api/services/LocationService.ts`
- 修改：`apps/mobile/src/api/client.ts`
- 修改：`apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts`
- 修改：`apps/mobile/src/state/SessionContext.tsx`
- 新增：`apps/mobile/src/__tests__/backgroundJourney.test.ts`

**步驟：**

1. 先寫背景 journey 純邏輯測試：開始保存 group/destination/initial distance/travel mode；重複啟動 idempotent；pause/end/leave/signout 清除；權限拒絕回傳可顯示的 fallback 狀態。
2. 用 `npm install expo-task-manager@~14.0.9` 安裝 Expo SDK 54 對應版本。
3. 在 module top-level 呼叫 `TaskManager.defineTask`，`index.ts` 必須先 import task module，再註冊 App。
4. `app.json` 加入：
   - `UIBackgroundModes: ["location", "remote-notification"]`
   - `NSLocationAlwaysAndWhenInUseUsageDescription`
   - expo-location background permission 文案與 indicator
5. 背景 callback 節流後執行：更新 `member_locations`、計算 Haversine distance 與 fallback ETA、upsert 自己的 `live_activity_sessions`、更新本機 ActivityKit state。
6. 導航開始時優先用 MapKit route distance 當 `initialDistance`，缺少時用 Haversine；pause/end/leave/signout 停止 background updates 並刪除自己的 session。
7. 把 `useJourneyNavigation` 的本機 `navTargetId` 改為以 server `activeDestinationId` 為主，保留 pending optimistic state 避免舊 snapshot 讓 UI 閃回。
8. 移除 client leader-only 30m 自動抵達作為權威來源；站點完成／切換由 persisted target 與 DB status 驅動。
9. 跑背景單測、既有 `journeyNavigation.test.tsx` 與 typecheck。

## Task 4：ActivityKit push token 與 Supabase session 註冊

**檔案：**

- 修改：`apps/mobile/modules/hither-live-activity/ios/HitherLiveActivityModule.swift`
- 修改：`apps/mobile/modules/hither-live-activity/ios/HitherGroupAttributes.swift`
- 修改：`apps/mobile/targets/live-activity/HitherGroupAttributes.swift`
- 修改：`apps/mobile/src/native/liveActivity.ts`
- 修改：`apps/mobile/src/state/useLiveActivity.ts`
- 修改：`apps/mobile/src/screens/MapScreen.tsx`
- 新增：`apps/mobile/src/__tests__/liveActivityContract.test.ts`

**步驟：**

1. 先寫 contract test，要求 `pushType: .token`、token hex encode、JS start result 含 `activityId`/`pushToken`、兩份 Swift ContentState 形狀相同、state 含 `memberArrived`。
2. 把 native start result 改為：

   ```ts
   interface ActivityStartResult {
     activityId: string;
     pushToken?: string;
   }
   ```

3. Swift 使用 `Activity.request(..., pushType: .token)`，等待首個 `pushTokenUpdates` 值並回傳；若 token 尚未到，Activity 仍可先本機顯示，後續用 native event 回報 rotation。
4. JS hook 收到 activity id/token 後 upsert `live_activity_sessions`；rotation 立即更新；end 時刪除 session。
5. `GroupActivityState` 加 `memberArrived: boolean[]`；兩份 Swift attributes byte-for-byte 同步。
6. MapScreen 的 `progress` 改用 Task 1 helper 與該使用者 `initialDistance`；抵達頭像使用每位 member 真實 `status === 'arrived'`，不再用固定 `PROGRESS_REF_M` 或 `first N`。
7. 跑 contract、Map UI、journey tests 與 typecheck。

## Task 5：依核准圖重製 Lock Screen／Dynamic Island

**檔案：**

- 修改：`apps/mobile/targets/live-activity/HitherLiveActivity.swift`
- 修改：`apps/mobile/src/__tests__/liveActivityContract.test.ts`

**步驟：**

1. 先把 screenshot UI contract 寫成失敗測試：近黑背景、綠色標頭、目的地、右側 ETA/距離、6pt progress、最多四頭像逐人 opacity、`x / y 已抵達`、walk/drive/transit symbol。
2. Expanded Island 與 Lock Screen 共用小型 view pieces：brand badge、destination header、ETA block、progress bar、arrival avatar row。
3. `AvatarStack` 改為 zip emoji 與 arrived boolean；已抵達 opacity 1，未抵達 opacity 0.35 並降低 saturation。
4. Compact leading 保留 crook + transport icon；compact trailing 顯示 ETA、無 ETA 才顯示距離；minimal 只顯示 crook。
5. 修正檔案內現有亂碼 UI 字串為 UTF-8 繁中：`前往集合點 · GATHERING AT`、`已抵達`。
6. 跑 contract test。Windows 無法本機編譯 Swift；最終 compile 交由下一個 EAS production build 驗證。

## Task 6：擴充 Edge Function 為一般 APNs + Live Activity APNs

**檔案：**

- 修改：`supabase/functions/send-push/apns.ts`
- 修改：`supabase/functions/send-push/messages.ts`
- 修改：`supabase/functions/send-push/index.ts`
- 新增：`apps/mobile/src/__tests__/sendPushContract.test.ts`

**步驟：**

1. 先寫失敗測試，驗證：production host、一般 push headers、Live Activity topic `app.hither.mobile.push-type.liveactivity`、`timestamp/event/content-state`、custom／脫隊／抵達 copy、subgroup/solo/prefs filter、webhook secret compare。
2. `sendApns` 拆成可測的 request builder 與 fetch executor；alert 仍用 topic bundle id，Live Activity 用 push type `liveactivity`、priority 5 與 liveactivity topic。
3. request 入口用 constant-time-safe 比對 `x-hither-webhook-secret` 與 `PUSH_WEBHOOK_SECRET`；不接受未驗證的 trigger payload。
4. 一般通知收件人限制為 active membership，排除 sender、solo，以及與 sender 不同 subgroup 的成員；套用 notification prefs。
5. liveactivity payload 依 `live_activity_sessions` 每位使用者的 distance/ETA/progress 組完整 content-state，並合併 group members 的 avatar/arrived arrays。
6. APNs 永久失效時，一般 push 刪 `push_tokens`；live activity 刪對應 session token。
7. 跑 contract test 與 TypeScript test suite。

## Task 7：正式 Auth、APNs Secrets、EAS 設定與 local fallback

**檔案：**

- 修改：`apps/mobile/app.json`
- 新增：`apps/mobile/eas.json`
- 修改：`apps/mobile/src/state/useGroupNotifications.ts`
- 修改：`apps/mobile/App.tsx`
- 新增：`apps/mobile/src/__tests__/productionConfig.test.ts`

**步驟：**

1. 先寫 production config test，要求 callback `hither://auth/callback`、production EAS profile、正式 entitlement 由 signing 管理、Realtime 本機群組通知只在 `__DEV__` fallback 啟用。
2. `eas.json` 建立 `production` App Store profile 與 `environment: "production"`；不執行 build/deploy（依使用者指示留給下一個 session）。
3. Supabase Auth Site URL 改為 `hither://auth/callback`；Additional Redirect URLs 保留 exact callback、`hither://**` 與既有 `exp://` 本機值。Google provider 已有成功 identity，不要求額外 Google Cloud 文件。
4. 將 `C:\Users\alexs\Downloads\AuthKey_YDV8WF53XN.p8` 內容透過 Supabase dashboard/CLI 寫入 Edge Function Secret `APNS_KEY`；同時設：
   - `APNS_KEY_ID=YDV8WF53XN`
   - `APNS_TEAM_ID=5LBPG5TUKP`
   - `APNS_BUNDLE_ID=app.hither.mobile`
   - `APNS_ENV=production`
   - 隨機產生 `PUSH_WEBHOOK_SECRET`
5. 同一 webhook secret 以 Supabase Vault secret `push_webhook_secret` 保存；值不得出現在 shell log、commit 或回覆。
6. 部署 `send-push`；因 function body 有自訂 webhook 驗證，DB trigger 路徑使用對應的 gateway 設定。
7. 正式 build 關閉 `useGroupNotifications` Realtime local fallback，避免 APNs 與本機通知重複；sender 的直接本機 feedback 保留。
8. 跑 config test。

## Task 8：完整驗證與交接

**步驟：**

1. 執行：

   ```powershell
   npm test -- --runInBand
   npm run typecheck
   npm run lint
   ```

   工作目錄：`apps/mobile`

2. 以 Supabase SQL 查證：active target、arrival trigger、Live Activity RLS、Realtime publication、Vault secret 只回名稱、trigger URL 已設定。
3. 呼叫 Edge Function 驗證：錯誤 secret 回 401；合法測試 payload 可完成 recipient resolution；不對真實使用者送測試噪音通知。
4. 查 Edge Function/Postgres logs，確認無 secret 洩漏、無 trigger/SQL error。
5. 執行 Supabase security 與 performance advisors，分辨本次新增問題與既有非本次問題。
6. 執行 `git diff --check`、`git status --short`，確認 APNs key 未追蹤；以 `rg` 只搜尋 Key ID/secret 名稱，不輸出 private key 內容。
7. 重新 index codebase-memory，檢查變更 impact。
8. 只提交本次新增／修改；保留使用者原有未提交工作，不把無關檔案併入 commit。
9. 交接下一個部署 session 尚需提供／確認：EAS project link、Apple App Store Connect app record/ASC App ID、EAS/Apple 登入權限。這些只影響 build/submit，不阻擋本 session 程式與 Supabase 接線。

## Definition of Done

- 距離集合點 `<= 30m` 在 DB 標記 arrived，且同一站 sticky；換站 reset。
- 個人 Live Activity 進度以自己的 initial/current distance 計算。
- App 進背景／鎖定後仍持續上傳位置並更新本機 Live Activity。
- 隊友抵達透過 Supabase/Live Activity APNs 更新逐人頭像明暗與抵達數。
- App 內 Quick Commands、custom、journey、脫隊、抵達、新集合點都有正式 APNs 路徑。
- APNs `.p8` 僅存在 Supabase Secrets；repo、migration、App bundle、log 均無私鑰。
- Auth callback 與 production EAS 設定完成；下一個 session 可直接做 EAS production/TestFlight build。

