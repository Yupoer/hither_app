# Tokyo QA：Expo JavaScriptActor 舊版 runtime 驗證

本文件針對 QA 大量 `ModuleDefinition.swift:90`、`Record.swift:130`、`JavaScriptActor.swift:49` 的 actor-isolated runtime 警告。使用 ExpoModulesJSI 57.1.1、Swift 6.2.3、Xcode 26.2；不關閉 concurrency 檢查或隱藏 log。

## 根因與比對

- 警告在 Expo module 建構／record 解碼時已出現，早於 Hither 定位事件。JSI 從 C++ 同步回呼進 Swift：現有 `assumeIsolated` 驗證 JS thread 後 bitcast runner，但沒有建立 Swift executor context。
- 本機 SDK `_Concurrency.swiftinterface` 明示 `SerialExecutor.checkIsolated` 要 iOS 18；`isIsolatingCurrentContext` 要 iOS 26。iOS 17 無法以 hook 證明同步外部 thread 的 isolation。[Swift executor 主來源](https://github.com/swiftlang/swift/blob/main/stdlib/public/Concurrency/Executor.swift)、[SE-0471](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0471-SerialExecutor-isIsolated.md)。
- Pods／app project 未見 `SWIFT_DEFAULT_ACTOR_ISOLATION`；最後 app 的 `ExpoModulesJSI` 二進位已有 `checkIsolated` witness，build log 為 hash cache 命中，沒有 source／binary drift 的確定證據。強制重建本身無法補 iOS 17 runtime 缺少的能力。
- 從 npm cache 取出的 57.1.1 registry tarball，其 SHA512 與 `package-lock.json` integrity 相同，原始 actor 檔就有 `checkIsolated`；不是必須依賴未保存的本機修改。正式 patch 在 registry 原始碼上驗證套用。

## 最小修正

`apps/mobile/patches/expo-modules-jsi+57.1.1.patch` 保留既有 Swift/C++ 修正，加入 actor bridge：

1. iOS 17 到 18 之前，以一次性 Task 產生合法 `UnownedJob`。worker 只把 job 交给 capture executor，不讀取或執行 JS closure；既有 JS caller thread 再 `runSynchronously`，建立正式 executor context。
2. Bridge 保存原 Thread 身分。complex equality 僅允許 base `JavaScriptExecutor` 的 bridge/global 配對；runtime-specific subclass 不跨 instance 相等，不跳過其他 runtime 的 scheduler。
3. 外層 scope box 在 caller-thread job 開始時取出並清除 escaping closure，避免 Task 後續仍持有 stack capture。支援 typed throw、noncopyable 結果／借用 capture；結果在 scope 結束前取出。
4. 同 thread 巢狀進入使用 thread-local context 直接執行；不再產生 job。不同 thread 各自持有 scope。
5. iOS 18 以上維持原 fast path；iOS 26 增加可回傳 isolation 狀態的 hook。保留 upstream assert 語意，不全域改為 release precondition。
6. 套件最低 iOS 16.4 不變：`complexEquality` 以 iOS 17 availability guard 使用；16.4 保留原 ordinary executor／原路徑。本次沒有聲稱修復 iOS 16.4 的 runtime 警告。

## 可重跑

在 `apps/mobile` 已安裝 dependency 並套用 patch 後，於 repo root：

```sh
python3 apps/mobile/scripts/build-jsi-executor-probe.py /private/tmp/hither-jsi-repro/production-ios
SIMCTL_CHILD_LIBDISPATCH_COOPERATIVE_POOL_STRICT=1 xcrun simctl spawn <ios17-udid> /private/tmp/hither-jsi-repro/production-ios many
xcrun simctl spawn <ios17-udid> /private/tmp/hither-jsi-repro/production-ios wrong
xcrun simctl spawn <ios18-or26-udid> /private/tmp/hither-jsi-repro/production-ios many
python3 apps/mobile/scripts/build-jsi-executor-probe.py /private/tmp/hither-jsi-repro/production-host --host
/private/tmp/hither-jsi-repro/production-host many
```

Builder 直接從已安裝的正式 actor/executor 源碼取出實作，只移除依賴 JSI runtime 的 adapter，與 `test-jsi-executor.swift` 合成編譯，開啟 actor data-race checks；沒有另外複製一份 bridge 來取代實作。

`many` 在兩個獨立 Thread 各執行 10,000 輪。每輪包含三次外部 assume、一次巢狀 fast path、原 pthread ID 驗證、typed throw 後再次執行、借用 noncopyable capture 與回傳 noncopyable。額外檢查 optional nil 回傳及六條 runtime executor 身分正／負例。`wrong` 必須非零退出，證明錯 thread 被拒。

## 已有證據及限制

- 基線 probe：iOS 17.0.1 同一 JS thread 呼叫仍有四條 actor warning；加入新 hook 仍相同。iOS 18.5、26.3 基線均無 warning；26.3 wrong-thread 負例 abort。
- 修正 probe：iOS 17.0.1 單次、1,000 次、正式版兩 Thread 共 20,000 輪均無 warning；wrong-thread 負例非零退出。正式 10,000 輪各約 0.597 秒，即每輪約 **0.0597 ms**，這不是單次 bridge 的成本。iOS 18.5 同樣正式測試各約 0.0502 秒／10,000 輪。
- 最終版於 iOS 17.0.1 設 `SIMCTL_CHILD_LIBDISPATCH_COOPERATIVE_POOL_STRICT=1` 後，兩 Thread 共 20,000 輪 PASS、無 warning，包含 optional nil 及六條 runtime executor 身分檢查；兩 Thread 各 10,000 輪約 0.354196／0.354300 秒。wrong 分支跳過身分正例、直接到 `JavaScriptActor.assumeIsolated`，確實以 `JavaScriptActor operations must be run on the JavaScript thread` assert 非零退出（133）。這些數值是 probe 執行時間，不是 app 資源 benchmark；兩 Thread 模擬不能視為真實多 JSI runtime 接受驗證。
- `patch-package` parser：三個檔案修改解析 PASS；在 integrity 相符的乾淨 registry 原始碼 dry-run／實際套用 PASS，actor 結果與私有 task dependency 完全相同。iOS 16.4 target 的 actual actor compile PASS。
- 原始 app log：`/Users/dillion/Library/Developer/XcodeBuildMCP/workspaces/Hither-3a72965dc099/logs/app.hither.mobile_2026-10-03T18-03-56-255Z_helperpid65945_ownerpid40676_625ca425.log`。probe 執行證據由主代理保存於 `qa-runs/2026-10-04-tokyo-qa-fix-implementation/executor-probe`。正式 app rebuild／launch log 由主代理另補。
- iOS 17 bridge 只在上游已要求的同步 JS thread 邊界使用；caller 等待 job 的 worker 交付，JS 操作仍在 caller。未宣稱真機能源改善、完整多 worklet/runtime 覆蓋、iOS 16.4 警告修復，或 probe 即代表 app runtime 驗收完成。

## Hither binary 回歸

以本次正式 patch 重建 iOS 17.0.1 Debug unsigned simulator binary（151.967 秒），核對生成 Pods 的 framework import／copy 都使用私有 task dependency。隔離入口執行 `expo-sqlite` 1,000 次 native option Record 解碼、in-memory SQL 查詢及關閉（759 ms），畫面與 Metro 皆 `SDK_RECORD_PASS`；對應 native log 2,019 bytes，actor warning／error 均為 0。原先只改 JSI target、仍引用舊 framework 的那次 binary 不計作通過。原生日誌、binary SHA256、截圖及 harness 在 `qa-runs/2026-10-04-tokyo-qa-fix-implementation`。入口已移除，原 index.ts 復原；沒有登入、GPS 新請求或修改群組資料。此短回歸不代表全天 background／所有 runtime／真機耗電或散熱驗收。
