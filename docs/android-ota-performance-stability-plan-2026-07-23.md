# Hither Android OTA 效能與穩定性改善計畫

查證日期：2026-07-23（Asia/Taipei）  
適用版本：Expo SDK 56、React Native 0.85.3、`react-native-maps` 1.27.2、`runtimeVersion: 0.1.3`

## 1. 目標與限制

本計畫以 OTA-first 為主，改善 Android 的 RAM、CPU、UI rendering、Google Maps 異常、重複呼叫與 JS 錯誤回報，並建立 Supabase 診斷閉環。

「100% Android 不閃退」不能作為技術承諾。OS、OEM/GPU driver、低記憶體殺程式、第三方 native SDK、網路與硬體故障都可能超出 App 控制範圍。可驗收目標是：

- 固定測試矩陣 0 crash、0 ANR。
- 7 日 crash-free users >= 99.9%。
- user-perceived ANR < 0.10%。
- 可擷取的 JS/native exit 事件都能在下一次啟動或網路恢復後上傳。
- 每次 OTA 都能分批發布、監測、回滾。

## 2. 現況查證

### 已存在的基礎

- EAS Update 已有 `development`、`preview`、`production` channel；`runtimeVersion` 為 `0.1.3`。
- `GroupMap`、marker 已使用 `React.memo`；Android 使用 Google provider；Android 已避免橋接未使用的 `onUserLocationChange`。
- `performance_events` 已使用 SQLite outbox、批次上傳、72 小時保留、最多 10,000 筆、每批 100 筆與失敗重試。
- Supabase `performance_events` 已啟用 RLS，authenticated 只可讀寫自己的資料，並有明確 `GRANT SELECT, INSERT`。
- RN `ErrorUtils` 全域 handler 已存在，App 也有 Android launch phase breadcrumb。

### 目前缺口

- `HitherMetricsModule.drainPayloads()` 目前回傳空陣列，尚無可靠 Android native crash/ANR spool。
- Android `samplePerformance()` 目前的 `cpuPercent`、`uiFps`、`frameTimeP95Ms`、`missedFrameRatio` 為 `null`；只有 PSS memory、累積 CPU time 等部分資料可用。
- JS error 記錄受 diagnostic consent 與 full tracing 兩小時生命週期限制，兩小時後可能漏記 JS fatal。
- App root 尚未有 Error Boundary；React render error 缺乏可操作 fallback。
- App 內 map lifecycle event 不等於 Google Maps billing 的 Map Loads；帳單、quota、API request 必須以 Google Cloud 為準。

## 3. OTA 與 binary 能力邊界

### OTA 可交付

- React render、effect、timer、callback、memo 與 props identity 修正。
- Error Boundary、ErrorUtils queue、SQLite retry、Supabase payload 與批次 flush。
- MapView props、marker、location update 節流、避免無意 remount。
- Places/Directions/Geocoding 的 debounce、cache、in-flight request 去重。
- AppState 背景停止非必要 timer、Realtime channel、FPS sampling。
- EAS rollout、feature flag、更新後 health check 與 rollback。

### 必須新 binary

- `ApplicationExitInfo`、native uncaught/ANR/LMK/過度資源使用的 spool。
- `Choreographer`／`FrameMetrics` 等 native frame metrics。
- Expo/RN/`react-native-maps`/Fabric/New Architecture 版本變更。
- Android Manifest、permission、Google Maps API key 注入與 native module 變更。
- R8 mapping、native symbols、NDK crash symbolication。

native 變更後必須建立新 `runtimeVersion`，不可把依賴新 native API 的 JS bundle 發給舊 binary。

## 4. 分階段實作方案

### Phase 0：建立 baseline（0.5–1 天）

固定 release-like 腳本：cold launch 30 秒、Map idle 3 分鐘、pan/zoom 60 秒、定位 10 次、sheet 開闔 20 次、background/foreground 10 次。

每次記錄：

- device model、API level、RAM class、refresh rate、thermal state。
- build number、`runtimeVersion`、`updateId`、channel。
- `dumpsys meminfo`、`dumpsys gfxinfo`、Perfetto、logcat crash buffer、Android vitals。
- map mount/ready/loaded、PSS、CPU time delta、JS FPS、frame latency。

### Phase 1：OTA-1 錯誤回報與量測可信度

1. 將最小 error telemetry 與兩小時 full performance tracing 分離；error 永久可排隊，sample 仍限時低頻。
2. 在 App root 加 Error Boundary，保存 component stack hash、last screen、launch phase、`updateId`、`runtimeVersion`、build number，顯示 retry/restart fallback；不得吞掉原始 ErrorUtils handler。
3. 沿用既有 SQLite outbox 與 `performance_events`，不要建立第二套 queue。event id 必須 idempotent，使用 upsert 避免重複。
4. 在啟動、回前景、登入完成、網路恢復與新 error 寫入時 flush；使用 exponential backoff + jitter，避免 crash loop request storm。
5. error 優先於 sample；payload 不得含座標、token、email、原始 stack/message，只傳錯誤分類、hash、版本、畫面與 phase。
6. 預設沿用既有 diagnostic consent。若產品要求未同意也自動上傳，必須先更新隱私政策與同意模型。

### Phase 2：OTA-2 Google Maps 與 UI rendering

#### Google Maps 異常判斷

- 以 foreground session 記錄 `map_mount`、`map_ready`、`map_loaded`、`map_unmount`。
- 計算 mount 次數、ready-to-loaded latency、ready without loaded、theme-change remount。
- 正常 session 的 MapView mount 目標 <= 1；ready-to-loaded P95 < 3 秒；loaded 缺失 < 1%。
- 保留目前 Android Google provider 與 iOS-only location callback；任何 renderer（例如 LEGACY）切換都必須先做 5% A/B 證據，不可憑猜測切換。
- `Places`、`Directions`、`Geocoding` 經既有 Supabase `google-maps` proxy；輸入 debounce、相同 query/route key 去重、in-flight promise 共用、短期 cache。
- App lifecycle event 不可直接當作 Google billing Map Loads；Google Cloud Reporting/Monitoring 才是 quota、API request、error、billing 的權威來源。

#### React render 與重複 function 呼叫

- 只在 MapScreen、GroupMap、BottomSheet、DestinationReorderList、Realtime/location subscription 等高成本邊界加入 diagnostic render counter；production 不逐 render 上傳。
- 使用 React Profiler、Hermes/Perfetto 找 commit duration 與 JS thread stall，以「一次使用者動作觸發幾次」判定重複呼叫，不以 useCallback 數量猜測。
- 稽核並測試 cleanup：AppState listener、interval、location watcher、Supabase Realtime channel、OTA foreground listener，每個資源只能有單一 owner。
- `useSubgroupInvites` 在 App 與 MapScreen 的雙掛載先用 channel topic 與 notification dedupe 證據確認，沒有證據不直接合併。
- GPS domain state 與視覺 state 分離；UI 以距離／時間 threshold 合併更新，Map camera 不跟每個 GPS tick。

### Phase 3：OTA-3 RAM／CPU／背景工作

- 用連續兩次 `cpuTimeMs` 差分計算 process CPU，明確記錄 wall time、core normalization 與 confidence；不可把累積 CPU time 直接當百分比。
- PSS memory 記錄 interaction 前後 delta、15 分鐘 slope、foreground/background 分層；只在 map mount、sheet gesture 結束、navigation start/stop 與 5 分鐘 heartbeat 取樣。
- App background 時停止 JS FPS `requestAnimationFrame`、非必要 interval、Realtime channel 與 render counter；回前景只恢復單一 owner。
- 既有 memo row 與 virtualization 先量測再調整；不新增 cache framework。
- 沿用既有 scheduler 合併上傳；error 優先、performance 次之、單批最多 100 筆。

### Phase 4：0.1.4 binary 補齊 native telemetry

- Android 11+ 下一次啟動讀取 `ApplicationExitInfo`，摘要 `REASON_CRASH`、ANR、LOW_MEMORY、EXCESSIVE_RESOURCE_USAGE 等原因，寫入 native payload spool。
- API 30 以下由 Android vitals 與 launch breadcrumb 補位，並在事件中標註資料來源與 confidence。
- native 先 atomic write，再由 JS drain；Supabase ack 後才刪除。fatal 當下不可做網路、SQLite transaction 或大型 JSON serialization。
- 用 Choreographer/FrameMetrics 或與 RN/Fabric 相容的 native hook 取得 UI FPS、frame P95、missed ratio。
- 修正 `/proc/self/stat` 欄位解析與時間窗 CPU 計算，並上傳 R8 mapping/native symbols。

## 5. Supabase 資料流與安全

### 最小資料模型

優先沿用 `public.performance_events`，不新建第二套 crash table：

```text
event_type: error
operation: error.js_fatal | error.react_render | error.native_exit | error.anr
payload: updateId, runtimeVersion, launchPhase, lastScreen,
         exceptionKind, stackHash, nativeExitReason,
         memoryMb, cpuPercent, mapLifecycle
```

規則：

- client 只使用 publishable/anon key，不得把 service role 放入 App。
- authenticated 只可 INSERT/SELECT 自己資料；保持 RLS 與 `(select auth.uid())` ownership check。
- 若使用 Edge Function，`verify_jwt` 必須開啟，並限制 batch size、payload bytes、rate limit。
- 未登入事件先留本機，不開匿名無限制 ingestion endpoint。
- 新 table/column 若透過 Data API 使用，migration 必須明確 GRANT；RLS 與 GRANT 是兩個不同層次。

### 建議告警

| 告警 | 分組 | 觸發條件 |
|---|---|---|
| 新 crash cluster | operation + stackHash + updateId + deviceModel | 10 分鐘 >= 3 件，或 control update 的 2 倍 |
| Map load 異常 | updateId + deviceModel | loaded 缺失 > 1%，或 mount/session > 1.2 |
| 記憶體回歸 | operation + deviceModel + build | P95 > baseline 10%，或 slope >= 1 MB/min |
| CPU 回歸 | operation + refresh rate + thermal | P95 > baseline 10%，持續 15 分鐘 |
| 上傳故障 | build + updateId | pending P95 age > 10 分鐘，或 accepted ratio < 99% |

## 6. 效能與穩定性驗收門檻

| 面向 | Gate |
|---|---|
| 穩定性 | 每裝置 50 次 cold launch、20 次 map foreground/background，0 crash、0 ANR |
| RAM | Map idle P95 PSS 較 baseline 降低 >= 20%；15 分鐘 slope < 1 MB/min |
| CPU | Map idle < 5%；active map P95 較 baseline 降低 >= 25% |
| UI | 60 Hz P95 frame time < 32 ms；frozen frame (>700 ms) = 0；missed-frame ratio < 5% |
| Google Maps | mount/session <= 1；ready-to-loaded P95 < 3 秒；loaded 缺失 < 1% |
| 回報 | JS render error、unhandled error、native exit 都能以同一 event id 查到；upload success >= 99% |

## 7. EAS staged rollout 與 rollback

| 階段 | 流量／時間 | 升級條件 |
|---|---|---|
| Preview | 同 runtime 的內部 QA | typecheck、lint、Jest、release-like Android 腳本全過 |
| Production 5% | >= 2 小時、>= 50 sessions | 無新 fatal cluster，RAM/CPU/UI/Map 不回歸 |
| 25% | >= 6 小時、>= 200 sessions | crash、ANR、upload、Map ratio 維持 gate |
| 50% | >= 24 小時 | Pixel、Samsung、低 RAM model 無特定回歸 |
| 100% | >= 48 小時或樣本門檻，以較晚者為準 | SLO 達標，繼續追蹤 7/28 日 |

發布規則：

- Preview 與 production 使用同一 commit、env、runtime；驗證後使用 republish/promote，避免重新 bundle 漂移。
- 每個 update 保存 `updateId`、`runtimeVersion`、build number；同時查看 EAS adoption、failed install、error recovery。
- 新 fatal cluster、crash rate +0.20 percentage point、任一 device model >2 倍、Map loaded 缺失 >1%、P95 RAM/CPU > baseline 15% 或 frozen frame >0 時立即停止 rollout。
- rollout 未結束前不可用同 runtime 發另一個 production update；先 revert/rollback。

## 8. 測試矩陣與 Definition of Done

- JS render error：驗證 Error Boundary fallback、`error.react_render`、stack hash 與原始 handler 都存在。
- JS fatal：離線觸發後重開，網路恢復後可上傳且不重複。
- Native crash/ANR：0.1.4 binary 驗證 `ApplicationExitInfo`、next-launch drain、Play vitals 關聯。
- Map lifecycle：mount/ready/loaded/unmount 順序與延遲正確，無 remount storm。
- UI jank：`gfxinfo`/Perfetto/native frame metrics 驗證無 >700 ms frozen frame，無主執行緒 I/O。
- RAM/CPU：同裝置、同 refresh rate、同 thermal state 比較 baseline 與 rollout build。
- OTA：確認 platform/runtime/channel 正確，並實際演練 rollback。

完成定義不是「測試機跑一次沒閃退」，而是：固定腳本 0 crash/ANR、漸進 rollout 無回歸、Supabase／Android vitals／EAS 證據可互相對上，且 rollback 已演練。

## 9. 建議實作區域

| 區域 | 優先檔案 | 最小變更 |
|---|---|---|
| Crash queue | `src/state/performance.ts`、`src/utils/activityLog.ts` | error 永久排隊，與 2 小時 full trace 解耦 |
| Root recovery | `App.tsx`、新增 `src/components/AppErrorBoundary.tsx` | fallback + retry，保留 original handler |
| Telemetry | `PerformanceService.ts`、後續 Supabase migration | 擴充 allowlist/index/rollup，不複製 table |
| Map | `src/components/GroupMap.tsx`、`src/screens/MapScreen.tsx` | 穩定 props、阻止無意 remount、精簡 Android callback |
| Subscriptions | `useGroupState`、`useDeviceLocation`、`useSubgroupInvites`、`otaUpdates` | 單一 owner + cleanup contract |
| Native 0.1.4 | `modules/hither-metrics/android/.../HitherMetricsModule.kt` | exit spool、CPU/frame metrics |
| QA | `androidMapContract`、`performanceRegression`、`androidMetricsContract` | 每項邏輯留一個最小 regression check |

## 10. 未來方向、功能與風險

### 未來方向

- 建立以 `updateId` 為核心的 release health dashboard，串接 EAS adoption、Android vitals 與 Supabase context。
- 依 device model、RAM class、refresh rate、thermal state 分群，避免平均值掩蓋 OEM 問題。
- 將 map、navigation、sheet 三條旅程納入固定 Perfetto macrobenchmark 與 Android store build gate。

### 未來功能

- 診斷頁顯示 updateId、pending crash count、最近 upload 狀態。
- Server-side daily rollup 增加 crash-free、Map loaded latency、memory slope、CPU P95、upload lag。
- 以 Play Developer Reporting API 匯入 crash/ANR cluster，只保存 issue id 與聚合結果。

### 未來風險

- OEM、GPU、Google Maps renderer 差異可能只在特定機型出現；只測 Pixel 不足以全量發布。
- process death 前非同步 SQLite/網路可能尚未完成；native spool 必須走 next-launch drain，不承諾 crash 當下即時上傳。
- 過度 telemetry 會增加 CPU、耗電、流量與隱私成本；sample 必須低頻、可關閉、有保留上限。
- `runtimeVersion` 未隨 native dependency 變更升版，可能把不相容 OTA 發給舊 binary。
- Google Maps Map Loads 與 App 自訂 mount event 定義不同，帳單與 quota 必須以 Google Cloud 為權威來源。

## 11. 查證來源

- [Expo — Runtime versions and updates](https://docs.expo.dev/eas-update/runtime-versions/)
- [Expo — Deploy updates](https://docs.expo.dev/eas-update/deployment/)
- [Expo — Rollouts](https://docs.expo.dev/eas-update/rollouts/)
- [Expo — Error recovery](https://docs.expo.dev/eas-update/error-recovery/)
- [Expo — Downloading updates and adoption metrics](https://docs.expo.dev/eas-update/download-updates/)
- [Android Developers — Android vitals](https://developer.android.com/topic/performance/vitals)
- [Android Developers — ANRs and ApplicationExitInfo](https://developer.android.com/topic/performance/vitals/anr)
- [Android Developers — Slow rendering](https://developer.android.com/topic/performance/vitals/render)
- [Android Developers — Manage your app's memory](https://developer.android.com/topic/performance/memory)
- [Google Maps Platform — Reporting and Monitoring](https://developers.google.com/maps/documentation/android-sdk/report-monitor)
- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase — Edge Functions](https://supabase.com/docs/guides/functions)
- [Supabase changelog — Tables not exposed automatically](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)

## 附錄：本次查證的專案檔案

- `apps/mobile/package.json`、`app.json`、`app.config.ts`、`eas.json`
- `apps/mobile/src/utils/otaUpdates.ts`、`src/utils/activityLog.ts`
- `apps/mobile/src/state/performance.ts`、`state/diagnostics.ts`、`state/hitherDatabase.ts`
- `apps/mobile/src/api/services/PerformanceService.ts`、`DiagnosticService.ts`
- `apps/mobile/src/components/GroupMap.tsx`、`src/screens/MapScreen.tsx`、`App.tsx`
- `apps/mobile/modules/hither-metrics/android/.../HitherMetricsModule.kt`
- `supabase/migrations/20260717050721_performance_tracing.sql`
- `docs/android-map-runtime-qa-2026-07-23.md`
- `docs/superpowers/plans/2026-07-23-android-map-crash-rendering-sheet-menu.md`
