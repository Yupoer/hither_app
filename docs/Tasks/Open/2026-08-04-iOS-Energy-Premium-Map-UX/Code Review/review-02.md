# iOS Energy / Premium / Map UX — Code Review 02

日期：2026-08-04
基準：保留 `review-01.md`，本文件只記錄本輪 FIX IT 的實際 diff 與驗證結果。
角色：Luna implementation follow-up

## 結論

7 個 Sol 已核准 finding 已完成對應的本機程式修正；可由 Jest/typecheck 證明的項目已通過。Server、Deno、StoreKit、native binary、Instruments 與 release gates 維持 **Unverified**。Lint 維持 **Failed**，沒有把 repo-wide lint failure 隱藏成綠色。

## Findings

### 1. Notification ledger — Implemented locally; runtime Unverified

- `record_storekit_notification` 對同 UUID 比對 notification type、subtype、environment、transaction/original transaction、product 與 signed date；immutable mismatch 回錯誤並 fail closed。
- `accepted=false` duplicate 不會直接回 accepted；handler 先重跑 idempotent `apply_storekit_transaction`，確認 `ok=true` 且 `durable=true` 後才呼叫 `accept_storekit_notification`。
- apply 或 acceptance failure 回 503 retryable response；accepted duplicate 才可不重跑 grant。
- transaction external key、unique transaction ledger 與 `signed_at` ordering fence 防止重複 grant 或較舊 lifecycle 覆蓋較新狀態。
- `apple-server-notifications/index_test.ts` 是 Deno handler 行為測試；`storekit_purchase_ledger.test.sql` 是 pgTAP transaction/ledger 行為矩陣。依使用者要求，本輪未啟動 Deno/Supabase/psql。

### 2. StoreKit expiry/type fail closed — Implemented locally; Deno Unverified

- `validateStoreKitTransaction` 僅接受 `Auto-Renewable Subscription`。
- `purchaseDate`、`expiresDate`、`signedDate` 必須是合法日期，且 expiry 嚴格晚於 purchase；validated transaction 的 `expiresAt` 型別為 non-null string。
- `storekit_test.ts` 補 missing type、missing/invalid expiry、expiry ordering 與 non-null expiry 行為測試；Deno runtime 未執行。

### 3. Paywall introductory-offer eligibility — Pass in Jest

- iOS only 以商品的 `subscriptionGroupIdIOS` 查 `isEligibleForIntroOfferIOS`。
- eligibility Promise 以 group id cache，同一 subscription group 的月/年方案共用結果。
- 非 iOS、缺 group、StoreKit method/query error 都回 false；不會在 fail-closed 情況顯示試用。
- `hasEligibleIntroductoryOffer` 同時要求 eligibility 為 true 與非空 introductory price；Paywall 使用此條件渲染。
- `storeKitSubscriptionBehavior.test.ts` 以 mocked IAP module 實際呼叫 adapter，驗證 cache、reject、Android、missing group 與 UI predicate；contract test 驗證邊界接線。

### 4. Personal/team Premium projection — Implemented locally; SQL runtime Unverified

- 新 projection 的 personal entitlement 與 team projection 只接受/讀取 `source='app_store'` 且有效 expiry。
- legacy profile Pro helper 與 `legacy-profile-v1` 不再授權新的 personal/team subscription projection。
- trip pass 只保留在明確標示的歷史 compatibility facade，不會出現在新 subscription source。
- `premium_projection.test.sql` 使用 pgTAP matrix 覆蓋 legacy profile、trip pass、expired entitlement、active StoreKit entitlement、team projection 與 source version；未執行 PostgreSQL runtime。

### 5. Realtime recovery race — Pass in Jest

- `pendingReloadRef` 在 snapshot in flight 收到較新 revision 時保留 follow-up；舊 response 完成後立即再抓，不等 poll interval。
- generation fence 使 group switch 後的舊 response 與 follow-up 不得寫入新 group state；舊 promise 可自然 settle，不會被新 group 共用。
- `useGroupStateRecoveryRace.test.tsx` 使用 deferred Promise 控制 response 順序，實際 mount hook，驗證 newer revision、stale response 與 group switch。

### 6. Map native boundary — Pass in Jest; native runtime Unverified

- `platformizedMapViewProps` 集中 provider、transit、iOS MapKit chrome、map ready/loaded、iOS user-location callback props。
- `platformizedMapLifecycle` 集中 Android mount/unmount diagnostics；unsupported runtime 回安全 defaults。
- `GroupMap.tsx` 不再 import/use `Platform.OS`、`PROVIDER_GOOGLE` 或直接 transit default branch，改 spread boundary props。
- `mapsPlatformBoundary.test.ts`、`mapNativeBoundaryBehavior.test.ts` 覆蓋 iOS、Android、fallback runtime；iOS/Android release binary 與原生 callback 未驗證。

### 7. Continuous route LOD — Pass in Jest; visual/native runtime Unverified

- `routeToleranceMeters` 由 normalized settled viewport 的 `metersPerPixel × targetPixelError` 導出，不再使用離散 zoom bands。
- GroupMap 只在 `onRegionChangeComplete` 更新 settled viewport；display simplification 不改 provider raw points，也不改 distance/ETA。
- `routeLod.test.ts` 覆蓋 tolerance 連續性、單調性、screen-space error budget、近距離 U-turn/彎道保留、raw geometry 與 ETA 不變。
- 真實 MapKit/Google Maps compositor 的 pixel-level visual evidence 仍待 native gate。

## Verification

### 通過

```text
npm.cmd test -- --runInBand <focused review suites> --silent
10 suites / 56 tests passed

npm.cmd test -- --runInBand
155 suites / 1291 tests passed

npm.cmd run typecheck
passed
```

Focused suites 另外包含 5 suites / 43 tests 的 map contract、legacy contract 與 realtime race recheck；其結果已包含在上述最後 full Jest 通過結果中，不代表額外 native/server gate。

### 未通過或未執行

- `npm.cmd run lint`：Failed，repo-wide 155 errors / 272 warnings。主要錯誤為既有 React Compiler purity、ref access、effect state update 等規則；本輪沒有用 disable 或刪除測試掩蓋。
- 未執行 `deno test`、Supabase CLI/pgTAP/psql、Edge Function deploy、xcodebuild、iOS Simulator、StoreKit sandbox、Instruments、MetricKit、EAS/OTA/TestFlight/App Store release gates。

## Changed paths

本輪 review scope 的核心路徑：

- `supabase/functions/apple-server-notifications/index.ts`
- `supabase/functions/apple-server-notifications/index_test.ts`
- `supabase/functions/_shared/storekit.ts`
- `supabase/functions/_shared/storekit_test.ts`
- `supabase/migrations/20260804000000_personal_premium_projection.sql`
- `supabase/migrations/20260804030000_storekit_purchase_and_notification_ledger.sql`
- `supabase/tests/premium_projection.test.sql`
- `supabase/tests/storekit_purchase_ledger.test.sql`
- `apps/mobile/src/native/purchases.ts`
- `apps/mobile/src/components/PaywallSheet.tsx`
- `apps/mobile/src/native/maps.ts`
- `apps/mobile/src/components/GroupMap.tsx`
- `apps/mobile/src/state/useGroupState.ts`
- `apps/mobile/src/utils/routeLod.ts`
- 對應的 focused/contract Jest tests 與 `apps/mobile/jest.config.js`

`review-01.md` 未覆寫。
