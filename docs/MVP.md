# Hither App — MVP 規格文件

| 欄位 | 內容 |
|------|------|
| 版本 | 0.1.0 |
| 最後更新 | 2026-06-16 |
| 狀態 | Draft |
| 適用平台 | iOS（React Native + Expo）；Android 為 `MVP+` |
| UI 設計工具 | Claude Design |
| 驗收方式 | Expo Go（iOS 實機測試） |

**標籤說明**
- `MVP`：本期必須完成
- `MVP+`：下一期實作，本期僅保留設計位
- `Out of scope`：明確不做，不在任何近期規劃中

---

## 1. Product Scope

### 1.1 核心場景定義

Hither 解決的是一個具體、高頻且痛苦的現實問題：**一名領隊帶著一群人在實體空間中移動，成員容易走散，且不知道下一個集合點在哪、還有多遠。**

核心場景：
- 一名 Leader 主導一次活動（旅遊、校外教學、大型場館參觀等）
- 數名 Follower 跟隨，過程中可能分散
- Leader 週期性地設定下一個集合點，Follower 需要知道「往哪走、還差多遠」

### 1.2 解決的核心問題

| 問題 | Hither 的回應 |
|------|---------------|
| 成員走散不知在哪 | 地圖上即時顯示所有成員位置 |
| 不知道下一個集合點 | Leader 在地圖上設點，Follower 立即收到 |
| 不知道還要走多久 | App 顯示與集合點的直線距離與預估步行時間 |

### 1.3 MVP 的設計原則

1. **單一 group**：每次活動一個 group，無巢狀或合併。
2. **單一進行中集合點**：同時只有一個 active meeting point，Leader 更新時舊的自動歸檔。
3. **地圖為唯一主畫面**：所有核心資訊在地圖上呈現，不分頁切換。
4. **越簡單越好**：不需要帳號註冊，匿名暱稱即可加入。
5. **iOS 優先，預留 Android 擴充**：MVP 以 iOS 為唯一驗收平台。開發語言為 **React Native（Expo）**，以 **Expo Go** 在真實 iOS 裝置驗證。iOS 原生服務（地圖用 Apple Maps / MapKit、通知基礎設施用 APNs）透過 React Native 封裝模組呼叫；所有平台相依的呼叫須封裝在 adapter 層，確保日後加入 Android 時只需替換 adapter，不動業務邏輯。

### 1.4 明確排除的進階能力

詳見第 6 章 Out of Scope。核心原則：**MVP 不做任何在集合場景之外的功能。**

### 1.5 MVP 驗收基準

Happy path（第 3 章）的完整流程可透過 **Expo Go** 在真實 **iOS 裝置**上跑通，包含：
- 建立 group、加入 group
- 所有成員位置顯示在地圖上（Apple Maps）
- Leader 設定集合點後 Follower 即時看到距離與時間

> **Expo Go 限制**：使用 `expo-dev-client` 才能測試需要原生模組的功能（例如背景定位、APNs）。如遇 Expo Go 不支援的套件，改用 Development Build。

---

## 2. User Roles

### 2.1 角色總覽

| 角色 | 一句話定位 |
|------|-----------|
| **Leader** | 主導活動流程，建立 group 並決定集合點的人 |
| **Follower** | 參與活動，跟隨 Leader 指示前往集合點的人 |

一個 group 有且只有一名 Leader，Follower 數量無硬性上限（MVP 不設限）。

### 2.2 Leader 權限

- 建立 group 並取得 group code
- 設定、更新下一個集合點（地圖點選）
- 查看地圖上所有成員的即時位置
- 關閉 group（MVP 不強制，可先用離開替代）

### 2.3 Follower 權限

- 以 group code 加入 group
- 分享自身即時位置
- 查看地圖上所有成員的位置（`MVP`，Leader 與 Follower 互可見）
- 查看當前集合點與自身的距離及預估步行時間

### 2.4 權限對照矩陣

| 功能 | Leader | Follower |
|------|:------:|:--------:|
| 建立 group | ✅ | ❌ |
| 加入 group | — | ✅ |
| 設定集合點 | ✅ | ❌ |
| 查看所有成員位置 | ✅ | ✅ |
| 查看距離/時間 | ✅ | ✅ |

### 2.5 身分與帳號假設（MVP）

MVP 採用**匿名暱稱**機制：
- 開啟 App → 輸入暱稱（nickname）→ 建立或加入 group
- 不需要 email、密碼或第三方登入
- Session 以裝置本地 token 維持，App 關閉後重開需重新加入
- 帳號系統（`MVP+`）：可於後續版本追加，讓 Leader 保有歷史 group 紀錄

---

## 3. Happy Path

### 3.1 流程總覽

```
[Leader]                          [Follower A, B, ...]
  │                                      │
  ├─ 1. 輸入暱稱，建立 group              │
  ├─ 2. 取得 group code                  │
  │                                      ├─ 3. 輸入暱稱 + group code，加入
  │                                      │
  ├─ 4. 地圖上看到所有人位置 ←────────────┤
  │                                      │
  ├─ 5. 設定集合點（地圖點選）             │
  │                                      ├─ 6. 收到集合點，看到距離與時間
  │                                      │
  └─ (重複 5~6 直到活動結束)              └─ (持續更新)
```

### 3.2 步驟一：Leader 登入並建立 group

**輸入**：暱稱（1–20 字元）

**操作**：
1. 開啟 App，看到「你是 Leader 還是 Follower？」選擇畫面。
2. 選擇 **Leader**，輸入暱稱。
3. 點擊「建立 group」。

**輸出**：
- 產生唯一 group code（6 位英數，不區分大小寫）
- 進入地圖主畫面，地圖上顯示 Leader 自身位置
- group code 顯示於畫面上方，方便 Leader 口頭或截圖告知成員

**狀態變化**：
- 後端建立 Group 記錄，Leader 的 Membership 寫入
- 開始廣播 Leader 位置

### 3.3 步驟二：Follower 以 group code 加入 group

**輸入**：暱稱 + group code

**操作**：
1. 開啟 App，選擇 **Follower**，輸入暱稱。
2. 輸入 group code（支援手動輸入，`MVP+` 可考慮 QR code）。
3. 點擊「加入」。

**輸出**：
- 進入地圖主畫面
- 地圖上出現 Leader 與其他已加入成員的位置

**錯誤情境**：
- group code 不存在 → 顯示「找不到此 group，請確認代碼」
- 暱稱為空 → 輸入欄標紅 + 提示文字

### 3.4 步驟三：所有人位置顯示在地圖上

**行為**：
- 每位成員（含 Leader）的位置以頭像 pin 顯示，pin 上方顯示暱稱。
- 位置更新頻率：`5 秒`（前景），`30 秒`（背景，視平台限制）。
- 地圖自動縮放至包含所有成員的 bounding box（首次進入時）。

**權限請求**（iOS）：
- App 啟動後立即請求「使用期間的定位權限」（`NSLocationWhenInUseUsageDescription`）。
- 若使用者拒絕 → 顯示 modal 說明需要定位才能使用 Hither，引導至 `UIApplication.openSettingsURLString`。
- Android 對應為 `ACCESS_FINE_LOCATION`，由平台 adapter 封裝（`MVP+`）。

**基本離線處理**：
- 失去網路 → 顯示 banner「目前離線，位置可能不準確」。
- 成員超過 30 秒未收到位置更新 → pin 變灰，顯示「最後位置」。

### 3.5 步驟四：Leader 設定下一個集合點

**操作**：
1. Leader 長按地圖上任意位置，出現「設為集合點」按鈕。
2. 確認後，該點以醒目圖示標記在地圖上。
3. 所有 Follower 即時收到新集合點。

**限制**：
- 同時只有一個 active meeting point。
- Leader 再次設點 → 舊集合點自動歸檔（不刪除，但不顯示在地圖上）。

**狀態變化**：
- 後端寫入 MeetingPoint 記錄，廣播給所有 group 成員。

### 3.6 步驟五：Follower 看到集合點 + 距離與預估時間

**畫面呈現**：
- 地圖上以旗幟圖示標記集合點。
- 畫面底部資訊卡顯示：
  - 集合點名稱（若 Leader 有命名）或座標
  - 直線距離（公尺 < 1000m，公里 ≥ 1km）
  - 預估步行時間（以直線距離 ÷ 步行速度 1.4 m/s 計算，顯示「約 X 分鐘」）

**計算方式**：
- 距離：Haversine 公式，客戶端計算。
- 時間：`直線距離 ÷ 1.4 m/s`，無路線規劃（`MVP+` 可接 routing API）。

**更新**：
- 每次 Follower 位置更新時，距離/時間自動重算。

### 3.7 Live Activity（`MVP+`）

iOS 鎖定畫面/動態島（Dynamic Island）顯示集合點資訊：
- 剩餘距離、預估時間
- **本期不實作**，介面留 hook 位，待 iOS ActivityKit 整合後開啟。

### 3.8 邊界與錯誤情境（MVP 範圍內）

| 情境 | 處理方式 |
|------|---------|
| 無效 group code | 輸入欄提示錯誤，不進入 group |
| 定位權限被拒 | Modal 引導至系統設定，無法使用 App 核心功能 |
| Leader 離線 > 30s | Leader pin 變灰，成員仍可看到彼此位置 |
| Follower 主動離開 | 點擊「離開 group」→ 停止廣播位置，返回首頁 |
| 網路中斷 | Banner 提示，位置停止更新但地圖仍可瀏覽 |

---

## 4. Screens / UX 概要

### 4.1 畫面列表

| 畫面 | 路由（暫定） | 可見角色 |
|------|------------|---------|
| 角色選擇 | `/` | 所有人 |
| 暱稱輸入 + 建立 group | `/leader/create` | Leader |
| 暱稱輸入 + 加入 group | `/follower/join` | Follower |
| 地圖主畫面 | `/map` | 所有人 |
| 設定集合點（地圖 overlay） | `/map` 上層 | Leader |

### 4.2 地圖主畫面元素

```
┌─────────────────────────────────────┐
│  [group code: ABC123]    [離開]      │  ← 頂部 bar
├─────────────────────────────────────┤
│                                     │
│         [地圖]                      │
│   📍 Alex (Leader)                  │
│         🚩 集合點                   │
│   📍 Bob                            │
│                                     │
├─────────────────────────────────────┤
│  🚩 集合點  直線 320m  約 4 分鐘     │  ← 底部資訊卡
└─────────────────────────────────────┘
```

- **成員 pin**：圓形頭像（暱稱首字），Leader 用不同顏色區分。
- **集合點旗幟**：醒目旗幟圖示，點擊可查看詳情。
- **底部資訊卡**：無集合點時隱藏；Leader 畫面改為「長按地圖設定集合點」提示。

---

## 5. Technical Assumptions

### 5.1 高層架構

```
React Native App
      │
      ├── WebSocket / SSE  ──→  後端 Server（Node.js / Elixir，待定）
      │                               │
      └── REST API         ──→       ├── 位置廣播（Pub/Sub）
                                     └── PostgreSQL（Group, User, MeetingPoint）
```

MVP 使用 **WebSocket** 廣播位置更新，保持所有成員即時同步。後端技術選型為待確認決策點（見第 7 章）。

### 5.2 核心資料實體

**User**
| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID | 主鍵 |
| `nickname` | string | 暱稱，1–20 字元 |
| `device_token` | string | 本地 session 識別，匿名用 |
| `created_at` | timestamp | |

**Group**
| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID | 主鍵 |
| `code` | string | 6 位英數 group code |
| `leader_id` | UUID → User | |
| `status` | enum | `active` / `closed` |
| `created_at` | timestamp | |

**Membership**
| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID | |
| `group_id` | UUID → Group | |
| `user_id` | UUID → User | |
| `role` | enum | `leader` / `follower` |
| `joined_at` | timestamp | |

**MeetingPoint**
| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID | |
| `group_id` | UUID → Group | |
| `lat` | float | 緯度 |
| `lng` | float | 經度 |
| `name` | string? | 選填名稱 |
| `status` | enum | `active` / `archived` |
| `set_by` | UUID → User | 必為 Leader |
| `created_at` | timestamp | |

**LocationUpdate**（ephemeral，不長期儲存）
| 欄位 | 型別 | 說明 |
|------|------|------|
| `user_id` | UUID | |
| `group_id` | UUID | |
| `lat` | float | |
| `lng` | float | |
| `timestamp` | timestamp | |

> MVP 的 LocationUpdate **不寫入 DB**，只透過 WebSocket 廣播給 group 內所有成員。

### 5.3 地圖、定位與通知

**地圖與定位**

| 項目 | MVP（iOS） | Android 擴充時替換為 |
|------|-----------|-------------------|
| 開發框架 | React Native（Expo）| 同 |
| 地圖元件 | `react-native-maps`（`provider` 預設為 Apple Maps / MapKit） | 同套件切換 `provider="google"` |
| 定位 API | `expo-location`（封裝在 `LocationService` adapter） | 同 adapter，無需改動上層 |
| 地圖授權費用 | Apple Maps 免費 | Google Maps SDK 需 API key 與計費評估 |
| 前景更新頻率 | 5 秒 | 同 |
| 背景更新頻率 | 30 秒（iOS Background Location Mode） | Android Foreground Service（`MVP+`） |
| 電量考量 | `kCLLocationAccuracyHundredMeters`（balanced） | `PRIORITY_BALANCED_POWER_ACCURACY`（`MVP+`） |

**推播通知基礎架構**

| 項目 | MVP 狀態 | 說明 |
|------|---------|------|
| APNs 整合 | 基礎建立（`MVP`），功能停用 | `expo-notifications` 設置好 APNs 憑證；MVP 不主動推送，但架構就位以供 `MVP+` 開啟 |
| 推播功能啟用 | `MVP+` | 集合點更新、Leader 呼叫等推播在下一期實作 |

### 5.5 Platform Abstraction Strategy

iOS 優先但架構須對 Android 友好，規則如下：

| 層級 | 做法 |
|------|------|
| **地圖** | 使用 `react-native-maps`；MapKit（iOS）與 Google Maps（Android）透過 `provider` prop 切換，上層元件不感知差異 |
| **定位** | 所有 `expo-location` 呼叫封裝在 `src/services/LocationService.ts`，不直接散落在元件中 |
| **權限** | 封裝在 `src/services/PermissionService.ts`，對外只暴露 `requestLocationPermission(): Promise<PermissionStatus>`，Android 的 `ACCESS_FINE_LOCATION` 在同一個 service 內處理 |
| **Live Activity / 通知** | iOS-only 功能統一放在 `src/platform/ios/` 目錄，Android 對應放 `src/platform/android/`，由 `src/platform/index.ts` 依 `Platform.OS` 匯出 |
| **禁止** | 不允許在 UI 元件內直接寫 `Platform.OS === 'ios'` 條件判斷；平台差異一律下沉到 service / platform 層 |

### 5.4 明確的技術非目標

- 不做離線地圖快取
- 不儲存歷史位置軌跡
- 不做 E2E 加密（MVP 位置資料明文傳輸）
- 不啟用推播通知功能（APNs 基礎架構建立，但 MVP 不發送推播；成員在 App 前景即時更新已足夠）

---

## 6. Out of Scope

### 6.1 不做的功能（本期及近期）

| 功能 | 類別 |
|------|------|
| AR 路徑導引（相機 overlay 箭頭） | Out of scope |
| 熱區/熱力圖層（人流分佈視覺化） | Out of scope |
| AI 群體引導（自動建議集合點） | Out of scope |
| 勳章/成就系統 | Out of scope |
| 多 group 合併 | Out of scope |
| 聊天/語音通話 | Out of scope |
| 歷史軌跡回放 | Out of scope |
| 路線規劃（step-by-step navigation） | Out of scope |
| QR code 掃描加入 | MVP+ |
| Live Activity（iOS 鎖定畫面） | MVP+ |
| 帳號系統（email/密碼/OAuth） | MVP+ |
| Push notification | MVP+ |
| Group 歷史記錄 | MVP+ |
| Android 支援 | MVP+ |

### 6.2 MVP+ 項目說明

`MVP+` 功能已確認有價值，但不阻擋 MVP 驗收。MVP 的程式架構應留好擴充介面，不需主動實作。

### 6.3 排除理由

MVP 的唯一驗收標準是：**在真機上跑通集合場景的 happy path**。所有讓這件事變複雜、卻對集合場景沒有直接幫助的功能，一律延後。範疇蔓延是最大風險。

---

## 7. Open Questions（待確認決策點）

| # | 問題 | 目前假設 | 需要誰拍板 |
|---|------|---------|-----------|
| 1 | 後端語言/框架 | Node.js（未定） | 技術負責人 |
| 2 | 地圖元件 | iOS MVP 用 Apple Maps（`react-native-maps` 預設），Android 擴充時切 Google Maps provider | 技術負責人確認 Android 時程後評估 |
| 3 | Follower 是否能互看位置 | MVP 可互看（見 2.3） | PM 確認 |
| 4 | group code 有效期 | 永久（直到 Leader 關閉） | PM 確認 |
| 5 | 最大 Follower 數量 | MVP 不設限 | 技術負責人評估 |
| 6 | 位置更新頻率（電量 vs 即時性取捨） | 前景 5s / 背景 30s | 技術負責人 |
| 7 | 匿名 session 過期機制 | App 關閉即失效 | 技術負責人 |
