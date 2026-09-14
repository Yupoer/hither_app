# 集合點、位置共享與省電交付檢查

日期：2026-09-14。版本／iOS runtime：0.1.8。此文件記錄來源碼與本機驗證，不代表正式後端、APNs、原生編譯或實機已驗收。

## 已修正的衝突與證據

| 問題與影響 | 修正／證據（路徑相對 repository） |
|---|---|
| 可見卡片與原始排序使用不同集合；非第一站的抵達資格受舊順序阻擋 | useJourneyNavigation 使用完整同範圍未完成集合重排，選取仍以 ID；arrivalMarking 與 set_destination_arrival 都接受有效導航目標。 |
| 舊 start_navigation_session 切換時會完成原節點 | 20260913153757_active_navigation_arrival_order.sql 將舊行程取消並保留節點；原 request ID 重試保持冪等。新增 before-insert trigger 呼叫既有鎖定排序 RPC，在導航交易內前移同日第一個未完成節點，保留日期、已完成槽位及其他相對次序。 |
| 停止分享遇到網路錯誤會回復舊偏好；延遲定位仍可能送出 | locationPrivacy 管理程序內的前景啟用、目前團隊、同意版本與 AbortSignal；PreferencesContext 立即取消。locationSharingSync 保存待同步意圖並以帳號核對後重送；晚到的遠端設定不能覆寫本機停止。 |
| 分享與本機導航隱私欄位互相矛盾 | NavigationService 同步 sharing_enabled／local_navigation_enabled；UI 說明改為停止全部定位。手動標記抵達不需要 GPS，仍可使用。 |
| 前景、推播刷新、背景定位各自啟動 GPS | 前景優先由 MapKit 提供；原生背景沿用既有 controller，iOS 17+ 使用 CLLocationUpdate／CLBackgroundActivitySession。背景刷新等待既有定位源，沒有新樣本就保留伺服器待處理請求，前景恢復再讀取。 |
| 固定 heartbeat 重送舊座標並更改時間 | 移除 JS GPS heartbeat；只上傳真實樣本時間。程序冷啟動預設沒有定位資格，回到前景後才能授予；Swift 背景 session 也只能前景準備。 |
| 背景無行程仍維持高耗能模式／最後一站直接停分享 | 行程結束切為被動分享。iOS 17+ 由系統暫停與恢復；Expo fallback 開啟 passive automatic pause。精確模式不會把無行程背景升為導航精度。 |
| 背景行程開始、切換、結束未同步；舊事件可能結束新即時動態 | send-push 增加 navigation_session 靜默控制；客戶端查目前有效行程、本人會員資格與分享設定，不查隊友座標。舊 webhook 先核對最新行程；既有 Live Activity handle 切換到新目標。 |
| 隊友位置事件導致全量重讀與跳點 | useGroupState 對有效位置事件只更新該隊友，以固定 250ms 合併事件；結構／無效資料才重讀。syncAuthority 保留較新的伺服器位置事件，允許伺服器清除座標。 |
| 標記短動畫且重疊動畫被原生拒絕 | 沿用 react-native-maps 原生動畫；新樣本從目前畫面座標接續，依樣本間隔轉場（最多 10 秒），30fps；修正 iOS 毫秒整數除法。首次、過期、跳點、回前景與減少動態效果直接校正。沒有新樣本就停止，不外推位置。 |
| 慢走逐點小位移永遠被視為靜止 | locationPolicy 保留累積位移錨點並考量誤差；真實行程樣本上傳目標約 5–10 秒、靜止降頻。前景／背景 Live Activity 顯示更新各自約 10 秒節流，語意變化即時；雲端進度約 30 秒；路線沿用既有距離／時間及快取閘門。 |

動畫座標只存在 Marker 內；距離、抵達與完成仍使用原始定位及既有 arrival reducer／資料庫交易。退出團隊、登出與停止分享會先撤銷程序內資格，再清除待送位置與背景工作。

## 驗證證據與限制

- 新增行為測試：locationPrivacyMotion、locationSharingSync、nativeLocationCancellation、navigationSessionLifecycle；擴充 arrivalMarking、backgroundJourneyTaskBehavior、backgroundLocationRefreshBehavior、locationService、syncAuthority 等既有測試。
- PostgreSQL：navigation_location_regression.mjs 使用 PGlite 0.5.8，在隔離資料庫載入實際 migration／既有 reorder 與 arrival 函式；驗證第二／第三站排序、日期與歷史、重試、切換、有效導航抵達（包含之後排序改動）、權限拒絕及失敗後仍只有一個 active session。通過。這不是正式 Supabase RLS／推播部署驗證。
- Windows 不能執行 iOS 原生編譯、Instruments 或雙 iPhone 驗收。Swift／Objective-C 僅來源檢查，react-native-maps patch 反向套用檢查通過；不能據此聲稱實機不卡頓、不發熱或達成耗電目標。
- iOS 17+ 的新定位流由 Core Location 管理精度與靜止恢復，並非 App 保證固定採樣。較舊 iOS／Android 保留 Expo fallback；短距離恢復、系統暫停與權限行為需分平台驗收。
- iOS 可延遲／忽略靜默推播；程序被關閉時不重啟 GPS，因此無法承諾背景立即收到行程。收到系統允許執行的控制事件或下一次定位事件時同步，回前景立即重新讀取。
- 停止分享可取消尚未送出的工作及本機在途 HTTP；已到伺服器並完成的寫入無法撤回。斷網時其他裝置也不可能立即知道本機已停止；本機不會因同步失敗恢復分享。
- 省電目標尚無實測百分比。程式內既有 8h／20% 欄位只是歷史產品目標，不能作為本次效果證據。

本機最終檢查：TypeScript、test:meta 與 git diff --check 通過；全量 Jest 239 組，共 1951 項通過、4 項既有失敗（下列前三點）。另以元件設定執行 journeyNavigation，14 項通過。受影響檔案 lint 沒有錯誤，仍有既有警告。navigationSessionState／navigationIntegration 的既有元件測試環境缺少原生依賴 mock，未作為通過證據；本次另有 navigationSessionLifecycle 行為測試覆蓋背景解除訂閱、回前景快照及亂序事件。

### 既有測試問題（未擴大修改無關 UI）

1. nativeUiContracts 仍要求 controlSize(controlSizeValue)，HEAD 既有 NativeGlassButton 已改用 requestedControlSize。
2. coreDataLocalFirst、gatheringSessionOutbox 都要求整個 useJourneyNavigation 只有一次 flush 呼叫，HEAD 原本已有兩次。這不是本次新增加的 flush。
3. languagePicker 期待語言文字與向下箭頭，但 HEAD 的 menu trigger 已是 globe-outline；元件與該測試本次未改。
4. send-push 全目錄 Deno test 的 fcm_test.ts:117、126 傳入收件人函式不接受的 group_id，造成兩個既有型別錯誤。推播主程式 deno check 通過；navigationControl、arrival、eventId、senderFallback 共 10 項通過。

## 待你決定的額外產品取捨

| 提案 | 目前證據／影響 | 建議 |
|---|---|---|
| 停止分享後是否立刻隱藏最後位置 | 本次停止後不送新位置；既有 GroupService 仍讀取歷史 member_locations，沒有刪除已分享的位置。斷網時無法立即同步隱藏。 | 預設保留真正時間並標示過期；若要立即隱藏，另規劃伺服器可見性與即時清除事件，避免讓舊座標看似即時。 |
| 多裝置偏好 | 伺服器 member_privacy_settings 是帳號層級，本機 pref.sharingEnabled 是裝置層級；本機停止永遠優先，另一裝置啟用不會自行解除它。 | 保留目前隱私優先；若要每台裝置獨立分享，需新增裝置範圍的產品模型。 |
| 最低 iOS 版本 | 系統自動暫停／小位移恢復的完整新接口需要 iOS 17+；舊版走 fallback。 | 先在目前支援的舊版實測，再決定是否將最低支援版升到 iOS 17；本次沒有自行提高最低版本。 |
| 平滑程度與延遲 | 無外推意味著畫面會落後最新真實樣本一段轉場時間；被動分享樣本間距較長時仍會停住。 | 保持真實樣本／最多 10 秒過渡，避免為追求永久移動而常駐高精度或預測未知位置。 |
| 停止分享時的即時動態 | 停止定位不等於退出行程；既有通知與手動抵達保留。 | 若要停止分享一併隱藏即時動態，另作明確選項；目前不混淆「離隊」與「停止定位」。 |

## 雙 iPhone 驗收（全部尚未執行）

準備：同一測試團隊兩台 iPhone，A 隊長／B 隊友，三個同日集合點、一個已完成節點、翌日節點；使用同一條 20–30 分鐘散步路線。先測舊版，再安裝 0.1.8 對照，記錄手機型號、iOS、電池健康、室溫、亮度、網路、低耗電模式與起訖電量。耗電段拔除充電；Instruments 診斷另開一輪，避免把量測負擔算進比較。

1. A 從第二／第三張開始，A／B 同日第一個未完成節點一致，抵達按鈕可用；日期、歷史與其餘次序不變。切換後原節點仍未完成。快速連點與斷網重試不出現兩個 active session、重複抵達或舊卡片回跳。
2. B 在定位尚未完成時停止分享，再進背景、斷網重連、接到行程／位置刷新推播。確認定位源停止、outbox 清空、後端沒有新的位置寫入；重新登入／回前景不會把停止意圖改回開啟。撤銷定位權限後重做。
3. B 分享開啟、無行程鎖屏靜止 15 分鐘，接著短距離走動、慢走，再靜止。比對定位回呼與位置寫入；沒有重報舊樣本時間，恢復移動的行為符合裝置系統限制。
4. B 在背景時由 A 開始、切換、結束；確認 B 模式與即時動態轉換。再將 B 從 App 切換器完全關閉重測：不得重新啟動 GPS；B 回前景才恢復並讀取目前行程。最後一站完成後應為被動分享。
5. A／B 互看位置，連續樣本與中途新樣本沒有跳回舊點；斷網後標記停止移動、時間保持真實。回前景、開啟減少動態效果、過期資料與異常跳點直接校正，抵達不受動畫位置影響。
6. 分別測只有前景權限、背景權限拒絕、精確定位關閉；地圖仍可用、不反覆詢問，不能讀取時不送位置。觀察 iOS 定位提示，不以隱藏提示達成測試。
7. 每輪比較既有 energyObservability 的 location_callback、location_accepted、network_request、route_recalc、realtime_callback、snapshot、render 計數，另查 diagnostics 的 background_op_timeline／location_upload_failed。以 Instruments Energy Log、Time Profiler 和裝置 thermalState／電池紀錄補足；判定靜止回呼降低、隊友位置事件不再引發全量快照、背景沒有隊友位置拉取、CPU 與熱狀態改善。不得只看上傳次數就宣稱 GPS 省電。

## 部署與重現順序

1. 將 migration 20260913153757_active_navigation_arrival_order.sql 部署到已具備既有 migrations 的測試環境，驗證後才上正式；保留 rollback／資料備份慣例。新增 function／trigger 無需更動對外資料格式。
2. 部署 supabase/functions/send-push，保留既有 secrets、webhook 與 APNs／FCM 設定；驗證實際控制推播與 push-to-start。Git 推送不代表這兩步已執行。
3. 另一台 Mac 拉取此提交，安裝既有依賴並套用 patch-package、執行既有 iOS Pods／編譯流程；確認 App 與 widget marketing version、Expo runtime 都為 0.1.8。不要只更新 JS 到 0.1.7。Android 既有原生版本資料仍是 0.1.3，若要發 Android 新 binary，須另外按既有 prebuild／版本流程同步並實測。
4. 在兩台測試 iPhone 執行上方驗收，再決定發布新 binary。此次不發布 OTA，也未執行原生 build 或正式後端部署。

本機重現（repository 根目錄）：

~~~powershell
node apps/mobile/node_modules/typescript/bin/tsc --noEmit --project apps/mobile/tsconfig.json
node apps/mobile/scripts/check-test-meta.mjs
node apps/mobile/node_modules/jest/bin/jest.js --config apps/mobile/jest.config.js --runInBand
npm.cmd install --prefix "$env:TEMP/hither-location-regression" --no-save --ignore-scripts @electric-sql/pglite@0.5.8
node supabase/tests/navigation_location_regression.mjs "$env:TEMP/hither-location-regression/node_modules/@electric-sql/pglite/dist/index.js"
npx.cmd --yes deno check supabase/functions/send-push/index.ts
npx.cmd --yes deno test --allow-read supabase/functions/send-push/navigationControl_test.ts supabase/functions/send-push/arrival_test.ts supabase/functions/send-push/eventId_test.ts supabase/functions/send-push/senderFallback_test.ts
~~~

平台依據：[Apple CLLocationUpdate](https://developer.apple.com/documentation/corelocation/cllocationupdate)、[WWDC23 原生暫停與恢復](https://developer.apple.com/videos/play/wwdc2023/10180/)。使用系統能力不代表可保證 iOS 背景排程或與「尋找」相同的耗電。
