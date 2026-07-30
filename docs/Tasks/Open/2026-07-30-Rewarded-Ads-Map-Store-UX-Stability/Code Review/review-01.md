# Rewarded Ads / Map / Store UX Stability — Code Review 01

**日期：** 2026-07-30  
**結果：** Changes requested → **Fixed**（同日 re-review 通過，**0 open**）  
**流程：** `/implement` effort 1（implement → review → fix → re-review）  
**Spec：** `../Spec/rewarded-ads-map-store-ux-stability-spec-2026-07-30.md`  
**Tickets：** `../Ticket/01` … `08`  
**實作摘要：** `../Report/implementation-summary.md`  
**驗證矩陣：** `../Report/04-verification-matrix.md`  
**原生對齊：** `../Report/02-native-admob-alignment.md`

---

## Scope（審查範圍）

只審查本 task pack 相關變更：

| 區塊 | 路徑（重點） |
|------|----------------|
| 原生 AdMob | `apps/mobile/ios/Hither/Info.plist`、`apps/mobile/android/app/src/main/AndroidManifest.xml`、`app.json` ATT 字串 |
| Rewarded 執行期 | `apps/mobile/src/native/rewardedAds.ts`、`…/StorePane.tsx` |
| 長按／改名 | `MapScreen.tsx` 底部新增卡 + 中央 rename Modal |
| 調整順序列 | `MapScreen.tsx` route pane 整條 `AmicroButton` |
| Emoji／色 | `destinationEmojiColor.ts`、`DestinationReorderList.tsx` |
| CoverFlow／手勢 | `PaneCoverFlow.tsx`（新）、`sheetPane.ts`、`BottomSheet.tsx` |
| 測試 | `rewardedAdController.test.ts`、`mapStoreUxContracts`、`storeSheetPane`、emoji／store／map 契約 |
| 報告 | `Report/01`、`02`、`04`、`implementation-summary` |

**排除：** Token／SSV／wallet schema 重設、App Store／Play 提交、正式廣告流量切換、與本 pack 無關的既有測試失敗（如 `gatheringWorkflowContract` push recipients）。

**優先級：**  
- **P0** 程序終止／錯誤入帳  
- **P1** 核心流程錯誤、狀態卡死、可觀察行為違反 Spec  
- **P2** 可恢復性／a11y／死碼  
- **P3** 文案／一致性 nit

---

## 一頁結論（給 reviewer）

| 項目 | 狀態 |
|------|------|
| Spec tickets 01–08 軟體面 | **完成**（裝置 E2E 明確標 未驗證） |
| Client 是否直接 +Token | **否**（`EARNED_REWARD` → `verifying` only） |
| Token／SSV 契約變更 | **無** |
| 新 npm carousel／手勢套件 | **無** |
| 自動化 | **7 suites / 102 tests PASS**（本 pack 主 pattern + `rewardedAdController`） |
| 第一輪 open issues | **9**（3 bug · 5 suggestion · 1 nit）→ 全部 fixed |
| 第二輪 open issues | **0** |
| 是否需要 **新原生 build** 才能宣稱廣告修復 | **是**（見下節） |

---

## 是否需要 build？為什麼？

### 短答

| 你想驗證／發布的東西 | OTA 夠嗎？ | 需要新原生 binary？ |
|----------------------|------------|---------------------|
| CoverFlow、長按改名、25 emoji、調整順序列、JS 生命週期硬化 | **可以**（JS only） | 否（但裝置手勢仍建議手測） |
| 「商店 → 觀看廣告 **不再因缺 App ID／模組閃退**」 | **不夠** | **是** |
| 「看完廣告 → SSV → wallet +1」完整通過 | **不夠** | **是** + 裝置 smoke |
| 宣稱 Ticket 04 通過 | **不夠** | **是** |

### 原因（給 code review 用）

1. **`GADApplicationIdentifier` / Android `APPLICATION_ID` 是原生 plist／manifest 設定**  
   本 pack 已寫入 committed `Info.plist` 與 `AndroidManifest.xml`，但這些值只有被 **編譯進安裝檔** 才會在執行期生效。Expo OTA（EAS Update）只更新 JS bundle，**不會**改寫已安裝 binary 內的 Info.plist / Manifest。

2. **`react-native-google-mobile-ads` 是原生模組**  
   需要連結 GMA／UMP SDK。審查當下 `Podfile.lock` **仍無** Google Mobile Ads 條目 → 高風險：舊 binary 上 `require` 失敗會走 `missing_module`，或初始化缺 App ID 時原生層可能直接終止（此為 Ticket 01 高風險假設，**尚未**在裝置上取得堆疊確認）。

3. **Spec 明確規定**  
   原生設定／依賴變更後必須新安裝檔；**不得**用 OTA 結果宣稱原生廣告已修復（見 Spec Implementation Decisions / Ticket 02、04）。

4. **因此**  
   - 地圖／商店 UX（05–08）的 JS 行為：可先 OTA 驗 UI。  
   - 廣告閃退與 Token 入帳（01–04）：必須 **`pod install`（iOS）+ 新 dev client / release-like build**，再跑裝置矩陣。

### 操作者 checklist（非 code review 阻塞，但是合規阻塞）

- [ ] macOS：`pod install`，確認 lock 出現 GMA／RNGoogleMobileAds／UMP  
- [ ] 產出 **新** iOS release-like 安裝檔（含上述 App ID）  
- [ ] 開發用 **test ad units**（`__DEV__`）或已登錄測試裝置  
- [ ] 跑 `Report/04-verification-matrix.md` 裝置欄  
- [ ] Android 另欄；未跑則寫 **Android 未驗證**（不得由 iOS 推定）

---

## Round 1 發現 → Round 2 修復狀態

### [P1] Load 階段 ERROR listener 殘留，可把 `verifying` 打回失敗 UI — **fixed**

**位置：** `rewardedAds.ts`（load settle 後 `clearUnsubs`；`phase: 'load' | 'show' | 'idle'`）

**問題：** 成功 `load()` 後 LOADED/ERROR 未 detach；`show()` 期間 load-phase ERROR 仍 `emit`，StorePane 可能把 UI 從 `verifying` 蓋成 error，違反「狀態只完成一次」。

**修復：** load settle 立即 `clearUnsubs()`；show 另註冊 listener；ERROR 受 `phase` 閘門。測試：`rewardedAdController.test.ts` late ERROR after ready。

---

### [P1] `dispose()` 不 resolve 進行中的 load/show Promise — **fixed**

**位置：** `rewardedAds.ts` `pendingSettle` / `settlePending` / `dispose`

**問題：** unmount 或重試 dispose 時 Promise 懸掛，可能卡死 `finally`／跳過 session 清理。

**修復：** `dispose()` 先 `settlePending('error')` 再清 listener。測試：mid-load／mid-show dispose。

---

### [P1] CoverFlow 取消手勢 `dragX` 不清 — **fixed**

**位置：** `PaneCoverFlow.tsx` `didEndSV` + `onFinalize`

**問題：** pan cancel 無 `onEnd` 時卡片視覺偏移殘留。

**修復：** finalize 時若未 end 則 `dragX = 0`。

---

### [P2] 長滑跨多格只震動一次 — **fixed**

**位置：** `sheetPane.ts` `coverFlowHapticSteps` + `PaneCoverFlow` `commitIndex` 迴圈

**規格：** 每跨越一個 index 一次 selection haptic。

---

### [P2] CoverFlow a11y action 英文硬編碼 — **fixed**

**位置：** `i18n` `map.coverFlowNext` / `map.coverFlowPrev`；`PaneCoverFlow` 使用 `t()`。

---

### [P2] CoverFlow 遷移後死碼 helpers — **fixed**

**位置：** 移除 `paneAfterSwipe` / `isHorizontalPaneGesture` / `paneIndex` / `paneAt`；保留 production 使用的 `coverFlowSnapIndex` 等。

---

### [P2] Ticket 03/08 僅 source contract — **fixed（最小行為測）**

**位置：** 新增 `rewardedAdController.test.ts`（fake GMA module）；offset／haptic steps 單元測。  
裝置手勢仍 **未驗證**。

---

### [P2] emoji 儲存成功後 `refresh()` 失敗被當儲存失敗 — **fixed**

**位置：** `MapScreen` `handleUpdateEmojiColor`：update 失敗才 rethrow；成功後 local patch；`refresh()` 僅 soft-log。

---

### [P3] ATT 使用說明英／中不一致 — **fixed**

**位置：** `Info.plist` + `app.json` 同步中文：「此識別碼會用來向你提供個人化廣告。」

---

## Spec 對齊 checklist（reviewer 用）

| Spec／Ticket | 預期 | Code review 判定 |
|--------------|------|------------------|
| 01 證據分層 | 已觀察／高風險／待驗證；不武斷單一根因 | **Pass**（`Report/01`） |
| 02 原生 App ID 一致 | plist／manifest = Expo plugin | **Pass**（需新 binary 驗證） |
| 03 生命週期可恢復 | 不閃退、不卡死、不 client 入帳 | **Pass（軟體）**；裝置 未驗證 |
| 04 E2E +1 | 新 binary 上證明 | **報告完成；裝置 未驗證**（不得宣稱通過） |
| 05 底部新增 + 中央改名 | 確定只改草稿；Add 才新增 | **Pass（契約）** |
| 06 整條調整順序 | 單一 press target | **Pass** |
| 07 25 emoji、獨立色、無自訂 | 清單去 🧭；preview；cancel/confirm | **Pass** |
| 08 CoverFlow + 互斥手勢 | 四卡；無箭頭圓點；failOffset 互斥 | **Pass（結構）**；裝置手勢 未驗證 |
| Out of scope | 不改 wallet schema／不取代底部卡／不加套件 | **Pass** |

---

## 仍開放的風險（非「未修 code」，是環境）

1. **GMA 未出現在 `Podfile.lock`** → 下一次 iOS build 前必須 `pod install` 並確認連結。  
2. **iOS／Android 裝置廣告 E2E 未跑** → Ticket 04 不可標通過。  
3. **CoverFlow ↔ BottomSheet 互斥** 依賴 Gesture Handler 實際行為 → 需真機確認。  
4. **舊安裝檔** 會繼續缺 App ID／模組；JS 應 degrade 為 unsupported／更新提示，而非 silently 當已修復。

---

## 建議 code review 通過條件

**軟體 merge／進主線（本 pack JS + 原生設定檔）：** 可通過，條件是：

- 文件清楚寫：**廣告修復需要新 binary，OTA 不可宣稱原生通過**  
- 不把 Ticket 04 標成 device pass  

**產品宣稱「觀看廣告可用／Token +1」：** 阻塞到操作者完成新 build + 裝置矩陣。

---

## 測試指令（reviewer 重跑）

在 `hither_app/apps/mobile`：

```bash
npx jest --testPathPattern="rewardedAdController|storeSheetPane|storeUiContracts|destinationEmojiColor|mapStoreUxContracts|amicroUiContracts|mapUiContracts"
```

預期：本 pack 相關 suites **PASS**（歷史上約 7 suites / 102 tests）。  
若 `gatheringWorkflowContract` 失敗：確認是否為既有 push recipients 字串漂移，**非**本 pack。

---

## 變更檔案清單（reviewer diff 入口）

### 原生
- `apps/mobile/ios/Hither/Info.plist` — `GADApplicationIdentifier`、`NSUserTrackingUsageDescription`
- `apps/mobile/android/app/src/main/AndroidManifest.xml` — `com.google.android.gms.ads.APPLICATION_ID`
- `apps/mobile/app.json` — ATT 字串與 plugin 對齊（中文）

### 執行期／UI
- `apps/mobile/src/native/rewardedAds.ts`
- `apps/mobile/src/screens/MapScreen/components/StorePane.tsx`
- `apps/mobile/src/screens/MapScreen/components/PaneCoverFlow.tsx` **（新）**
- `apps/mobile/src/screens/MapScreen.tsx`
- `apps/mobile/src/components/BottomSheet.tsx`
- `apps/mobile/src/components/DestinationReorderList.tsx`
- `apps/mobile/src/components/AmicroButton.tsx`
- `apps/mobile/src/utils/destinationEmojiColor.ts`
- `apps/mobile/src/store/sheetPane.ts`
- `apps/mobile/src/i18n/index.ts`

### 測試
- `apps/mobile/src/__tests__/rewardedAdController.test.ts` **（新）**
- `apps/mobile/src/__tests__/mapStoreUxContracts.test.ts` **（新）**
- 既有：`storeSheetPane`、`storeUiContracts`、`destinationEmojiColor`、`mapUiContracts`、`amicroUiContracts`

### 本 task 文件
- `Report/*`、`Code Review/review-01.md`（本檔）

---

## Reviewer 簽核欄（人工填）

| 角色 | 結果 | 日期 | 簽名／備註 |
|------|------|------|------------|
| Implementer re-review | 0 open | 2026-07-30 | 自動化通過 |
| Human code review | ☐ Approve / ☐ Request changes | | |
| Device QA (iOS ads) | ☐ Pass / ☐ Fail / ☐ 未驗證 | | 需新 binary |
| Device QA (Android ads) | ☐ Pass / ☐ Fail / ☐ 未驗證 | | 不得由 iOS 推定 |
