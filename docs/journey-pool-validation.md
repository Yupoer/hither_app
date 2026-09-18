# 搜尋、行程與獨立池驗收

本次直接修改 master；沒有發布 binary、OTA 或套用正式資料庫遷移。

## 資料與相容性

- `Destination.day = null` 表示獨立池；既有正整數天數原樣保留。
- 新增、匯入、核准、排序沿用既有 RPC、群組鎖與權限。池內地點不參與導航、抵達、下一站或集合時間提醒。
- migration：`20260919090000_unscheduled_destination_pool.sql`。
- **不可直接部署給混用舊版的團隊。** 舊版把 `null` 補成第一天；發布前須先完成相容客戶端的版本門檻／升級安排，再啟用池內寫入。現有資料庫仍不接受 null，故新版獨立池寫入須配合 migration，不能只 OTA。
- iOS 鎖定訊號新增於 HitherLocation，需重新建置 binary。沒有此方法時，靠近提醒採未知狀態：只更新即時動態。
- 回滾前必須先讓使用者安排或匯出池內地點；不能直接恢復 NOT NULL 或把所有池內資料塞入第一天。

## 可重跑的本地驗證

在 `apps/mobile` 執行：

```powershell
npm.cmd run typecheck
npm.cmd test -- --runInBand destinationSearchLifecycle mapsSearchFallback destinationPool liveActivityOwnership approachNotificationLock backgroundJourneyTaskBehavior tripDay openReorderSlots
```

隔離 PostgreSQL 回歸測試（PGlite 0.5.8）：

```powershell
node supabase/tests/navigation_location_regression.mjs <pglite/dist/index.js>
```

涵蓋新舊天數、池內新增／匯入／核准、排入／移出天數、活動目的地防護、非隊長拒絕、整批失敗回滾，以及原本的導航切換與抵達歷史。

2026-09-19 本地結果：TypeScript 通過；隔離資料庫回歸通過；Jest 239 個 suite／1,970 個測試通過，仍有 4 個既有失敗：`nativeUiContracts`、`languagePicker`、`coreDataLocalFirst`、`gatheringSessionOutbox`。前兩項為既有 UI 斷言；後兩項預期 outbox flush 呼叫一次，但 HEAD 原已包含兩次。本次沒有宣稱全套測試全綠。

## 尚須 iPhone 驗收

1. 搜尋「內湖 CQ2」、完整地址、座標；GPS 持續更新時不能重複搜尋。搜尋失敗、清空、關閉與快速換字不留 spinner／舊結果。
2. 開始導航後反覆鎖屏／解鎖、切至其他 App、離開再返回地圖；活動不提前消失或重複建立。手動結束、已確認自動完成、關閉設定、登出／離隊會清理。
3. 沒有行程、只有池內地點、導航結束後，背景導航定位應停止；行程中仍持續更新。
4. 靠近目的地：Hither 前景、其他 App 使用中、未知鎖定狀態皆不發靠近通知；明確鎖定才提醒，且同一行程／目的地只提醒一次。
5. 粒子只在導航卡片顯示，300ms 淡入淡出；切背景不持續跑畫格；減少動態效果顯示靜態畫面。
6. 搜尋／長按／收藏／匯入進池，地圖仍可見並可改 icon；拖曳到空白天數、跨天、拖回池及「移至」操作均保存正確順序。兩台裝置驗證同步與失敗回復。

本地測試不是 MapKit 真實搜尋品質、iOS 定位指示、ActivityKit、耗電或正式 Supabase RLS 的裝置／部署證據。
