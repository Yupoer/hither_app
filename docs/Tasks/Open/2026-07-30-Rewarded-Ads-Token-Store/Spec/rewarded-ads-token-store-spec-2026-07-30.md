# Rewarded Ads Token 商店 Spec

建立日期：2026-07-30  
狀態：ready-for-agent  
程式基準：`ebeeb5487faf179ff752bb76226fa22a55b35d4d`  
Supabase project：`htqrucnjafhhvxdqslbv`

## Problem Statement

Hither 現有地圖 Bottom Sheet 只有「成員、路線、工具」三個區塊，免費使用者只能透過既有 Paywall 或兌換碼取得 Premium，沒有一個可持續取得、查看與消耗 App 內權益的入口。

使用者希望主動觀看 Google 全螢幕獎勵型廣告取得 token，再用 token 解鎖團隊或個人權益，包括一日、三日、七日 Premium、一次性額外集合點額度，以及即時動態。這套機制必須符合既有產品邊界：

- Hither 仍是團隊集合與協調產品，廣告不能插入導航、集合點或成員操作流程。
- Free Plan 每個 itinerary 可同時保留最多 5 個未完成集合點。
- Premium 與額外集合點額度必須由 server 判定，client 不得自行寫入 Pro、token 或額度。
- token 屬於已註冊帳號；團隊商品與個人商品必須明確區分。
- Google Rewarded Ads 的 client 完成事件不能單獨作為入帳依據，否則可被修改 client 或重播請求偽造。
- 現行 temporary unlimited gathering-points override 與 temporary direct Premium upgrade 只適合測試，不能成為正式商店的權益來源。

## Solution

在 Bottom Sheet 新增第四個「商店」區塊。四個區塊都能用點擊與左右滑動切換，但分頁列一次只顯示三個；隱藏的區塊可透過滑動分頁列或內容區切換後顯示。

商店顯示 server-authoritative token 餘額、Google Rewarded Ad 入口與商品列表。每個由使用者主動觀看、完成且通過 Google Server-side Verification（SSV）的廣告增加 1 token，不設每日、24 小時或累積觀看上限。同一時間仍只能存在一個有效廣告 session，且相同 Google transaction 只能入帳一次。

token 可兌換：

| 商品代碼 | 顯示名稱 | Scope | 初始價格 | 權益 |
|---|---|---|---:|---|
| `team_premium_1d` | Premium 一日卡 | 目前團隊 | 5 token | Premium 1 日 |
| `team_premium_3d` | Premium 三日卡 | 目前團隊 | 12 token | Premium 3 日 |
| `team_premium_7d` | Premium 七日卡 | 目前團隊 | 25 token | Premium 7 日 |
| `team_extra_points_3` | 額外 3 個集合點 | 目前團隊 | 4 token | 3 個一次性額度 |
| `team_extra_points_10` | 額外 10 個集合點 | 目前團隊 | 12 token | 10 個一次性額度 |
| `personal_live_activity_lifetime` | 即時動態永久解鎖 | 個人帳號 | 10 token | 永久使用即時動態 |

商品價格與啟用狀態由 server catalog 回傳；權益行為仍以固定 allow-list 實作，不建立任意規則引擎。

## User Stories

1. As a 已註冊使用者, I want to 在商店看到 token 餘額, so that 我知道目前能兌換哪些商品。
2. As a 已註冊使用者, I want to 主動點擊觀看廣告, so that 廣告不會打斷導航或其他核心工作。
3. As a 已註冊使用者, I want to 在觀看前知道完成後會得到 1 token, so that 交換條件清楚。
4. As a 已註冊使用者, I want to 在廣告尚未載入時看到載入狀態, so that 我不會反覆點擊沒有反應的按鈕。
5. As a 已註冊使用者, I want to 在目前沒有可用廣告時看到可重試結果, so that 無廣告供應不會被誤認為 App 壞掉。
6. As a 已註冊使用者, I want to 連續觀看任意數量的可用廣告, so that Hither 不會用每日上限阻止我累積 token。
7. As a 已註冊使用者, I want to 同一時間只啟動一個廣告, so that 重複點擊不會開啟多個廣告或產生錯誤獎勵。
8. As a 已註冊使用者, I want to 在廣告完成後看到「驗證中」, so that 我知道 Google 尚未完成 server 驗證。
9. As a 已註冊使用者, I want to 只在 Google 驗證成功後收到 token, so that 餘額可跨裝置保持一致。
10. As a 已註冊使用者, I want to 在 Google callback 延遲時稍後自動看到入帳, so that 我不必重看廣告或重新登入。
11. As a 已註冊使用者, I want to 重開 App 後由 server 恢復餘額, so that token 不依賴單一裝置的本地儲存。
12. As a 已註冊使用者, I want to 查看團隊商品與個人商品的區別, so that 我知道兌換會影響誰。
13. As a 已註冊使用者, I want to 看見每個商品的 token 價格與效果, so that 我能在扣款前做決定。
14. As a 已註冊使用者, I want to 在餘額不足時看到還缺多少 token, so that 我不會提交一定失敗的兌換。
15. As a 已註冊使用者, I want to 在兌換團隊商品前看到團隊名稱, so that 我不會把權益套用到錯誤旅程。
16. As a 團隊成員, I want to 用自己的 token 為目前團隊兌換商品, so that 團隊權益不只依賴 Leader 一人累積。
17. As a 團隊成員, I want to 兌換失敗時不被扣 token, so that 權益與餘額保持原子一致。
18. As a 團隊成員, I want to 兌換一日卡, so that 目前旅程能短期使用 Premium。
19. As a 團隊成員, I want to 兌換三日卡, so that 週末旅程能使用 Premium。
20. As a 團隊成員, I want to 兌換七日卡, so that 較長旅程能使用 Premium。
21. As a 團隊成員, I want to 在既有 token 日卡尚未到期時延長期限, so that 多次兌換不會浪費剩餘時間。
22. As a 團隊成員, I want to 在團隊已有永久、購買或 promo Premium 時停止重複兌換, so that token 不會花在沒有額外效果的商品上。
23. As a 帳號持有人, I want to 在帳號狀態看到 Premium 團隊、到期時間與剩餘時間, so that 我知道目前權益何時結束。
24. As a 行程編輯者, I want to 兌換額外 3 個集合點, so that 已達免費上限後仍能加入少量額外地點。
25. As a 行程編輯者, I want to 兌換額外 10 個集合點, so that 較完整的旅程可一次取得足夠額度。
26. As a 行程編輯者, I want to 在未完成集合點少於 5 個時優先使用免費容量, so that 不會提早消耗已購額度。
27. As a 行程編輯者, I want to 只在第 6 個以上集合點成功建立時消耗額度, so that 失敗或重複操作不會損失額度。
28. As a 行程編輯者, I want to 在路線頁看到剩餘額外額度, so that 我知道還能新增幾個超額集合點。
29. As a 行程編輯者, I want to 在剩餘額度為 0 時不看到額外狀態 UI, so that 平常畫面不增加無用資訊。
30. As a 行程編輯者, I want to 完成或刪除集合點後重新取得免費容量, so that Free Plan 的 5 點上限只計算未完成集合點。
31. As a 行程編輯者, I want to 已消耗的額外額度不因刪除或完成而退還, so that 一次性商品語意一致。
32. As a 團隊成員, I want to Premium 到期後仍可查看與完成已建立的集合點, so that 到期不會刪除旅程資料。
33. As a 帳號持有人, I want to 永久解鎖即時動態, so that 我能跨旅程與跨裝置使用。
34. As a 有效 Premium 團隊成員, I want to 在 Premium 期間使用即時動態, so that 團隊卡包含完整 Premium 體驗。
35. As a 未解鎖使用者, I want to 點擊即時動態時被帶到商店對應商品, so that 我知道如何取得權益。
36. As a 匿名使用者, I want to 在商店看到註冊提示, so that 我知道為什麼不能取得或兌換 token。
37. As a 匿名使用者, I want to 註冊後保留既有 UID 與 trip data, so that 開始使用商店不會失去原本旅程。
38. As a 使用者, I want to 點擊「成員、路線、工具、商店」切換內容, so that 四個區塊都能直接操作。
39. As a 使用者, I want to 左右滑動內容切換四個區塊, so that 單手操作不必每次點擊分頁。
40. As a 使用者, I want to 分頁列一次只顯示三個區塊, so that 每個標籤仍有足夠可讀寬度。
41. As a 使用者, I want to 滑動分頁列後點擊原本隱藏的商店, so that 隱藏不等於無法直接選取。
42. As a 使用者, I want to 選中隱藏頁時讓分頁列自動顯示該頁, so that 選中狀態永遠可見。
43. As a 使用者, I want to 水平切頁不干擾 Bottom Sheet 垂直拖曳, so that 原有地圖操作不退化。
44. As a 行程編輯者, I want to 水平切頁不干擾集合點拖曳排序, so that 新手勢不會造成誤排序。
45. As a 使用較大字體或粗體文字的使用者, I want to 四個分頁仍可辨識與操作, so that 商店符合既有可及性標準。
46. As a 使用螢幕閱讀器的使用者, I want to 聽到分頁選中、按鈕狀態與商品 scope, so that 不需依賴視覺判斷。
47. As a 離線使用者, I want to 看見最後同步的餘額與商品, so that 畫面不會空白。
48. As a 離線使用者, I want to 不能播放廣告或提交兌換, so that App 不會假裝離線操作已成功。
49. As a Hither operator, I want to 調整商品價格或停用商品, so that 商業測試不必重新發布 App。
50. As a Hither operator, I want to 每筆 token 變化都有不可變 ledger, so that 可以處理爭議與重複入帳。
51. As a Hither operator, I want to 拒絕未簽章、錯誤 ad unit 或重播的 Google callback, so that token 不會被偽造。
52. As a Hither operator, I want to 不在 diagnostics 記錄 callback 簽章、raw token 或個人資料, so that 商店不增加敏感資料外洩。

## Implementation Decisions

### 商業與權益

- 廣告只存在商店靜態頁，由使用者明確點擊；不在 App 開啟、導航開始、抵達、集合點完成或頁面切換時自動播放。
- 每個成功 SSV transaction 發放 1 token，不設每日、24 小時、週期或累積獎勵上限，也不在 AdMob 設 frequency cap。
- 無上限不代表無並行限制：每個帳號同一時間只能有一個未結束的廣告 session；session 完成、失敗或過期後才能建立下一個。
- token 為帳號 scope、不可轉讓、不可兌現、不可購買真實世界商品；帳號刪除時依帳號資料清理政策刪除。
- 匿名帳號不能建立廣告 session 或兌換商品；正式註冊沿用既有 UID 升級流程。
- 任何已註冊的有效團隊成員都能用自己的 token 為目前團隊兌換團隊商品；不是只有 Leader 能兌換。
- 團隊商品兌換前顯示目前團隊名稱、商品效果與不可退款提示。
- 商品 catalog 由 server 回傳價格、scope、排序與啟用狀態；grant 行為使用固定 product code allow-list，不接受資料庫中的任意執行規則。

### Token wallet 與 ledger

- server 保存每位使用者的 wallet balance，並以 append-only ledger 記錄廣告入帳、商品扣款與必要的管理調整。
- wallet 與 ledger 必須在同一資料庫交易內更新；balance 不得低於 0。
- client 的餘額只是 cache；App 啟動、登入、SSV 入帳與兌換後都以 server snapshot 收斂。
- 每筆 ledger 使用穩定 reference 去重：廣告使用 Google transaction ID，兌換使用 server 產生的 redemption ID。
- client 不得直接 insert/update wallet、ledger、團隊額度、個人即時動態授權或 trip entitlement。
- RLS 僅允許使用者讀取自己的 wallet 與必要 ledger 摘要；privileged 寫入只從簽章驗證 callback 或 server RPC 進行。

### Rewarded Ad session 與 SSV

- App 在載入廣告前先向 server 建立短效、不透明的 reward session；session 綁定目前使用者、平台、允許的 ad unit 與狀態。
- App 將 session reference 放入 Google SSV custom data，不傳 raw Supabase access token，也不依賴 client 提供可任意指定的獎勵數量。
- client 的 rewarded callback 只把 UI 切到「Google 驗證中」，不直接入帳。
- SSV endpoint 是公開 webhook，因 Google 不帶 Supabase JWT；endpoint 必須在 handler 內驗證 Google ECDSA signature 與 key ID。
- callback 只接受兩個 allow-listed Rewarded Ad Unit ID：
  - iOS：`ca-app-pub-8135109277557342/7899053731`
  - Android：`ca-app-pub-8135109277557342/7100977386`
- callback 驗證 session 存在、尚未使用、未過期、平台與 ad unit 相符，以及 Google reward amount/item 符合 `1 hither_token`。
- Google transaction ID 具有唯一約束；重複 callback 回傳可重試的成功結果，但不得再次入帳。
- SSV 延遲時 session 保持 verifying；App 透過 server snapshot／既有同步方式取得最終餘額，不要求使用者重看廣告。
- callback URL 使用 linked Supabase project 與固定 function name，部署後為：
  `https://htqrucnjafhhvxdqslbv.supabase.co/functions/v1/admob-reward-callback`
- 兩平台 AdMob Rewarded Ad Unit 都使用同一 callback URL；server 依 ad unit allow-list 分流。

### AdMob native 設定

- 使用支援 Expo config plugin、Rewarded Ads、SSV custom data 與 UMP consent 的 Google Mobile Ads React Native 整合。
- 原生設定使用：
  - iOS App ID：`ca-app-pub-8135109277557342~4266216474`
  - Android App ID：`ca-app-pub-8135109277557342~5387726456`
- 開發與自動化測試使用 Google 官方 test ad unit；正式 ad unit 只在 release-like／production build 啟用。
- native SDK 不存在、廣告未載入、沒有 fill、使用者取消、網路錯誤與 consent 尚未允許請求時，商店保留可恢復狀態，不 crash、不假發 token。
- 廣告 SDK 與 App ID 屬 native runtime 變更，必須建立新的 development／production build；EAS OTA 不能單獨交付此功能。
- AdMob Privacy & messaging／UMP consent 在請求廣告前完成；App 不是以兒童為主要受眾的假設必須在 production AdMob 設定中由帳號持有人確認。

### Premium 日卡

- 1／3／7 日卡綁定目前 trip，沿用 Small Trip 2–5 人適用範圍。
- 成功兌換後產生 server entitlement，source 明確標示為 token redemption。
- 有效 token 日卡再次兌換時，從既有到期時間延長對應天數；已過期則從 server 現在時間起算。
- 團隊已有有效 lifetime、verified purchase 或 promo entitlement 時，日卡兌換回傳 duplicate/not-applicable，且不扣 token。
- 日卡期間解鎖目前 Premium 權益、無限集合點與團隊成員的即時動態。
- Account／Premium 狀態顯示目前團隊、source、到期時間與剩餘時間；client 不自行推算是否仍有效，先以 server expires/status 判定。
- 日卡過期後保留旅程資料。若目前未完成集合點超過 Free 上限，既有點仍可查看、排序、導航與完成，但不得繼續新增，除非使用額外額度或再次取得 Premium。

### 額外集合點額度

- Free Plan 上限是每個 itinerary 最多 5 個 `closed_at IS NULL` 的未完成集合點；已完成集合點不占用免費容量。
- 現有 temporary unlimited override 必須撤除，正式限制回到 server trigger／shared mutation boundary。
- 團隊保存未消耗的 extra destination credits；兌換 3／10 點商品時增加對應數量。
- 新增集合點時先鎖定團隊並計算相同 itinerary scope 的未完成點數：
  - 少於 5：不消耗 credit。
  - 已達 5 且 Premium 有效：允許新增，不消耗 credit。
  - 已達 5、沒有 Premium、credit 大於 0：成功 insert 同一交易內扣 1。
  - 已達 5、沒有 Premium、credit 為 0：回傳 point-limit 錯誤。
- insert 失敗、權限失敗、重複請求或交易回滾時不得消耗 credit。
- 刪除或完成集合點會釋放免費容量，但不退還已消耗 credit。
- credit 沒有到期日，綁定 trip，不可移轉或退款；trip 刪除時一併清理。
- 路線頁只在 credit 大於 0 時顯示「額外集合點剩餘 N」。

### 即時動態

- 個人永久商品寫入 server-controlled user entitlement，並可在重裝、換機或切換 trip 後恢復。
- 使用即時動態的 effective entitlement 為「個人永久解鎖」或「目前團隊 Premium 有效」。
- 現有本機 `liveActivityEnabled` 只保存使用者偏好；effective entitlement 不成立時，即使偏好為 true 也不得啟動原生 Live Activity／Android Live Update。
- 未解鎖時，工具頁的即時動態操作顯示 locked，點擊後切到商店並定位商品。
- 權益恢復時保留先前本機偏好；若偏好仍為 true，可在下一個合法導航生命週期啟動，不因購買當下直接建立錯誤 session。

### 四分頁與商店 UI

- 分頁順序固定為 Members、Route、Tools、Store。
- 分頁 viewport 固定顯示三個等寬項目；第四個可由水平捲動分頁列露出。
- 點擊或內容水平 swipe 共用單一 selected-pane state。選中 viewport 外的項目時，分頁列自動捲動到完整可見。
- 內容 swipe 不循環；第一頁向右、第四頁向左不切換。
- 水平 gesture 使用方向門檻，與 Bottom Sheet 垂直 gesture 同時存在時只由主要方向接管；Route 拖曳排序中的水平位移不得切頁。
- 延伸現有 Segmented 與 gesture 能力，不加入 carousel、pager 或商店 UI dependency。
- 商店依序顯示 balance、Rewarded Ad CTA、廣告／驗證狀態、團隊商品、個人商品。
- 商品卡顯示名稱、scope、價格、效果、餘額不足差額與兌換狀態；團隊商品確認畫面顯示團隊名稱。
- 離線時可顯示最後 snapshot，但 watch/redeem disabled；不得建立本地待補發的 token 或兌換 outbox。
- 所有分頁、按鈕、商品 scope、locked／loading／verifying 狀態提供 accessibility role、label 與 state，並支援既有 Dynamic Type 上限與 Bold Text。

### Diagnostics 與營運

- 記錄 allow-listed 結果事件：ad load、show、dismiss、client reward callback、SSV verified/rejected、ledger credit、redemption success/failure 與 callback latency bucket。
- diagnostics 不包含 Google signature、完整 callback query、access token、raw session reference、精確 user ID 或座標。
- 無觀看上限不移除 invalid-traffic 防護：transaction idempotency、單一 active session、allow-listed ad units 與 Google signature verification 都是必要條件。
- 商品價格與 active 狀態可由 server 調整；第一版不提供管理 UI。

## Testing Decisions

- 測試外部可觀察行為，不以內部函式名稱、資料表存在或純文字搜尋當作主要驗收。
- **四分頁最高 seam**：輸入點擊、水平 swipe、垂直 drag 與 Route reorder gesture，驗證 selected pane、tab visibility 與原有操作結果。涵蓋第一／第四頁邊界、三格 viewport、自動捲動、Dynamic Type、Bold Text、reduced motion 與 accessibility state。
- **廣告最高 seam**：從 authenticated reward session 開始，到簽章正確的 Google SSV callback 使 wallet 增加 1。涵蓋 iOS／Android ad unit、延遲 callback、無效簽章、未知 key、錯誤 ad unit、錯誤 reward、過期／已用 session、同 transaction 重播與並行 callback。
- 廣告測試必須證明連續建立與完成多個 session 不受每日／24 小時上限阻擋，同時證明同帳號不能並行建立兩個 active session。
- **兌換最高 seam**：從 server catalog 商品與 wallet 餘額開始，經單一 redeem contract 到 team/user entitlement 與 ledger。涵蓋餘額不足、匿名、非成員、商品停用、錯誤 scope、重複 request、並行扣款與任何失敗不扣 token。
- Premium 測試涵蓋 1／3／7 日啟用、token 日卡累加、到期、2–5 人適用範圍、lifetime／purchase／promo 已存在時拒絕，以及到期後既有超額集合點仍可讀但不可新增。
- **集合點最高 seam**：從新增集合點的公開 mutation 到 itinerary item 與 remaining credit。涵蓋未完成點數 4、5、6、Premium on/off、credit 0/1、insert failure、並行 insert、completed/deleted 點釋放 Free 容量且不退款。
- 即時動態測試涵蓋個人永久 entitlement、團隊 Premium 臨時 entitlement、兩者皆無、Premium 到期、跨裝置 restore、本機偏好 true/false，以及 unsupported native runtime 的 graceful fallback。
- 商店 UI 測試涵蓋 anonymous gate、offline snapshot、no fill、load error、dismiss before reward、verifying、late credit、insufficient balance、兌換確認與錯誤恢復。
- migration／RLS 測試必須證明 client 不能直接修改 wallet、ledger、credits、user entitlement 或 trip entitlement；使用者只能讀自己的 wallet／ledger 與有 membership 的團隊狀態。
- Edge Function 測試使用保存的合成 SSV query/signature fixture 與 Google public-key fetch seam；不以正式廣告點擊作為自動測試。
- Android emulator 與 iOS simulator 使用 Google test ads驗證 native load/show/dismiss/reward callback；實際 production SSV 必須用 release-like build 與 AdMob test device 證據。
- Jest、TypeScript typecheck、SQL tests 與 Edge Function tests 是必要但不充分；它們不能證明 AdMob 帳號 readiness、正式 fill、Google invalid-traffic 判定、iOS 真機或 OEM Android 行為。

## Out of Scope

- 不建立 token 轉帳、贈送 token、現金兌換、加密貨幣或真實世界獎勵。
- 不建立每日廣告上限、每日 token 上限、streak、抽獎、隨機獎勵或觀看任務。
- 不加入 banner、一般 interstitial、app-open、native feed ads 或導航流程廣告。
- 不建立商店管理後台、折扣碼產生器、動態 grant DSL 或 A/B testing framework。
- 不在此功能決定 6–20 人 Large Plan 的價格與權益。
- 不實作 StoreKit／Play Billing 付款或退款；既有 verified purchase entitlement 保持獨立。
- 不讓額外集合點 credit 增加團隊人數上限。
- 不保證 Google 一定提供廣告、固定 eCPM、帳號審核通過或無效流量不會被 Google 限制。
- 不把開發測試廣告收入、client rewarded callback 或本地 AsyncStorage 當作正式 token 證據。
- 本 Spec 不包含 OTA、App Store／Google Play 提交、正式 Build 發布或 production credentials／付款資料設定。

## Further Notes

- 現有產品決策把廣告列為「尚未定案」，且已完成的 OTA-08 Spec 明確排除 token currency 與 Rewarded Ads。本 Spec 是較新的決策；歷史 Spec 保留，不回寫成當時已包含此功能。
- 廣告仍不是主要收入來源，只存在靜態商店頁，符合「不破壞導航與集合工作流」的產品邊界。
- Supabase CLI 已確認登入、linked project `htqrucnjafhhvxdqslbv` 狀態為 `ACTIVE_HEALTHY`；實作者可建立 migration、部署 Edge Function 並取得既定 callback URL。
- AdMob 已建立兩平台 App 與 Rewarded Ad Unit。App ID 與 Ad Unit ID 不是 secret；Google 帳號密碼、付款資訊與 Supabase service-role credential 不得寫入 repository。
- AdMob console 的 SSV callback、Privacy & messaging、付款／身分驗證與 app readiness 是外部發布狀態。能控制已登入的 AdMob browser session 時可代為設定；帳號持有人仍對法律聲明、兒童導向設定與付款資料負責。
- 目前 mobile dependency 尚未包含 Google Mobile Ads native SDK，因此 UI／JS 即使經 OTA 發布，也不能在舊 binary 顯示正式廣告。
- iOS 與 Android 可共用同一 SSV endpoint；server 必須以兩個 allow-listed ad unit 驗證平台來源，不能接受 callback 自行聲稱的任意 ad unit。
