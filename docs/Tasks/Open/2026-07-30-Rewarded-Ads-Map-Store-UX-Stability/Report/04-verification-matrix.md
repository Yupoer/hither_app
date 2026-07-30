# 04 — 驗證矩陣（廣告 → Wallet、地圖 UX）

**日期：** 2026-07-30  
**Binary 需求：** 原生 App ID／GMA 依賴變更 → **必須新原生安裝檔**；**OTA 不可**取代本報告中的原生通過聲明。

---

## 證據分層

| 層級 | 本輪結果 | 可否推及裝置 |
|------|----------|--------------|
| 自動化（Jest 契約／純函式） | **通過**（見下） | 否 |
| TypeScript／靜態設定 | 已寫入 Info.plist + AndroidManifest + JS | 否 |
| iOS release-like 裝置／模擬器 | **未驗證** | — |
| Android 裝置／模擬器 | **未驗證** | — |
| Server SSV／ledger | 沿用 Token Store pack；本輪未重跑 E2E | 不得由 iOS 未驗證推定 |

---

## Rewarded Ads 端到端

| 案例 | 自動化 | iOS 裝置 | Android |
|------|--------|---------|---------|
| 開啟商店 → 觀看廣告 → 看完 → SSV → balance +1 | 契約：verifying-only、無 client +1 | **未驗證** | **未驗證** |
| 重複 callback 最多一筆入帳 | server 契約（既有 pack）；client dispose／generation | **未驗證** | **未驗證** |
| 提前關閉 → 不入帳 | JS：`dismissed` + failSession | **未驗證** | **未驗證** |
| 無填充／load／show 失敗 → 可重試 | JS：no_fill／error + dispose | **未驗證** | **未驗證** |
| 離線 | StorePane offline banner／CTA | **未驗證** | **未驗證** |
| 缺少原生模組 | `missing_module` → unsupported CTA | **未驗證**（需舊／Expo Go 安裝） | **未驗證** |
| late SSV 反映餘額 | `startLateSsvPoll` + AppState refresh | **未驗證** | **未驗證** |
| 原生不因缺 App ID 閃退 | Info.plist / Manifest 已對齊 | **未驗證**（需新 binary） | **未驗證** |

**結論：** 不得宣稱「iOS 廣告至 Token +1 已通過」。必須在含 GMA+UMP 的新安裝檔上重跑。

---

## 地圖／Emoji／CoverFlow

| 案例 | 自動化 | 裝置互動 |
|------|--------|----------|
| 長按 → 底部卡 + 暫存旗幟 | 契約：longpress source、confirm card | **未驗證** |
| 名稱 → 中央改名；確定只改草稿 | 契約：confirmRenameModal 無 addDestination | **未驗證** |
| 取消改名保留草稿 | 契約：cancelRenameModal | **未驗證** |
| 新增成功清草稿 + cameraAfterSuccessfulAdd | 契約 + 既有 camera 測試路徑 | **未驗證** |
| 新增失敗保留草稿 | 契約：keep card until success | **未驗證** |
| 非領隊請求 | 既有 handlePickDestination notifyLeader | **未驗證** |
| 25 emoji、無自訂、獨立色 | unit + 契約 | **未驗證** UI |
| 整條調整順序 | 契約：單一 AmicroButton full-row | **未驗證** |
| CoverFlow 四卡／橫滑不移 sheet | unit snap + failOffsetX/Y 契約 | **未驗證** 原生手勢 |
| 縱滑不切 tab | BottomSheet failOffsetX | **未驗證** |
| 每索引一次震動 | CoverFlow selectionTick on commit | **未驗證** |
| Reduced motion / a11y adjustable | 原始碼契約 | **未驗證** |

---

## 本輪執行的自動化

```
jest --testPathPattern=
  storeSheetPane|storeUiContracts|destinationEmojiColor|
  mapStoreUxContracts|amicroUiContracts|mapUiContracts
→ 6 suites, 97 tests PASS
```

另：`coordinateDestination`、`mapRouteUiContract` PASS。  
`gatheringWorkflowContract` 1 failure 為 **既有** push recipients 字串漂移，**非**本 pack 變更。

---

## 發布／OTA 備註

- 本 pack 變更含 **iOS Info.plist**、**Android Manifest** → 需要 **新原生 binary**。  
- 純 JS（CoverFlow、emoji、rename、rewarded lifecycle）可隨 OTA，但 **不得** 用 OTA 結果宣稱原生廣告修復。  
- 正式廣告流量切換、App Store／Play 提交：**Out of scope**。
