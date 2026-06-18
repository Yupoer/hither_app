# Spec — APNs Notifications, Quick Commands, Per-Category Toggles & Leader Journey + Live Activity

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-06-19 |
| 狀態 | Approved (design Q&A) |
| 範圍 | `hither_app/apps/mobile` (Expo RN + Supabase) |
| 平台 | iOS（Dev Build，非 Expo Go） |

## 1. 目標 (from /goal)

1. **新增集合點推播**：隊長新增/設定集合點時，推播給團隊中「除了自己以外」的成員。
2. **快捷通知按鈕**：設定頁有快捷按鈕（成員：廁所、休息、求助、發現東西；隊長：集合、找集合點、出發、休息、小心、左、右、停、快點），按下直接通知其他人。
3. **每類別獨立開關**：設定頁可逐項開關四個通知類別（新增集合點 / 隊長指令 / 成員快捷請求 / 行程開始暫停）。
4. **隊長行程開始/暫停**：隊長有開始/暫停鍵決定是否朝集合點移動。按開始時：
   - 出現 iOS 原生 **Live Activity**（鎖屏 / 動態島）。
   - App 內地圖**下方自繪橫幅**同步顯示（狀態 + 集合點 + 距離/ETA）。

## 2. 決策摘要

- **橫幅**：兩者都做（原生 Live Activity + App 內地圖底部橫幅，資料同步）。
- **通知類別**：四類，皆可獨立開關。
- **建置環境（預設）**：本 spec 把 DB / Edge Function / native module / UI 全部寫到可運行；APNs `.p8` 金鑰、EAS Dev Build、Apple capabilities 由使用者本人之後提供（憑證需其 Apple 帳號）。專案已 `expo prebuild`（`ios/` 已生成，scripts 已切 `expo run:ios`），符合 Dev Build 路線。
- **快捷按鈕位置**：依使用者要求放在**設定頁**（role-appropriate）；地圖不另做指令 UI（YAGNI）。
- **推播觸發**：Postgres trigger（pg_net）→ Supabase Edge Function（server-authoritative，定義於 migration）。
- **通知偏好強制點**：server-side。Edge Function 依每個收件人的 `notification_preferences` 過濾，故偏好存 DB（非僅 AsyncStorage）。

## 3. 架構

JS 僅透過 `src/native/*` 邊界碰裝置能力（既有約定）。資料層單一接縫在 `api/client.ts`（snake_case↔camelCase）。即時更新沿用 `useGroupState` 的 realtime channel。

```
[Leader/Follower app]
  ├─ Settings: quick buttons → sendCommand()      ─┐
  ├─ Settings: 4 toggles → setNotificationPrefs()  │ supabase-js (RLS)
  ├─ Map: start/pause → setJourneyStatus()         │
  └─ launch: registerPushToken()                   ─┘
                       │ insert/update
                       ▼
[Supabase Postgres]  commands / itinerary_items / groups.journey_status
                       │ AFTER trigger (pg_net)
                       ▼
[Edge Function send-push]  recipients = members − sender
                            ∩ push_tokens ∩ prefs[category]
                       │ APNs HTTP/2 (JWT from .p8)
                       ▼
[APNs] → 收件人裝置推播
  + 每台裝置：journey_status='going' 且有集合點 → 本機啟動/更新 Live Activity
```

## 4. 資料庫（新 migration `*_notifications_journey.sql`）

### 4.1 `push_tokens`
```
user_id uuid (FK auth.users) , token text, platform text default 'ios',
updated_at timestamptz default now(), primary key (user_id, token)
```
RLS：`authenticated`，insert/update/delete/select 限 `user_id = auth.uid()`。Edge Function 以 service role 讀（繞 RLS）。

### 4.2 `commands`
```
id uuid pk default gen_random_uuid(), group_id uuid (FK groups, cascade),
sender_id uuid (FK auth.users), type text not null, message text,
latitude double precision, longitude double precision,
created_at timestamptz default now()
```
`type` 檢查值（leader）：`gather, find_gathering, depart, rest, be_careful, go_left, go_right, stop, hurry_up`；（follower）：`need_restroom, need_break, need_help, found_something`。
RLS：select 限 member（`extensions.is_member`）；insert 限 `sender_id = auth.uid() AND is_member(group_id)`。Realtime：加入 publication。FK 覆蓋索引：`idx_commands_group_id`, `idx_commands_sender_id`。

### 4.3 `notification_preferences`
```
user_id uuid pk (FK auth.users),
add_gathering boolean not null default true,
leader_commands boolean not null default true,
follower_requests boolean not null default true,
journey boolean not null default true,
updated_at timestamptz default now()
```
RLS：own select/insert/update。缺列時 Edge Function 視為全開（預設 true）。

### 4.4 `groups.journey_status`
`alter table groups add column journey_status text not null default 'paused' check (journey_status in ('going','paused'))`。RLS 既有「update if leader」已涵蓋。
將 `groups` 加入 `supabase_realtime` publication，讓成員即時看到開始/暫停。

### 4.5 觸發推播（pg_net）
- helper：`extensions.notify_push(payload jsonb)` — 用 `net.http_post` 呼叫 Edge Function URL，帶 `Authorization: Bearer <service_role>`（從 `vault` / DB setting 取，不可硬編）。
- triggers：
  - `commands` AFTER INSERT → payload `{category: leader_commands|follower_requests by type, group_id, sender_id, type, message}`。
  - `itinerary_items` AFTER INSERT → `{category: 'add_gathering', group_id, sender_id: <creator>, title}`。注意 `itinerary_items` 無 sender 欄；以 `auth.uid()`（trigger 內可取）或新增 `created_by`。**決策**：`itinerary_items` 加 `created_by uuid default auth.uid()` 以便排除新增者。
  - `groups` AFTER UPDATE OF `journey_status`（且值改變）→ `{category:'journey', group_id, status}`。sender = 觸發更新的 leader（`auth.uid()`）。
- 設定值（Edge Function URL、service role key）以 `alter database ... set app.settings.*` 或 Supabase Vault 提供；migration 留 placeholder + 註解說明使用者填入。

## 5. 客戶端資料層（`api/client.ts` + `types/`）

- `registerPushToken(): Promise<void>` — 取 `notifications.getDevicePushToken()`，upsert `push_tokens`。launch（auth 後）呼叫。
- `sendCommand(groupId, type, message?, coords?): Promise<void>` — insert `commands`。
- `getNotificationPreferences(): Promise<NotificationPreferences>` / `setNotificationPreference(key, enabled): Promise<void>` — upsert `notification_preferences`。
- `setJourneyStatus(groupId, status): Promise<void>` — update `groups.journey_status`（leader-only via RLS）。
- types：`CommandType`、`NotificationPreferences`、`JourneyStatus`，`GroupState` 增 `journeyStatus`，`mapGroup` 帶 `journey_status`。

## 6. UI

### 6.1 Settings（`SettingsScreen.tsx`）
- **快捷通知** section：role-appropriate 按鈕格（follower 看 follower set，leader 看 leader set）。每鍵 `sendCommand`，送出後輕量回饋（Alert / toast）。
- **通知設定** section：四個 toggle（Switch），讀寫 `notification_preferences`。一進頁 fetch，切換即 upsert，失敗回滾。
- i18n：所有字串進 `i18n/index.ts`（zh + en）。

### 6.2 Map（`MapScreen.tsx`）
- 隊長：start/pause FAB（右側 FAB 欄新增一顆），toggle `journey_status`。
- 地圖底部：`JourneyBanner` 元件，`journey_status==='going'` 且有 selected gathering 時顯示（狀態徽章 + 集合點名 + 距離/ETA，沿用 `distanceEtaLabel`）。
- journeyStatus 來自 `useGroupState`（realtime）。

### 6.3 Live Activity 串接
- 新 hook `useLiveActivity`（或在 MapScreen effect）：當 `journey_status==='going'` 且有 gathering → `liveActivity.startGroupActivity({...})`；距離/ETA 變化 → `updateGroupActivity`；轉 'paused' / 離開 / 無集合點 → `endGroupActivity`。handle 存 ref。
- 每位成員裝置各自啟動（成員也想在鎖屏看距離）。

## 7. Edge Function `supabase/functions/send-push/index.ts`（Deno）

1. 驗證來源（service role bearer）。
2. 解析 payload（category, group_id, sender_id, …）。
3. 查收件人：`memberships`（group 內、role 視 category）排除 sender → join `push_tokens` → 過濾 `notification_preferences[category] != false`。
4. 組 APNs payload（alert title/body 依 category + type，localized fallback；`apns-topic = bundleId`）。
5. JWT（ES256，header kid，payload iss=teamId, iat）簽 `.p8`（secrets `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_ENV` sandbox/prod）。
6. HTTP/2 POST `https://api.{sandbox|}push.apple.com/3/device/{token}`；410 / BadDeviceToken → 刪 `push_tokens` 該列。
7. 回報計數。
- secrets 由 `supabase secrets set` 提供（使用者）。

## 8. Native modules

### 8.1 `HitherNotifications`（`modules/hither-notifications/ios/HitherNotificationsModule.swift`）
- `getDevicePushToken()`：`UIApplication.shared.registerForRemoteNotifications()`，於 AppDelegate `didRegisterForRemoteNotificationsWithDeviceToken` 取 hex token，以 promise/continuation 回傳。Expo Module 可用 `AppDelegateSubscriber`。port 自 legacy NotificationService。
- 權限請求沿用 JS（expo-notifications `requestPermissionsAsync`）。

### 8.2 `HitherLiveActivity`（`modules/hither-live-activity/ios/`）
- `isSupported()`：`ActivityAuthorizationInfo().areActivitiesEnabled`（iOS 16.1+）。
- `startGroupActivity(state)`：`Activity.request(attributes: HitherGroupAttributes(...), content:.init(state:.., staleDate:..))`，回 activity.id。
- `updateGroupActivity(handle,state)` / `endGroupActivity(handle)`：依 id 找 `Activity<HitherGroupAttributes>.activities`。
- `HitherGroupAttributes`（shared，定義於 module + Widget target 皆引用）：static `groupName, groupId`；ContentState `gatheringTitle, distanceMeters, etaSeconds, status, memberCount`。

### 8.3 Widget Extension（Live Activity UI）
- 新 target `HitherWidget`：`WidgetsLiveActivity.swift`（`ActivityConfiguration`，lock screen + Dynamic Island compact/expanded），port 自 legacy `Widgets/WidgetsLiveActivity.swift`。
- 透過 **Expo config plugin** 加入 target（採 `@bacons/apple-targets` 或自訂 plugin 寫入 pbxproj），並加 `NSSupportsLiveActivities=YES`、push capability、`aps-environment` entitlement。
- app.json：`expo-notifications` plugin 已在；加上 config plugin、Live Activities infoPlist。

## 9. 測試

- 既有 Jest（client 測試在 `src/__tests__/client.test.ts`）。為新 `api/client` 函式加單元測試（mock supabase）：sendCommand insert shape、prefs upsert、setJourneyStatus、registerPushToken upsert、排除 sender 邏輯（Edge Function 純函式部分抽出可測）。
- `npm run typecheck` 與 `npm test` 必須綠。
- Native（ActivityKit / APNs 實送）只能在實機 Dev Build 驗，列為使用者手動驗收。

## 10. 使用者後續手動步驟（憑證/建置）

1. Apple Developer：建 APNs Auth Key（`.p8`），記 Key ID、Team ID。為 App ID 開 Push Notifications。
2. `supabase secrets set APNS_KEY=... APNS_KEY_ID=... APNS_TEAM_ID=... APNS_BUNDLE_ID=app.hither.mobile APNS_ENV=sandbox`。
3. `supabase functions deploy send-push`。
4. 在 DB 設定 Edge Function URL + service role（migration 註解處）：`alter database postgres set app.settings.edge_url = '...'` 等。
5. EAS / `expo run:ios`（Dev Build）安裝到實機；接受通知權限；確認 Widget target 與 Live Activities、aps-environment entitlement 存在。

## 11. 明確排除（YAGNI）

UWB precision finding、remote push-updated Live Activity（僅本機更新）、battery-adaptive location、Android 推播實作（保留 adapter 介面）、find-member 流程。

## 12. 實作階段（供 writing-plans）

1. DB migration（4 表/欄 + RLS + realtime + triggers）。
2. 客戶端資料層 + types + token 註冊。
3. UI：Settings 快捷按鈕 + toggles；Map start/pause + JourneyBanner。
4. Edge Function send-push（含 JWT/APNs）。
5. Native：HitherNotifications token；HitherLiveActivity + Widget + config plugin + entitlements。
6. Live Activity 串接 journey state + distance/eta。
7. 測試 + typecheck 綠；文件化手動步驟。
