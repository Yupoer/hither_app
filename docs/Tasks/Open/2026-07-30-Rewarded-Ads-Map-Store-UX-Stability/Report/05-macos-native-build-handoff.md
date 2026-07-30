# 05 — macOS 原生 Build Handoff（給下一台電腦 session）

**日期：** 2026-07-30  
**來源 session：** Windows（Map-Store / review-02 修復將由本次 ship 產生的 commit 交接）  
**此檔目的：** 下一台 **macOS** session 只做原生 gate，不重做 JS。

---

## 為什麼 Windows session 沒跑 `pod install`

| 檢查 | 結果 |
|------|------|
| OS | Windows |
| `pod` | **not found** |
| `ruby` | **not found** |
| Xcode / iOS SDK | 無 |
| `Podfile.lock` 內 GMA 條目數 | **0** |

`pod install` 需要 **macOS + CocoaPods + Xcode**。Windows 無法解析 iOS pods。  
**不是漏做**，是環境硬限制。Android Gradle 可在 Windows 做，但 iOS binary 仍必須 macOS／EAS。

## 交接前提

Mac 不應以 Windows working tree 或 stash 作為來源。Windows ship 完成後，先把產生的 commit push 並合併到 `origin/master`；Mac 必須從遠端 master 拉取該 commit，再執行以下原生步驟。

---

## Windows 已完成（不要重做）

### 原生設定（Ticket 02 軟體面）

| 項目 | 位置 | 值 |
|------|------|-----|
| iOS App ID | `apps/mobile/ios/Hither/Info.plist` → `GADApplicationIdentifier` | `ca-app-pub-8135109277557342~4266216474` |
| Android App ID | `apps/mobile/android/app/src/main/AndroidManifest.xml` → `APPLICATION_ID` | `ca-app-pub-8135109277557342~5387726456` |
| Expo plugin | `apps/mobile/app.json` → `react-native-google-mobile-ads` | 同上 ios／android AppId |
| npm 依賴 | `apps/mobile/package.json` | `react-native-google-mobile-ads@^16.4.0`（lock 16.4.0） |
| Podfile | `apps/mobile/ios/Podfile` | Expo autolinking；`pod install` 後會拉 GMA |

### JS／UX（review-02 Fixed）

- `rewardedAds.ts`：load 45s / show 120s timeout、dispose settle  
- Map 長按：`refresh() === true` 才 dismiss 確認卡  
- CoverFlow：`SheetPaneKey`、divisor 3.05、step 0.52、overflow visible  
- Emoji：25 preset、`#5E6C84` 色盤、非 preset fallback 📍、accent 框線  
- 鉛筆：`activeColor={accent}`  
- 測試：`rewardedAdController` / `destinationEmojiColor` / `mapStoreUxContracts` 等  

詳見：`Code Review/review-02.md`、`Report/02-native-admob-alignment.md`。

### 未做（必須 macOS／EAS）

- [ ] `pod install` 更新並 **commit** `Podfile.lock`（含 `RNGoogleMobileAds`、`Google-Mobile-Ads-SDK`）  
- [ ] 產出含 GMA 的 **新 native binary**  
- [ ] 裝置：看廣告 → verifying → SSV wallet +1（Ticket 04）  

---

## 接手前檢查（macOS session 第一步）

```bash
# 1. 進 repo（路徑依機器調整）
cd <repo>/hither_app   # 或 monorepo 內 apps 上層

# 2. 拉取 Windows 已 push 的 task commit
git fetch origin
git switch master
git pull --ff-only origin master

# 3. 確認在對的 branch / 有 Map-Store 變更
git status -sb
git log -1 --oneline

# 4. 確認 JS 依賴已裝（在 apps/mobile）
cd apps/mobile
test -d node_modules/react-native-google-mobile-ads && echo "GMA npm OK" || npm ci
```

若 Mac checkout 後仍有 working-tree 變更，先停止並確認來源；不要在 Mac 重新提交 JS／UX 修改，也不要把其他 Hygiene 文件刪除混入原生 commit。

---

## 必做：`pod install` + 驗證 lock

```bash
cd apps/mobile/ios

# 建議用與專案一致的 Ruby／CocoaPods（bundler 若有則 bundle exec）
pod install --repo-update

# 驗收：兩個必要 Pod 都必須存在；UMP 另行記錄
grep -q 'RNGoogleMobileAds' Podfile.lock && echo 'RNGoogleMobileAds OK'
grep -q 'Google-Mobile-Ads-SDK' Podfile.lock && echo 'Google-Mobile-Ads-SDK OK'
grep -E 'UserMessagingPlatform|GoogleUserMessagingPlatform' Podfile.lock || true
```

**通過條件：**

```
RNGoogleMobileAds
Google-Mobile-Ads-SDK
```

（UMP 名稱可能是 `GoogleUserMessagingPlatform` 或 plugin 帶入的別名；有則佳。）

```bash
# 失敗時常見原因
# - node_modules 不完整 → 回 apps/mobile 跑 npm ci
# - autolinking 找不到 package → 確認 package.json 有 react-native-google-mobile-ads
# - 部署目標過舊 → Podfile 已 15.1+
```

**成功後立刻：**

```bash
cd ../../..   # 回到 hither_app root
git add apps/mobile/ios/Podfile.lock
# 若 Pods 目錄不進 git：只 lockfile
git status -- apps/mobile/ios/Podfile.lock
# commit message 建議：
# chore(ios): lock Google Mobile Ads via pod install (Ticket 02)
```

---

## 必做：新 native binary（OTA 不夠）

任選一條路徑（專案慣用 EAS 則用 A）：

### A. EAS（建議）

```bash
cd apps/mobile
# 內部分發的 release-like 驗證
npx eas-cli@latest build --platform ios --profile preview
# Android 若也要新 GMA binary：
npx eas-cli@latest build --platform android --profile androidQa
# 商店簽署包則改用 production
# npx eas-cli@latest build --platform ios --profile production
```

### B. 本機 Xcode

```bash
cd apps/mobile/ios
open Hither.xcworkspace   # 必須 workspace，不是 xcodeproj
# Product → Archive 或 Run 到裝置
```

### C. Android 本機（可 Windows 或 macOS）

```bash
cd apps/mobile/android
./gradlew :app:assembleRelease   # 或 assembleDebug / 專案既有 script
```

---

## 裝置驗收（Ticket 04 — 完成才可宣稱廣告修了）

| # | 步驟 | 通過 |
|---|------|------|
| 1 | 安裝 **新 binary**（非僅 OTA 舊包） | 冷啟不閃退 |
| 2 | 開地圖 → CoverFlow → **商店** | 可看到商店卡 |
| 3 | 看獎勵廣告（`__DEV__` 用 test unit） | 進到 verifying，CTA 不永久卡住 |
| 4 | 等 SSV callback | wallet **+1**（與 Token Store 後端契約） |
| 5 | 舊 binary（無 GMA） | 顯示需更新／missing_module，**不**當已修復 |

開發請用 Google **test ad units** 或登錄測試裝置，勿拿正式流量當開發驗證。

---

## App ID 速查（勿改，已對齊）

| 平台 | App ID |
|------|--------|
| iOS | `ca-app-pub-8135109277557342~4266216474` |
| Android | `ca-app-pub-8135109277557342~5387726456` |

來源：`app.json` plugin、`Info.plist`、`AndroidManifest.xml`、（若存在）`store/types.ts` `ADMOB_APP_IDS`。

---

## 完成後回寫

1. 勾 `Report/02-native-admob-alignment.md` 驗收 checklist  
2. 在本檔底部填：

```
## Mac session 結果
- 日期：
- 機器：
- pod install：OK / FAIL（貼 grep 片段）
- Podfile.lock commit：
- binary 產物（EAS build id 或 local path）：
- Ticket 04 裝置：PASS / FAIL / 未測
```

3. 更新 `Report/implementation-summary.md` Ticket 02 Device 欄  

---

## 給 agent 的最短 prompt（貼到 macOS session）

```
讀 docs/Tasks/Open/2026-07-30-Rewarded-Ads-Map-Store-UX-Stability/Report/05-macos-native-build-handoff.md
先 git fetch origin && git switch master && git pull --ff-only origin master，再執行：
1) apps/mobile npm 依賴就緒
2) ios pod install，分別確認 Podfile.lock 有 RNGoogleMobileAds + Google-Mobile-Ads-SDK
3) commit 僅 Podfile.lock（+ 若有必要的 lock 相關）
4) `npx eas-cli@latest build --platform ios --profile preview` 打新 iOS native binary（必要時 Android）
5) 回寫 Report/02 與本檔 Mac session 結果
不要重做 JS review-02 修復；不要 OTA 取代 native build。
```
