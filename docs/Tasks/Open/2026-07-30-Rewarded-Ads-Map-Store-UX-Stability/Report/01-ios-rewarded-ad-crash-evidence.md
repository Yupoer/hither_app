# 01 — iOS Rewarded Ads 閃退與版本證據（去識別化）

**日期：** 2026-07-30  
**環境：** 倉庫靜態指紋（repo fingerprint）  
**裝置重現：** **未驗證**（本 agent 執行環境無 iOS release-like 裝置／模擬器）  
**Android 重現：** **未驗證**

---

## 標籤說明

| 標籤 | 意義 |
|------|------|
| **已觀察** | 可從已提交原始碼／設定直接驗證的事實 |
| **高風險不一致** | 與 Expo plugin／GMA 預期不同步，足以造成原生初始化失敗或閃退，但尚未以裝置 stack 證實為唯一根因 |
| **待驗證假設** | 需新安裝檔 + 裝置／日誌才能確認或排除 |

---

## 版本指紋（repo）

| 項目 | 值 | 標籤 |
|------|-----|------|
| Expo `app.json` version | `0.1.3` | 已觀察 |
| Expo `runtimeVersion` | `0.1.3` | 已觀察 |
| package.json mobile version | `0.1.0`（與 app.json 不完全一致） | 已觀察 |
| Expo SDK | `^56.0.0` | 已觀察 |
| react-native | `0.85.3` | 已觀察 |
| react-native-google-mobile-ads | `^16.4.0`（package-lock 已鎖） | 已觀察 |
| node_modules GMA 套件 | 存在 | 已觀察 |
| AdMob iOS App ID（Expo plugin） | `ca-app-pub-8135109277557342~4266216474` | 已觀察 |
| AdMob Android App ID（Expo plugin） | `ca-app-pub-8135109277557342~5387726456` | 已觀察 |
| Production rewarded unit iOS | `…/7899053731`（types.ts） | 已觀察 |
| Production rewarded unit Android | `…/7100977386`（types.ts） | 已觀察 |
| Dev／非 release | 使用 Google sample test rewarded units | 已觀察 |

**未記錄（政策）：** access token、完整 SSV callback query、原始 reward session ref、可識別使用者資料。

---

## 原生設定比對

### iOS（提交專案）

| 檢查 | 結果 | 標籤 |
|------|------|------|
| `ios/Hither/Info.plist` 曾缺 `GADApplicationIdentifier` | **修復前缺失**（高風險：GMA 初始化常見閃退原因） | 高風險不一致 → Ticket 02 已寫入 |
| Expo plugin `iosAppId` 與 types `ADMOB_APP_IDS.ios` | 一致 | 已觀察 |
| `Podfile.lock` 含 Google-Mobile-Ads-SDK / RNGoogleMobileAds | **未見** GMA 相關 pod 條目 | 高風險不一致 |
| UMP / User Messaging Platform 原生連結 | 依賴 GMA pod 解析；目前 lock 無證據 | 高風險不一致 |
| 實際安裝檔是否含原生模組 | **待驗證**（需 `pod install` + 新 binary） | 待驗證假設 |

### Android（提交專案）

| 檢查 | 結果 | 標籤 |
|------|------|------|
| `AndroidManifest.xml` 曾缺 `com.google.android.gms.ads.APPLICATION_ID` | **修復前缺失** | 高風險不一致 → Ticket 02 已寫入 |
| Expo plugin `androidAppId` 與 types | 一致 | 已觀察 |
| 裝置 smoke「商店 → 觀看廣告」 | **未驗證** | 待驗證假設 |

---

## 生命週期入口（JS 已觀察）

商店 CTA → `ensureRewardedAdsReady`（UMP `canRequestAds` fail-closed）→ `createRewardSession` → `createRewardedAdController` → load / show → 僅 `verifying` UI → server snapshot 輪詢。

客戶端 **不** 直接 `balance + 1`（已觀察於 StorePane／契約測試）。

---

## 根因結論（供 Ticket 02／03）

1. **不得** 在無原生 stack 時宣稱單一已確認閃退根因。  
2. **必須保留的修復分支：**  
   - 原生 App ID 缺失／不同步（Info.plist + Android meta-data）  
   - 原生模組未連結／舊安裝檔（Expo Go 或未重 build）  
   - 同意／無填充／load／show／提前關閉／SSV 延遲（JS 生命週期）  
3. **Ticket 02 最小動作：** 寫入原生 App ID、新原生安裝檔、確認 pod／Gradle 解析 GMA+UMP。  
4. **Ticket 03 最小動作：** 缺少模組／同意／錯誤路徑可重試、dispose、verifying-only。  
5. **OTA 不足以** 驗證原生 App ID 或 GMA 連結修復。

---

## 裝置證據狀態

| 平台 | 重現「商店 → 觀看廣告」 | 原生例外／stack | 狀態 |
|------|------------------------|-----------------|------|
| iOS release-like | 未執行 | 無 | **未驗證** |
| Android | 未執行 | 無 | **未驗證** |
| Jest／契約 | 已跑相關 suite | N/A | 自動化通過（非原生證明） |
