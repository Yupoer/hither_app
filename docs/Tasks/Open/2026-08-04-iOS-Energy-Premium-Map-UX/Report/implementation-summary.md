# iOS Energy / Premium / Map UX 實作報告

日期：2026-08-04

本文件記錄本輪 iOS Energy / Premium / Map UX 的程式實作與本機驗證證據，定位為實作報告，不取代 Code Review 文件，也不宣稱 native、server 或 release gate 已完成。

## 實作目標與範圍

本輪實作涵蓋以下七項能力：

1. Notification ledger 的 retry、idempotency 與 immutable payload 保護。
2. StoreKit 交易資料的 fail-closed validation。
3. StoreKit introductory offer eligibility 查詢與 Paywall 顯示條件。
4. Premium projection 與 legacy Pro / trip pass 的來源分離。
5. Realtime recovery 的 in-flight request race 保護。
6. Map native boundary 集中 provider、平台 props 與 location callback 行為。
7. 依 settled viewport 連續計算 route LOD，並保護真正的 U-turn / roundabout maneuver anchors。

## 實作內容

### 1. Notification ledger retry、idempotency、immutable payload

主要檔案：

- `supabase/functions/apple-server-notifications/index.ts`
- `supabase/functions/apple-server-notifications/index_test.ts`
- `supabase/migrations/20260804030000_storekit_purchase_and_notification_ledger.sql`
- `supabase/tests/storekit_purchase_ledger.test.sql`

完成內容：

- 未接受的 duplicate notification 可重新執行 durable transaction apply。
- 只有 durable apply 成功後才進入 acceptance；apply 或 accept 失敗回傳 retryable 503。
- 同一 notification UUID 的 payload 必須不可變；payload 不一致時 fail closed。
- transaction external key 與 signed-date fence 維持 idempotent、order-safe 的處理邊界。
- SQL migration 與 ledger 行為測試已建立，但 PostgreSQL / Supabase runtime 尚未執行。

### 2. StoreKit fail-closed validation

主要檔案：

- `supabase/functions/_shared/storekit.ts`
- `supabase/functions/_shared/storekit_test.ts`

完成內容：

- 僅接受正確的 auto-renewable subscription `type`。
- `signedDate`、`purchaseDate`、`expiresDate` 必須是合法正整數毫秒日期。
- `expiresDate` 必須晚於 `purchaseDate`，validated transaction 的 `expiresAt` 不為 null。
- 若 payload 帶有 `revocationDate`，該日期也必須合法且不得早於 purchase date；否則拒絕，不得誤判為 active。
- Deno 行為測試已補齊，但 Deno runtime 尚未執行。

### 3. Introductory offer eligibility

主要檔案：

- `apps/mobile/src/native/purchases.ts`
- `apps/mobile/src/components/PaywallSheet.tsx`
- `apps/mobile/src/__tests__/storeKitSubscriptionBehavior.test.ts`
- `apps/mobile/src/__tests__/storeKitSubscriptionContract.test.ts`

完成內容：

- iOS 依 `subscriptionGroupIdIOS` 呼叫 `isEligibleForIntroOfferIOS`。
- 同一次 catalog fetch 內，同一 subscription group 的 monthly / annual products 共用查詢 Promise。
- eligibility cache 僅存在於單次 catalog fetch，不將可能變動的 StoreKit account state 永久快取。
- 無 subscription group、非 iOS runtime、native method 缺失或查詢失敗時均 fail closed 為 false。
- Paywall 只有在 eligibility 為 true 且 introductory price 有效時才顯示 introductory offer。

### 4. Premium projection 與 legacy separation

主要檔案：

- `supabase/migrations/20260804000000_personal_premium_projection.sql`
- `supabase/tests/premium_projection.test.sql`
- `apps/mobile/src/__tests__/premiumProjection.test.ts`
- `apps/mobile/src/state/SessionContext.tsx`

完成內容：

- 新 personal / team subscription projection 只使用 `source = 'app_store'` 且尚未過期的 entitlement。
- legacy profile Pro 與 trip pass 不會被投影為新的 subscription source。
- Client 的 `isPro` 只由 `personalPremiumActive` / `teamPremiumActive` 推導；projection 失敗、legacy profile Pro、trip pass 與 deprecated local setter 都不會解鎖新 Premium。
- 歷史 `group_has_active_premium` compatibility facade 的既有讀取行為保留，與新 subscription projection 分開處理。
- pgTAP SQL matrix 已建立，但 pgTAP / PostgreSQL runtime 尚未執行。

### 5. Realtime recovery race

主要檔案：

- `apps/mobile/src/state/useGroupState.ts`
- `apps/mobile/src/__tests__/useGroupStateRecoveryRace.test.tsx`

完成內容：

- in-flight snapshot request 收到較新 Realtime revision 時，標記 pending follow-up。
- 舊 snapshot response 不得覆蓋較新的 Realtime state。
- group 切換時以 group ID 與 generation fence 隔離 remote、local snapshot 與 open-operation response，避免舊 group 的 response 寫入新 group state。
- 測試以可控制 Promise 順序的實際 hook harness 驗證 race 行為。

### 6. Map native boundary

主要檔案：

- `apps/mobile/src/native/maps.ts`
- `apps/mobile/src/components/GroupMap.tsx`
- `apps/mobile/src/__tests__/mapsPlatformBoundary.test.ts`
- `apps/mobile/src/__tests__/mapNativeBoundaryBehavior.test.ts`

完成內容：

- GroupMap 不直接判斷 `Platform.OS` 或選擇 Google provider。
- native maps boundary 統一處理 provider、transit defaults、MapKit chrome、Android lifecycle 與平台 location callback。
- iOS user-location event 在 native boundary 正規化後才交給 UI callback。
- Map callback props 由 native boundary 組裝；GroupMap 只傳入 intent/diagnostic callbacks 並展開 boundary 結果。

### 7. Continuous route LOD

主要檔案：

- `apps/mobile/src/utils/routeLod.ts`
- `apps/mobile/src/components/GroupMap.tsx`
- `apps/mobile/src/__tests__/routeLod.test.ts`

完成內容：

- tolerance 由 settled viewport 的 meters-per-pixel 乘以 target pixel error 連續導出，不使用 zoom bands 或跳變門檻。
- `longitudeDelta = 0` 時 meters-per-pixel 與 tolerance 可達到 0，恢復完整 provider geometry。
- Douglas-Peucker 只作用於 display projection，不修改 raw geometry、distance 或 ETA 資料。
- 真正的 U-turn、roundabout 同向轉彎 run 受 maneuver anchor 保護。
- 小於目前視覺容忍度的細小 square bump 可被簡化，避免泛用急轉保護造成回歸。
- route LOD 測試涵蓋 collinear simplification、screen budget、U-turn、roundabout、exact-zero viewport 與 raw data immutability。

## 驗證證據（WIP-org 整合後 2026-08-04）

| Gate | Status | Evidence |
|------|--------|----------|
| Full Jest | **Passed** | `npm.cmd test -- --runInBand --silent` → 155 suites / 1303 tests passed |
| TypeScript | **Passed** | `npm.cmd run typecheck` |
| `git diff --check` | **Passed** | task-scoped paths after EOF fix |
| Lint | **Failed** (pre-existing) | 未以 disable 掩蓋；repo-wide React Compiler / purity 等 |
| Deno Edge runtime | **Unverified** | 本機未執行 `deno test` |
| pgTAP / psql / Supabase migration deploy | **Unverified / Blocked** | 無本機 PostgreSQL runtime；production deploy 未授權 |
| StoreKit sandbox / JWS chain / ASN V2 | **Unverified / Blocked** | 無 Apple credentials / sandbox 裝置證據 |
| MapKit visual / Instruments / MetricKit A/B | **Unverified** | 無 iOS Instruments 執行 |
| EAS / OTA / TestFlight / App Store | **Blocked** | 依使用者要求：整合驗證後**不** merge push；release 另授權 |

## 未驗證 gates

以下 gate 不能由 Jest 或 typecheck 取代，仍未驗證：

- Deno Edge Function runtime、Supabase deploy、migration、pgTAP 與 psql / PostgreSQL transaction runtime。
- Apple JWS certificate chain、StoreKit sandbox purchase / restore / finish，以及 App Store Server Notifications V2 replay、refund、revocation。
- iOS / Android release-like native binary、真機或模擬器 MapKit / Google Maps callback 與實際 map visual / screen-space route rendering。
- Instruments、MetricKit，以及 MapKit compositor、radio、thermal A/B evidence。
- EAS build、OTA、TestFlight、App Store Connect 與 App Store submit / release gate。

## WIP-org 分類

- **整合進 master（本地）**：Energy observability、group recovery snapshot、coordination deadline scheduler、Premium projection / StoreKit catalog / purchase recovery、Map route LOD / native boundary、optimistic destination mutation overlay、相關 migrations / edge functions / docs。
- **明確排除**：`support-site` → 移出 repo 至 `../support-site-separate-20260804`（非 Mobile delivery；不混入 commit）。
- **保留 master**：`version` / `runtimeVersion` **0.1.5**、Expo Dev Client / preview 設定、`expo-iap` caret pin、既有 emoji category UI。

## Implementation commits

- 前輪：`0992a6e` / `9aa6660`（rebased via integrate branch → local master merge）
- 本輪 follow-up：working tree → 本地 commit（**未 push origin/master**，依使用者要求）

上述 commit 只代表本機程式碼與 Jest/typecheck 完成，不代表 native、server 或 release gate 已成功。
