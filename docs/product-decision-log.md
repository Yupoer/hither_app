# Hither 產品決策紀錄

最後更新：2026-07-30

本文件記錄已確認的產品策略、尚未定案的方案與主要取捨。若舊文件與本文件衝突，以較新的已確認決策為準；程式現況則以 `current-app-functional-architecture.md` 為準。

## 已確認決策

### 產品定位

- Hither 是旅遊團隊的集合與協調工作流，不是單純的多人追蹤地圖。
- 核心價值是讓團隊知道目前集合點、下一步、時間、抵達情況，並讓 Leader 只在例外發生時介入。
- Leader 負責行程與集合點；同行者取得必要資訊並回報自己的狀態。
- 「老人模式」統一稱為「被動同行者模式」，適用於長輩、小孩、低數位熟悉度或不想操作 App 的成員。

### 全隊與個人狀態

- 全隊共享目前集合點、集合點順序與全域行程 phase。
- 全域 phase 只有 `staying` 與 `en_route`：開始前與結束後是 `staying`，正在前往集合點時是 `en_route`。
- 單一集合點依序為 `pending → en_route → completed`。
- 可按操作只有「開始」與「結束」；「前往中」是開始後的不可按顯示狀態。
- 完成目前集合點並換下一個集合點時，上一點維持 `completed`，下一點在按開始前維持 `pending`。
- travel mode、粗略 ETA、個人位置、抵達與進度是 user-scoped，不得改寫全隊 phase 或集合點 status。

### 導航與協調

- Leader 啟動導航後立即進入前往中，不等待全員同意。
- 隊員回應是獨立狀態，可回報「知道了」、「我會晚到」或「需要協助」；未回覆不得視為同意或拒絕。
- 導航啟動不使用投票。
- 只有變更集合點、時間、路線或行程等真正協調請求，才使用回應、期限、共識／多數決或 Leader 覆寫等結案規則。

### 資料與同步

- 採 Local-first：裝置本地 SQLite 作為核心資料的即時讀寫來源，連線後同步 Supabase。
- 第一批 Local-first 資料包含 group snapshot、itinerary、active gathering state 與 navigation responses。
- 有網路時使用 Supabase Auth、Postgres、Realtime、Storage 與 Edge Functions；附近無網路互傳只先做技術 spike。
- 不加入網際網路 WebRTC P2P；只有 Supabase 成本或延遲出現實際問題時才重新評估。

### 商業化與解鎖

- 正式收費由 OTA-08 負責方案限制、Paywall、server entitlement 與兌換碼授權。
- Free Plan 最多 5 人（含 Leader），每個 itinerary 最多 5 個**未完成**集合點（`closed_at IS NULL`）。
- 2–5 人旅程可購買 7 天 Small Trip Premium Pass；權益綁定 trip。
- 兌換碼直接寫入同一套 entitlement，不建立獨立 Early Access 功能層。
- StoreKit／Play Billing、購買、恢復、收據驗證與退款／撤銷處理屬 BUILD-02。
- 6–20 人正式方案的價格與功能牆尚未定案；未定案前不先實作該方案。
- **2026-07-30 Rewarded Ads Token Store**（取代歷史 OTA-08「token／Rewarded Ads out of scope」決策；歷史 Spec 不回寫）：
  - 商店為 Bottom Sheet 第四分頁；廣告僅使用者主動點擊，不插入導航／集合流程。
  - Token 經 Google SSV 入帳，client 不得寫 wallet／ledger／credits／entitlements。
  - 可兌換團隊 Premium 日卡、額外集合點額度、個人即時動態永久解鎖。
  - 不設每日廣告上限；同一帳號僅一個 active reward session；transaction 冪等。

### 匿名帳號

- 匿名同行者有效期為 14 天，起算基準是加入群組的時間。
- 匿名使用者可建立／加入最多 5 人旅團（含 Leader）。
- 第 6 人加入前，匿名 Leader 必須完成註冊。
- 升級註冊必須保留 UID、membership、trip data 與有效權益；過期清理由 server 執行且具 idempotency。

### 平台與驗證

- iOS 與 Android 不刻意拉開上線時間，以各平台能通過測試與審查為準。
- iOS 可做真機驗證，但目前不列入功能完成條件。
- Android 目前只用 emulator；不宣稱 OEM 背景執行、FCM、耗電、Play Billing 或混合真機旅程已驗證。
- 真機驗證獨立追蹤，不阻塞目前 OTA／Build 規格整理。

### 外部資料與延後功能

- KML 匯入保留為主要批次匯入方式；Google Maps 短網址／分享路線匯入暫緩。
- 不爬取 Google Maps 網頁，也不承諾無 API 解析完整路線、轉乘與即時資訊。
- AI 外包、Apple Shortcuts、內建旅遊推薦、Solo Trip 與 Professional 方案暫不列入核心流程。
- 投票是附加協調工具，不是 onboarding 或導航啟動的核心流程。

## 尚未定案

| 項目 | 目前方向 | 尚未定案原因 |
|---|---|---|
| 被動同行者介面 | 優先評估同一 navigation tree 上的簡易 overlay；必須可隨時切回完整介面。 | 尚未決定 overlay 或簡化既有 UI。 |
| 6–20 人方案 | 可能採 Large Free／Premium。 | 功能界線、價格與是否限時完整體驗尚未確認。 |
| 廣告營收規模 | 已定：只限商店靜態頁、Rewarded + SSV；非主收入。 | eCPM、AdMob 帳號 readiness、正式 fill 率仍依 Google。 |
| Nearby Connections | 先做小型跨平台技術 spike。 | 背景執行、權限、裝置數量與跨平台可靠性尚未證實。 |
| Live Activity 互動 | 先維持資訊優先，必要時再加入單一情境動作。 | iOS 版本、驗證與跨平台一致性成本高。 |

## 主要取捨

| 決策 | 得到 | 犧牲／風險 |
|---|---|---|
| 5 人永久免費 | 降低小團使用門檻。 | 5 人以上進入付費牆，免費使用仍有資料與通知成本。 |
| 匿名 14 天 | 覆蓋較長旅行，降低中途失效。 | 註冊誘因變弱，必須清楚提示資料期限。 |
| 立即啟動導航 | 不讓投票阻塞出發。 | 行程變更需另外建立協調請求。 |
| Local-first | 離線可查看與操作，未來可共用 operation protocol。 | 需要處理版本、重送、衝突與資料一致性。 |
| 暫緩 Android 真機 | 降低目前測試成本。 | OEM 背景限制與 Play Billing 風險延後到 release。 |

