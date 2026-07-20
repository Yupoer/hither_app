# Android Release Runbook

**Plan:** `docs/android-full-implementation-plan-2026-07-20.md` (M3–M4)  
**Package:** `app.hither.mobile`  
**Last code evidence date:** 2026-07-20

## 1. Build identities & secrets

| Item | Where | Notes |
|---|---|---|
| Android package | `app.config.ts` / `app.json` | `app.hither.mobile` |
| Maps Android key | EAS env `GOOGLE_MAPS_ANDROID_API_KEY` | Restrict package + SHA-1; never commit |
| `google-services.json` | EAS file secret or local (client config only) | Admin service-account JSON never in Git |
| FCM send | Edge secret `FIREBASE_SERVICE_ACCOUNT_JSON` | send-push only |
| APNs | Edge secrets `APNS_*` | iOS path only |
| Places/Routes server key | Edge secret `GOOGLE_MAPS_SERVER_API_KEY` | google-maps function only |
| Push webhook | `PUSH_WEBHOOK_SECRET` | Vault / Edge |

## 2. EAS profiles

```bash
cd apps/mobile
eas build --platform android --profile androidQa    # internal APK
eas build --platform android --profile production   # signed AAB, autoIncrement
```

- `androidQa`: internal distribution APK, channel `preview`
- `production`: store AAB, channel `production`, `autoIncrement: true`

Do **not** submit to Play until background-location disclosure, data safety form, and notification purpose review are complete.

## 3. Automated verification (must exit 0)

```bash
cd apps/mobile
npm run typecheck
npm run lint
npm test -- --runInBand src/__tests__/androidPushRegistration.test.ts \
  src/__tests__/androidLiveUpdateContract.test.ts \
  src/__tests__/androidLocationPermissions.test.ts \
  src/__tests__/androidParityContract.test.ts \
  src/__tests__/androidMetricsContract.test.ts \
  src/__tests__/navigationPushContract.test.ts \
  src/__tests__/liveActivityContract.test.ts \
  src/__tests__/backgroundJourney.test.ts \
  src/__tests__/metricKitContract.test.ts \
  src/__tests__/client.test.ts

cd ../../supabase/functions/send-push
deno test --allow-env fcm_test.ts

cd ../google-maps
deno test --allow-env google_test.ts
```

Optional DB: `supabase test db` (requires local Supabase).

## 4. Quota & cost guards (production Places/Routes)

- Per-user daily hard limits (default 100 search / 100 route) via `consume_google_maps_quota`
- Fail closed: 429 → App keeps coordinate add, haversine ETA, KML, external Maps
- Billing budget alerts on Google Cloud project
- Keep Places/Routes production flag **off** until smoke + quota tests pass

## 5. Device matrix (manual evidence)

| Device | API | Focus | Result | Date / tester |
|---|---|---|---|---|
| Pixel | 36 | Live Update ProgressStyle, POST_NOTIFICATIONS | _pending_ | |
| Pixel / AVD | 34 | FGS location, notification dismiss | _pending_ | |
| Non-Pixel OEM | 31–34 | OEM background kill, approximate location | _pending_ | |

Record: callback interval, notification presence, location outbox catch-up.

## 6. Dual-platform event smoke

Same group: iPhone + Android — create gathering, search/coordinate, start nav, route update, arrival, straggler, meet time, command, prefs off, pause, leave, sign out. Expect Realtime + APNs + FCM + LA/Live Update sync (pixels need not match).

## 7. Evidence checklist (fill per release)

| Field | Value |
|---|---|
| Commit SHA | _fill after merge_ |
| EAS androidQa build URL | _fill_ |
| EAS production AAB URL | _fill_ |
| APK / AAB checksum | _fill_ |
| Test date / devices / API | _fill_ |
| Maps key restriction screenshot ref | _fill_ |
| Quota values | search 100 / route 100 (default) |
| Supabase function versions | send-push, google-maps |
| Platform-equivalent diffs | see `android-parity-qa-matrix-2026-07-20.md` |
| Rollback build id | _fill_ |

## 8. Rollback

1. Disable Places/Routes via Edge flag / remove server key (fail closed to free core).  
2. Point OTA channel to previous known-good update if JS-only.  
3. For native/permission regressions: install previous `androidQa` / production AAB (OTA cannot fix native).

## 9. Known platform-equivalent gaps

- Dynamic Island / ActivityKit avatar stack → Android ongoing notification  
- Liquid Glass material → BlurView dark fallback  
- MetricKit crash spool → empty `drainPayloads` on Android  
- Apple login → iOS only  
- Live Update chip promotion → OEM/OS controlled; presence of ongoing notification is pass
