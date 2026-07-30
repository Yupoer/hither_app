# Rewarded Ads Token Store — Code Review 02

**日期：** 2026-07-30  
**目的：** 複驗 `review-01.md` 的 Fixed 標記  
**結果：** Changes requested → **Fixed** (2026-07-30)  
**固定點：** `73a3d4465bbee9c853d57971bd3c996f07d9c05f`  
**審查範圍：** 固定點至目前 task-scoped 工作樹，加上 migrations `20260730140000` / `20260730150000`  
**Follow-up migration：** `20260730150000_rewarded_ads_review02_fixes.sql`（已 `db push`）

## Standards

### [P1] UMP fallback 仍可能 fail-open — **fixed**

**位置：** `apps/mobile/src/native/rewardedAds.ts`

**Response：** `canRequestAds` 初始值改為 `false`。僅在 `AdsConsent.requestInfoUpdate`（及表單）明確回傳 `canRequestAds === true` 時才初始化廣告；AdsConsent 缺失或 API 不存在 → `consent_required`。

### [P1] 團隊切換仍可被上一個 RPC 的慢回應覆寫 — **fixed**

**位置：** `apps/mobile/src/screens/MapScreen.tsx`

**Response：** generation counter + `storeEntitlementGroupRef`。await 後若 gen 或 groupId 已變更則丟棄結果。進入 RPC 前先 fail-closed 清零，避免 `useLiveActivity` 看到舊團隊 `true`。

### [P1] 輪詢在 snapshot 持續失敗時永遠不會逾時 — **fixed**

**位置：** `StorePane.tsx`

**Response：** 逾時判斷在 `!snap` 時仍執行。主 poll 結束後 `idle` + `startLateSsvPoll`（較長間隔）持續同步 late SSV。`session_active` 時恢復 verify poll 而非永久卡死。

### [P1] 回應遺失後重新確認仍會使用新 key 再次扣款 — **fixed**

**位置：** `StorePane.tsx` + AsyncStorage pending redeem

**Response：** 成功扣款前寫入 `hither.store.pending_redeem.v1:{user}:{product}:{group}`。重新確認重用同一 `clientRequestKey`；成功或業務失敗才清除。

### [P2] Idempotent replay 沒有綁定原 product／group — **fixed**

**位置：** migration `20260730150000`

**Response：** 找到 prior ledger 時比對 `product_code` 與 `group_id`；不符 → `idempotency_conflict`。credits 只讀 `v_prior.group_id`，不讀呼叫端任意 `p_group_id`。

### [P2] EARNED_REWARD listener 重複註冊 — **fixed**

**位置：** `rewardedAds.ts`

**Response：** load 僅 LOADED/ERROR；earn/close 只在 show 註冊一次。StorePane 的 `onState` 不再啟動 verify poll（只更新 UI）；verify 由 show resolve 路徑單次啟動。

### 已確認修正（review-01 延續）

- `verifying -> failed` 拒絕。
- entitlement helpers 無 authenticated execute。

## Spec

### [P2] CLOSED 後晚到的 EARNED_REWARD 仍會失去 token — **fixed**

**Response：** CLOSED 後 `CLOSED_EARNED_GRACE_MS`（2s）再 resolve dismiss；grace 內 EARNED → verifying。不在 present-start fail session。

### [P2] 離線 snapshot 未依帳號隔離 — **fixed**

**Response：** cache key `hither.store.snapshot.v2:{userId}:{groupId}`。換 group 先 `setSnapshot(null)` 再讀對應 cache。

### [P2] locked 商品仍沒有實際捲動／焦點定位 — **fixed**

**Response：** pin 商品 + `AccessibilityInfo.setAccessibilityFocus(findNodeHandle(...))`；`openStoreForLiveActivity` 展開至 full detent。

### 已確認修正

- SSV `createForAdRequest` + `serverSideVerificationOptions`。
- UMP normal path + fail-closed default。
- no-fill／network 狀態保留。

## Verification (post-fix)

- Focused store/map/entitlement Jest + contracts：**pass**（修正後）
- TypeScript：**pass**
- Migration `20260730150000`：**pushed** to `htqrucnjafhhvxdqslbv`
- Device ad → SSV：**仍未驗證**（需 native build）

## Summary

Review-02 全部 finding 已修並部署後端 idempotency 綁定。
