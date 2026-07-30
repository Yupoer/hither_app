# Rewarded Ads、地圖與商店 UX 穩定性 Spec

建立日期：2026-07-30  
狀態：ready-for-agent  
關聯任務：2026-07-30-Rewarded-Ads-Token-Store

## Problem Statement

使用者在商店按下「觀看廣告」後，iOS App 會直接閃退，無法完成 Rewarded Ad、Server-side Verification（SSV）與 Token 入帳流程。Android 尚未取得同等裝置證據，但使用相同的 JavaScript 流程與原生廣告整合，因此也必須保留對等的設定與驗證入口。目前已知已提交的 iOS 原生專案與 Expo／Google Mobile Ads 設定存在不同步風險，但在取得原生例外前，不能把任何單一風險直接宣稱為已確認根因。

地圖的長按新增集合點流程也不可靠：長按產生的旗幟可能在加入後消失，集合點沒有出現在新集合點卡片；完成加入後，鏡頭也沒有穩定回到同時看見自己與集合點的範圍。原本底部新增彈窗內直接編輯名稱時，鍵盤會遮擋內容，但使用者不希望更換原本的新增彈窗，只希望點擊名稱後，另外開啟中央輸入視窗。

集合點管理目前提供過多 Emoji、仍有自訂 Emoji 入口、網格邊距與框線不一致，而且 Emoji 與旗幟背景色被綁在一起，造成選擇顏色後地圖旗幟不一定反映選擇。「調整順序」也只有小按鈕可觸發，鉛筆圖示的動畫與主題色回饋不一致。

成員、路線、工具、商店目前使用只露出三個項目的橫向 Tab，商店容易被忽略。切換 Tab 的橫向手勢還會與 Bottom Sheet 的縱向拖曳競爭，導致切換內容時誤移動 Sheet。

## Solution

先以 iOS release-like 執行環境取得 Rewarded Ads 的原生閃退證據與版本指紋，再依證據同步原生廣告設定、修正廣告生命週期，最後驗證「觀看廣告 → SSV → Token +1」的完整流程。任何缺少原生模組、舊版安裝檔、同意流程、載入、顯示、關閉或驗證錯誤，都必須回到可理解且可重試的狀態，不得閃退、卡死或錯誤發放 Token。

保留原本的底部新增地點彈窗。使用者點擊其中的地點名稱時，才在畫面中央開啟獨立的改名視窗；「確定」只更新尚未新增的草稿名稱，「取消」不修改草稿，實際新增仍由底部彈窗的原按鈕完成。加入成功後，同一份集合點狀態必須驅動集合點卡片、地圖旗幟與鏡頭範圍；加入失敗時則保留草稿與旗幟供重試。

Emoji 選擇器固定為 25 個內建 Emoji，移除 `🧭` 與自訂輸入。Emoji 與旗幟背景色改為兩個獨立選項，在同一視窗預覽，按下「確定」後一次儲存；「取消」完全不修改。調整順序改為整條可觸發，沿用既有動畫與主題色。

成員、路線、工具、商店改成四卡 CoverFlow 選擇器：四張長方形卡片同時可見，中央項目在最前方，其他項目依距離減少露出範圍並帶陰影。操作只接受左右滑動，不提供視覺箭頭或圓點；每跨越一個索引觸發一次震動。CoverFlow 橫向手勢與 Bottom Sheet 縱向拖曳必須互斥。

## User Stories

1. As a Hither 使用者, I want to 在商店按下觀看廣告時 App 不會閃退, so that 我可以正常使用 Token 功能
2. As a Hither 使用者, I want to 在原生廣告功能不可用時看到可理解的提示, so that 我知道需要更新 App 或稍後重試
3. As a Hither 使用者, I want to 在同意流程尚未完成時不會誤啟動廣告, so that App 不會進入錯誤狀態
4. As a Hither 使用者, I want to 在廣告無填充或載入失敗後可以再次嘗試, so that 一次失敗不會永久停用商店
5. As a Hither 使用者, I want to 在關閉未看完的廣告後不會獲得 Token, so that Token 規則保持一致
6. As a Hither 使用者, I want to 在看完廣告後等待伺服器驗證, so that Token 不由手機自行發放
7. As a Hither 使用者, I want to 同一筆廣告交易最多增加一個 Token, so that 重複 callback 不會重複入帳
8. As a Hither 使用者, I want to SSV 延遲時看到驗證中狀態, so that 我不會誤以為廣告失敗
9. As a Hither 使用者, I want to SSV 最終失敗時可以安全重試, so that App 不會卡在驗證中
10. As a Hither 維運者, I want to 取得去識別化的原生閃退與版本證據, so that 修復依據是實際根因而不是推測
11. As a Hither 維運者, I want to 分別記錄 iOS 與 Android 的驗證狀態, so that 未驗證平台不會被誤報為已通過
12. As a Hither 發布者, I want to 原生廣告設定變更被標示為需要新安裝檔, so that OTA 不會被誤用來宣稱修復原生整合
13. As a 地圖使用者, I want to 長按地圖後看見暫存旗幟, so that 我能確認準備加入的位置
14. As a 地圖使用者, I want to 保留原本底部新增地點彈窗, so that 既有加入流程不會突然改變
15. As a 地圖使用者, I want to 點擊底部彈窗的地點名稱後開啟中央改名視窗, so that 鍵盤不會遮住原本彈窗
16. As a 地圖使用者, I want to 在中央改名視窗按確定後只更新草稿名稱, so that 我仍可檢查位置再正式新增
17. As a 地圖使用者, I want to 在中央改名視窗按取消後保留原名稱, so that 誤操作不會修改草稿
18. As a 地圖使用者, I want to 空白名稱無法被確認, so that 集合點不會得到無法辨識的名稱
19. As a 地圖使用者, I want to 新增成功後在集合點卡片看見該地點, so that 我能繼續管理行程
20. As a 地圖使用者, I want to 新增成功後地圖旗幟持續存在, so that 地圖與卡片呈現一致
21. As a 地圖使用者, I want to 新增成功後同時看見自己與集合點, so that 我能理解彼此距離與方向
22. As a 地圖使用者, I want to 新增失敗後保留草稿與旗幟, so that 我可以直接重試而不用重新長按
23. As a 非領隊成員, I want to 長按加入集合點時仍送出領隊請求, so that 團隊權限規則不會被繞過
24. As a 集合點管理者, I want to 從固定 25 個 Emoji 中選擇, so that 選項一致且容易掃視
25. As a 集合點管理者, I want to 不看見自訂 Emoji 輸入, so that 不會遇到跨平台字形與驗證差異
26. As a 集合點管理者, I want to Emoji 網格左右留白相等, so that 選擇器在不同螢幕寬度下仍整齊
27. As a 集合點管理者, I want to 所有 Emoji 框線使用相同主題色, so that 顏色不會被誤解為旗幟背景色
28. As a 集合點管理者, I want to 分別選擇 Emoji 與旗幟背景色, so that 我可以自由搭配
29. As a 集合點管理者, I want to 在儲存前預覽 Emoji 與背景色組合, so that 我能先確認地圖旗幟外觀
30. As a 集合點管理者, I want to 按確定後一次套用 Emoji 與背景色, so that 不會出現只更新一半的狀態
31. As a 集合點管理者, I want to 按取消後維持原 Emoji 與背景色, so that 試選不會直接改動資料
32. As a 集合點管理者, I want to 儲存失敗後保留我的選擇並看到錯誤, so that 我可以重試而不用重新選擇
33. As a 集合點管理者, I want to 點擊整條調整順序區域都能啟動排序, so that 不必精準點擊小圖示
34. As a 集合點管理者, I want to 鉛筆與整條操作同步顯示動畫, so that 我能清楚知道操作已被接收
35. As a Hither 使用者, I want to 一次看見成員、路線、工具、商店四個入口, so that 商店不會因尚未滑到工具而被忽略
36. As a Hither 使用者, I want to 以左右滑動切換四個入口, so that 操作像撥盤一樣連續
37. As a Hither 使用者, I want to 每跨越一個入口收到一次震動, so that 我能感覺目前切換了幾格
38. As a Hither 使用者, I want to 橫向切換入口時 Bottom Sheet 不移動, so that 畫面不會誤觸上下拖曳
39. As a Hither 使用者, I want to 上下拖曳 Bottom Sheet 時入口不切換, so that 兩種手勢的結果可預期
40. As a Hither 使用者, I want to Tab 文字比目前更容易閱讀, so that 我不需要費力辨識入口
41. As a 使用動態字級的使用者, I want to 放大文字後仍可辨識四個入口與選取狀態, so that 我可以使用系統閱讀設定
42. As a 使用讀屏的使用者, I want to 透過可調整操作前後切換入口, so that 沒有視覺箭頭也能操作 CoverFlow
43. As a 偏好減少動態效果的使用者, I want to 動畫被適度簡化但狀態仍清楚, so that 切換不造成不適

## Implementation Decisions

### Rewarded Ads

- 修復順序固定為：蒐集原生證據、同步原生設定、強化執行期狀態、以新安裝檔完成端到端驗證。
- iOS 是必要驗證平台。Android 使用同一份行為契約，但通過與未驗證狀態必須分開紀錄。
- 已提交的原生專案、Expo 設定、Google Mobile Ads 與 User Messaging Platform（UMP）依賴必須保持一致；設定同步後需要新原生安裝檔，OTA 不足以驗證。
- 原生模組不可用、安裝檔過舊、同意流程未完成、無填充、載入錯誤、顯示錯誤、提前關閉及 SSV 失敗都要收斂成可復原的商店狀態，不得讓原生例外造成程序終止。
- 沿用既有 reward session、SSV callback、wallet snapshot 與 append-only ledger。手機端的 rewarded callback 只進入等待驗證，不直接增加 Token。
- 同一個 reward session 與 Google transaction 仍保持冪等；任何錯誤或重複 callback 都不得造成重複入帳。
- 診斷資訊只記錄允許的生命週期事件、錯誤分類、平台與版本指紋，不記錄 access token、完整 callback query、原始 session reference 或可識別個人的資料。

### 長按地圖與改名

- 長按仍先建立暫存旗幟與原本的底部新增地點彈窗，不以中央視窗取代它。
- 底部彈窗的名稱顯示改為可觸發改名；中央視窗持有獨立輸入草稿，包含「確定」與「取消」。
- 「確定」只在名稱通過既有輸入規則後更新待新增集合點名稱並關閉中央視窗；「取消」捨棄輸入草稿，不改動待新增集合點。
- 正式新增仍由底部彈窗的原按鈕觸發。成功後才清除暫存狀態，並以已保存的集合點更新卡片、旗幟及鏡頭。
- 新增失敗不得清除暫存旗幟、名稱或位置，並要提供可理解的錯誤與重試。
- 領隊維持直接新增；非領隊維持建立持久化請求，由領隊後續處理。
- 長按後可先拉近所選位置；正式新增成功後使用既有鏡頭流程調整到自己與集合點均可見。

### Emoji 與調整順序

- 內建 Emoji 固定為 25 個，從現有清單移除 `🧭`；移除自訂 Emoji 的輸入、驗證提示與入口。
- Emoji 網格使用對稱的水平容器留白與一致間距；所有未選取與選取框線都以既有主題色系呈現，不再使用每個旗幟背景色作為框線色。
- Emoji 與旗幟背景色是兩個獨立草稿值，沿用既有色盤及既有 `emoji`、`marker_color` 資料契約，不新增 schema 或 API。
- 選擇器提供組合預覽。「確定」後以既有更新邊界一次提交兩個值；「取消」不提交。
- 儲存失敗時保留視窗與草稿、回復持久化畫面狀態並顯示錯誤，不只寫入安靜日誌。
- 「調整順序」改為單一整條點擊目標，避免同一區域有兩個競爭的 press handler；鉛筆為同一互動的視覺回饋。
- 鉛筆靜止與動畫狀態都沿用主題色；震動與動畫先立即回饋，業務動作在既有動畫完成邊界後執行。

### CoverFlow 與手勢

- 使用專案已安裝的 Reanimated、Gesture Handler 與 Haptics，不新增 carousel 或手勢套件。
- 四張長方形卡片同時存在於可視區，寬度沿用目前 Tab target 的尺度；中央選取卡片位於最前方，其他卡片依相對距離套用位移、縮放、層級與陰影，越後方露出越少。
- 不顯示外框、箭頭或頁面圓點，也不以點擊卡片切換；一般操作只接受 CoverFlow 區域內的左右滑動。
- 使用專屬橫向手勢取代整個 Pane 的原始 touch swipe 判定。橫向位移勝出時 CoverFlow 取得手勢，縱向位移勝出時讓 Bottom Sheet 處理。
- Bottom Sheet 的拖曳也必須在橫向位移勝出時失敗，形成雙向互斥；橫滑不得改變 Sheet detent，縱滑不得改變 Tab index。
- 跨越或吸附到新索引時觸發一次選擇震動，不隨動畫影格重複觸發。取消或回彈到原索引不重複震動。
- 字體使用既有較大的文字層級並遵守動態字級上限；讀屏使用可調整元件的增加／減少動作切換索引，不增加視覺箭頭。
- Reduced Motion 開啟時減少透視與位移動畫，但保留清楚的前後層級與選取狀態。

## Testing Decisions

- 測試只斷言使用者與系統可觀察的結果，不鎖定元件內部 state、動畫實作細節或特定第三方函式呼叫。
- 優先沿用現有最高層接縫，不為此規格建立新的通用測試框架或抽象。
- **Rewarded Ads 接縫：** 從商店 CTA 經 UMP、原生 load/show/dismiss、reward session、SSV 到 wallet snapshot。測試正常入帳、未看完、無填充、離線、載入／顯示失敗、重複 callback、延遲 callback、缺少原生模組與舊安裝檔。
- **長按新增接縫：** 從地圖長按、中央改名、底部新增，到既有集合點 mutation、卡片／旗幟投影與成功後鏡頭。領隊直接新增與非領隊請求都要覆蓋。
- **Emoji 接縫：** 從選擇器草稿與預覽，經既有集合點更新服務，到重新讀取後的排序列與地圖旗幟。測試確定、取消、失敗重試與 Emoji／顏色獨立組合。
- **Tab 手勢接縫：** 從 CoverFlow 橫向手勢與 Bottom Sheet 縱向手勢，到選取 Pane 與 Sheet detent。明確驗證橫滑不移動 Sheet、縱滑不切換 Tab，以及快速反向滑動後索引正確。
- 既有純函式測試、商店狀態測試、地圖鏡頭測試、集合點投影測試與手勢判斷測試可作為先例；只新增會攔住此次回歸的最小案例。
- iOS 必須以含正確原生依賴的 release-like 安裝檔驗證「觀看廣告 → SSV → Token +1」，並保存去識別化證據。模擬器測試、Jest 或 typecheck 不能取代真實原生廣告驗證。
- Android 若有可用裝置或模擬器則執行同等 smoke test；若未完成，報告必須明確標示為未驗證，不得由 iOS 結果推定通過。
- 地圖、Emoji、排序與 CoverFlow 至少完成自動化回歸、TypeScript 檢查及 iOS／Android 可用環境的互動檢查；無裝置證據時不得宣稱原生手勢或地圖行為已通過。

## Out of Scope

- 不重新設計 Token、SSV、wallet、ledger、商店商品或兌換價格。
- 不變更集合點資料表、權限模型、領隊／成員協作語意或新增地點上限。
- 不以中央改名視窗取代原本底部新增地點彈窗，也不移動原本的新增按鈕。
- 不增加自訂 Emoji、Emoji 套件、圖片 marker、GIF、貼圖或新的旗幟色盤。
- 不加入 CoverFlow 套件、視覺箭頭、圓點、點擊切換或無限循環。
- 不重做整個 Bottom Sheet、地圖相機系統或所有 App 手勢。
- 不在本規格執行 App Store、Google Play 發布、OTA 發布或正式廣告流量切換。

## Further Notes

- 本規格補充並修正原 Rewarded Ads Token Store 任務中「僅顯示三個 Tab」及原生廣告已完成的假設；不覆寫原任務的歷史文件。
- CoverFlow 只借用 Amicro CardCoverFlow 的透視、位移、縮放、層級與陰影概念；原範例的按鈕、箭頭及圓點不屬於 Hither 行為。
- Ticket 01 完成前，原生設定不同步只能列為待驗證風險，不得寫成唯一已確認閃退根因。
- 原生廣告設定或依賴改變後必須建立新安裝檔；OTA 只可承載不涉及原生依賴的 JavaScript 變更。
