# iOS Energy / Premium / Map UX implementation summary

日期：2026-08-04

本摘要只記錄目前工作樹可由本機證據確認的狀態。`review-01.md` 保留為歷史文件；本輪 Code Review FIX IT 的補充報告是 `Code Review/review-02.md`。

## 本輪已完成的程式修正

| Finding | 本機可證明狀態 | 主要路徑 |
|---|---|---|
| 1. Notification ledger | **Implemented locally**。未接受的 duplicate 會重新 apply；只有 durable transaction apply 後才呼叫 acceptance；apply/accept 失敗回 503 retryable；同 UUID immutable payload mismatch fail closed；transaction external key 與 signed-date fence 保持 idempotent/order-safe。Deno、PostgreSQL runtime 未執行。 | `supabase/functions/apple-server-notifications/index.ts`, `supabase/functions/apple-server-notifications/index_test.ts`, `supabase/migrations/20260804030000_storekit_purchase_and_notification_ledger.sql`, `supabase/tests/storekit_purchase_ledger.test.sql` |
| 2. StoreKit validation | **Implemented locally**。auto-renewable subscription 必須有正確 `type`、合法 `expiresDate`，且 expiry 大於 purchase；validated `expiresAt` 為非 null。Deno 行為測試已補但未執行。 | `supabase/functions/_shared/storekit.ts`, `supabase/functions/_shared/storekit_test.ts` |
| 3. Paywall eligibility | **Pass in Jest**。iOS 依 `subscriptionGroupIdIOS` 查詢 `isEligibleForIntroOfferIOS`，同 group 使用 Promise cache；無 group、非 iOS、查詢錯誤均 false；Paywall 只在 eligibility true 且有 introductory price 時顯示。 | `apps/mobile/src/native/purchases.ts`, `apps/mobile/src/components/PaywallSheet.tsx`, `apps/mobile/src/__tests__/storeKitSubscriptionBehavior.test.ts`, `apps/mobile/src/__tests__/storeKitSubscriptionContract.test.ts` |
| 4. Premium projection | **Implemented locally**。新 personal/team subscription projection 只讀 `source='app_store'` 且 expiry 未過期；legacy profile Pro 與 trip pass 不進 subscription source。pgTAP SQL matrix 已補但未執行。歷史 `group_has_active_premium` compatibility facade 仍可讀 trip pass，這不等於新 subscription projection。 | `supabase/migrations/20260804000000_personal_premium_projection.sql`, `supabase/tests/premium_projection.test.sql`, `apps/mobile/src/__tests__/premiumProjection.test.ts` |
| 5. Realtime recovery race | **Pass in Jest**。in-flight snapshot 收到較新 Realtime revision 時標記 pending follow-up；舊 response 不得覆蓋新 state；切換 group 會隔離舊 request。測試使用可控制 Promise 順序的實際 hook harness。 | `apps/mobile/src/state/useGroupState.ts`, `apps/mobile/src/__tests__/useGroupStateRecoveryRace.test.tsx` |
| 6. Map native boundary | **Pass in Jest**。GroupMap 不再判斷 `Platform.OS` 或直接選 Google provider；native maps boundary 統一回傳 provider、transit、MapKit chrome、lifecycle、location callbacks 的 platformized props。實機原生 MapKit/Google Maps 未驗證。 | `apps/mobile/src/native/maps.ts`, `apps/mobile/src/components/GroupMap.tsx`, `apps/mobile/src/__tests__/mapsPlatformBoundary.test.ts`, `apps/mobile/src/__tests__/mapNativeBoundaryBehavior.test.ts` |
| 7. Route LOD | **Pass in Jest**。tolerance 由 settled viewport 的 meters-per-pixel × target pixel error 連續導出；只在 `onRegionChangeComplete` 更新 viewport；Douglas-Peucker 僅改 display projection，raw geometry、distance、ETA 不變。實機 screen-space visual gate 未驗證。 | `apps/mobile/src/utils/routeLod.ts`, `apps/mobile/src/components/GroupMap.tsx`, `apps/mobile/src/__tests__/routeLod.test.ts` |

## 驗證結果

- Focused Jest：通過；包含 StoreKit eligibility、projection、realtime race、map boundary、route LOD 相關 suites，最後一次 focused run 為 10 suites / 56 tests。
- Full Jest：`npm.cmd test -- --runInBand` 通過，155 suites / 1291 tests。
- TypeScript：`npm.cmd run typecheck` 通過。
- Lint：`npm.cmd run lint` **Failed**，repo-wide 155 errors / 272 warnings。錯誤包含既有 React Compiler purity、refs、set-state-in-effect 等問題；本輪未把無關模組擴大改寫，也未把 lint failure 宣稱為通過。
- `git diff --check`：目前工作樹檢查通過；stage 後仍會再檢查 cached diff。

## 未驗證 gates

以下不是 Jest/typecheck 可替代的證據，均保持 **Unverified**：

- Deno Edge Function runtime、Supabase migration/pgTAP execution、PostgreSQL transaction/lock behavior、Supabase deploy。
- Apple JWS certificate chain、StoreKit sandbox purchase/restore/finish、App Store Server Notifications V2 replay/refund/revocation。
- iOS/Android release-like native binary、MapKit/Google Maps native callback與實際 screen-space route rendering。
- Instruments、MetricKit、MapKit compositor/radio/thermal A/B evidence。
- EAS build、OTA、TestFlight、App Store Connect、App Store submit/release gate。
