# Hither Android 版實作前調查報告

> 調查日期：2026-07-20  
> 程式碼基準：`ee91cba`（2026-07-19）及目前工作區  
> 文件性質：可行性、平台差異、費用與風險調查；不是實作方案、排程或工作拆解。

## 1. 結論摘要

1. **App 內介面與主要業務功能可高度共用，不需要另寫一套 Android App。** 現有專案已是 Expo SDK 56、React Native 0.85.3、React 19.2.3，登入、Onboarding、地圖頁、群組、行程、即時同步、設定與 Supabase service 都在共用 TypeScript 層。
2. **「iPhone 1:1」應分成兩種定義：**
   - App 內畫面、資訊、操作流程：可追求接近 1:1。
   - OS 系統介面：只能做功能與資訊等價，不能像素級複製。Dynamic Island／ActivityKit 是 Apple 系統介面；Android 對應為 Live Updates、鎖定畫面通知、狀態列 chip 與一般 ongoing notification。
3. **Apple Maps 沒有原生 Android SDK。** Apple 官方的 MapKit JS 可跨 Android 使用，但本質是網頁地圖，通常需要 WebView；現有 `react-native-maps` 在 Android 原生後端就是 Google Maps。對 Hither 而言，Android 採 Google Maps 是與現有架構最一致、風險最低的選擇。
4. **Google Maps SDK for Android 的一般行動地圖載入目前是 unlimited no-cost SKU，但仍必須啟用 Google Cloud Billing 並使用 API key。** 「不用錢」不等於「不用綁帳單」。
5. **路線、距離與預估時間都有 Google API。** Routes API 可回傳路線 polyline、距離、時間、多交通模式；駕車可使用即時／預測交通資料計算 ETA。基本 Compute Routes Essentials 每月前 10,000 次免費。
6. **Google Places Text Search 有接近語意地點搜尋的能力，但不等於 Google Maps 消費者 App 的完整搜尋引擎。** 它可理解「台北車站附近適合聚餐的素食餐廳」這類文字與地理條件，但不保證與 Google Maps App 相同排序、結果、個人化或所有自然語言意圖。
7. **目前 Android 不是可直接出 APK 的完成狀態。** 專案尚未產生 `apps/mobile/android/`；Android Maps、Live Activity、Push、Metrics 自訂模組仍是 stub，Android CLI 啟動器目前也無法在 PowerShell 執行。

## 2. 現有程式對 Android 的實際基礎

| 項目 | 現況 | 判定 |
|---|---|---|
| UI 與流程 | React Native 共用元件與 screens | 可共用大部分程式 |
| 地圖顯示 | `react-native-maps`，未指定 provider | iOS 使用 MapKit；Android 使用 Google Maps |
| 地點搜尋 | iOS `MKLocalSearch`；JS fallback 為 Photon → Nominatim | Android native stub 目前回傳空結果，必須處理 |
| 路線與 ETA | iOS `MKDirections`；失敗時用直線距離與固定速度估算 | Android native stub 尚無 Google Routes |
| 前景定位 | `expo-location` fallback 已存在 | 原則上跨平台，但需真機驗證 |
| 背景定位 | `expo-task-manager` + `expo-location`，已有 Android foreground service 參數 | 有共用邏輯，權限與 OEM 行為尚未驗證 |
| Live Activity | ActivityKit + Widget Extension 已有完整 iOS 實作 | Android module 明確回傳不支援 |
| Push | Supabase Edge Function 目前只送 APNs | Android FCM 尚未存在 |
| 登入 | guest、email、Google、Apple | Apple 原生元件只支援 iOS；Android 需 web OAuth 才能保留 Apple 登入 |
| 訂閱／購買 | `purchasePro()`、`restorePurchases()` 固定回傳 `unavailable` | iOS、Android 都尚未接商店購買 |
| Android 原生工程 | `apps/mobile/android/` 不存在 | 尚未 prebuild／編譯／安裝 APK 驗證 |

### 已查證的 Android stub 風險

- `hither-maps` Android module 的 `searchPlaces()` 回傳空陣列。共用 JS 把它視為一次成功的 native 呼叫，所以不會落入 Photon／Nominatim fallback。
- `hither-maps` Android module 的 `getDirections()` 回傳空 map；共用層最後會回到沒有 route 的直線距離估算。
- `hither-live-activity` Android module 的 `isSupported()` 固定為 `false`。
- `hither-notifications` Android module 不會取得 FCM token。
- `send-push` Edge Function 是 APNs fan-out，沒有 FCM 發送路徑。
- `app.json` 已宣告前景、背景與 foreground-service location 權限，但尚無 Android APK 實機驗證證據。

## 3. iPhone 介面能否 1:1 搬到 Android

### 可高度一致

- 登入、角色選擇、建立／加入隊伍、我的隊伍。
- 地圖上的隊員 marker、集合點、路線線條、卡片與 carousel。
- 三段式 bottom sheet、成員／路線／工具分頁、各 overlay。
- 集合點搜尋、加入、排序、跨日行程、集合時間、抵達與歷史。
- 小隊、暫時離隊、邀請／接受／拒絕、群組指令。
- 主題、字體縮放、Fredoka 字型、色彩、間距、動畫與震動回饋。
- Supabase Auth、Database、Realtime、RPC、RLS 與 diagnostics 業務邏輯。

### 只能做資訊與操作等價

| iPhone 能力 | Android 對應 | 差異 |
|---|---|---|
| ActivityKit Live Activity | Android 16 Live Updates | Android 由系統決定通知卡、鎖定畫面與狀態列 chip 呈現 |
| Dynamic Island expanded／compact／minimal | 狀態列 chip + promoted ongoing notification | 沒有 Apple Dynamic Island 的區域模型 |
| SwiftUI WidgetKit 自訂版面 | `ProgressStyle`／標準通知 style | Live Updates 禁止 custom `RemoteViews`，無法完整複製 avatar stack 與自訂排版 |
| iOS Liquid Glass | Android blur／半透明 surface | 材質、backdrop blur 與裝置渲染不同 |
| Apple Maps 字體、POI、道路樣式 | Google Maps 原生樣式 | 地圖資料與底圖品牌不可能相同 |
| Apple haptic patterns | Android vibration／haptic constants | 強度與手感受硬體/OEM 影響 |

因此可接受的「1:1」定義應是：**App 內資訊架構、功能、狀態、品牌視覺與操作順序一致；系統級介面遵守 Android 的系統元件與限制。**

## 4. Android 的 Live Activity 對應能力

Android 官方目前將這類功能稱為 **Live Updates**。Android 16（API 36）新增 progress-centric notification；符合條件時，系統可把通知提升到：

- 通知抽屜頂部；
- 鎖定畫面；
- 狀態列 chip；
- 部分 Wear OS 裝置。

Hither 的「前往集合點」屬於官方所定義的 ongoing、user-initiated、time-sensitive navigation journey，使用情境符合。

### 可對應的內容

- 集合點名稱。
- 剩餘距離與 ETA。
- 行程進度。
- 起點、目前位置、目的地或中途 milestone。
- 點擊回 App、停止導航等 action。
- 到達後結束 Live Update，轉成一般通知或移除。

### 無法完全對應的內容

- iOS Dynamic Island 的 leading／trailing／center／bottom 自訂區域。
- compact／minimal 的品牌化 Dynamic Island 版型。
- 目前 iOS Live Activity 中的完整 emoji avatar stack 與任意 SwiftUI layout。

原因不是技術選型，而是 Android 官方 Live Update 規則明確禁止 custom notification view（`RemoteViews`），只能使用 Standard、BigText、Call、Progress 或 Metric style。

### 相容性分層

| Android 版本 | 可用表現 |
|---|---|
| Android 16 / API 36 以上 | Live Update + `ProgressStyle`；可能顯示 promoted card 與狀態列 chip |
| 較舊 Android | location foreground service 的 ongoing notification；可顯示距離、ETA、進度與 action，但沒有 Android 16 chip |

Android 16 的 promotion 仍受使用者設定與 OEM 額外條件影響；App 不能保證每台裝置都被提升。Android 14 起，使用者也能 dismiss 某些 ongoing foreground notification。

## 5. Apple Maps 能否沿用到 Android

### 原生 Apple Maps：不行

Apple 沒有提供 Android 原生 MapKit SDK。`react-native-maps` 官方也明載 Android 使用 Google Maps；iOS 才能選 Apple Maps 或 Google Maps。

### MapKit JS：技術上可行

Apple 官方 MapKit JS 明確支援不同平台與作業系統，包括 Android，可提供：

- 互動地圖；
- annotation 與 overlay；
- 搜尋與 autocomplete；
- directions；
- place detail、Look Around。

官方目前提供每個 Apple Developer Program membership 每日 250,000 map views 與 25,000 service calls 免費額度。

### 對 Hither 的判定

MapKit JS 在 Android 通常需要 WebView 或受控網頁容器，會增加：

- React Native 與 WebView 手勢、camera、marker、polyline 的橋接；
- 背景／前景生命週期處理；
- token 簽發與更新；
- WebView 效能與 OEM 差異；
- 與現有 `react-native-maps` 原生元件不同的兩套地圖實作。

它能保留 Apple 地圖資料，但不會是 Android 原生 MapKit。現有程式已經讓 `react-native-maps` 在 Android 使用 Google Maps，因此本調查結論是：**Apple Maps 可用 MapKit JS 勉強沿用，但沒有必要；Android 改用 Google Maps 較符合現有架構與免費優先原則。**

## 6. Google Maps 的費用事實

截至 2026-07-20，Google Maps Platform 採 pay-as-you-go。各 SKU 有自己的每月免費額度；即使使用 no-cost SKU，仍需建立 Billing account、啟用 API、提供 API key 或支援的 OAuth token。

| Hither 需要的能力 | Google 產品／SKU | 每月免費額度 | 超過後全球牌價（每 1,000 次，第一級） |
|---|---|---:|---:|
| Android 原生互動地圖 | Maps SDK | Unlimited | 無 |
| 路線與 ETA | Compute Routes Essentials | 10,000 | US$5 |
| 多人／多點時間矩陣 | Compute Route Matrix Essentials | 10,000 billable elements | US$5 |
| 搜尋輸入建議 | Autocomplete Requests | 10,000 | US$2.83 |
| Text Search，僅 IDs | Text Search Essentials (IDs Only) | Unlimited | 無 |
| Text Search，需地點名稱等可顯示資料 | Text Search Pro | 5,000 | US$32 |
| Place Details 基本欄位 | Place Details Essentials | 10,000 | US$5 |
| App 內完整 turn-by-turn | Navigation Request | 1,000 destinations | US$25 |

注意：Hither 搜尋結果需要 `displayName`、地址、座標才能呈現和落點。Google 官方把 `displayName` 歸在 Text Search Pro，因此不能把「IDs Only unlimited」當成完整地點搜尋免費額度。

### 免費優先的成本控制邊界

- 單純顯示 Android 地圖：目前可視為無用量費，但要綁 Billing。
- 路線：每月 10,000 次免費，應設定每日 quota 與 budget alert，避免錯誤迴圈造成費用。
- 地點搜尋：真正可顯示名稱的 Text Search 免費額度為每月 5,000 次；輸入期間需 debounce、只在必要時查詢。
- REST web service key 不應直接裸放 APK。Google 建議 Android 優先使用原生 SDK；若行動端直呼未能安全限制的 web service，應由受驗證的 server proxy 代呼。

## 7. 路線規劃與交通時間能力

Google Routes API 可提供：

- 起點、終點與中途點路線；
- 距離；
- 預估時間；
- encoded polyline，能畫在現有 `GroupMap`；
- walking、driving、transit 等交通模式；
- 替代路線；
- 多點順序與 waypoint optimization；
- Route Matrix，可計算多名隊員到同一集合點的距離／時間。

駕車模式設為 `TRAFFIC_AWARE` 或 `TRAFFIC_AWARE_OPTIMAL` 時，回傳的 duration 會納入交通狀況；`trafficModel` 可影響預測模型。步行與大眾運輸不使用相同的道路車流模型。

### 與目前 Hither 的差距

目前 iOS 的本人路線使用 `MKDirections`；隊員列表預設不用 N 次路線請求，而是用 haversine 直線距離與固定速度估 ETA，避免耗電與 API 呼叫。Android stub 也因此只能顯示直線估算。

所以答案是：**Google 有真正的路線規劃與 ETA；如要所有隊員都用道路／步行路線 ETA，可使用 Route Matrix，但會比目前演算法產生更多 billable elements。**

### 外部 Google Maps 導航的零 API 費用選項

如果需求只是按下按鈕後交給 Google Maps App 導航，Google Maps URLs 可啟動搜尋、路線或導航，而且官方明載不需要 API key。這與「在 Hither 內顯示完整 turn-by-turn」是兩個不同等級的功能。

## 8. Google 地點搜尋是否等同 Google Maps 搜尋引擎

### 能做到的部分

Places Text Search 可接受自然文字，例如：

- `pizza in New York`
- `shoe stores near Ottawa`
- `Spicy Vegetarian Food in Sydney`
- `台北車站附近適合聚餐的素食餐廳`

也支援：

- location bias 或 location restriction；
- 語言與地區；
- place type；
- relevance 排序；
- 地址、店名、類別式搜尋；
- Autocomplete 的地點與 query predictions。

### 不能宣稱相同的部分

- 官方不保證相同請求每次回傳完全一致。
- Text Search 對多重概念、模糊意圖、非地理問題與部分非正式名稱有明載限制。
- API 文件沒有承諾與 Google Maps 消費者 App 相同的個人化、歷史脈絡、介面模組、商業排序或完整自然語言理解。
- App 必須自行設計 debounce、session token、location bias、field mask、顯示與錯誤狀態。

因此精確答案是：**有相似的文字／語意地點搜尋能力，品質通常會比目前 Photon／Nominatim 更接近 Google Maps，但不是把 Google Maps App 的完整搜尋引擎原封不動嵌入 Hither。**

## 9. 其他 iPhone 功能的 Android 對應

| 現有 iPhone 能力 | Android 可行性 | 已知限制／缺口 |
|---|---|---|
| Supabase guest／email／Google 登入 | 可等價 | Google OAuth 需 Android client 設定與 redirect 驗證 |
| Sign in with Apple | 可透過 Supabase Apple web OAuth 保留 | `expo-apple-authentication` 不支援 Android；Apple OAuth secret 每 6 個月需輪替 |
| APNs 一般推播 | 改用 FCM | 現有後端只有 APNs，尚無 Android token 與 FCM fan-out |
| 背景位置共享 | 可用 location foreground service | 需 runtime permissions、通知、啟動限制、電池優化與 OEM 實機測試 |
| 精確／約略位置 | Android 支援 | Android 12+ 使用者可只授權 approximate；流程不能假定一定取得 fine location |
| Liquid Glass | 可近似 | Android 沒有同一套系統材質；需以現有共用 glass token 做視覺等價 |
| Haptics | 可近似 | OEM／硬體差異大，不能保證手感相同 |
| KML 匯入 | 可共用 | Document picker 與檔案 URI 行為需 Android 驗證 |
| App 內購買／恢復購買 | 可用 Google Play Billing | 現有 iOS StoreKit 也尚未接；目前兩平台都 unavailable |
| OTA update | Expo Updates 可共用 | 原生模組或權限變更不能只靠 OTA，仍需新 APK |
| diagnostics／performance | JS 層可共用 | Android native metrics module 目前是空實作 |

## 10. APK 與發佈邊界

- APK 適合直接安裝、內測、QA 與私下分發。
- 若未來上 Google Play，標準發佈通常使用 AAB，由 Play 產生裝置對應 APK。
- 現有專案尚無生成的 Android native directory，因此「已安裝 Android CLI」不代表目前已具備可建置 APK 的完整環境。
- 本次實測 `android.exe` 位於 WinGet Links，但 PowerShell 無法執行，錯誤為沒有與此操作關聯的應用程式。這是工具啟動器問題，不是 App 程式錯誤。

## 11. 調查結論與決策建議

| 決策題 | 調查結論 |
|---|---|
| 是否重寫 Android UI | 不需要；保留共用 React Native UI，針對平台差異修正 |
| Android 地圖供應商 | Google Maps |
| 是否在 Android 繼續 Apple Maps | 不建議；只有 MapKit JS／WebView 路線，沒有原生 SDK |
| Android Live Activity | Android 16 Live Updates；舊版 ongoing foreground notification fallback |
| 能否與 Dynamic Island 完全相同 | 不能；應以資訊與狀態等價為驗收標準 |
| 路線／ETA | Google Routes API 可提供；駕車支援 traffic-aware ETA |
| 地點語意搜尋 | Places Text Search 可提供相似能力，不等於完整 Google Maps App 搜尋 |
| 免費策略 | Maps SDK 免費；Routes 10k/月；可顯示名稱的 Text Search Pro 5k/月；全部設 quota |
| App 內 turn-by-turn | 先視為不同產品層級；Navigation SDK 免費額度較低，超額費用高 |

## 12. 未來方向、未來功能、未來風險

### 未來方向

- 維持單一 React Native codebase，以 platform capability adapter 隔離 Google Maps、Live Updates、FCM 與 Android metrics。
- 將「App 內 1:1」與「OS 原生等價」分開驗收。
- 免費額度優先，對 Routes／Places 設硬 quota，而不只設費用警示。

### 未來可討論功能

- 所有隊員的 Route Matrix ETA。
- Android 16 Live Update progress milestones。
- 一鍵跳轉 Google Maps 外部導航。
- App 內 Google Navigation SDK turn-by-turn。
- Google Places Autocomplete／Text Search 與搜尋 session。
- FCM 遠端通知、Wear OS notification bridge。

### 未來風險

- Android OEM 對背景定位、通知提升與省電策略行為不同。
- Google Maps 綁 Billing；未限制 key／quota 會有濫用與超額費用風險。
- Places 的免費額度按 SKU 與 field mask 計費，錯選欄位可能提升費率。
- Live Updates 不支援自訂 RemoteViews，無法以 hack 保證 Dynamic Island 像素級復刻。
- Google Play 對背景定位有政策審查；APK 能安裝不代表能通過 Play 上架。
- 目前程式碼知識圖譜落後於工作區，實作前需重新索引或以實際檔案為準。
- 現有 Android native stubs 會讓部分 fallback 被短路，不能以「共用 JS 已存在」推定 Android 已可用。

## 13. 查證來源

### 專案內來源

- `apps/mobile/package.json`
- `apps/mobile/app.json`
- `apps/mobile/src/components/GroupMap.tsx`
- `apps/mobile/src/native/maps.ts`
- `apps/mobile/src/state/backgroundJourney.ts`
- `apps/mobile/src/state/useLiveActivity.ts`
- `apps/mobile/modules/hither-*/android/`
- `apps/mobile/targets/live-activity/`
- `supabase/functions/send-push/`
- `supabase/migrations/`

### 官方外部來源

- [Android Live Updates](https://developer.android.com/develop/ui/views/notifications/live-update)
- [Android 16 Progress-centric notifications](https://developer.android.com/about/versions/16/features)
- [Notification.ProgressStyle API 36](https://developer.android.com/reference/android/app/Notification.ProgressStyle)
- [Android foreground service types：location](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [Android runtime location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions/runtime)
- [Apple MapKit JS](https://developer.apple.com/documentation/mapkitjs/)
- [Apple Maps on the Web 額度](https://developer.apple.com/maps/web/)
- [react-native-maps installation：Android 使用 Google Maps](https://github.com/react-native-maps/react-native-maps/blob/master/docs/installation.md)
- [Google Maps SDK for Android billing](https://developers.google.com/maps/documentation/android-sdk/usage-and-billing)
- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Google Routes API](https://developers.google.com/maps/documentation/routes/compute_route_directions)
- [Google Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [Google Places data fields／SKU](https://developers.google.com/maps/documentation/places/web-service/data-fields)
- [Google Maps API key security](https://developers.google.com/maps/api-security-best-practices)
- [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)
- [Google Navigation SDK pricing](https://developers.google.com/maps/documentation/navigation/android-sdk/pricing)
- [Expo AppleAuthentication platform support](https://docs.expo.dev/versions/v56.0.0/sdk/apple-authentication/)
- [Supabase Login with Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple)

## 14. 2026-07-20 實作方向更新：Android 零成本邊界

### 設定狀態

使用者已回報以下準備工作完成：

- Google Maps SDK for Android API key 已建立。
- API key 已限制為 Android package `app.hither.mobile` 與 SHA-1 certificate fingerprint：`4E:7E:AE:F7:10:BF:D2:DA:9A:D6:61:E7:73:4A:78:63:37:5B:45:12`。
- `google-services.json` 已放入指定位置。
- Firebase FCM service-account JSON 已放入指定位置。
- Supabase CLI 與 EAS CLI 已登入。

API key 本身不寫入本文件。由於 API key 曾出現在對話內容，正式使用前應在 Google Cloud 重新建立一把受相同限制的新 key，並撤銷曾暴露的 key。

### Android 第一階段不使用付費 Google API

第一階段只使用 Maps SDK for Android 顯示地圖、marker、camera 與既有座標資料；不啟用 Places、Routes、Geocoding 或 Navigation API。這使 Google 地圖服務維持在 Maps SDK 的 no-cost SKU，但仍須保留 Billing、API key restriction 與 quota 監控。

### 功能保留與功能降級的精確定義

「不能新增地點」並不完全正確。Android 仍可新增集合點，只是不能使用 iOS 那種 App 內自然語言搜尋與相似地點結果：

| 功能 | Android 第一階段結果 | 說明 |
|---|---|---|
| 由匯入資料新增集合點 | 保留 | KML 或其他已含座標的資料可以直接建立集合點 |
| 從地圖點選／長按新增集合點 | 保留 | 取得座標後可建立自訂名稱的集合點 |
| 手動輸入經緯度新增集合點 | 保留 | 不需要 Places API |
| App 內輸入地址並顯示相似地點 | 暫停 | 不使用 Google Places，也不把公共 Nominatim autocomplete 當正式方案 |
| 已有集合點的距離計算 | 保留 | 使用裝置目前座標與目的地座標計算 haversine 距離 |
| 即時進度百分比／距離變化 | 保留 | 可依 GPS 更新距離與本地進度 |
| 道路交通精準 ETA | 降級 | 改為固定速度／直線距離估算，必須標示為估算值 |
| App 內道路路徑規劃與 route polyline | 暫停 | 不呼叫 Routes API；若匯入資料本身含路線 geometry，仍可顯示匯入 geometry |
| 導航按鈕 | 保留 | 使用目的地座標開啟外部 Google Maps URL；Google Maps 會在自身介面提供道路路線、交通與導航 |
| Hither 內同步外部 Google Maps 的精準 ETA | 不保證 | 外部 Google Maps 的路線與 ETA 不會自動回傳給 Hither |

因此，正確結論是：**Android 不是失去「新增地點」功能，而是失去 App 內的搜尋型新增流程；也不是失去導航按鈕，而是 Hither 不再自行計算道路路線與交通 ETA。**

### 以座標計算進度的限制

使用目前位置與集合點座標，可以可靠地取得：

- 目前距離；
- 距離變化趨勢；
- 是否接近集合點；
- 抵達半徑判定；
- 依固定速度推算的本地 ETA。

但它不能等同於道路 ETA，因為直線距離不包含道路拓撲、單行道、轉彎、橋樑、交通壅塞、步行路徑與大眾運輸班次。這套演算法適合 Hither 的集合進度與抵達判定，不應在 UI 中宣稱為 Google Maps 等級的精準到達時間。

### 實作順序

1. Android Maps SDK：顯示地圖、marker、集合點與既有路線 geometry。
2. FCM：取得 Android token，後端依 `platform` 將通知分流至 APNs 或 FCM。
3. 座標型集合點：匯入、長按選點、手動經緯度與自訂名稱。
4. 本機距離／進度／估算 ETA：沿用現有 domain logic，明確標示估算。
5. 導航 deep link：以 Google Maps URL 開啟外部搜尋、路線或導航；Maps URLs 不需要 API key。
6. Places／Routes：暫不實作，待真實使用量證明需要後，再以後端 quota 與 fail-closed 機制啟用。

### 本節查證來源補充

- [Expo Maps：Android SHA-1 與 Maps API key 設定](https://docs.expo.dev/versions/latest/sdk/maps/)
- [Firebase Admin：Service account private key](https://firebase.google.com/docs/admin/setup)
- [Google Maps URLs：不需要 API key](https://developers.google.com/maps/documentation/urls/get-started)
- [Google Maps SDK for Android Usage and Billing](https://developers.google.com/maps/documentation/android-sdk/usage-and-billing)
