# Rewarded Ads／Map／Store UX Stability — Code Review 02

**日期：** 2026-07-30  
**結果：** Fixed  
**固定點：** 先前受審 `39bb8dc`；修復落地於 working tree（相對 master `535b66e`）  
**Spec：** `../Spec/rewarded-ads-map-store-ux-stability-spec-2026-07-30.md`  

## Scope

- Rewarded Ads 原生設定、執行期 controller 與 Store Pane
- 長按新增集合點與中央改名視窗
- 調整順序、Emoji／旗幟背景色
- CoverFlow 與 Bottom Sheet 手勢
- 本 task 新增及修改的 focused tests

排除 task 外的文件搬移、既有失敗與發布操作。

## Standards

### [P3] CoverFlow 用一般字串繞過既有 Pane domain type — **Fixed**

**位置：** `PaneCoverFlow.tsx`、`MapScreen.tsx`

`PaneCoverFlowOption.key` / `value` / `onChange` 改為 `SheetPaneKey`。caller 不再需要 `as (key: string) => void`。

## Spec

### [P1] 新增成功但 refresh 失敗時仍清掉旗幟與底部卡片 — **Fixed**

**位置：** `MapScreen.tsx` `handlePickDestination`

```ts
const projected = await refresh();
return projected === true;
```

`refresh() === false` 時回傳失敗，上層不呼叫 `dismissConfirmCard()`，暫存旗幟與確認卡保留。

### [P1] Rewarded Ad load／show 沒有逾時 — **Fixed**

**位置：** `rewardedAds.ts`

| 常數 | 值 | 用途 |
|------|-----|------|
| `REWARDED_AD_LOAD_TIMEOUT_MS` | 45s | load 無 LOADED/ERROR → `error` |
| `REWARDED_AD_SHOW_TIMEOUT_MS` | 120s | show 無 EARNED/CLOSED/ERROR → `error` |
| `REWARDED_AD_CLOSED_EARNED_GRACE_MS` | 2s | CLOSED 先於 EARNED 的 grace |

`phaseTimeoutTimer` 在 `settlePending` / `finish` / `dispose` 一律清除。CTA 可重試。

### [P1] Ticket 02 iOS GMA／UMP 原生依賴對齊 — **Documented gate（非 OTA）**

**位置：** `Info.plist`（已有 `GADApplicationIdentifier`）、`package.json`（`react-native-google-mobile-ads`）、`Podfile.lock`（**仍無** GMA 條目）

| 項目 | 狀態 |
|------|------|
| iOS App ID / Android APPLICATION_ID | Done（JS + plist + manifest） |
| npm dependency | Done |
| `Podfile.lock` 含 RNGoogleMobileAds / Google-Mobile-Ads-SDK | **Blocked：需 macOS `pod install`** |
| 新 native binary + 裝置驗證 | **Blocked：需 EAS/Xcode 新 build** |

詳見 `Report/02-native-admob-alignment.md`。Windows 無法完成 pod 解析；此項不阻塞 OTA 的 JS 修復，但 **Ticket 04 真實 iOS 廣告驗收仍被阻擋**。

### [P1] 初始 CoverFlow 仍完全看不到「商店」 — **Fixed**

**位置：** `PaneCoverFlow.tsx`

- `COVERFLOW_CARD_DIVISOR = 3.05`、`COVERFLOW_STEP_RATIO = 0.52`
- `coverFlowCardLeftEdge` 純函式供幾何測試
- 外層 GlassView `overflow: 'visible'`
- 契約：四個 center index 下每張卡與 track 有交集（含 members 選中時 store 仍可見）

### [P2] 移除 `🧭` 時連帶刪除了既有色盤顏色 — **Fixed**

`DESTINATION_PALETTE_LIST` 明確保留 `#5E6C84`。

### [P2] Emoji 框線仍不是一致的主題色 — **Fixed**

每個 preset cell：`borderColor: colors.accent`、`borderWidth: 2`；選取用背景 `accent33`，不改框線。

### [P2] 舊自訂 Emoji 沒有轉成安全的 25 項 fallback — **Fixed**

`resolveDestinationEmoji`：非 preset → `DESTINATION_EMOJI_FALLBACK`（📍）；`validateDestinationEmoji` 仍做 Unicode 寫入防禦。

### [P2] 鉛筆動畫完成後仍切換成非主題色 — **Fixed**

`map-edit-itinerary`：`color={accent}` 且 `activeColor={accent}`（不再用 `glass.ok`）。

## Verification

- Focused Jest：`rewardedAdController`、`destinationEmojiColor`、`mapStoreUxContracts` 等（見本輪跑測結果）
- iOS／Android 真實 Rewarded Ad、SSV +1、MapKit 手勢：**未在本環境驗證**
- **外部 gate：** macOS `pod install` → 提交 `Podfile.lock` → 新 native binary → Ticket 04

## Summary

| 嚴重度 | 原 findings | 狀態 |
|--------|-------------|------|
| P3 Standards | 1 | Fixed |
| P1 Spec | 4 | 3 Fixed + 1 Documented external gate（Podfile/binary） |
| P2 Spec | 4 | Fixed |

可 OTA 的 JS／契約修復已收斂。iOS 廣告原生連結仍需 macOS + 新 binary，不可靠 OTA 單獨宣稱商店閃退已修。
