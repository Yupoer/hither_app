# Rewarded Ads Token Store — Code Review 01

**日期：** 2026-07-30  
**結果：** Changes requested → **Fixed** (2026-07-30)  
**固定基準：** `ebeeb5487faf179ff752bb76226fa22a55b35d4d`  
**審查端點：** `73a3d4465bbee9c853d57971bd3c996f07d9c05f` 加上目前工作樹內的 task-scoped 修改  
**Spec：** `../Spec/rewarded-ads-token-store-spec-2026-07-30.md`  
**Follow-up migration：** `supabase/migrations/20260730140000_rewarded_ads_review01_fixes.sql`（已 `db push` 至 linked project）

## Scope

- 只審查 `Report/implementation-summary.md` 列出的 Rewarded Ads／Token Store 程式、資料庫與原生設定。
- 排除同一提交內的 Field-Test Import／Notifications／Map UX／Energy 變更，以及目前工作樹的大量文件搬移。
- 優先級：P0 阻斷所有使用者；P1 阻斷核心流程、可能錯誤扣款或違反隱私邊界；P2 影響特定流程或可恢復性；P3 低風險。

## Standards

### [P1] UMP 尚未允許請求時仍初始化並請求廣告 — **fixed**

**位置：** `apps/mobile/src/native/rewardedAds.ts`

**Response：** `ensureRewardedAdsReady` 現在讀取 `requestInfoUpdate` / form 後的 `canRequestAds`；僅在 `true` 時 `mobileAds().initialize()`。拒絕時回傳 `{ available: false, reason: 'consent_required' }` 並清空 init cache 以便重試。StorePane 對應 CTA 文案。

### [P1] 團隊切換／權益 RPC 失敗時，Live Activity 權益會 fail-open — **fixed**

**位置：** `apps/mobile/src/screens/MapScreen.tsx`

**Response：** `groupId` 變更時立即 `setLiveActivityEffective(false)` / credits `0`；RPC `catch` 改為 fail-closed（不再 keep last known）。成功 snapshot 後才恢復（含個人永久 entitlement）。

### [P1] 驗證輪詢逾時後，觀看廣告按鈕永久停用 — **fixed**

**位置：** `apps/mobile/src/screens/MapScreen/components/StorePane.tsx`

**Response：** 輪詢達 `VERIFY_POLL_TICKS` 後 `setAdState('idle')` 並停止 interval，**不**把 session 標 failed（server/expiry 處理 verifying）。CTA 可再點；late SSV 仍可入帳。

### [P1] 兌換重試沒有 idempotency key，回應遺失會重複扣款 — **fixed**

**位置：** migration `20260730140000` + `StoreService.redeemStoreProduct` + StorePane

**Response：** `redeem_store_product(p_product_code, p_group_id, p_client_request_key)`；`external_ref = redeem:{uid}:{key}` 唯一；重送回 `already: true` 與先前 balance，不二次扣款。Client 每次確認彈窗產生一個 `clientRequestKey`。

### [P2] SECURITY DEFINER helper 可探測其他使用者的付費狀態 — **fixed**

**位置：** migration `20260730140000`

**Response：** `user_has_live_activity_lifetime` / `effective_live_activity_entitlement` revoke `authenticated`；僅 `service_role` 顯式 grant。內部 SECURITY DEFINER RPC 仍以 owner 呼叫。

### [P2] Client 可把 verifying session 改成 failed — **fixed**

**位置：** migration `20260730140000` + StorePane

**Response：** `update_reward_session_status`：`verifying → failed` 回 `session_verifying` 拒絕。僅 `active → failed|verifying`。StorePane 僅在 `!verifyingRef` 時 fail；show 改為事件驅動後不再用 short grace 誤殺。

## Spec

### [P1] SSV custom data 使用不存在的 instance API — **fixed**

**位置：** `apps/mobile/src/native/rewardedAds.ts`

**Response：** `RewardedAd.createForAdRequest(unitId, { serverSideVerificationOptions: { customData: sessionRef } })`。合約測試改為斷言 `serverSideVerificationOptions` + `createForAdRequest(unitId,`。

### [P1] `show()` 被誤當成「廣告播放完成」— **fixed**

**位置：** `rewardedAds.ts` / StorePane

**Response：** `show()` 以 `EARNED_REWARD` / `CLOSED` / `ERROR` listener resolve；不依賴 present-start 的 Promise。移除 900ms／2s 誤 fail 路徑。

### [P1] UMP consent 結果未 gate 廣告請求 — **fixed**

同 Standards 第一項。

### [P2] 冷啟動離線時沒有最後同步 snapshot — **fixed**

**位置：** StorePane + AsyncStorage `hither.store.snapshot.v1:{groupId}`

**Response：** 成功 snapshot 寫入 cache；mount 先讀 cache；網路錯誤時以 cache 填空；離線提示 `store.offlineCachedHint`。

### [P2] no-fill 狀態會立即被 error 覆蓋 — **fixed**

**位置：** `rewardedAds.ts` load path

**Response：** load 錯誤分類為 `no_fill` / `network_error` / `error` 並原樣回傳；StorePane 不再把 non-ready 一律當 `error`。

### [P2] 即時動態 locked CTA 沒有定位到對應商品 — **fixed**

**位置：** StorePane + MapScreen

**Response：** highlight 商品 pin 在 ad CTA 下方（`store-product-pinned`）；`openStoreForLiveActivity` 展開 sheet 至少 mid detent。

## Verification (post-fix)

- Focused Jest (`store*` / map / entitlement contracts)：**pass**
- `npx tsc --noEmit`：**pass**
- Migration `20260730140000`：**pushed** to linked project `htqrucnjafhhvxdqslbv`
- Deno SSV / release-like device ad path：仍未做（與原 review 外部閘門相同）

## Summary

全部 12 項 finding 已修。最嚴重 native 入帳路徑（SSV custom data + show 生命週期）與兌換 idempotency、UMP gate、LA fail-closed 已落地並部署後端。
