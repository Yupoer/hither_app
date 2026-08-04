# iOS Energy、Premium、Map UX — Code Review 01

**日期：** 2026-08-04  
**結果：** Changes requested  
**固定點：** `HEAD aa6f31b04f14ea09bae44187cd55b843776c4eeb` 相對目前 task-scoped working tree  
**Spec 來源：** `Spec/ios-energy-premium-map-ux-spec-2026-08-04.md` 與 `Ticket/01`–`13`  
**範圍說明：** 本分支沒有 task commit；spec 記錄的 `origin/master 2b61da8` 現在位於此分支前方，因此不能作為 `git diff <fixed-point>...HEAD` 的實作基準。本次納入 `apps/mobile/`、`supabase/` 的 tracked diff 與 untracked 新檔，排除既有且無關的 `CLAUDE.md`、`SETUP_NEW_MACHINE.md`、`support-site/` 變更。

## Standards

### [P3] Map UI 新增的 chrome 邏輯仍直接分支 `Platform.OS`

**位置：** `apps/mobile/src/components/GroupMap.tsx:775-782`  
**標準：** `CLAUDE.md`「原生能力唯一入口是 `apps/mobile/src/native/`」及「UI 元件禁止直接判斷 `Platform.OS`」。

本次修改在既有平台分支中加入 `compassOffset` 與 `appleLogoInsets`，讓 MapKit chrome 的平台策略繼續留在 UI 元件。Expo Go fallback、Android 或日後其他 runtime 的 prop 策略因此要同時修改 UI 與 native boundary，容易把 iOS-only props 下發到錯誤 runtime。

**要求：** 由 `src/native/maps.ts` 回傳完整的平台化 MapView chrome props；`GroupMap` 只套用 boundary 回傳值，不自行判斷平台。

Standards 共 **1** 項；最高嚴重度 **P3**。

## Spec

### [P1] Notification 在 entitlement 套用前已被永久去重

**位置：**

- `supabase/functions/apple-server-notifications/index.ts:171-190`
- `supabase/functions/apple-server-notifications/index.ts:227-231`
- `supabase/migrations/20260804030000_storekit_purchase_and_notification_ledger.sql:137-159`

**Spec：** `Spec/...md:110` 要求 notification 與 purchase reconciliation 共用可安全重試的冪等 ledger；`Ticket/08...md:10-11` 要求重播、亂序與重試正確收斂。

handler 先寫入 `premium_store_notifications`，之後才查帳號並呼叫 `apply_storekit_transaction`。若第一次 entitlement RPC 暫時失敗，Apple 重試同一 UUID 時會在 `duplicate === true` 分支直接回 `200 accepted: true`，不再套用交易。`accepted` 欄位建立後也沒有任何成功更新路徑。

**失敗情境：** refund／revocation 首次處理遇到暫時性 DB 錯誤；重試被當成已完成，使用者永久保留 Premium。

**要求：** 把 notification claim、transaction apply、accepted 標記做成可恢復的狀態機或同一原子 RPC；只有已成功套用才可把 duplicate 回覆為 accepted。

### [P1] 缺少 `expiresDate` 的訂閱交易會被視為永久 active

**位置：** `supabase/functions/_shared/storekit.ts:182-195`  
**Spec：** `Spec/...md:108` 與 `Ticket/07...md:10-11` 要求驗證 purchase／expiry／revocation，必要資料不足時 fail closed。

`expiresDate` 缺失時 `expiresAt` 會是 `null`，但 status 仍落入 `active`；後續 projection 又把 `expires_at is null` 視為有效且無期限。合法簽章但缺少 subscription expiry 的 payload 因此可能取得永久 Premium。

**要求：** 對已核准的 auto-renewable product 強制要求合法的 `type`、`expiresDate` 與必要日期關係；缺失或不一致一律拒絕。

### [P1] Paywall 沒有向 App Store 查詢 introductory-offer eligibility

**位置：**

- `apps/mobile/src/native/purchases.ts:173-205`
- `apps/mobile/src/components/PaywallSheet.tsx:221-224`

**Spec：** `Spec/...md:103` 與 `Ticket/06...md:11-12` 規定七天試用資格由 App Store 判定，不可由商品是否帶 introductory price 推定。

目前只映射 `introductoryPriceIOS`，未呼叫已安裝 `expo-iap` 提供的 `isEligibleForIntroOfferIOS(groupId)`。商品 metadata 有 introductory price 不代表目前 Apple ID 仍符合資格。

**失敗情境：** 已使用過同 subscription group 試用的使用者仍看到試用承諾，實際付款頁卻直接收費。

**要求：** 以 subscription group 查詢 StoreKit eligibility；查詢失敗時 fail closed，不顯示試用承諾。

### [P2] Legacy profile Pro 仍被投影成個人與團隊 Premium

**位置：** `supabase/migrations/20260804000000_personal_premium_projection.sql:81-86,348-373`  
**Spec：** `Spec/...md:101,107` 定義 Premium 為 Apple auto-renewable subscription，Client local Pro flag 不得授權；`Ticket/05...md:16` 要求舊資料不可誤認為新訂閱。

`profile_has_lifetime_premium()` 會在沒有 StoreKit entitlement 時直接產生 `personalPremiumActive`，且 `group_has_active_subscription_premium()` 也把同一 legacy profile 狀態納入團隊投影。沒有 Apple entitlement 的舊 Pro 帳號因此仍可開啟新 Premium 能力。

**要求：** 明確決定 grandfathering 是否屬核准產品規則；若不是，從新的 personal/team subscription projection 移除。若要保留，必須在 spec 與 UI 中以獨立 entitlement 類型呈現，不得稱為 auto-renewable subscription。

### [P2] Realtime 事件與 in-flight snapshot 競態會漏掉立即重抓

**位置：** `apps/mobile/src/state/useGroupState.ts:196-205,326-338`  
**Spec：** `Spec/...md:89` 要求 Realtime 是一般前景同步主路徑；`Ticket/02...md:12` 要求舊 snapshot 不得覆蓋較新 Realtime state。

revision fence 會正確丟棄舊 snapshot，但 Realtime 安排的 reload 若在舊 snapshot 仍 in-flight 時觸發，`load()` 只回傳既有 Promise，沒有 pending-follow-up。舊 response 被丟棄後也不會立即再抓一次。

**失敗情境：** itinerary／membership 更新發生在慢 snapshot 期間；UI 不套用舊 snapshot，但也沒有取得新內容，最久等下一個 60 秒 recovery。

**要求：** 仿照 coordination hook 保留 pending reload，in-flight 完成後至少再執行一次；新增可控制 Promise 順序的 race test。

### [P2] Route LOD 不是依 screen-space tolerance 連續派生

**位置：** `apps/mobile/src/utils/routeLod.ts:29-52,113-127`  
**Spec：** `Spec/...md:119` 與 `Ticket/09...md:12` 要求依 viewport／zoom 的 screen-space tolerance 派生，細節隨縮放連續變化。

目前先把 viewport 切成五個 zoom band，再套用固定的 `0/2/8/24/64` 公尺 tolerance。同一 band 內 tolerance 不隨 meters-per-pixel 變化，跨 `1.5/6/20/70 m/px` 門檻時又會離散跳變。

**失敗情境：** 緩慢縮放跨 band 時整批路線點突然被抽掉或恢復，呈現可見跳動；世界尺度固定 64m 也不等同固定像素誤差。

**要求：** 由 meters-per-pixel × 目標像素誤差計算 tolerance，若為避免每 frame 重算，可對 tolerance 做 hysteresis／量化，但須證明畫面誤差與轉換連續性。

Spec 共 **6** 項；最高嚴重度 **P1**。

## Verification

### 已執行

- Focused Jest：**15 suites / 145 tests passed**。
- 全量 Jest：**151 suites / 1268 tests passed**；存在既有 `react-test-renderer` deprecated 與 `act(...)` console warnings，沒有 test failure。
- `npm.cmd run typecheck`：**Pass**。
- `git diff --check HEAD -- apps/mobile supabase docs/Tasks/Open/2026-08-04-iOS-Energy-Premium-Map-UX`：**Pass**。

### 證據限制

- `storeKitSubscriptionContract.test.ts` 主要檢查 source string 與程式碼出現順序，沒有執行 notification「第一次 apply 失敗 → Apple retry」、intro eligibility 或缺 expiry payload 行為。
- `supabase/tests/storekit_purchase_ledger.test.sql` 目前只有說明文字與單一 `select`，不是會驗證 ledger 狀態轉移的 pgTAP 測試。
- 本機沒有 `deno`、`supabase`、`psql`、`xcodebuild`，因此 Edge Function、migration、PostgreSQL runtime、Apple JWS fixture、native iOS build 均為 **Unverified**。
- Instruments A/B、MetricKit、StoreKit sandbox、App Store Server Notifications、MapKit 視覺、iPhone／iPad layout、App Store Connect、deploy／OTA／TestFlight／submit 仍為 **Unverified**；Jest 與 typecheck 不構成這些 gate 的通過證據。

## Summary

Standards：**1** 項，最高 **P3**。Spec：**6** 項，最高 **P1**。本輪不可接受；優先修正 notification retry 原子性、expiry fail-closed 與 introductory-offer eligibility，再補 Realtime race 與真正的 server/runtime 行為測試。
