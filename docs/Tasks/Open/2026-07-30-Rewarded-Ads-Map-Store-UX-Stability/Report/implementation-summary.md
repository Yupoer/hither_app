# Implementation Summary — Rewarded Ads / Map / Store UX Stability

**Date:** 2026-07-30  
**Task pack:** `docs/Tasks/Open/2026-07-30-Rewarded-Ads-Map-Store-UX-Stability`  
**Windows source:** 本次 ship 產生並 push 的 task commit（Mac 從 `origin/master` pull）  
**macOS next:** `Report/05-macos-native-build-handoff.md`

## Status

| Ticket | Software (Windows) | Device / native |
|--------|--------------------|-----------------|
| 01 Evidence | Done (repo fingerprint) | iOS/Android 未驗證 |
| 02 Native AdMob | Done：plist + manifest + npm + app.json | **Blocked：** `pod install` + 新 binary（見 05 handoff） |
| 03 Rewarded lifecycle | Done（含 load/show timeout） | 未驗證 |
| 04 E2E verify report | Matrix 文件 Done | **不得宣稱通過**（等新 binary） |
| 05 Long-press rename | Done（refresh false 保留卡） | 未驗證 |
| 06 Reorder full row | Done | 未驗證 |
| 07 25 emoji + color | Done（#5E6C84、preset fallback、accent border） | 未驗證 |
| 08 CoverFlow | Done（幾何 + SheetPaneKey） | 手勢 未驗證 |
| review-02 | **Fixed：typecheck + focused Jest**（Code Review/review-02.md） | Pod gate 除外 |

## Files changed (high signal)

- `apps/mobile/ios/Hither/Info.plist` — GADApplicationIdentifier + ATT usage string  
- `apps/mobile/android/app/src/main/AndroidManifest.xml` — APPLICATION_ID meta-data  
- `apps/mobile/src/native/rewardedAds.ts` — dispose settle、phaseTimeout 45s/120s  
- `apps/mobile/src/screens/MapScreen/components/StorePane.tsx` — dispose after load fail / show  
- `apps/mobile/src/screens/MapScreen/components/PaneCoverFlow.tsx` — **new**  
- `apps/mobile/src/screens/MapScreen.tsx` — CoverFlow、rename、refresh===true、pencil accent  
- `apps/mobile/src/components/BottomSheet.tsx` — failOffsetX exclusive with CoverFlow  
- `apps/mobile/src/components/DestinationReorderList.tsx` — 25 emoji、uniform accent border  
- `apps/mobile/src/utils/destinationEmojiColor.ts` — drop 🧭、保留 #5E6C84、preset resolve  
- `apps/mobile/src/store/sheetPane.ts` — coverFlowSnapIndex  
- `apps/mobile/src/components/AmicroButton.tsx` — labelColor, flex label  
- `apps/mobile/src/i18n/index.ts` — rename / emoji strings  
- Tests + `Report/*`（含 **05-macos-native-build-handoff.md**）

## Design decisions

1. **Native IDs in committed projects** so prebuild-less builds match Expo plugin.  
2. **CoverFlow replaces Segmented only on main sheet panes**; Settings keep Segmented.  
3. **No raw content swipe** — horizontal owned by CoverFlow + sheet `failOffsetX`.  
4. **Rename modal** is additive; bottom add sheet and Add button unchanged.  
5. **Emoji/color** independent drafts; single existing `updateDestinationEmojiColor` submit; failure rethrows and clears optimistic patch.  
6. **Reorder** = one AmicroButton spanning the card (no nested press handlers).  
7. **`pod install` is macOS-only** — Windows documents gate + handoff; does not fake lockfile.

## Verified vs 未驗證

- **Verified (Windows):** Jest focused suites（review-02 後含 timeout／幾何契約）、typecheck PASS。  
- **未驗證：** iOS/Android device ads、SSV +1、CoverFlow/sheet 真機手勢、`Podfile.lock` GMA 連結、新 binary 冷啟。

## Leftover gaps（原生與裝置 gate）

1. **macOS：** 依 `05-macos-native-build-handoff.md` 跑 `pod install`、commit `Podfile.lock`、打新 binary。  
2. Device matrix Ticket 04。  
3. Pre-existing `gatheringWorkflowContract` 等 out-of-scope 失敗不擋本包。

## Handoff 一句話

> 軟體／JS／review-02 將隨本次 commit 交接；下一台從 `origin/master` pull 後只做 pod + native build + 裝置 Ticket 04，prompt 在 `Report/05-macos-native-build-handoff.md` 最底。
