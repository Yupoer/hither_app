# Hither — 目前產品狀態

> 最後更新：2026-09-08
> 程式基準：`origin/master`
> 本文件描述目前 mobile App 實際存在的產品流程、畫面與能力，不是 UI 實作規格，也不反向驅動 App。判定順序為：`apps/mobile/src` 與 `supabase` → 可驗證的執行／服務狀態 → 本文件。

## 1. 產品定位

Hither 是旅遊團隊的集合與協同行程 App。它把以下資訊放在同一個團隊工作區：

- **現在要去哪裡**：目前集合點、下一個行程點與行程順序。
- **大家在哪裡**：成員位置、距離、路線、ETA 與抵達狀態。
- **什麼時候集合**：集合日期、時間、倒數與逾時提醒。
- **誰需要協助**：隊員狀態、掉隊提醒、快捷指令與協調請求。

核心使用者是負責安排旅程的 **Leader（隊長）**，以及跟隨安排、回報狀態的 **Follower（隊員）**。產品重點是協調一趟實際旅程，不是單純顯示多人位置。

## 2. 目前使用流程

### 2.1 首次啟動

首次啟動由 `apps/mobile/src/onboarding/` 控制：

1. 核心介紹。
2. 定位與通知權限說明。
3. 選擇 `night`、`day`、`dusk` 或 `forest` 主題。
4. 選擇 Leader、Follower 或先瀏覽。
5. 依角色收集旅行目的、天數、出發日、旅伴與偏好。
6. 完成後保存本機完成狀態；登入後同步到 Profile。

使用者可在設定重設旅行偏好。完成 onboarding 後，重開 App 不會重複進入 onboarding。

### 2.2 帳號入口

登入入口目前包含以下五種畫面／狀態：

| 畫面 | 目前流程 |
| --- | --- |
| 登入 | Email／密碼、Google、Apple（平台可用時）、訪客身份 |
| 註冊 | Email、密碼、確認密碼；條款與隱私權政策只在註冊流程展示 |
| 忘記密碼 | 輸入 Email、寄送重設連結、重寄冷卻與錯誤提示 |
| 主畫面 | 建立群組、用代碼加入、查看既有隊伍 |
| 我的隊伍 | 查看隊名、人數、群組頭像、成員頭像與邀請代碼；可展開、進入、離開或清空隊伍 |

登入錯誤會依欄位或供應商顯示可操作的提示；註冊信未確認時可從同一流程重寄確認信。訪客流程會先揭露資料期限與功能限制，再由使用者確認。

### 2.3 建立或加入隊伍

- **建立群組**：輸入暱稱、群組名稱，選擇群組頭像與顏色。
- **用代碼加入**：輸入暱稱與 6 碼邀請代碼。
- 建立／加入成功後直接進入 Map 工作區，不再經過獨立 lobby。
- 同一個帳號可加入多個隊伍；每個隊伍有獨立群組頭像，成員則使用自己的個人頭像。

## 3. Map 工作區

MapScreen 是目前的主要產品工作區：地圖在底層，拉起的 glass bottom sheet 承載團隊、行程與工具。主要分頁為：

| 分頁 | 目前內容 |
| --- | --- |
| 成員 | 主隊／小隊成員、位置、距離、抵達狀態、隊伍與個人狀態 |
| 路線 | 目前與下一個集合點、行程 Carousel、搜尋／座標新增、日期與順序編輯、住宿、KML 匯入、導航與歷史 |
| 工具 | 快捷指令、通知偏好、邀請、設定、帳號、意見回饋與診斷 |
| 商店 | Premium 入口、動態商品、恢復購買、兌換碼與主動觀看廣告取得 Token |

### 3.1 地圖與行程

- 顯示自己的定位、成員 marker、Leader 標記、集合點與其他行程點。
- 支援重新定位、置中成員、符合路線範圍與受 bottom sheet 遮擋修正的 camera 計算。
- 以文字搜尋或座標新增地點；本人的路線可顯示距離、ETA 與 polyline。
- Leader 或可管理自己 scope 的小隊成員可新增、刪除、拖曳排序集合點。
- 行程支援出發日、跨日、集合時間、集合提醒、住宿與已完成／未完成狀態。
- KML 可批次解析景點名稱與座標，匯入時套用目前帳號與行程的容量限制。
- 抵達可由系統依距離與準確度判定，也可由使用者或 Leader 手動標記；完成後推進下一個行程點並寫入歷史。

### 3.2 團隊協調與導航

- Leader 可啟動、暫停、完成全隊導航 session；隊員回報是各自的狀態，不阻塞 Leader 開始導航。
- Realtime 同步目前集合點、成員狀態、位置與協調資料；重要變更由 server-authoritative RPC 處理。
- 支援 Leader／Follower 快捷指令與自訂指令，並依通知偏好送出 in-app／push 更新。
- 成員可使用 `follow`、`solo`、`away` 等狀態；小隊有自己的成員範圍、行程、通知與歷史投影。
- 掉隊提醒以集合點或團隊位置為目標，支援 Leader 調整門檻；不適用的 solo／小隊成員不列入主隊判定。

## 4. 帳號、資料與平台能力

- Supabase Auth 支援註冊帳號、Google、iOS Apple 與訪客 session。
- Local-first 資料使用本機 SQLite／快取承接團隊 snapshot、行程、集合與導航狀態，再與 Supabase 同步。
- 訪客資料自加入隊伍起最多保留 **14 天**；訪客升級為註冊帳號時保留同一 UID、membership、旅程資料與有效權益。
- 定位分享、高精度定位、通知類別、Live Activity 與 diagnostics 都由使用者控制；diagnostics 預設不啟用。
- 意見回饋可附帶 context tag、裝置資訊與畫面擷取；事件與錯誤先進本機佇列，再批次上傳。
- iOS 有 ActivityKit／Dynamic Island 的 Live Activity 路徑，顯示集合點、距離、ETA、進度與成員狀態；Android 對應能力維持在 native boundary。
- App 文字支援繁體中文與英文；文字大小、主題背景與通知偏好可在設定調整。

## 5. 目前介面外觀

目前入口畫面實際使用以下視覺語言，來源是 `LoginScreen`、`RoleSelectScreen`、`MyTeamsScreen`、`NativeGlassButton`、`NativeTeamCard` 與 `MetalforgeBackground`：

- 深色海軍藍、鏽橙與暖琥珀的 MetalForge 動態顆粒背景。
- iOS 使用原生 glass／SwiftUI 控制項；其他平台保留相同結構的 RN fallback。
- Hither 牧羊杖 Logo、白色無襯線文字與暖橙主 CTA。
- 登入頁以緊湊的登入／註冊分段控制、玻璃輸入框、全寬主按鈕、Google／Apple 圓形入口與訪客膠囊組成。
- 註冊頁只保留 Email、密碼、確認密碼與條款連結；密碼一致時在欄位內顯示確認狀態。
- 主畫面以「建立群組」與「用代碼加入」兩個等比例大按鈕為主要動作，下面是「查看隊伍」膠囊。
- 我的隊伍以玻璃卡片呈現群組頭像、隊名、人數、代碼與成員頭像堆疊；點擊卡片可展開細節。
- 互動控制使用系統／向量圖示；Emoji 保留給個人或群組頭像資料，不作為一般功能按鈕。

這些是目前 App 的產品外觀描述；`Hither Design System` 另行維護，不由本文件回寫或修改。

## 6. Free／Premium 目前邊界

目前 client 與 server contract 對齊的 Free Plan 上限如下；本機常數不是付費權益證明，最終由 server entitlement 判定。

| 項目 | Free Plan |
| --- | ---: |
| 每隊總人數（含 Leader） | 5 |
| 訪客成員 | 2 |
| 每個 itinerary 未完成集合點 | 5 |
| 單次 KML 匯入點數 | 5 |
| 掉隊提醒門檻 | 500 m |
| 歷史項目 | 3 |

Premium 目前有月訂閱、年訂閱與 2–5 人適用的 Small Trip Pass（啟用後 10 天）。商店價格由 StoreKit／Play 商品資料載入，不在 UI 寫死；購買、恢復、兌換與權益 projection 走 server verification，再完成 native transaction。實際商店帳號、真機購買、退款／撤銷與跨平台商店驗證仍屬外部驗收，不在本文件中宣稱已完成。

商店內的 Rewarded Ads 只由使用者主動觸發，Token 入帳由 server-side verification 處理；client 不直接寫 wallet、ledger 或 entitlement。

## 7. 不列入目前核心範圍

- 不做社群動態牆、公開旅遊內容或以社交互動取代隊伍協調。
- 不做 AI 自動排行程；目前先以搜尋、手動編輯與 KML 匯入完成規劃流程。
- 不重造 Apple Maps／Google Maps 的逐步導航；Hither 提供集合協調與外部導航入口。
- 不以網頁版取代 iOS／Android 的實際移動工作區。
- 不把 AR 路徑、跨品牌 Bluetooth 離線中繼或 Nearby P2P 當作目前產品承諾。

## 8. 外部驗收邊界

程式碼存在不等於所有平台能力已被驗證。以下項目需另以指定環境驗收：

- iOS／Android 真機的背景定位、推播、Live Activity／Live Updates 與權限流程。
- App Store／Google Play 商品、交易、收據／JWS 驗證、恢復、退款與撤銷。
- Android OEM 背景存活、耗電與跨裝置完整旅程。

## 9. 相關長期文件

- [目前 App 功能與架構](./current-app-functional-architecture.md)
- [產品決策紀錄](./product-decision-log.md)
- [文件索引](./README.md)
