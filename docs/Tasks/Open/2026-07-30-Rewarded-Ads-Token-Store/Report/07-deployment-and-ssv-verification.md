# 07 — Deployment & SSV Verification Report

**Date:** 2026-07-30  
**Ticket:** `Ticket/07-integrated-deployment-and-release-verification.md`  
**Spec:** `Spec/rewarded-ads-token-store-spec-2026-07-30.md`  
**Linked project:** `htqrucnjafhhvxdqslbv` (Hither, Northeast Asia / Seoul)

This report separates **what was proven** from **what remains an external gate**. Nothing below invents device or AdMob console state.

---

## Evidence matrix

| Area | Status | Evidence |
|------|--------|----------|
| **Code (01–06)** | Complete | Implement + 3 review rounds → 0 open issues; see `implementation-summary.md` |
| **Migration (repo)** | Complete | `supabase/migrations/20260730120000_rewarded_ads_token_store.sql` |
| **Migration (remote)** | Applied | `supabase migration list --linked` shows local = remote `20260730120000` |
| **Edge Function (repo)** | Complete | `supabase/functions/admob-reward-callback/` + `config.toml` `verify_jwt = false` |
| **Edge Function (deploy)** | ACTIVE | `supabase functions list` → `admob-reward-callback` **ACTIVE v5** (2026-07-30 07:34:40 UTC) |
| **Public probe** | Pass | `GET` bare URL → `200` `{"ok":true,"probe":true}` |
| **AdMob Verify URL (iOS)** | Pass | Operator confirmed console verify succeeded after 200 policy fix |
| **AdMob Verify URL (Android)** | Pass | Same |
| **AdMob reward config** | Operator | Expect `1` / `hither_token`; no frequency cap (operator-owned) |
| **AdMob Privacy / UMP / payments / children** | External | Account holder |
| **Android release-like ad→SSV→wallet→redeem** | Not verified | Needs new binary + test device |
| **iOS release-like same path** | Not verified | Needs Simulator/device + signed build |
| **Continuous multi-ad no daily cap (device)** | Not verified | Code has no Hither daily cap; device not exercised |
| **Txn replay no double credit (device)** | Not verified | SQL/RPC designed for `gtxn:` uniqueness; device not exercised |
| **Deno SSV unit tests in CI** | Not run on host | Tests present; `deno` missing on implement machine |
| **OTA vs binary** | Documented | Native GMA requires **new** dev/prod build; OTA alone insufficient |

---

## Deploy actions performed

1. Confirmed Supabase CLI login + link to `htqrucnjafhhvxdqslbv`.  
2. `supabase db push --linked` → remote already up to date including `20260730120000`.  
3. `supabase functions deploy admob-reward-callback --project-ref htqrucnjafhhvxdqslbv --no-verify-jwt`.  
4. Fixed AdMob URL verification failures:  
   - Empty query probe → **HTTP 200**  
   - Invalid / incomplete SSV → **HTTP 200** + `{ ok: false }` (no credit)  
   - HEAD / OPTIONS → **HTTP 200**  
   - Transient key/RPC issues → **HTTP 503** (Google may retry)  
5. Operator re-verified callback URL on **both** Rewarded Ad Units → **passed**.

---

## Callback configuration (copy for ops)

**URL (both platforms):**

```
https://htqrucnjafhhvxdqslbv.supabase.co/functions/v1/admob-reward-callback
```

| Platform | Rewarded Ad Unit |
|----------|------------------|
| iOS | `ca-app-pub-8135109277557342/7899053731` |
| Android | `ca-app-pub-8135109277557342/7100977386` |

| Platform | App ID |
|----------|--------|
| iOS | `ca-app-pub-8135109277557342~4266216474` |
| Android | `ca-app-pub-8135109277557342~5387726456` |

**Reward:** amount `1`, item `hither_token`  
**Frequency cap:** none (Hither product decision)

---

## What “Verify URL passed” does and does not prove

| Proves | Does not prove |
|--------|----------------|
| Google can reach the Edge Function over HTTPS | A real ad completion will credit a wallet |
| Endpoint returns HTTP 200 for AdMob’s probe | ECDSA path on a live Google signature (needs real SSV) |
| JWT gateway does not block public SSV | Fill rate, invalid traffic, or production eCPM |
| Operator finished AdMob console URL step | Native SDK integrated in a store binary |

---

## Recommended next verification sequence

1. **New native build** (dev client or release-like) with `react-native-google-mobile-ads` + App IDs from `app.json`.  
2. Register test device in AdMob; use Google **test** ads in `__DEV__` builds.  
3. Registered user → Store → watch ad → UI **驗證中** → balance +1 without re-login.  
4. Replay same transaction (or double-callback) → balance unchanged.  
5. Redeem one team SKU + confirm trip entitlement / credits / LA as applicable.  
6. Repeat on second platform when available; if iOS unavailable, leave explicitly **unverified**.

---

## Product decision note

This Spec is the current decision for Rewarded Ads + token currency. Historical OTA-08 text that marked token/ads out of scope is **not** rewritten; `docs/product-decision-log.md` records the supersession for future work.

---

## Ticket 07 checklist (honest)

- [x] Schema via tracked migration; present on linked project  
- [x] `admob-reward-callback` deployed; public URL reachable  
- [x] iOS + Android SSV **URL** configured and verified in AdMob (operator)  
- [ ] Confirm reward item/amount + no frequency cap in AdMob UI (operator follow-up if not already)  
- [ ] Privacy & messaging / UMP / account readiness (account holder)  
- [ ] Android release-like end-to-end evidence  
- [ ] iOS release-like end-to-end evidence  
- [x] Local Jest / typecheck / feature contracts (implement pass)  
- [x] Product decision log note (no historical Spec rewrite)  
- [x] Report separates code / migration / edge / AdMob / device / OTA  

**Ticket 07 software + backend deploy portion: complete.**  
**Ticket 07 device / native E2E portion: open.**
