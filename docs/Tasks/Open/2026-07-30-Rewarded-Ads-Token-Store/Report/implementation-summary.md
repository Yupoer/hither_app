# Implementation Summary — Rewarded Ads Token Store

**Date:** 2026-07-30  
**Task pack:** `docs/Tasks/Open/2026-07-30-Rewarded-Ads-Token-Store`  
**Spec:** `Spec/rewarded-ads-token-store-spec-2026-07-30.md`  
**Code baseline (spec):** `ebeeb5487faf179ff752bb76226fa22a55b35d4d`  
**Supabase project:** `htqrucnjafhhvxdqslbv`  
**Process:** `/implement` (effort 1) — implement → review → fix until 0 open issues  
**Review rounds:** 3  
**Review issues fixed:** 15 total (5 bug · 6 suggestion · 4 nit) across rounds  
**IMPL_ID:** `d4314056`

## Status

| Layer | Status |
|-------|--------|
| Software AC (tickets 01–06) | **Complete** |
| Migration on linked project | **Deployed** (`20260730120000` present remote) |
| Edge Function `admob-reward-callback` | **ACTIVE v5** (HTTP 200 probe verified) |
| AdMob SSV callback URL verify | **Passed** (operator confirmed iOS + Android) |
| Native release-like ad → SSV → wallet → redeem | **Unverified** (needs new binary + test device) |
| OTA-only delivery of ads | **Impossible** — GMA is native; new build required |
| App Store / Play submit | **Out of scope** this pack |

Sibling report:

- `07-deployment-and-ssv-verification.md` — deploy matrix, callback URL, open gates

---

## Scope

Seven tickets:

1. Four-pane store navigation (Members / Route / Tools / Store)  
2. Token wallet, ledger, reward sessions, Google SSV credit  
3. AdMob native rewarded flow (consent, load/show, verifying UI)  
4. Team Premium 1 / 3 / 7 day token redemptions  
5. Extra gathering-point credits + restore Free open-point limit  
6. Personal Live Activity lifetime + effective entitlement gate  
7. Integrated deploy / AdMob / device verification report  

---

## Solution (one paragraph)

Bottom Sheet gains a fourth **商店** pane. Registered users create a short-lived opaque reward session, watch a Google Rewarded Ad with that session as SSV `custom_data`, and only receive **+1 token** after the public Edge Function verifies Google’s ECDSA signature and calls a service-role credit RPC. Tokens redeem via a fixed product-code allow-list for team day passes, extra open gathering-point credits, and personal Live Activity unlock. Client never writes wallet, ledger, credits, or entitlements.

---

## Files created

| Path | Purpose |
|------|---------|
| `supabase/migrations/20260730120000_rewarded_ads_token_store.sql` | Wallets, ledger, sessions, catalog, credits, user entitlements, RPCs, point-limit restore, diagnostics allow-list |
| `supabase/functions/admob-reward-callback/index.ts` | Public SSV webhook (`verify_jwt = false`) |
| `supabase/functions/admob-reward-callback/ssv.ts` | Parse, DER→P1363 ECDSA, key cache, allow-list helpers |
| `supabase/functions/admob-reward-callback/ssv_test.ts` | Deno unit tests (happy-path crypto + reject paths) |
| `supabase/tests/rewarded_ads_token_store.test.sql` | SQL contract notes |
| `apps/mobile/src/store/types.ts` | Pane keys, catalog types, AdMob IDs, SSV URL |
| `apps/mobile/src/store/sheetPane.ts` | Swipe / 3-tab viewport pure helpers |
| `apps/mobile/src/store/connectivity.ts` | Optional NetInfo + navigator + probe connectivity |
| `apps/mobile/src/api/services/StoreService.ts` | Snapshot / create session / redeem / session status |
| `apps/mobile/src/native/rewardedAds.ts` | GMA SDK wrapper, UMP, Expo Go degrade, dismiss grace |
| `apps/mobile/src/screens/MapScreen/components/StorePane.tsx` | Store UI: balance, ad CTA, products, offline gates |
| `apps/mobile/src/__tests__/storeSheetPane.test.ts` | Pane swipe / viewport unit tests |
| `apps/mobile/src/__tests__/storeServiceContract.test.ts` | Migration + service contracts |
| `apps/mobile/src/__tests__/storeUiContracts.test.ts` | Map / store UI contracts |
| `apps/mobile/src/__tests__/storeConnectivity.test.ts` | Connectivity helper tests |

## Files modified (high signal)

| Path | Change |
|------|--------|
| `apps/mobile/src/screens/MapScreen.tsx` | 4th pane, swipe, store body, LA gate, open-point + credits pre-check, extra credits UI |
| `apps/mobile/src/screens/MapScreen/components/Segmented.tsx` | 3-tab viewport + horizontal scroll + auto-scroll selected |
| `apps/mobile/src/entitlements.ts` | Free open destinations = 5; open-count helpers + block/remaining slots |
| `apps/mobile/src/i18n/index.ts` | `map.tabStore` + store / account premium source strings (zh/en) |
| `apps/mobile/src/api/client.ts` | Export StoreService |
| `apps/mobile/src/components/AccountSheet.tsx` | Server Premium team / source / expires / remaining |
| `apps/mobile/app.json` | `react-native-google-mobile-ads` config plugin + App IDs |
| `apps/mobile/package.json` / lockfile | `react-native-google-mobile-ads@^16.4.0` |
| `supabase/config.toml` | `[functions.admob-reward-callback] verify_jwt = false` |
| `docs/product-decision-log.md` | This Spec supersedes OTA-08 “token/ads out of scope” for future work |
| Contracts tests | `mapUiContracts`, `entitlementContract`, `diagnosticEventsAllowList`, etc. |

---

## Per-ticket outcomes

### 01 — Four-pane store navigation — **Done**

- Pane order fixed: `members | route | tools | store`.  
- Segmented `viewportCount={3}`; tab bar scrolls; selected off-viewport auto-scrolls into view.  
- Content horizontal swipe with direction threshold; no wrap; blocked during route edit/reorder.  
- Store shell: balance, ad CTA, team/personal products, anonymous / loading / empty states.  
- a11y roles/states; Dynamic Type via existing font layout patterns.

### 02 — Wallet / ledger / SSV — **Done (deployed)**

- Tables: `token_wallets`, `token_ledger`, `reward_sessions`, `store_product_catalog`, trip extra credits, user entitlements.  
- RLS: authenticated **select** only; no client write policies.  
- RPCs: `get_store_snapshot`, `create_reward_session`, `update_reward_session_status`, `redeem_store_product` (auth); `credit_rewarded_ad_transaction` (**service_role only**).  
- One unfinished session per user: `status IN ('active','verifying')` unique partial index + create lock + expiry.  
- Opaque `session_ref` (never Supabase JWT in Google custom data).  
- Edge Function: DER→P1363 ECDSA, allow-listed ad units, `1 hither_token`, `gtxn:` ledger idempotency.  
- HTTP policy for AdMob: **200** for probe + validation rejects (no credit); **503** only for transient key/RPC failure.

### 03 — AdMob native rewarded flow — **Code done (binary gate)**

- Package + Expo config plugin with production App IDs.  
- `__DEV__` uses Google test ad units; production units outside dev.  
- Flow: UMP consent → create session → load with SSV custom data = session ref → user-initiated show → **verifying UI only** → poll snapshot.  
- Fail session on no-fill / load error; dismiss uses ~900ms + 2s grace so CLOSED-before-EARNED does not kill a valid SSV.  
- Graceful degrade: Expo Go / missing native module.

### 04 — Premium day passes — **Done**

- SKUs: `team_premium_1d` (5), `_3d` (12), `_7d` (25).  
- Atomic debit + `trip_entitlements` with `source = token_redemption`.  
- Stack extends active token day-pass `expires_at`; reject purchase/promo/grant/lifetime without debit.  
- Account sheet shows team/source/expires/remaining from server (i18n source labels).

### 05 — Extra gathering points — **Done**

- SKUs: `team_extra_points_3` (4), `_10` (12).  
- Restored `enforce_itinerary_point_limit`: open points = `closed_at IS NULL`, Free max 5; credit consume on 6th+ without Premium (same trigger transaction).  
- Temporary unlimited override superseded by this migration.  
- Client pre-check: open count + credits (not total destinations).  
- Route UI: “額外集合點剩餘 N” only when N > 0.

### 06 — Live Activity entitlement — **Done**

- SKU: `personal_live_activity_lifetime` (10).  
- Effective = personal lifetime **OR** current team Premium (personal does not require membership).  
- Local `liveActivityEnabled` is preference only; native start requires preference **and** effective.  
- Tools locked row → Store highlight product.  
- No auto-grandfather of existing accounts.

### 07 — Deploy / verification — **Partial (see sibling report)**

| Gate | Result |
|------|--------|
| Code + focused Jest + typecheck | Pass (implement pass) |
| Migration remote | Present |
| Edge Function deploy | ACTIVE |
| AdMob Verify URL (iOS + Android) | **Passed** (operator) |
| Full ad → SSV → +1 token on device | Open |
| iOS/Android release-like binary | Open |

---

## Product catalog (server seed)

| Code | Scope | Price | Effect |
|------|-------|------:|--------|
| `team_premium_1d` | team | 5 | Premium 1 day |
| `team_premium_3d` | team | 12 | Premium 3 days |
| `team_premium_7d` | team | 25 | Premium 7 days |
| `team_extra_points_3` | team | 4 | +3 open-point credits |
| `team_extra_points_10` | team | 12 | +10 open-point credits |
| `personal_live_activity_lifetime` | personal | 10 | Permanent Live Activity |

Grant behavior is hard-coded by product code in `redeem_store_product`; catalog supplies price / active / sort / display only.

---

## Design decisions

1. **Extract `StorePane` + `store/*` helpers** rather than ballooning MapScreen further.  
2. **SSV custom data = opaque session_ref only** — never access token.  
3. **Credit only after Google SSV** via service_role RPC; client reward callback is UI-only.  
4. **Token day-pass stacking** updates the single active `small_trip_pass` row (unique active index preserved).  
5. **Free open-point cap** uses `closed_at IS NULL` (Spec), not all historical rows.  
6. **Unfinished sessions** include both `active` and `verifying` for concurrency control.  
7. **AdMob HTTP 200 policy** for console URL verify and non-credit rejects; security is crypto + RPC, not 4xx status.  
8. **This Spec supersedes OTA-08** “token/Rewarded Ads out of scope” for future product decisions; historical Specs not rewritten.

---

## Security checklist

- [x] Client cannot INSERT/UPDATE wallet, ledger, credits, user/trip entitlements (RLS + grants)  
- [x] Opaque session ref in SSV custom data  
- [x] Allow-listed iOS/Android Rewarded Ad Unit IDs only  
- [x] Google transaction unique / replay-safe credit  
- [x] Anonymous: no reward session / redeem  
- [x] Diagnostics allow-list outcomes only (no signature / full query / raw session / tokens / PII)  
- [x] ECDSA DER → P1363 before Web Crypto verify  

---

## Review loop (summary)

| Round | Open | Highlights fixed |
|-------|------|------------------|
| 1 | 12 | DER→P1363; open-point client pre-check; session fail/verifying RPC; LA effective without membership; product-code grants; offline gate; key cache |
| 2 | 3 | Unfinished = active\|verifying index; dismiss grace; connectivity helper |
| 3 | **0** | Approved |

---

## Tests run (implement pass)

| Command / suite | Result |
|-----------------|--------|
| `npx tsc --noEmit` (apps/mobile) | Pass |
| Focused Jest (store / map / entitlement / diagnostics / live activity / destination) | Pass (100+ cases across passes) |
| Deno `admob-reward-callback` tests | Written; **not executed** on implement host (no `deno`) |
| `git diff --check` (feature paths) | Clean enough; pre-existing CRLF noise elsewhere possible |

---

## Callback URL (operator)

```
https://htqrucnjafhhvxdqslbv.supabase.co/functions/v1/admob-reward-callback
```

Probe (empty GET): `200 {"ok":true,"probe":true}`  
Dashboard: https://supabase.com/dashboard/project/htqrucnjafhhvxdqslbv/functions  

Ad units (allow-list + AdMob console):

- iOS: `ca-app-pub-8135109277557342/7899053731`  
- Android: `ca-app-pub-8135109277557342/7100977386`  
- App IDs: iOS `~4266216474`, Android `~5387726456`  

Reward configuration expected: amount `1`, item `hither_token`, no frequency cap.

---

## Follow-ups (not code-complete blockers for this report)

1. New development/production **native build** with GMA SDK (OTA cannot deliver ads alone).  
2. Device evidence: watch ad → Google SSV → wallet +1 → redeem at least one SKU (Android + iOS when available).  
3. Optional: run Deno SSV tests in CI.  
4. AdMob Privacy / UMP / payments / children-directed declarations remain account-holder responsibility.

---

## Verdict

**Software implementation for tickets 01–06 is complete and review-clean.**  
**Backend migration + Edge Function are live; AdMob SSV callback URL verification passed.**  
**End-to-end production ad fill and wallet credit on device remain an open release gate** pending a new binary and device verification.
