# Hither UI、導航、歷史與耗能設計

## 目標

在不改變既有導航精度與原生能力的前提下，修正集合點卡片、隊長/隊員導航權限、歷史可見性、首頁動畫與頭像首屏，並以 Supabase/MetricKit 資料處理發熱根因。

## 查證結論

- 2026-07-17 12:22–12:47 UTC 的 `performance_events` 中，`destination_arrivals` 查詢 8,488 次，約每秒 5.6 次；第二名只有 264 次。根因是 `useTranslation()` 每次 render 都建立新的 `t`，使依賴 `t` 的集合流程 effect 重建、重查與重訂閱。
- 兩筆 MetricKit payload 顯示約 65–69 分鐘前景時間內，GPU 累積 2,180/5,947 秒、CPU 999/1,958 秒、峰值記憶體約 697 MB/1.17 GB；定位只使用 hundred-meters accuracy，沒有 best/navigation accuracy 時間，因此不能把主要熱源歸因於高精度 GPS。
- 既有定位已具有前景/背景單一 GPS owner、距離/時間門檻、上傳 heartbeat、route cache 與 Realtime debounce；保留這些精度策略，只補顯示座標的原生 Marker 插值。
- 舊診斷中 164 次上傳有 127 次 pending retry；現有 SQLite outbox 已有指數退避。避免每次 enqueue 都立刻 flush，改由單一節流 flush 合併佇列。

## 設計

### 集合點與導航

- 收合標題使用既有 Reanimated 做 overflow-only 跑馬燈：先停 1 秒、捲至末端、停 2 秒、動畫回到起點；Reduce Motion 時維持單行截斷。
- 展開卡片只調整現有 style：日期直接貼在抵達進度上方，ETA/距離靠近 Apple Maps 按鈕，縮短 meta 與 command row 間距。
- 隊長保留開始/停止導航。隊員未抵達時顯示本地「路徑規劃／關閉路線圖」；隊長導航同一點時顯示不可點的「導航中」。
- 已抵達為綠色可點按鈕；再次點擊以既有確認流程取消抵達，避免誤觸且不新增第二套狀態。

### 歷史

採「同一事件、依角色投影」：`visited_waypoints` 保留每位參與者的抵達事件。一般成員只能讀自己的事件，因此自然包含個人行程與自己實際參與過的小隊行程；目前隊長可讀該隊所有成員事件。離隊後仍可讀自己的過往事件。RLS 是權限來源，client 不負責隱藏越權資料。

### 效能與快取

- memoize translator，停止 effect/subscription churn。
- Marker 使用 `Marker.Animated` + `AnimatedRegion` 在已確認座標間插值，不預測超過最新定位，保留真實精度。
- SQLite outbox flush 做單一飛行與短節流；網路失敗仍由既有退避處理。
- My Teams 的 emoji/avatar color 以使用者隔離的 AsyncStorage 快取先畫；網路資料回來後覆寫並更新快取。Map 畫面既有 profiles Realtime 繼續處理即時頭像更新。
- 建立/加入按鈕移除位移 entering animation；查看我的隊伍只做 FadeIn。

## 驗證與發布

新增最小 regression tests 覆蓋 translator identity、導航 UI 契約、首頁 animation、頭像快取、歷史 RLS、Marker 插值與 flush 節流。完成後跑 targeted tests、全套 Jest、typecheck、lint。變更沒有 native module/package/app config，Supabase migration 先上線後可用 Expo OTA 發布 production 與 preview。

