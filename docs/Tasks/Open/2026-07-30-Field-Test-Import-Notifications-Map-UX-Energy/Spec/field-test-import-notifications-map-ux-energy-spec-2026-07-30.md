# Field Test：匯入、通知、地圖 UX 與耗電穩定性 Spec

建立日期：2026-07-30  
狀態：Draft for ticket approval  
程式基準：`ebeeb5487faf179ff752bb76226fa22a55b35d4d`  
診斷樣本：development build 0.1.3，2026-07-27 至 2026-07-30，175 筆事件、19 個 App session

## Problem Statement

使用者在原地進行 App 點擊測試時，同時遇到五組問題：

1. 選擇 KML／KMZ 後無法開啟或解析，而且尚未找出穩定觸發條件。
2. 本機通知、Realtime 同步通知與遠端推播的收件人規則不一致；開始行程缺少操作者本機回饋，隊長與成員應收到的事件也沒有一份可驗證的完整矩陣。
3. 路線入口、分享／搜尋動畫與長按新增集合點的相機動作，不符合操作階段。
4. 集合點只能調整順序與每日顏色，不能為各天的每個集合點設定專屬 Emoji 與顏色。
5. 即使沒有移動，持續操作 App 仍會感到手機明顯發熱；現有診斷能指出部分昂貴工作，但不能單獨證明是定位、網路、UI 渲染或其他原生工作造成。

目前診斷樣本可確認：

- 42 次 `background_op_timeline` 的總耗時中，`outbox_flush` 佔 87.4%。
- 背景工作的中位數為 82 ms、p95 為 1964 ms、最大值為 2354 ms；5 次超過 1 秒。
- 有 20 次位置上傳排程重試、1 次永久拒絕。
- 有 40 次 `live_activity_token_register` 的 `token_unique_unresolved`。
- 有 13 次 `arrival_confirmed`、8 次 `previous_launch_incomplete`、9 次無法分類的 native metric。

這些資料代表「位置 outbox 與 Live Activity token 註冊值得優先調查」，但沒有 CPU、GPU、frame、thermal state、定位 owner 與網路喚醒次數，因此不能把手機發熱直接歸因到其中一項，也不能把 `previous_launch_incomplete` 當成已證實 crash。

## Solution

建立一套可重現、可驗證的修正：

1. 讓 KML／KMZ 從系統文件選擇器到預覽的每個階段都有明確結果，並支援 iOS／Android 常見本機與雲端文件來源。
2. 以單一通知矩陣統一本機操作者回饋、Realtime fallback 與遠端推播的事件、角色、scope、sender 與去重規則。
3. 讓動畫結束格由外部操作生命週期控制；讓長按與加入集合點各自只做一次正確的相機動作。
4. 在集合點資料上保存 Emoji 與顏色，於編輯順序頁提供 26 組預設與單一 Unicode Emoji 自訂輸入。
5. 先用同裝置、同 build、同操作腳本建立耗電基線，再只修正證據指向的定位、同步、token 或 render 熱點，最後以 release-like build 重測。

## User Stories

1. As a 行程建立者, I want to 選擇 KML 檔後看到集合點預覽, so that 我能確認內容再匯入。
2. As a 行程建立者, I want to 選擇 KMZ 檔後由 App 找到其中的 KML, so that Google 我的地圖匯出檔可以直接使用。
3. As a 行程建立者, I want to 從 iCloud Drive、Files、Google Drive 或 Android 文件 provider 選檔, so that 匯入不依賴單一儲存來源。
4. As a 行程建立者, I want to 在選檔取消時回到原畫面, so that 取消不會被顯示成錯誤。
5. As a 行程建立者, I want to 在讀檔、解壓、格式或內容失敗時看到可區分的錯誤, so that 我知道要換檔案、重試或回報。
6. As a 行程建立者, I want to 失敗後保留匯入頁並可重試, so that 不必重新走整段操作。
7. As a 行程操作者, I want to 在開始行程後收到自己裝置上的一次本機回饋, so that 我能確認動作已生效。
8. As a 抵達集合點的成員, I want to 在自動抵達成立後收到自己裝置上的一次本機回饋, so that 我知道系統已記錄抵達。
9. As a 通知發送者, I want to 一般廣播排除自己, so that 快捷指令不會回彈成自己的通知。
10. As a 隊伍成員, I want to 收到其他人發出的快捷指令, so that 我能立即回應隊伍指示。
11. As a 事件相關成員, I want to 收到自己 scope 內的例外與協調通知, so that 主隊與小隊不會互相產生無關噪音。
12. As a 隊長, I want to 收到成員提出的路線要求, so that 我能決定是否開始或調整路線。
13. As a 隊長, I want to 收到成員脫隊通知, so that 我能採取協調動作。
14. As a 隊長, I want to 收到成員抵達通知, so that 我能掌握目前集合進度。
15. As a 成員, I want to 只在自己的位置符合抵達距離規則時自動觸發抵達, so that 別人的位置或伺服器固定距離不會替我誤判。
16. As a 成員, I want to 低精度定位不會造成誤抵達, so that 漂移不會產生錯誤通知。
17. As a 隊長, I want to 同一成員同一集合點只收到一次抵達通知, so that Realtime、APNs／FCM 與重試不會重複提醒。
18. As a 使用者, I want to 清楚看到獨立的「調整集合點順序」操作框, so that 編輯入口不會埋在一般列表列中。
19. As a 使用者, I want to 分享動畫停在完成格直到系統分享視窗關閉, so that 動畫狀態符合操作仍在進行中。
20. As a 使用者, I want to 搜尋動畫停在完成格直到搜尋地點頁已顯示, so that 畫面切換不會先看到按鈕跳回原狀。
21. As a 使用減少動態效果設定的使用者, I want to 同樣能完成分享與搜尋, so that 關閉動畫不會阻擋功能。
22. As a 使用者, I want to 長按地圖後立即放大該位置, so that 我能確認 pin 是否放在正確區域。
23. As a 使用者, I want to 按下加入且成功後看到自己與集合點的合適範圍, so that 我能理解兩者距離。
24. As a 使用者, I want to 加入失敗時保留確認卡與相機位置, so that 我能修正名稱或重試。
25. As a 行程編輯者, I want to 為每一天的每個集合點設定專屬 Emoji 與顏色, so that 同一天內的景點也能快速區分。
26. As a 行程編輯者, I want to 從常見景點預設中快速選擇, so that 不必每次打開鍵盤。
27. As a 行程編輯者, I want to 從系統 Emoji 鍵盤輸入一個 Emoji, so that 預設庫不足時仍可自訂。
28. As a 跨裝置隊伍成員, I want to 收到標準 Unicode Emoji 與安全顏色值, so that 同步資料不會變成任意圖片、貼圖或無效字串。
29. As a 舊行程使用者, I want to 沒有設定 Emoji／顏色的集合點仍正常顯示, so that schema 更新不會破壞既有資料。
30. As a 測試者, I want to 用固定的原地操作腳本比較修改前後的 CPU、thermal、frame、定位與網路工作, so that 「發熱改善」有可重複的證據。
31. As a 使用者, I want to 原地操作時不因重複 token 註冊或失敗 outbox flush 產生無界重試, so that App 不會持續喚醒 CPU 與網路。
32. As a 使用者, I want to 正常的 30 秒至 1 分鐘被動同步與即時明確操作仍保留, so that 降低耗電不會犧牲核心協調即時性。

## Implementation Decisions

### 匯入

- 保留現有文件選擇器、KML parser 與 KMZ 解壓套件，不另建匯入框架。
- 將「選檔、取得可讀內容、KMZ 解壓、KML 解析、預覽」視為可分辨的階段；錯誤需記錄階段、平台、檔名副檔名、MIME 與大小，不記錄檔案內容或使用者路徑。
- 本機／provider URI 必須先轉成 App 可穩定讀取的快取資源，再交給同一 parser；不可假設每個平台都能直接以 `fetch` 讀取 `file://` 或 `content://`。
- 取消選檔不是錯誤；空檔、無 KML 的 KMZ、壓縮檔損壞、沒有 Point、非有限座標與超出安全大小才進入錯誤狀態。
- 保留現有匯入上限、隊長審批與逐筆進度語意，不在這次改成新的批次匯入協定。

### 通知

- 建立單一通知政策矩陣，讓本機 Realtime fallback 與遠端 send-push 共用相同事件語意；各傳輸層只負責送達，不自行發明收件人規則。
- 明確區分：
  - **操作者本機回饋**：開始行程、自己抵達；允許 sender 收到，且每個動作一次。
  - **同步事件通知**：快捷指令、例外與協調；一般情況排除 sender，依主隊／小隊／solo scope 過濾。
  - **隊長通知**：成員路線要求、脫隊、抵達；只送給該 group 的有效隊長。
- Realtime local 與 APNs／FCM 可能同時可用時，以穩定 event identity 去重，不以「裝置有 token」直接假設遠端一定送達。
- 抵達判定沿用目前的 accuracy-aware 狀態機與使用者設定的 arrival radius；伺服器保存結果並以 `(destination, user)` 冪等，不能使用舊的固定 30 m 規則覆蓋使用者設定。
- 抵達通知在「第一次成功保存該使用者於該集合點的抵達」後產生；重送位置、重開 App 或 Realtime 重播不得再次通知隊長。
- 開始行程的操作者本機回饋不得依賴資料庫 update payload 是否能可靠帶出 sender；由成功完成明確操作的 client 觸發。
- 通知偏好仍由 server authoritative 過濾；操作者本機成功回饋屬操作確認，不與其他成員廣播混為同一條 sender 排除規則。

### 路線與動畫

- 「調整集合點順序」移出一般 `listGroup`，使用現有 glass、spacing、Pressable 與 Amicro 動畫，成為獨立 framed action；不新增 UI library。
- 延伸現有 Amicro 按鈕的受控完成狀態，不建立第二套動畫元件。
- 分享按鈕在動畫完成後呼叫系統分享；系統分享 Promise 結束（完成或取消）後才回到起始格。分享失敗也必須解除 busy 狀態。
- 搜尋按鈕在動畫完成後開啟搜尋頁；搜尋頁完成顯示後才回到起始格。關閉、錯誤與 reduced-motion 路徑都不能留下永久 busy。
- 長按地圖時立即沿用既有單點相機 API，以搜尋選點相同的 neighborhood zoom 顯示 pin。
- 長按新增成功後沿用既有多座標 fit API，框住「自己位置 + 新集合點」；無可用自己位置時退回單點相機。寫入失敗時不進行成功後 fit。
- 搜尋選點既有可接受行為不因長按修正而改寫。

### 集合點 Emoji 與顏色

- Emoji 與顏色屬於每一個 itinerary item，不屬於整天的唯一 theme；day header 顏色保留原用途。
- 新欄位為 nullable，舊資料使用穩定 fallback；讀取、建立、更新、Realtime、local snapshot、outbox 與 Live Activity／map marker 投影必須保留資料。
- 顏色只接受產品 palette 內的十六進位值；不接受任意 CSS 字串。
- 自訂輸入只接受**一個標準 Unicode Emoji grapheme sequence**，包含 variation selector、膚色與合法 ZWJ 組合；拒絕一般文字、多個 Emoji、圖片、URL、貼圖與自訂字型內容。
- App 無法從系統 API 證明「某個 Emoji 在每一款手機都有 glyph」。因此產品保證的是標準 Unicode 資料可同步；舊 OS 沒有 glyph 時顯示 fallback，不承諾不同平台繪圖外觀完全相同。
- 不新增 Emoji 套件；優先使用執行環境的 Unicode property／grapheme 能力與一個小型可測 validator。若目標 Hermes build 缺少必要能力，才評估已安裝相依或最小 fallback。
- 提供以下 26 組預設：

| Emoji | 顏色 | 用途 |
|---|---|---|
| 🍽️ | `#F0883E` | 餐廳 |
| ☕ | `#A56A43` | 咖啡 |
| 🍜 | `#E85D4A` | 麵食 |
| 🍣 | `#E45C7A` | 日式料理 |
| 🍰 | `#F08BB4` | 甜點 |
| 🛍️ | `#B565C4` | 購物 |
| 🏨 | `#596DDE` | 飯店 |
| 🏠 | `#5B8DEF` | 住宿／住家 |
| 📍 | `#E8543F` | 一般地點 |
| ⭐ | `#F4C13E` | 重點 |
| 🏛️ | `#C58A55` | 博物館／文化 |
| ⛩️ | `#D65A5A` | 寺廟／神社 |
| 🏰 | `#8A6FD1` | 地標 |
| 🎡 | `#E86AA8` | 景點 |
| 🎢 | `#D94C68` | 樂園 |
| 🌊 | `#3D9DD9` | 水岸 |
| 🏖️ | `#46B8C8` | 海灘 |
| ⛰️ | `#6F8C62` | 山區 |
| 🌳 | `#4FAE72` | 公園 |
| 🌸 | `#E78AB4` | 花季 |
| 📷 | `#687CE5` | 拍照點 |
| 🚉 | `#4A90D9` | 車站 |
| 🚌 | `#2F9D86` | 公車 |
| ✈️ | `#6574CD` | 機場 |
| 🎫 | `#D69035` | 活動／票券 |
| 🧭 | `#5E6C84` | 中繼點 |

### 效能與發熱

- 不以「手機摸起來熱」或單一 diagnostic event 作為根因；先固定裝置、build、電量區間、亮度、網路、前景時間與操作腳本。
- 至少比較四個情境：靜置地圖、原地連續點擊、行程中靜止、High Accuracy 開／關。
- 每個情境記錄 CPU、thermal state、frame stall、記憶體、定位 callback／owner、路線重算、Realtime callback、render count、outbox enqueue／flush、網路請求數與 Live Activity token 註冊次數。
- 優先處理目前已出現的兩個高訊號：
  - `outbox_flush` p95 接近 2 秒且伴隨位置上傳重試。
  - 同裝置／session 重複出現 `token_unique_unresolved`。
- outbox 需維持現有序列化、coalescing、重試上限與永久拒絕丟棄；優化不能改成無界立即重試。
- Live Activity token 註冊需對同一 `(user, device, token, enabled)` 冪等；已知衝突不得每次 mount／token callback 都重送相同失敗。
- 被動位置保持 30 秒至 1 分鐘的產品更新語意；原地 liveness 可重用最後位置，明確操作仍立即同步。
- 只有 evidence 顯示 render、map route 或定位 owner 是主要耗用時才改該路徑；不先做大範圍 memoization 或降低所有更新頻率。

## Testing Decisions

- 測試外部行為，不鎖死內部函式名稱或以純文字搜尋代替主要驗證。
- **匯入最高 seam**：從文件 asset 到 `preview/error/cancelled` 狀態。以 KML、KMZ、空檔、損壞 zip、無 Point、無效座標、不同 URI scheme 建立 fixture matrix；另保留 iOS／Android 真實文件 picker gate。
- **通知最高 seam**：輸入事件、sender、recipient memberships、scope 與偏好，輸出唯一 recipient set 與 delivery kind。對應 SQL trigger／RPC、Edge Function 與 foreground Realtime fallback 都需驗證同一矩陣。
- 通知整合測試至少涵蓋：隊長 + 成員兩帳號、主隊 + 小隊、solo、sender、有／無 push token、Realtime 與遠端同時可用、重播同一 event。
- 抵達測試沿用現有 arrival radius 與 accuracy-aware reducer prior art；新增第一次保存才通知、重複 fix 不通知、不同 destination 可再次通知。
- **動畫最高 seam**：以受控 active state 驗證 animation complete、外部 Promise／頁面 open complete、reset 的先後順序；另驗證取消、throw、reduced motion。
- **相機最高 seam**：驗證長按只呼叫一次單點 zoom，成功加入只呼叫一次 self + destination fit，失敗不 fit，缺少 self 時使用 fallback。
- **Emoji 最高 seam**：從資料寫入到另一 client 讀取與 marker／編輯頁顯示。測試單一基本 Emoji、variation selector、膚色、ZWJ family、旗幟、keycap、文字、多 Emoji、URL、超長字串與無效顏色。
- schema／RPC 測試必須驗證舊資料 nullable fallback、權限、跨 group 拒絕與批次／Realtime payload 保留新欄位。
- **效能最高 seam**：同一 release-like build 的 before/after scenario。至少保留原始 trace、摘要與版本；通過條件需同時包含：
  - 沒有無界 token 註冊或位置上傳重試。
  - outbox p95 與超過 1 秒次數有明確下降，或有證據證明耗時在不可控網路等待且已移出高頻路徑。
  - 靜置／點擊情境沒有持續 serious thermal、明顯 CPU 飆高或 frame stall 回歸。
  - 被動同步與明確操作即時性仍符合產品語意。
- 現有 focused Jest、TypeScript typecheck 與 SQL／Edge Function tests 是必要但不充分；它們不能證明實機文件 provider、系統分享視窗、原生 Map 相機、APNs／FCM 或 thermal 結果。

## Out of Scope

- 不重寫 KML parser，也不支援任意 GIS 格式、Google Maps scraping 或自創 Emoji 圖片。
- 不保證每個 Unicode Emoji 在所有 OS 版本有相同 glyph 或相同繪圖。
- 不重新設計整個路線 overlay、通知設定頁或地圖視覺系統。
- 不改變「End Navigation 不等於 Complete Gathering Point」的既有語意。
- 不以這次工作移除 Realtime fallback；只有遠端推播在 release-like 環境被證實可靠後，才能另案移除。
- 不因發熱回報全面關閉定位、Live Activity、Realtime 或背景同步。
- 不在缺少實機／symbolicated／thermal evidence 時宣稱已解決所有發熱、crash 或 native 問題。
- 本規格不包含 OTA、build、App Store／Play 提交或 production migration 發布。

## Further Notes

- 目前匯入流程已有快取複製設定，但實際內容仍直接由 URI 讀取；現有測試沒有證明 iOS／Android provider 資源真的可讀。
- 目前 journey Realtime listener 明確排除執行 start 的隊長；因此開始行程的操作者回饋應走「成功操作後本機確認」，不是放寬所有 sender 排除。
- 目前 server message 已認識 `arrival` 類別，但盤點未找到完整、冪等的 arrival push producer；不可只補 UI banner。
- 目前長按 handler 的註解與行為都刻意不 zoom，而加入成功後會再次 center 單點；這是可直接對應預期行為的流程差異。
- 目前順序編輯器已有每日顏色，但集合點 domain model 沒有 Emoji／顏色；不能只存本機偏好，否則跨裝置不會同步。
- 先前效能任務已加入 outbox coalescing、節流與背景 stage timing；本次應沿用這些 seam，針對新資料找根因，不建立第二套 telemetry。
