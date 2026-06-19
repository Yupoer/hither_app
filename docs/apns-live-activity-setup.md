# APNs Push + Live Activity — Setup / Handoff

## Current mode: LOCAL notifications (no paid Apple account needed)

APNs needs a paid Apple Developer account, so the app currently delivers
**local notifications** instead: every device listens to the group's Supabase
realtime changes and, on an event from someone else, fires a local notification
gated by that device's per-category toggle (`src/state/useGroupNotifications.ts`).
This works in Expo Go. Limitation: local notifications only fire while the app
is running (foreground / brief background) — true background/closed-app delivery
needs APNs.

The APNs path below (Edge Function + triggers + Live Activity widget) is fully
built but **dormant** until you add a key. `notify_push` no-ops while
`app.settings.edge_url` is unset, so nothing breaks. When you upgrade, do
sections 1–4 and the server path takes over (you can then drop
`useGroupNotifications` to avoid double notifications).

---

## (Later) APNs + Live Activity

The remaining steps need your **Apple Developer account** and **Supabase
project**. Until done, pushes don't deliver remotely and Live Activities are
absent (native calls are safe no-ops).

## 0. What's already built

- **DB** (`supabase/migrations/20260619000000_notifications_journey.sql`):
  `push_tokens`, `commands`, `notification_preferences`,
  `groups.journey_status`, `itinerary_items.created_by`; RLS; realtime; pg_net
  triggers → `send-push`.
- **Client** (`src/api/client.ts`): `savePushToken`, `sendCommand`,
  `get/setNotificationPreferences`, `setJourneyStatus`.
- **UI**: Settings quick-command grid + 4 per-category toggles; Map leader
  start/pause + in-app `JourneyBanner`; `useLiveActivity` drives the native
  activity; `usePushRegistration` registers the device on launch.
- **Edge Function** (`supabase/functions/send-push`): APNs fan-out.
- **Native**: `HitherLiveActivity` ActivityKit module + Widget target
  (`apps/mobile/targets/live-activity`). Token comes from `expo-notifications`
  on a Dev Build.

## 1. Apple Developer

1. Keys → create an **APNs Auth Key (.p8)**. Note the **Key ID** and your
   **Team ID**. Download the `.p8` once.
2. Ensure the App ID `app.hither.mobile` has **Push Notifications** enabled.

## 2. Supabase secrets (Edge Function)

```sh
supabase secrets set \
  APNS_KEY="$(cat AuthKey_XXXXXXXXXX.p8)" \
  APNS_KEY_ID=XXXXXXXXXX \
  APNS_TEAM_ID=YYYYYYYYYY \
  APNS_BUNDLE_ID=app.hither.mobile \
  APNS_ENV=sandbox          # 'production' for TestFlight/App Store builds
supabase functions deploy send-push
```

## 3. Wire the DB trigger to the function

The pg_net trigger reads two settings; set them once (service_role from
Project Settings → API):

```sql
alter database postgres set app.settings.edge_url     = 'https://<ref>.supabase.co/functions/v1/send-push';
alter database postgres set app.settings.service_role = '<service_role_key>';
```

Apply the migration: `supabase db push` (or `supabase migration up`).

> If these are unset, `extensions.notify_push` no-ops — safe, just no pushes.

## 4. Build (Dev Build, not Expo Go)

Live Activities + APNs need a Dev Build. The project is already prebuilt
(`ios/`) and `npm run ios` → `expo run:ios`.

```sh
cd apps/mobile
npm i -D @bacons/apple-targets    # widget target generator (referenced in app.json)
npx expo prebuild -p ios --clean  # regenerates ios/ incl. the HitherLiveActivity widget target
npm run ios                       # build & run on a *physical device*
```

Then on device: accept the notification permission prompt.

## 5. Verify

- Two devices in one group. Leader adds a gathering point → follower gets a
  push (and vice-versa for member quick buttons), **sender never** gets their
  own.
- Settings → toggle a category off → that category stops arriving for that user.
- Leader taps **▶︎ Start** on the map → in-app banner appears + a Live Activity
  shows on the lock screen / Dynamic Island; **⏸ Pause** ends both.

## Gotchas

- Live Activities & APNs do **not** work on the iOS Simulator or in Expo Go.
- The shared `HitherGroupAttributes` exists in two places (module + widget
  target) and must stay structurally identical — see the file headers.
- `APNS_ENV` must match the build: `sandbox` for Dev Builds, `production` for
  TestFlight/App Store. A mismatch returns `BadDeviceToken`.
