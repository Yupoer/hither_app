# iOS 能耗、Premium 訂閱、路線與地圖 UX Spec

建立日期：2026-08-04
狀態：ready-for-agent；ticket breakdown 與測試接縫已於 2026-08-04 核准
規劃基準：`origin/master`（調查時為 `2b61da8`）
目標執行方式：獨立 worktree，由 `Subagent 5.6 Luna-Effort-Max` 實作

## Problem Statement

使用者在 iPhone 12 Pro 與 M2 iPad 開啟 Hither 後，前兩到三分鐘內都能感受到快速發熱與高耗電。這已排除「只有舊手機晶片或電池不足」的單一解釋。現有遠端資料能證明 App 在前景定期發出偏多的群組完整快照與協調請求，但目前取樣頻率過低，也沒有 GPU、MapKit compositor、Core Location 能耗或 radio wakeup，因此不能把發熱直接歸因於後端 API、React render 或 MapKit 任一方。

最近一個 iPad development build 0.1.5／build 43 session 顯示 CPU 約 0–5.5%、畫面約 59–60 FPS、thermal state 為 nominal；同時記憶體在約五分鐘內由 497 MB 增至 662 MB，session 結束時約 710 MB。該 session 的五分鐘 API 視窗有 75 個 REST 請求，其中群組狀態會每 60 秒以多個 endpoint 重抓完整資料，協調請求則每 45 秒固定寫入 deadline resolver 再讀取結果。這些是已確認的成本，但仍需實機 profiling 才能判定主要熱源。

Premium 目前在最新遠端分支已有 expo-iap、StoreKit bridge、購買 UI 與一版 Edge Function，但仍不符合正式付費安全性。伺服器沒有驗證 Apple 簽章，任意合格式 transaction ID 可能被當成已付款；Client 又在伺服器持久化權益前完成交易，存在「付款成功但沒有 Premium」的風險。現有七天 trip pass 模型也已被產品決策取代。

新的 Premium 是每位使用者獨立持有的自動續訂訂閱：月費 NT$60、年費 NT$400，首次符合資格的訂閱者享七天免費試用，試用結束後依所選週期自動續費。個人 Premium 功能只屬於訂閱者；團隊 Premium 功能則在目前團隊至少有一名有效 Premium 成員時整趟開啟。若最後一名 Premium 成員離隊、到期、退款或被撤銷，團隊功能必須關閉。

iOS 路線目前對完整 MapKit 道路幾何套用固定 10 公尺簡化，導致圓環、彎道與道路凹角被截彎取直。縮放也沒有參與路線細節決策，因此近距離失真、遠距離又顯得過度細碎。地圖 UI 另有 Apple Maps Logo 隨 Bottom Sheet detent 跳動、羅盤被收合卡片遮住、集合點 Emoji 等後端成功才更新、分享／複製按鈕沒有合理 padding 且文字未以整顆按鈕置中等問題。

## Solution

以 `origin/master` 為基準在獨立 worktree 實作，保留目前髒工作區的未提交內容。效能工作先降低已證明的網路與 client polling 成本，並補上能覆蓋啟動前兩分鐘的觀測接縫；同時建立 Apple 原生 profiling protocol，將 CPU、GPU、MapKit、定位、網路喚醒、記憶體與 render 分開歸因。Realtime 維持即時來源，60 秒 polling 維持故障保底，但每輪多 endpoint 完整快照改為單一 server snapshot。協調請求 deadline 改由伺服器排程處理，沒有 open request 時 Client 不再每 45 秒固定寫入與讀取。

Premium 改為同一 subscription group 下的月訂閱與年訂閱。StoreKit 顯示 Apple 回傳的本地化價格與七天 introductory offer eligibility；Client 使用穩定的 app account token 將 Apple transaction 綁定 Hither 使用者。伺服器只接受 Apple 簽章驗證成功、bundle、environment、product、ownership 與狀態均符合的交易，之後才持久化個人 entitlement，再通知 Client 完成 transaction。App Store Server Notifications V2 驅動續訂、到期、退款與撤銷；所有 webhook 與購買重試保持冪等。任何驗證服務、憑證或交易資料不足都必須 fail closed，不得本地解鎖。

個人 Premium 與團隊 Premium 分開投影。個人功能檢查目前使用者 entitlement；團隊功能檢查目前 membership 集合中是否至少一名成員有有效 entitlement。成員加入、離開、被移除、訂閱續期、到期、退款或撤銷時，都重新計算團隊 Premium。這個投影不得把訂閱 ownership 轉移給 Leader，也不得讓離隊成員繼續替舊團隊解鎖。

路線資料層永遠保留 provider 回傳的完整道路幾何。近距離顯示完整道路；縮遠時才從未破壞的原始 geometry 依螢幕像素容差連續降低視覺細節，避免以固定公尺容差切穿圓環。縮放回近距離時必須恢復完整細節。Apple Maps Logo 固定在 map 底部基準，不再隨 detent 跳動，並由 Peak sheet 的可視範圍自然遮罩。羅盤移到 safe area 與收合卡片之外，旋轉時完整露出。

集合點 Emoji／顏色確認後立即投影到地圖 marker 並關閉選擇器；後端保存失敗時回復舊值並顯示可重試錯誤。分享與複製按鈕的 icon 固定在左側合理 inset，文字以整顆按鈕的幾何中心置中。

## User Stories

1. As a Hither 使用者, I want to 開啟 App 後不會在數分鐘內快速發熱, so that 我可以長時間使用地圖與集合功能
2. As a Hither 使用者, I want to 在前景待機時避免不必要的網路喚醒, so that 電量不會被固定輪詢持續消耗
3. As a Hither 使用者, I want to Realtime 更新仍然立即出現, so that 節能不會犧牲團隊同步速度
4. As a Hither 使用者, I want to Realtime 中斷時仍有 60 秒保底同步, so that 團隊資料不會永久停在舊狀態
5. As a Hither 使用者, I want to 一次保底同步只需要一個完整快照請求, so that App 不會每分鐘同時喚醒多個 endpoint
6. As a 沒有待處理協調請求的使用者, I want to App 不再固定執行 deadline RPC, so that 空閒狀態不產生無效寫入
7. As a 有待處理協調請求的使用者, I want to deadline 到期仍由伺服器準時結算, so that 關閉 App 不會阻止決策完成
8. As a Hither 維運者, I want to 取得啟動後 0、15、30、60、120 秒的效能樣本, so that 前兩分鐘發熱不再是觀測盲區
9. As a Hither 維運者, I want to 區分 CPU、GPU、MapKit、定位、網路與記憶體成本, so that 優化依據不是手感推測
10. As a Hither 維運者, I want to 知道每個定位 callback、route recalc、Realtime callback、snapshot 與 render 的頻率, so that 高頻 owner 可以被排序
11. As a Hither 維運者, I want to 透過 signpost 對齊啟動與地圖階段, so that Instruments 與正式環境報告能指回產品行為
12. As a Hither 維運者, I want to 長期接收 MetricKit 報告, so that 真實裝置上的 CPU、GPU、hang、memory 與 network 趨勢可以追蹤
13. As a Hither 發布者, I want to 效能改善附帶 before／after 請求量與實機 gate, so that 測試通過不會被誤稱為已解決發熱
14. As a 免費使用者, I want to 看見月費 NT$60 與年費 NT$400 的 Apple 本地化價格, so that 顯示內容與實際付款一致
15. As a 首次符合資格的訂閱者, I want to 獲得七天免費試用, so that 我能先體驗 Premium
16. As a 訂閱者, I want to 七天試用結束後依所選月費或年費自動續訂, so that Premium 不會無預警中斷
17. As a 不符合免費試用資格的使用者, I want to 付款頁顯示 Apple 判定的正確條件, so that App 不會承諾不存在的試用
18. As a 月訂閱者, I want to 在 Apple 管理訂閱中切換或取消, so that 收費由 App Store 規則管理
19. As a 年訂閱者, I want to 使用較低的年度總價, so that 我能選擇適合的方案
20. As a Premium 使用者, I want to 個人 Premium 功能只跟隨我的帳號, so that 離開團隊後仍保有自己的功能
21. As a 團隊成員, I want to 團隊內任一現役成員有 Premium 時開啟整趟團隊功能, so that 團隊不用每個人都訂閱
22. As a 團隊成員, I want to 最後一名 Premium 成員離隊時關閉團隊功能, so that 已離隊者不再替團隊提供權益
23. As a 團隊成員, I want to 最後一份訂閱到期、退款或撤銷時關閉團隊功能, so that 團隊權益與實際付款一致
24. As a Premium 成員, I want to 加入新團隊後立即讓該團隊取得團隊功能, so that 不必重新購買
25. As a 多團隊成員, I want to 我的有效 Premium 對我目前加入的每個團隊使用相同規則, so that 權益不被任意綁死在單一 trip
26. As a 已付款使用者, I want to 網路暫時失敗時交易不會過早完成, so that App 恢復後仍能補發權益
27. As a 已付款使用者, I want to 重啟 App 後自動重處理未完成交易, so that 不必再次付款
28. As a 恢復購買的使用者, I want to App 與伺服器重新核對 Apple 交易歷史, so that 換機後能恢復有效訂閱
29. As a Hither 維運者, I want to 只有 Apple 簽章驗證成功的交易才能授權, so that 偽造 transaction ID 無法取得 Premium
30. As a Hither 維運者, I want to webhook、購買重試與恢復都保持冪等, so that 同一交易不會重複建立 entitlement
31. As a Hither 維運者, I want to 收到續訂、到期、退款與撤銷通知, so that Premium 狀態不依賴使用者再次開啟 App
32. As a 地圖使用者, I want to 近距離路線沿著圓環與實際道路, so that 導航線不會截彎取直
33. As a 地圖使用者, I want to 縮遠時路線細節連續融合, so that 畫面不會塞滿無意義的小轉折
34. As a 地圖使用者, I want to 再次縮近時恢復完整路線, so that 遠距簡化不會破壞原始道路資料
35. As a 地圖使用者, I want to Apple Maps Logo 不隨 Peak／Stage 切換跳動, so that 地圖 chrome 保持穩定
36. As a 地圖使用者, I want to Logo 固定在 map 底部並由 Peak sheet 自然遮罩, so that Logo 不會跑進 sheet 的內容區
37. As a 旋轉地圖的使用者, I want to 羅盤完整露出且不被收合卡片遮擋, so that 我能辨識方向並回正地圖
38. As a 集合點管理者, I want to 確認 Emoji 後立即看見地圖 marker 更新, so that 操作不會像沒有生效
39. As a 集合點管理者, I want to 保存失敗時回復舊 marker 並看到錯誤, so that 地圖不會長期顯示未保存狀態
40. As a 邀請成員的使用者, I want to 分享與複製按鈕保有左側 padding, so that icon 不會貼住邊界
41. As a 邀請成員的使用者, I want to 按鈕文字以整顆按鈕置中, so that icon 不會把文字擠離中央
42. As a 使用動態字級的使用者, I want to 分享與複製按鈕在文字放大時仍能辨識, so that 可讀性設定不會破壞按鈕配置

## Implementation Decisions

### 基準與交付邊界

- 以最新 `origin/master` 建立獨立 worktree；不得改動目前 checkout 的未提交檔案。
- 規格、ticket 與實作分開。此規格由 Sol 定義架構與驗收；實作、測試、格式化與機械修改交由 Luna Max；完成後再由 Sol 審查實際 diff 與證據。
- 原生依賴、StoreKit、Pods、runtime version 與 iOS binary 變更需要新的 EAS iOS build，不能只靠 OTA。
- Edge Function、secrets、App Store Server Notifications 與 App Store Connect 商品設定不屬於 OTA。
- 本任務可以完成程式、測試與部署前驗證，但未經明確發布要求不執行 production migration、Edge deploy、OTA、TestFlight 或 App Store submit。

### 能耗與同步

- Realtime 是一般前景同步主路徑；60 秒 full snapshot polling 只作為 missed-event recovery，不改成更慢 cadence。
- full snapshot 由單一 server boundary 回傳群組、membership、profiles、subgroups、itinerary、locations 與必要版本資訊，避免每分鐘約七個獨立 round trip。
- snapshot response 必須有明確版本或 freshness marker，且不得覆寫仍在 pending 的本地 optimistic mutation。
- 協調請求 deadline 由伺服器排程 owner 執行，不由每一個 Client 週期性寫入。Client 透過 Realtime 接收結果，必要時以既有保底同步恢復。
- 啟動採樣在 0、15、30、60、120 秒建立有限次 burst；穩定期回到低頻採樣，避免監控本身變成耗電來源。
- 樣本包含 CPU、physical memory、FPS、thermal state、App state、tracking mode、location callback count、accepted location count、route recalc count、Realtime callback count、snapshot count、render count與 network request count。無法由 App 安全取得的 GPU／radio 資料不偽造，交由 Instruments 與 MetricKit。
- 使用 Apple signpost 標記 launch、map ready、location acquisition、snapshot、route calculate、marker render window 與 background transition；不得包含 token、座標、邀請碼或個人資料。
- 實機 protocol 固定比較 Map visible／非地圖頁、定位 on／off、網路 on／blocked，每個情境至少三分鐘；使用 Energy Log、Time Profiler、Animation Hitches／Core Animation、Metal System Trace、Network、Allocations／VM Tracker。
- 已確認的 request storm 直接改善；marker pulse、MapKit render 或定位策略只有在 profile 指向該 owner 時才調整，避免未經證據關閉必要功能。

### Premium 訂閱與權益

- Premium 是 Apple auto-renewable subscription，不再是七天 trip pass、consumable 或 non-consumable。
- 同一 subscription group 提供 monthly 與 annual 兩個方案。商業目標價格為月費 NT$60、年費 NT$400；App 顯示 StoreKit 回傳的 localized display price，不以硬編字串取代商店價格。
- 七天免費試用以 introductory offer 配置，資格由 App Store 判定。使用者在同一 subscription group 是否曾使用過 introductory offer，不由本地 flag 決定。
- Premium entitlement 以個人 Hither user 為 owner，使用穩定且不可逆推個資的 app account token 將 Apple transaction 與 Hither user 對應。
- 個人功能讀取 `personalPremiumActive`；團隊功能讀取 `teamPremiumActive = current memberships 中至少一名 personalPremiumActive`。不得把個人 entitlement 複製或轉移給團隊 Leader。
- membership 加入、離開、移除及 entitlement 狀態變更都必須觸發團隊 Premium 重算。最後一名有效 Premium 成員離隊或失效時，團隊功能關閉；若之後有有效 Premium 成員加入，團隊功能重新開啟。
- 伺服器是 Premium authority。Client 不得用 local Pro flag、未驗證 receipt、transaction ID 字串或 UI 狀態授權。
- 購買驗證需核對 Apple 簽章、bundle ID、environment、product ID、transaction／original transaction、app account token、purchase／expiry／revocation 狀態與 Hither user。任一必要資料無法驗證時 fail closed。
- 伺服器 durable grant 成功或確認交易已冪等處理後，Client 才 finish transaction。驗證或網路失敗時保留 unfinished transaction，啟動後可重處理。
- App Store Server Notifications V2 處理 renewal、expiration、refund、revocation 與方案變更；notification 與 purchase reconciliation 共用冪等 ledger。
- Restore 不只讀取單一本地 purchase；它以 Apple transaction history／current entitlement 與 Hither server ledger reconciliation 為準。
- 現有接受任意 transaction ID 的驗證端點在正式接線前必須 fail closed，不得部署成可授權狀態。
- 月／年商品 ID、subscription group、introductory offer、Paid Applications agreement、tax／banking、server API key 與 notifications URL 都是 release gate；repo 內的字串不能證明 App Store Connect 已配置。

### 路線幾何與縮放

- provider 回傳的道路 geometry 是 immutable source of truth；不得在資料層用固定公尺 tolerance 覆寫或快取成簡化版本。
- iOS 近距路線直接保留完整 MapKit geometry，不再無條件套用固定 10 公尺 RDP。
- 遠距細節降低以 viewport／zoom 對應的 screen-space tolerance 計算，從原始 geometry 每次派生；縮放變化採連續尺度，避免跨離散門檻跳變。
- 圓環、U-turn、大彎道與關鍵 maneuver anchor 在近距不得被 chord 取代。任何遠距簡化都只屬於視覺 LOD，不改變導航路徑或距離計算。
- region／camera 更新需節流，只有 zoom band 或有效 tolerance 變更時重算顯示 geometry，避免每個手勢 frame 都回到 JavaScript 做昂貴計算。

### 地圖 chrome

- Apple Maps Logo 使用固定 map-bottom 基準，不再使用已落定 detent 計算位置，也不在 sheet spring 前瞬間跳位。
- Peak sheet 的層級與 clipping 負責覆蓋 Logo；Logo 不得出現在 sheet 內容區。
- 羅盤選擇完整露出。位置需納入 safe area、右上卡片 footprint 與合理觸控間距；不可再依賴目前沒有 native layout 效果的 dead offset prop。
- 若採原生修補，需驗證實際 MapKit subview layout；若採自繪羅盤，需保持 heading、camera rotation、tap-to-north、accessibility 與 reduced-motion 行為。兩者擇一，以較小且可驗證的 native seam 為優先。

### Optimistic marker 與邀請按鈕

- Emoji／marker color 確認後，先保存 previous value、立即 patch optimistic destinations、關閉選擇器，再背景持久化。
- 保存成功後以 server response／Realtime 合併 optimistic state；保存失敗時只回復該次 mutation 的 previous value，顯示共享 recovery UI，不得回復使用者之後已做的新 mutation。
- 本項採 rollback，不新增離線 outbox。
- 分享／複製按鈕的文字以整個按鈕 bounds 幾何置中；icon 使用 absolute placement 並保持左側 16pt inset，不能讓 icon 寬度推動文字中心。
- 動態字級、窄螢幕與中英文文案下，icon、文字與 hit target 不得重疊或被裁切。

## Testing Decisions

- 測試最高接縫是「使用者操作／Realtime／polling／server authority → 可見 UI 與持久化結果」，避免只靠 source-string contract 宣稱功能成立。
- **效能同步接縫：** 在相同 60 秒窗口驗證 Realtime 仍即時、missed-event recovery 仍運作、full snapshot 從多個 endpoint 降為單一 request；沒有 open coordination request 時 Client deadline write 為零。
- **啟動觀測接縫：** 驗證 0、15、30、60、120 秒樣本只各產生一次、背景或 unmount 會取消排程、樣本不包含敏感資料，穩定期不維持高頻 timer。
- **Premium 購買接縫：** 從 StoreKit 商品與 introductory offer，經 verified transaction、server durable entitlement、finish transaction，到個人與團隊 UI。測試成功、取消、pending、驗證失敗、伺服器失敗、duplicate、重啟補處理與 restore。
- **Premium 安全接縫：** 偽造 transaction ID、錯誤 bundle／environment／product、app account token 不符、過期、退款、撤銷與重播都不得授權；合法 sandbox JWS 才可建立 entitlement。
- **團隊 Premium 接縫：** 測試零／一／多名 Premium 成員、Premium 成員加入、最後一名離隊、到期、退款、撤銷與重新加入。個人功能始終只跟隨本人，團隊功能跟隨當前 membership 聚合。
- **路線接縫：** 使用含圓環、U-turn、連續彎道與細小道路轉折的 fixture；近距幾何不得切穿道路，縮遠點數連續下降，縮回近距恢復原始幾何，距離與導航計算不受 LOD 影響。
- **地圖 chrome 接縫：** 實機或原生 snapshot 驗證 Peak／Stage 切換時 Logo 不跳動、Logo 不進入 sheet、旋轉後羅盤完整露出且可回正。JavaScript 字串存在不能當作原生 offset 已生效。
- **Optimistic marker 接縫：** 點確認後不等待 network 即更新 marker；成功不閃回，失敗只回復對應 mutation 並顯示錯誤；關閉 overlay 不是 commit 條件。
- **邀請按鈕接縫：** 用 layout／snapshot 驗證 icon inset 與文字幾何中心，並覆蓋中英文、動態字級與 iPad／iPhone 寬度。
- 自動化最低 gate 包含 focused tests、TypeScript typecheck、diff check 與既有相鄰 regression suites。基線 lint 問題需和本次新增問題分開，不得把既有 lint error 說成本次通過。
- iOS StoreKit、MapKit、Instruments、thermal 與付款 sheet 都需要含正確 native runtime 的 release-like 實機證據。Windows 上的 Jest／typecheck 不得替代這些 gate；無法執行時明確標示 Unverified。
- Server side 驗證使用 Apple sandbox transaction／notification fixtures 與 fail-closed tests；production secrets、正式扣款與 App Store 狀態不進入一般單元測試。

## Out of Scope

- 不在本規格直接執行 production migration、Edge Function deploy、OTA、EAS build、TestFlight、App Store submit 或正式扣款。
- 不宣稱目前 iPad 發熱已由單一 owner 解釋；在 Instruments 證據前，不任意關閉地圖、定位、marker pulse 或 Realtime。
- 不改變 Realtime 即時、60 秒保底同步、移動定位 30 秒與靜止定位 60 秒的既有產品節奏。
- 不把 End Navigation 改成 Complete Gathering Point，也不改變集合點完成語意。
- 不支援 family sharing、web checkout、外部付款、企業授權碼或團隊共用 Apple ID。
- 本輪不建立 Android Play Billing 訂閱；Android 可顯示不可購買／稍後支援狀態，但不得偽裝成已完成付款。
- 不重寫整個 MapScreen、Bottom Sheet、MapKit provider 或集合點 outbox。
- 不以第三方 RUM 取代 Apple Instruments 與 MetricKit；若日後加入 Sentry／其他服務，另行評估隱私、成本與採樣耗能。

## Further Notes

- 此規格取代「七天、綁 trip、NT$30」的 Premium 購買假設，但不覆寫舊任務的歷史文件。
- 月費 NT$60、年費 NT$400 是產品價格決策；App 畫面仍以 App Store Connect 回傳的 locale price 為準。
- 團隊 Premium 是目前 membership 上的衍生能力，不是 entitlement ownership。離隊只移除對團隊的貢獻，不取消個人訂閱。
- 現有 iPad 樣本顯示低 CPU 與正常 FPS，不能排除 GPU、MapKit、定位、radio wakeup 或記憶體壓力。約 500–700 MB 的 footprint 需要 Allocations／VM Tracker 區分 MapKit cache 與持續 leak。
- MetricKit 提供長期實機趨勢；Instruments 提供可重現的短期 owner 歸因。兩者和 Supabase request／Realtime observability 互補，不能互相替代。
- App Store Connect 的商品、subscription group、七天 introductory offer、合約與 server credentials 目前沒有 repo 內證據；完成程式不等於付款已可上線。
