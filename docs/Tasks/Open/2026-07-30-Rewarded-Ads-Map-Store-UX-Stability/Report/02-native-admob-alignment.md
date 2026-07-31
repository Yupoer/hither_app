# 02 — 原生 AdMob 設定同步

**日期：** 2026-07-30  
**需要新原生安裝檔：** **是**（OTA 不足）  
**macOS handoff：** 見同目錄 `05-macos-native-build-handoff.md`（給下一台 build session 的完整指令）

## 設定狀態（Windows session 已完成）

| 檔案 | 變更 |
|------|------|
| `apps/mobile/ios/Hither/Info.plist` | 新增 `GADApplicationIdentifier` = `ca-app-pub-8135109277557342~4266216474`；`NSUserTrackingUsageDescription` 與 plugin 對齊 |
| `apps/mobile/android/app/src/main/AndroidManifest.xml` | 既有 `com.google.android.gms.ads.APPLICATION_ID`；已核對為 `ca-app-pub-8135109277557342~5387726456` |
| `apps/mobile/app.json` | 既有 plugin ios／android App ID 已核對一致；本次同步 ATT 說明文字 |
| `apps/mobile/package.json` | 既有 `react-native-google-mobile-ads` `^16.4.0`；package-lock 已鎖定 16.4.0，本次未新增套件 |

## 一致性

- 與 `app.json` → `react-native-google-mobile-ads` plugin 的 iosAppId／androidAppId 一致  
- 與程式內 App ID 常數一致（若有 `ADMOB_APP_IDS`）  
- **未**變更 Token／SSV／wallet／ledger／商品契約  
- `Podfile` 使用 Expo `use_native_modules!` autolinking：npm 有 GMA 套件後，**macOS `pod install` 應自動鏈入**，無需手寫 pod 行  

## 為什麼本機沒跑 `pod install`

| 項目 | Windows 代理環境 |
|------|------------------|
| `pod` CLI | **不存在** |
| `ruby` | **不存在** |
| Xcode | **不存在** |
| `Podfile.lock` 內 `RNGoogleMobileAds` / `Google-Mobile-Ads-SDK` | **0 筆** |

iOS CocoaPods 解析 **只能在 macOS** 完成。這不是漏步驟；軟體面 App ID + npm 依賴已就緒，**lockfile 更新留給 macOS session**。

## 仍待 macOS／EAS（外部 gate）

完整逐步指令、驗收 grep、EAS／Xcode、裝置 Ticket 04、給 agent 的 prompt：

→ **`Report/05-macos-native-build-handoff.md`**

摘要：

1. `cd apps/mobile/ios && pod install`（必要時 `--repo-update`）  
2. `grep -q 'RNGoogleMobileAds' Podfile.lock && grep -q 'Google-Mobile-Ads-SDK' Podfile.lock` 必須成功  
3. **commit** 更新後的 `Podfile.lock`  
4. EAS／Xcode／Gradle 產出 **新** release-like binary（runtime 含 GMA；**OTA 不能補原生模組**）  
5. 裝置：test unit → verifying → SSV wallet +1  
6. 舊安裝檔介面仍可能 unsupported／需更新（JS degrade）  

### 驗收 checklist（macOS 操作者）

- [x] `Podfile.lock` 同時有 `RNGoogleMobileAds` 與 `Google-Mobile-Ads-SDK`（2026-07-30 Mac；re-verified 2026-07-31；GMA SDK 13.5.0 + UMP 3.1.0）  
- [x] `Podfile.lock` 已 commit（`fix/ios-gma-pod-lock-reward-ads` → master；含 production 必要 native gate）  
- [x] 新 binary：`0.1.3` build `42` local production IPA 已 upload ASC（2026-07-31；含 GMA pods；Ticket 04 實機未測）  
- [ ] Store 看廣告可到 verifying，SSV 後 wallet +1（Ticket 04）  

## 驗證（Windows 已做）

- 契約測試：`mapStoreUxContracts` 讀 Info.plist／Manifest；`package.json` 宣告 `react-native-google-mobile-ads`  
- Focused Jest（含 review-02）：`rewardedAdController`、`destinationEmojiColor`、`mapStoreUxContracts` 等 PASS  
- 裝置啟動不因缺 App ID 閃退：**未驗證**（需新 binary）  
