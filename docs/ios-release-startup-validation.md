# iOS Release 啟動驗證

## JSI UI runtime 回歸

Expo `AppContext.prepareUIRuntime()` 在 MainActor 建立 UI worklet runtime。
JSI 的 context predicate 必須同時接受主執行緒及 React Native JavaScript
執行緒。單純檢查 module registration、SQLite Record 或一般 JS thread，
無法覆蓋完整 App 啟動時的 UI runtime 安裝。

本次基線 Release 在 `AppContext.prepareUIRuntime → JavaScriptActor.assumeIsolated`
因 executor isolation 不符而 abort。只重建並替換 JSI framework，保持 App
及 JavaScript bundle 相同後，兩次冷啟動均到達 `stable` 且登入畫面可見。
這項差異測試直接驗證 context predicate 修正的效果。

可重跑的原生 probe 使用已安裝且套用 patch 的實際 actor/executor source：

```sh
# 在 repo root；使用與 framework 相同的 Swift Release optimization。
python3 apps/mobile/scripts/build-jsi-executor-probe.py /private/tmp/hither-ui-probe --release
xcrun simctl spawn <simulator-udid> /private/tmp/hither-ui-probe ui many
xcrun simctl spawn <simulator-udid> /private/tmp/hither-ui-probe wrong
```

`ui many` 必須通過主執行緒、巢狀呼叫、typed throw 與兩個一般 JS threads
各 10,000 次操作；`wrong` 在現代 runtime 必須非零退出。舊 iOS 17
另外使用 `SIMCTL_CHILD_LIBDISPATCH_COOPERATIVE_POOL_STRICT=1` 重跑 `ui many`，
確認同步 executor bridge 不死鎖及不產生 isolation warning。

CI 的 `jsi-ui-runtime` job 在 macOS 上從乾淨 lockfile 安裝依賴，執行上述
Release-optimized actor probe（`--host --release`），同時驗證 UI/JS 成功及
錯誤背景執行緒必須被拒絕。它是 executor 回歸檢查；以下完整 iOS Release
冷啟動仍須在發布前另行執行。

`jsi-ios27-runtime` 另在 Xcode 27／iPhone 12 Pro／iOS 27.0 比較同一個
已安裝 actor：只移除 UI predicate 的基線必須 abort，修正版 `ui many`
必須通過，錯誤背景執行緒仍必須被拒絕。此項是 iOS 27 原生 runtime
回歸，仍不代表完整 App 或實機 TestFlight 驗收。
CI 使用 `simctl spawn --standalone` 執行 Foundation/Swift actor probe，不連接
其他 OS services，並輸出 Foundation runtime 的實際版本。完整 App 檢查
仍須開機、安裝及正常 launch，不能使用此模式替代。

## 完整 Release 冷啟動

發布前使用完整 Release simulator build，包含正式入口、原生依賴、Hermes
及 production 更新設定。不得使用 Debug、Metro 或替換成單一功能 harness
來代替此項驗證。

在 `apps/mobile`：

```sh
npm run verify:ios-release-launch -- \
  --app /absolute/path/Hither.app \
  --simulator <booted-simulator-udid> \
  --build <embedded-build-number> \
  --output /private/tmp/hither-release-launch
```

檢查器不移除現有 App 資料，會驗證兩次冷啟動各存活 45 秒、當次 timestamp
及 build 的啟動階段已到達 session/navigation ready，保存原生日誌、截圖及
`launch-result.json`。拒絕 Debug dylib、錯誤 build 及裝置 IPA。必須再人工
檢視兩張截圖，確認顯示實際 App 畫面。收到特定 iOS 版本的崩潰回報時，
必須在該版本重測；其他版本的通過不能替代它。

封裝 metadata、簽章、Jest、typecheck 或 archive 成功均不能取代冷啟動驗證。
模擬器結果仍不能代替實機 TestFlight binary 驗收。原生 JSI 修正需要新 IPA，
純 OTA 不會更新 framework。

檢查器以同次啟動的 stdout/stderr 檔案補充 console 證據，每個 stream 最多解析
1 MB，原始檔保留在 runner，不上傳。第二次成功後 App 仍可寫入，直到 App／runner
結束；一般檔案沒有 byte 上限。
Darwin kqueue 只在核對已安裝 executable 路徑後，對 simctl 回傳的 PID 註冊 exit
事件；沒有 OS wait status 時不填 App exit code。註冊前退出、工具失敗或 PID
generation 無法確認時保留未知。`commandExitCode` 是 verifier 子指令的結果，
`appExitCode`／`appExitSignal` 才是觀測到的 App 狀態。

完整 runner 在唯一一次 App build 前，會檢查 Xcode 的 console flags，並以小型
host 子程序驗證 exit 37 與 SIGTERM 觀測。此自測不代表 App 通過冷啟動。
原始失敗仍使 gate 失敗，不會因診斷或自測成功改判，也不自動重建。

對已確認的原 PID SIGTRAP、App 已不存在且沒有匹配 crash report 的失敗，wrapper
會在保存原始結果後，使用同一份已安裝 binary 最多加一次限時 LLDB 診斷 launch。
此 replay 不計入兩次冷啟動驗收；其成功或工具失敗都不能覆蓋原 gate 失敗。
完整 App build 前會先用小型 host trap fixture 驗證 debugger 能取得命名 frame。
若 LLDB cleanup 回報失敗，會保留已取得的 frames 並標記 `cleanupFailed`，
診斷指令與 build 前自測仍判失敗。
只把有限的靜態 module／UUID／offset／function 欄位放入診斷 artifact，原始
debugger 輸出留在 runner。相同 native binary 仍不保證選到相同 OTA bundle。
