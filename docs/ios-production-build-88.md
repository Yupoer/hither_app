# iOS production build 88

The Mac EAS local production build used source `f11507b8f50ce8ee852e5e21b064cba299119f0a` after its [master CI](https://github.com/Yupoer/hither_app/actions/runs/43909220159) passed.
The App and Widget report version `0.1.17`, build `88`, with the App on runtime `0.1.17` and channel `production`.

The verified signed IPA matches SHA-256 `5a2945123b171f5f8108fdc9c2f0af28c403f31c321fd2f10e8f1f2382e13bcd`. The EAS submission was confirmed canceled while queued.
Apple's altool uploaded the same IPA under delivery `04cfbf70-b871-475e-9331-ed5c01da4e07`.
App Store Connect build `04cfbf70-b871-475e-9331-ed5c01da4e07` reported `VALID` and `IN_BETA_TESTING` at `2026-11-16T17:37:36.039Z`.
The internal TestFlight groups with access were Hither Test and Hither Test group 1.

## Issue #375 驗收（2026-11-18）

使用 iPhone 17 Pro 模擬器（iOS 26.4.1，23E254a）與 Xcode 27.2。Release 模擬器為 `0.1.17 (1)`、runtime `0.1.17`，原生執行檔與 Widget 來自上方同一來源。JavaScript 從該提交重新打包，透過測試啟動程式登入本機合成隊伍，並關閉 OTA 載入。已比對安裝後的執行檔、Widget 與 JavaScript bundle。

- 在地圖出發後切到背景，再回前景並長按結束。前後是同一個 Hither 程序，測試隊伍依序進入 `going`、回到 `paused`。通知中心顯示 Hither 的 Live Activity。ActivityKit 日誌記錄同一筆活動的建立、結束與清除。
- 從設定的隊伍頁選「加入」開啟「我的隊伍」，從左邊緣拖曳可回到地圖。在地圖本身做左邊緣手勢，仍留在地圖。
- MapKit 顯示自己的藍點。同一個定位膠囊內的「縮放到全隊」與「回到我的位置」都能移動地圖。底部隊伍面板收合時隱藏內容，向上拖曳且手指尚未放開時已顯示隊伍內容。
- Live Activity observer 的並行生命週期測試在 build 88 來源的 CI 通過 Thread Sanitizer。 [測試紀錄](https://github.com/Yupoer/hither_app/actions/runs/43909220159/job/133446619449)

以模擬器作為本次驗收。實機 GPS、背景續航與 APNs 遠端推播超出此次驗證範圍。操作畫面與日誌保存在 Mac 的 `qa-runs/issue-375-20261118/`。

### 加密符號封存

用上方 SHA-256 對應的原始 IPA 與同次 build 的 `.xcarchive`，重新核對 arm64 執行檔、封存中的 dSYM 與 DWARF 檔案雜湊。

| 執行檔 | IPA 與 dSYM 相符的 UUID |
| --- | --- |
| App | `81ED2FC2-4653-3782-896D-B2A091D588D8` |
| Live Activity Widget | `F0D532ED-7106-35D0-AC35-622FC03391FC` |

CMS AES-256 加密檔 `hither-ios-debug-symbols.encrypted.der` 已保存在 Mac 原始發佈目錄 `release-artifacts/ios-0.1.17-map-sheet-refinement-20261117/`。SHA-256 為 `c5e699f937d5f5709e42e9862348ff0b672c3248fe106e9945adbc9968a4a54a`。已讀回 DER 結構並核對收件者憑證。解密驗證需使用該憑證對應的私鑰。 [符號封存流程](crash-investigation.md#retain-signed-build-symbols)
