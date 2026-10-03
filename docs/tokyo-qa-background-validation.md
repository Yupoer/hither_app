# Tokyo QA：背景定位修復與驗證

日期：2026-10-04（Asia/Taipei）。實作位於 `tokyo-qa-fixes-worktree`，base 為 `f511489`。本範圍未修改主工作樹、commit、push、OTA 或發布 binary。

## 證據與修復

QA 來源為 `/Users/dillion/Desktop/Hither/qa-runs/2026-10-03-tokyo-blocker002-fix-validation`。

| QA 證據 | Source 根因／缺口 | 本次處理 |
| --- | --- | --- |
| `BACKGROUND-STALL-READOUT.md`、`BACKGROUND-PREPARATION-RACE-FIX.md` | base callback 遇 allDay／無 session 直接停止；prepare 在 permission await 後才建立 foreground native session，跨鎖屏可能拒絕 | 選帶 `697713f` 的 presence 保持、完成導航後降級與 foreground 先 prepare 修復；仍檢查 privacy generation／prompt 必須前景 |
| `C-STALE-1443-READOUT.md`：66.717m 短路線 age 370.245s，跨 151.395m 才恢復 | Swift moving sample 同時必須滿 150s 與 150m，時間到期也可能被距離攔截 | 真實 fix 到期即可交付，移除額外距離硬 gate；stationary 同樣遵守時間下限。保留 allDay 150s 低頻模式 |
| `SWITCH-AND-FAULT-RESULT.md`：B 鎖屏至少 71s 舊 P2 context | navigation control 靠 push 或 callback piggyback，原等待 60s；sample 過濾也會延遲同步 | journey piggyback budget 改 15s，presence 150s；依真實 callback 執行，不新增背景 timer。這不是無 callback 時的同步時限保證 |
| `CURRENT-STATUS.md`、`FINAL-44-COVERAGE-MAP.md`：C prefs 高／config 低 | `backgroundPresenceConfig` 清掉 highAccuracy，後續重新建立 journey 會遺失偏好 | presence 保留偏好與 subgroup scope；allDay policy 仍忽略 precision，journey 才恢復相應配置 |
| `REFRESH-LOCK-FAULT-RECOVERY-RESULT.md`：普通 sample 新了但 explicit refresh pending 未 ACK | existing owner 等 fix 只有 15s，allDay 下一筆可晚於等待窗口；普通上傳不會自動作 explicit ACK | 逾時 marker 由下一筆既有 owner 真 fix 補 `refresh_request` 上傳與版本 ACK；保持 newer marker／request，不開第二個 GPS |
| `FINAL-RESOURCE-OBSERVATION.md`、`RESUME-FINAL-RESOURCE-ADDENDUM.md` | Simulator CPU／footprint 已觀測，但未分離真機 GPS 能源與熱量根因；stationary 原可繞過 sample 時間 gate | balanced journey 選 OS `.default`，精準 journey 才 `.fitness`；serious／critical native→JS delivery 最少 30／60s。降低 callback、持久化及上傳機會，未宣稱實測耗電收益 |

另補 GPS／upload await 後的分享權限驗證，避免分享 OFF 後繼續上傳或 ACK。background 位置分享接受與前景一致的最多 120s clock-ahead；arrival 仍使用共用新鮮度判斷，主代理已將小幅 GPS clock skew 容忍限制為 2s，對應過大 future fixture 改為 +2001ms。

## 與 baseline 的比對

主樹在執行期間由其他工作流程提交為 `697713f`，因此當下 `git diff` 為空不代表沒有既有修復。先比較 `git diff f511489 697713f -- <相關檔案>`，選带背景相關修改與回歸測試；未複製其他主樹內容。

本次背景產品檔案：

- `apps/mobile/src/state/backgroundJourney.ts`
- `apps/mobile/src/state/backgroundJourneyController.ts`
- `apps/mobile/src/state/backgroundLocationRefresh.ts`
- `apps/mobile/src/screens/MapScreen/hooks/useDeviceLocation.ts`（選帶既有一次有界 bootstrap）
- `apps/mobile/modules/hither-location/ios/HitherLocationModule.swift`
- `apps/mobile/modules/hither-location/ios/LocationDeliveryPolicy.swift`（新增）

## 可重跑驗證

以下命令從 `apps/mobile` 執行。第一組當次為 **6 suites／78 tests PASS**；第二組 5 suites／19 tests PASS，第三組 1 suite／4 tests PASS，合計 **12 suites／101 tests**。React renderer 的 deprecation warning 不是測試失敗。

```sh
npm test -- --runInBand src/__tests__/backgroundJourneyCoverage.test.ts src/__tests__/backgroundJourneyTaskBehavior.test.ts src/__tests__/backgroundJourneyControllerCoverage.test.ts src/__tests__/backgroundJourney.test.ts src/__tests__/backgroundLocationRefreshBehavior.test.ts src/__tests__/localLocationFeed.test.ts
npm test -- --runInBand src/__tests__/nativeLocationCancellation.test.ts src/__tests__/nativeLocationCoverage.test.ts src/__tests__/androidLocationPermissions.test.ts src/__tests__/foregroundLocationSource.test.ts src/__tests__/debugLocationDeviceFeed.test.ts
npm test -- --runInBand src/__tests__/locationRefreshPendingContract.test.ts
```

Swift 純 policy 的 **16 個行為斷言**位於 `apps/mobile/scripts/test-location-delivery-policy.swift`，直接编譯產品使用的 `LocationDeliveryPolicy.swift`，涵蓋 150s 邊界、370s 可交付、stationary 時間下限、重複／倒退 timestamp、精準 5s 邊界、serious 30s／critical 60s，以及熱狀態不提升 allDay 頻率；追加 3 個活動 profile 斷言，確保 journey 的 code 4 使用 default、code 5 使用 fitness、presence 不使用 fitness。此測試腳本位於 pod source glob 之外。

```sh
swiftc -module-cache-path /private/tmp/hither-location-policy-module-cache modules/hither-location/ios/LocationDeliveryPolicy.swift scripts/test-location-delivery-policy.swift -o /private/tmp/hither-location-policy-tests
/private/tmp/hither-location-policy-tests
xcrun swiftc -frontend -parse modules/hither-location/ios/HitherLocationModule.swift modules/hither-location/ios/LocationDeliveryPolicy.swift
npm run typecheck
```

前三個命令已通過：16 checks PASS、native syntax parse exit 0。最新 `npm run typecheck` exit 0。

## Pod 收錄與驗證限制

`apps/mobile/modules/hither-location/ios/HitherLocation.podspec` 實際 `s.source_files` 為 `**/*.{h,m,mm,swift,hpp,cpp}`。以相同 Ruby glob 驗證，結果包含 `HitherLocationModule.swift` 與新增 `LocationDeliveryPolicy.swift`：

```sh
ruby -e 'Dir.chdir("modules/hither-location/ios") { files = Dir.glob("**/*.{h,m,mm,swift,hpp,cpp}"); abort "missing LocationDeliveryPolicy.swift" unless files.include?("LocationDeliveryPolicy.swift"); puts files.join("\n") }'
```

此驗證確認 source glob 收錄，syntax parse 確認語法；兩者都不等於完整 iOS module typecheck、Pods 整合或 native build。Native 修改須新的相容 binary 才能在 Simulator／裝置驗收，純 OTA 不會帶入 Swift 修復。

尚未重跑三台 Simulator 的鎖屏／短路線／P1→P2→P1／refresh 流程，也未量測實體 iPhone 溫度、電池與 GPS 能源。OS 沒有產生真實 fix 時仍不製造 heartbeat，沒有將舊座標改寫為新 timestamp。全天 150s cadence 依下述可靠 metadata 使用 180s availability 門檻；主代理的設定文案明示省電背景約 150s 與 OS 可能延遲。本次未另行加密 GPS。

## 補充：依真實 sample metadata 區分 freshness

`20260716214247_team_navigation_sessions.sql` 已為 `member_locations` 新增 `tracking_mode`、`source`、`navigation_session_id`。Recovery snapshot 的 `locations` 使用 `to_jsonb(l)`，已包含完整 row，無需新的 SQL migration。這是目前 source schema 核對，不聲稱本輪重新部署或查過 remote schema。

- `GroupService` 直接 select 加入這 3 欄，snapshot mapper 與 Realtime parser／patch 保留它們為 `locationTrackingMode`、`locationSource`、`locationNavigationSessionId`。
- `locationFreshnessLimitMs` 僅在 **passiveBackground＋background_task＋明確 null navigation session** 的 sample 使用 180s；journey、精準、explicit refresh、未知或缺 metadata 仍使用 120s。新 sample 缺 metadata 時會清掉前筆 metadata，不沿用較長 allowance。
- `isLocationSampleFresh(capturedAt, metadata, nowMs)` 提供共用判定；capturedAt／lastUpdated 不改，時齡文字仍顯示真實分鐘。此 availability allowance 不改 arrival 的 15s 新鮮度限制。Map/FlockRow 接線由主代理負責。
- `locationPolicy.test.ts` 的 passive OS pause fixture 已更新為 false，與防止無限期停更的 Expo fallback 配置一致。Swift 使用實際 code 5 作為 precision 門檻，避免 balanced teamNavigation 的 code 4 誤用 fitness。

```sh
npm test -- --runInBand --silent src/__tests__/locationFreshness.test.ts src/__tests__/groupStatePatches.test.ts src/__tests__/groupServiceBehavior.test.ts src/__tests__/locationPolicy.test.ts
```

補充驗證 **4 suites／80 tests PASS**，涵蓋 120／150／180s 邊界、179999ms、未知 metadata、journey／refresh 分支、snapshot／direct read／Realtime metadata 保留，以及 upload 比 capture 新也不重置 GPS age。TypeScript exit 0，原生 syntax parse exit 0；Swift 16 個 policy checks 已編譯執行通過。
