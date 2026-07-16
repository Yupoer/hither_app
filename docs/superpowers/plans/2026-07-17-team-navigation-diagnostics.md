# Hither Team Navigation and Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Navigation Session、可靠背景定位、ActivityKit push-to-start、抵達判定、SQLite／MetricKit 診斷，以及 production EAS Build + TestFlight Submit。

**Architecture:** PostgreSQL/RPC 是導航唯一真實來源；Realtime 與 APNs 是傳輸通道。Expo app 使用 SQLite outbox 保存位置與診斷事件，原生 ActivityKit/MetricKit module 只處理 iOS 能力並透過既有 JS boundary 同步後端。

**Tech Stack:** Expo SDK 54、React Native 0.81、TypeScript 5.9、expo-location、expo-task-manager、expo-sqlite、Supabase PostgreSQL/RLS/RPC/Realtime/Edge Functions、Swift ActivityKit/MetricKit、Jest、pgTAP、EAS Build/Submit。

## Global Constraints

- iOS deployment target 維持 15.1；Live Activity 在 iOS 16.1+，push-to-start 在 iOS 17.2+ 才執行。
- `sharingEnabled = false` 優先於任何導航或高精度設定，並清除未上傳位置。
- public schema 新表全部啟用 RLS、明確 GRANT；token 不可出現在 log、APNs alert 或診斷匯出。
- 每個位置事件有 UUID、sequence、capturedAt、24 小時 TTL；診斷最多 10,000 筆、72 小時、每批 100 筆。
- 保留使用者現有 `scripts/task-end-ship.sh` 修改，不納入任何 task commit。
- 每項非平凡邏輯先執行失敗測試，再寫最小實作。

## File Map

- `supabase/migrations/20260717*_team_navigation_sessions.sql`：session、member state、device activity token、location/diagnostic ingestion、RLS、trigger。
- `supabase/tests/team_navigation_sessions.test.sql`：RPC 權限、冪等、active 唯一性、ACK 與 ingestion pgTAP。
- `apps/mobile/src/types/navigation.ts`：Navigation Session 與 member state domain types。
- `apps/mobile/src/api/services/NavigationService.ts`：session RPC、active query、ACK、Realtime subscription。
- `apps/mobile/src/state/hitherDatabase.ts`：單一 SQLite connection 與 schema migration。
- `apps/mobile/src/state/locationOutbox.ts`：SQLite location queue、batch upload、backoff、TTL。
- `apps/mobile/src/state/diagnostics.ts`：bounded diagnostic queue、redaction、batch upload、JSON export。
- `apps/mobile/src/utils/navigationArrival.ts`：距離／精度／連續 fix 抵達 reducer。
- `apps/mobile/src/state/backgroundJourney.ts`：callback → diagnostics → arrival → outbox。
- `apps/mobile/src/state/useNavigationSession.ts`：active session hydration、Realtime、ACK、tracking config。
- `apps/mobile/modules/hither-live-activity/ios/HitherLiveActivityModule.swift`：push-to-start/update token lifecycle。
- `apps/mobile/modules/hither-metrics/`：MetricKit payload file spool Expo module。
- `supabase/functions/send-push/apns.ts`、`index.ts`：ActivityKit start/update/end APNs。
- `apps/mobile/src/screens/MapScreen/components/DiagnosticsOverlay.tsx`：TestFlight 診斷畫面與 JSON 分享。
- `apps/mobile/src/screens/MapScreen.tsx`、`SettingsOverlay.tsx`、`PreferencesContext.tsx`：session、分享與診斷 UI 整合。

---

### Task 1: Navigation Session database contract

**Files:**
- Create: `supabase/migrations/20260717*_team_navigation_sessions.sql`
- Create: `supabase/tests/team_navigation_sessions.test.sql`
- Test: `apps/mobile/src/__tests__/teamNavigationMigration.test.ts`

**Interfaces:**
- Produces: `start_navigation_session(uuid, uuid, uuid) -> navigation_sessions`
- Produces: `cancel_navigation_session(uuid, integer) -> navigation_sessions`
- Produces: `complete_navigation_session(uuid, integer) -> navigation_sessions`
- Produces: `ack_navigation_session(uuid, text, jsonb) -> navigation_member_states`
- Produces: `ingest_location_batch(jsonb) -> jsonb`
- Produces: `ingest_diagnostic_batch(jsonb) -> jsonb`

- [ ] **Step 1: 建立 migration 與失敗契約測試**

Run:

```powershell
npx supabase migration new team_navigation_sessions
```

Add a Jest contract asserting the generated SQL contains the seven tables, five RPCs, RLS, explicit grants, realtime publication and partial unique active-session index:

```ts
expect(sql).toContain('create table public.navigation_sessions');
expect(sql).toContain("where status = 'active'");
expect(sql).toContain('create or replace function public.start_navigation_session');
expect(sql).toContain('alter table public.navigation_sessions enable row level security');
expect(sql).toContain('grant execute on function public.ack_navigation_session');
```

- [ ] **Step 2: 驗證測試先失敗**

Run: `npm test -- --runInBand src/__tests__/teamNavigationMigration.test.ts`  
Expected: FAIL because the generated migration is empty.

- [ ] **Step 3: 實作 schema、RPC、RLS 與 webhook trigger**

Use these exact states and constraints:

```sql
status text not null check (status in ('active','cancelled','expired','completed')),
version integer not null default 1 check (version > 0),
unique (group_id, request_id)
```

```sql
create unique index navigation_sessions_one_active_group
on public.navigation_sessions(group_id) where status = 'active';
```

`start_navigation_session` must lock the group row, verify leader membership and destination ownership, return the existing `(group_id, request_id)` row, expire stale active rows, insert one active row, seed member states as `pending`, and mirror `groups.journey_status/active_destination_id/journey_started_at`. Cancel/complete must compare `p_expected_version`, update the mirror fields and fire a `navigation_session` payload through `extensions.notify_push`.

- [ ] **Step 4: 新增 pgTAP security tests**

The test must prove:

```sql
select throws_ok(
  $$ select public.start_navigation_session(:group_id, :destination_id, gen_random_uuid()) $$,
  '42501', 'leader membership required'
);
select is((select count(*) from public.navigation_sessions where group_id = :group_id), 1::bigint);
select is((select local_status from public.navigation_member_states where user_id = :follower_id), 'pending');
```

Also assert a member can select its group session, cannot read another group, can ACK only itself, and duplicate location event IDs return one accepted row.

- [ ] **Step 5: 驗證 migration**

Run: `npm test -- --runInBand src/__tests__/teamNavigationMigration.test.ts`  
Expected: PASS.  
Run: `npx supabase db reset --local`  
Expected: all migrations apply.  
Run: `npx supabase test db --local supabase/tests/team_navigation_sessions.test.sql`  
Expected: all pgTAP assertions pass.

- [ ] **Step 6: Commit**

```powershell
git add -- supabase/migrations supabase/tests apps/mobile/src/__tests__/teamNavigationMigration.test.ts
git commit -m "feat: add navigation session backend"
```

### Task 2: Typed NavigationService and Realtime session state

**Files:**
- Create: `apps/mobile/src/types/navigation.ts`
- Create: `apps/mobile/src/api/services/NavigationService.ts`
- Create: `apps/mobile/src/state/useNavigationSession.ts`
- Test: `apps/mobile/src/__tests__/navigationService.test.ts`
- Test: `apps/mobile/src/__tests__/navigationSessionState.test.tsx`

**Interfaces:**
- Consumes: Task 1 RPCs/tables.
- Produces: `startNavigationSession(groupId, destinationId, requestId): Promise<NavigationSession>`
- Produces: `ackNavigationSession(sessionId, status, detail?): Promise<MemberNavigationState>`
- Produces: `useNavigationSession(groupId): { session, memberState, loading, start, cancel, ack }`

- [ ] **Step 1: 寫 Supabase mock 失敗測試**

```ts
await startNavigationSession('g1', 'd1', 'request-1');
expect(supabase.rpc).toHaveBeenCalledWith('start_navigation_session', {
  p_group_id: 'g1', p_destination_id: 'd1', p_request_id: 'request-1',
});
```

The hook test emits INSERT/UPDATE realtime payloads and expects the active session to replace the cached session only when `version` is newer.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- --runInBand src/__tests__/navigationService.test.ts src/__tests__/navigationSessionState.test.tsx`  
Expected: FAIL with missing modules.

- [ ] **Step 3: 實作 domain types and mapper**

```ts
export type NavigationSessionStatus = 'active' | 'cancelled' | 'expired' | 'completed';
export type NavigationMemberStatus = 'pending' | 'activity_started' | 'tracking_active' | 'permission_denied' | 'location_disabled' | 'app_force_quit_suspected' | 'offline' | 'push_unavailable' | 'sharing_disabled' | 'arriving' | 'arrived' | 'cancelled';
export interface NavigationSession {
  id: string; groupId: string; destinationId: string; startedBy: string;
  startedAt: string; expiresAt: string; status: NavigationSessionStatus; version: number;
}
```

The hook loads the active row plus current user's member row in parallel, subscribes to both tables, ACKs `tracking_active` after applying background mode, and clears local state on terminal session status.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- --runInBand src/__tests__/navigationService.test.ts src/__tests__/navigationSessionState.test.tsx`  
Expected: PASS.  
Run: `npm run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/mobile/src/types/navigation.ts apps/mobile/src/api/services/NavigationService.ts apps/mobile/src/state/useNavigationSession.ts apps/mobile/src/__tests__/navigationService.test.ts apps/mobile/src/__tests__/navigationSessionState.test.tsx
git commit -m "feat: add realtime navigation sessions"
```

### Task 3: SQLite location outbox and privacy purge

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/package-lock.json`
- Create: `apps/mobile/src/state/hitherDatabase.ts`
- Modify: `apps/mobile/src/state/locationOutbox.ts`
- Modify: `apps/mobile/src/api/services/LocationService.ts`
- Modify: `apps/mobile/src/__tests__/locationOutbox.test.ts`

**Interfaces:**
- Produces: `initializeHitherDatabase(): Promise<void>`
- Produces: `enqueueLocationOutbox(input: LocationUploadEvent): Promise<void>`
- Produces: `flushLocationOutbox(maxEntries?: number): Promise<{sent:number;remaining:number}>`
- Produces: `purgeLocationOutbox(): Promise<void>`

- [ ] **Step 1: Install the Expo-supported SQLite package**

Run: `npx expo install expo-sqlite`  
Expected: Expo SDK 54-compatible version added to package and lock files.

- [ ] **Step 2: Rewrite tests against an in-memory DB adapter and confirm failure**

Test oldest-first ordering, one RPC call per batch, retry backoff, 24-hour TTL, UUID stability, sequence ordering, and `purge()` removing every pending position.

```ts
await outbox.enqueue({
  id: 'e1', groupId: 'g1', navigationSessionId: 'n1', capturedAt: 1000,
  coords: { latitude: 25.04, longitude: 121.5, accuracy: 12 },
  trackingMode: 'teamNavigation', source: 'background_task', sequence: 7,
});
expect(await outbox.flush()).toEqual({ sent: 1, remaining: 0 });
```

Run: `npm test -- --runInBand src/__tests__/locationOutbox.test.ts`  
Expected: FAIL because AsyncStorage does not expose the SQLite contract.

- [ ] **Step 3: Implement SQLite schema and batch RPC upload**

```sql
create table if not exists location_outbox (
  id text primary key, group_id text not null, navigation_session_id text,
  captured_at integer not null, payload text not null, sequence integer not null,
  attempts integer not null default 0, next_attempt_at integer not null,
  expires_at integer not null
);
create index if not exists location_outbox_due on location_outbox(next_attempt_at, captured_at);
```

`flushLocationOutbox` calls `ingest_location_batch` once with up to ten rows, deletes accepted IDs in the same SQLite transaction, increments failed rows, and caps backoff at 15 minutes. On first open, import valid legacy `@hither/location-outbox` entries then remove the AsyncStorage key.

- [ ] **Step 4: Run tests**

Run: `npm test -- --runInBand src/__tests__/locationOutbox.test.ts src/__tests__/backgroundJourney.test.ts`  
Expected: PASS.  
Run: `npm run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/src/state/hitherDatabase.ts apps/mobile/src/state/locationOutbox.ts apps/mobile/src/api/services/LocationService.ts apps/mobile/src/__tests__/locationOutbox.test.ts
git commit -m "feat: move location outbox to sqlite"
```

### Task 4: Diagnostic event store, upload and JSON export

**Files:**
- Create: `apps/mobile/src/state/diagnostics.ts`
- Create: `apps/mobile/src/api/services/DiagnosticService.ts`
- Test: `apps/mobile/src/__tests__/diagnostics.test.ts`

**Interfaces:**
- Produces: `diagnostics.write(event): Promise<void>`
- Produces: `diagnostics.flush(): Promise<{sent:number;remaining:number}>`
- Produces: `diagnostics.summary(): Promise<DiagnosticSummary>`
- Produces: `diagnostics.exportJson(): Promise<string>`

- [ ] **Step 1: Write failing retention/redaction tests**

```ts
await diagnostics.write({ event: 'location_upload_failed', errorCode: 'offline', pushToken: 'secret' } as never);
expect(await diagnostics.exportJson()).not.toContain('secret');
expect((await diagnostics.list()).length).toBeLessThanOrEqual(10_000);
```

Also insert events older than 72 hours, run cleanup and expect deletion; production minimal mode must drop `location_callback` successes while preserving errors.

- [ ] **Step 2: Run failing test**

Run: `npm test -- --runInBand src/__tests__/diagnostics.test.ts`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement bounded SQLite diagnostics**

```sql
create table if not exists diagnostic_events (
  id text primary key, timestamp integer not null, session_id text not null,
  event text not null, payload text not null, attempts integer not null default 0,
  uploaded_at integer
);
create index if not exists diagnostic_events_pending on diagnostic_events(uploaded_at, timestamp);
```

Allowed fields are copied explicitly; drop `token`, `pushToken`, `latitude`, `longitude`, email and raw error message. Build metadata comes from `expo-constants`. `flush()` sends 100 rows to `ingest_diagnostic_batch` and marks them uploaded before retention cleanup.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- --runInBand src/__tests__/diagnostics.test.ts`  
Expected: PASS.

```powershell
git add -- apps/mobile/src/state/diagnostics.ts apps/mobile/src/api/services/DiagnosticService.ts apps/mobile/src/__tests__/diagnostics.test.ts
git commit -m "feat: add bounded diagnostic event store"
```

### Task 5: Arrival reducer and background tracking integration

**Files:**
- Create: `apps/mobile/src/utils/navigationArrival.ts`
- Create: `apps/mobile/src/__tests__/navigationArrival.test.ts`
- Modify: `apps/mobile/src/state/backgroundJourneyController.ts`
- Modify: `apps/mobile/src/state/backgroundJourney.ts`
- Modify: `apps/mobile/src/state/backgroundLocationRefresh.ts`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`

**Interfaces:**
- Produces: `reduceArrival(previous, sample, destination): ArrivalResult`
- Consumes: Tasks 2–4 session, outbox and diagnostics.

- [ ] **Step 1: Write failing arrival tests**

```ts
expect(reduceArrival(initial, { distanceM: 49, accuracyM: 20 }, { radiusM: 50 }).status).toBe('arriving');
expect(reduceArrival(arrivingOnce, { distanceM: 48, accuracyM: 20 }, { radiusM: 50 }).status).toBe('arrived');
expect(reduceArrival(arrivingOnce, { distanceM: 20, accuracyM: 80 }, { radiusM: 50 }).consecutiveFixes).toBe(0);
```

- [ ] **Step 2: Run failing test**

Run: `npm test -- --runInBand src/__tests__/navigationArrival.test.ts`  
Expected: FAIL with missing reducer.

- [ ] **Step 3: Implement reducer and callback pipeline**

The reducer clamps progress, allows at most a 0.03 backward display movement, requires `accuracyM <= 50` and two consecutive fixes. Background callback order is: write callback diagnostic → reject hidden/sharing disabled → calculate arrival → update local activity → enqueue location → flush → ACK arriving/arrived. It never calls Supabase before enqueue succeeds.

Extend `BackgroundJourneyConfig` with `navigationSessionId`, `arrivalRadiusMeters`, `sequence`, and `sharingEnabled` required. Replace the MapScreen hardcoded `sharingEnabled: true` with Preferences state.

- [ ] **Step 4: Run focused regressions**

Run: `npm test -- --runInBand src/__tests__/navigationArrival.test.ts src/__tests__/backgroundJourney.test.ts src/__tests__/locationRefresh.test.ts src/__tests__/locationPolicy.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/mobile/src/utils/navigationArrival.ts apps/mobile/src/__tests__/navigationArrival.test.ts apps/mobile/src/state/backgroundJourneyController.ts apps/mobile/src/state/backgroundJourney.ts apps/mobile/src/state/backgroundLocationRefresh.ts apps/mobile/src/screens/MapScreen.tsx
git commit -m "feat: confirm navigation arrival from location fixes"
```

### Task 6: Leader start/cancel and follower ACK UI integration

**Files:**
- Modify: `apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Modify: `apps/mobile/src/state/useGroupState.ts`
- Modify: `apps/mobile/src/__tests__/journeyNavigation.test.tsx`
- Create: `apps/mobile/src/__tests__/navigationIntegration.test.tsx`

**Interfaces:**
- Consumes: `useNavigationSession`, `startNavigationSession`, `cancelNavigationSession`.
- Preserves: follower local route never writes server session.

- [ ] **Step 1: Add failing integration tests**

Leader start must generate one UUID request ID and call `startNavigationSession`; retry must reuse it until success. Stop passes the observed version. Follower receives Realtime active session, centers once, starts team tracking and ACKs within 60 seconds. Terminal session clears shared route without clearing an independent local route.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- --runInBand src/__tests__/journeyNavigation.test.tsx src/__tests__/navigationIntegration.test.tsx`  
Expected: FAIL because the hook still calls `setJourneyTarget` directly.

- [ ] **Step 3: Replace journey mirror writes with session commands**

Keep `groups.journey_status` only as compatibility read data. `useJourneyNavigation` accepts `navigationSession` and command callbacks; optimistic state keys by session request ID and rolls back on RPC error. `useGroupState` subscribes to `navigation_sessions` and `navigation_member_states` rather than inferring new sessions from the group mirror.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- --runInBand src/__tests__/journeyNavigation.test.tsx src/__tests__/navigationIntegration.test.tsx src/__tests__/groupStatePatches.test.ts`  
Expected: PASS.

```powershell
git add -- apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts apps/mobile/src/screens/MapScreen.tsx apps/mobile/src/state/useGroupState.ts apps/mobile/src/__tests__/journeyNavigation.test.tsx apps/mobile/src/__tests__/navigationIntegration.test.tsx
git commit -m "feat: drive team navigation from sessions"
```

### Task 7: ActivityKit push-to-start and token lifecycle

**Files:**
- Modify: `apps/mobile/modules/hither-live-activity/ios/HitherLiveActivityModule.swift`
- Modify: `apps/mobile/src/native/liveActivity.ts`
- Modify: `apps/mobile/src/state/useLiveActivity.ts`
- Modify: `apps/mobile/src/api/services/LiveActivityService.ts`
- Modify: `apps/mobile/src/__tests__/liveActivityContract.test.ts`
- Create: `apps/mobile/src/__tests__/activityTokenService.test.ts`

**Interfaces:**
- Produces event: `onPushToStartToken({ token: string | null })`
- Produces event: `onPushToken({ activityId, pushToken })`
- Produces: `upsertDeviceActivityToken(deviceId, pushToStartToken, enabled)`

- [ ] **Step 1: Write failing JS/native contract tests**

Assert Swift contains `Activity<HitherGroupAttributes>.pushToStartTokenUpdates`, availability `iOS 17.2`, both event names, and startup observation. Service tests assert null token deletes/deactivates the previous row and token rotation upserts by `(user_id, device_id)`.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- --runInBand src/__tests__/liveActivityContract.test.ts src/__tests__/activityTokenService.test.ts`  
Expected: FAIL because push-to-start observation is absent.

- [ ] **Step 3: Implement token observation**

Swift starts one retained `Task` for push-to-start updates, emits the current token and every rotation, and cancels it in module teardown. Existing per-activity token observation remains. JS registers once in `useLiveActivity`, derives a stable device ID from SecureStore, and sends token plus `liveActivitiesEnabled` to Supabase.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- --runInBand src/__tests__/liveActivityContract.test.ts src/__tests__/activityTokenService.test.ts`  
Expected: PASS.  
Run: `npm run typecheck`  
Expected: PASS.

```powershell
git add -- apps/mobile/modules/hither-live-activity/ios/HitherLiveActivityModule.swift apps/mobile/src/native/liveActivity.ts apps/mobile/src/state/useLiveActivity.ts apps/mobile/src/api/services/LiveActivityService.ts apps/mobile/src/__tests__/liveActivityContract.test.ts apps/mobile/src/__tests__/activityTokenService.test.ts
git commit -m "feat: register activitykit push-to-start tokens"
```

### Task 8: APNs start/update/end orchestration

**Files:**
- Modify: `supabase/functions/send-push/apns.ts`
- Modify: `supabase/functions/send-push/messages.ts`
- Modify: `supabase/functions/send-push/index.ts`
- Create: `apps/mobile/src/__tests__/navigationPushContract.test.ts`

**Interfaces:**
- Consumes: Task 1 `device_live_activity_tokens` and navigation webhook payload.
- Produces: `buildLiveActivityStartRequest`, existing update/end request, dead-token pruning.

- [ ] **Step 1: Write failing APNs contract tests**

The start body must contain:

```json
{"aps":{"timestamp":1,"event":"start","attributes-type":"HitherGroupAttributes","attributes":{"groupName":"Trip"},"content-state":{"navigationSessionId":"n1","status":"starting"}}}
```

Assert headers use `liveactivity`, production host and `${bundleId}.push-type.liveactivity`; start targets `push_to_start_token`, update/end target activity update token; 410 deactivates only the matching token.

- [ ] **Step 2: Run failing test**

Run: `npm test -- --runInBand src/__tests__/navigationPushContract.test.ts`  
Expected: FAIL because `LiveActivityPayload.event` excludes `start`.

- [ ] **Step 3: Implement navigation_session category**

On active session INSERT, load eligible group members and their push-to-start tokens, send ActivityKit start, and send a normal alert only to members without usable ActivityKit token. On versioned active UPDATE send content update; terminal status sends end. Reuse `providerToken`, `resultFromResponse`, membership scope and notification preference filtering.

- [ ] **Step 4: Run function contract tests and commit**

Run: `npm test -- --runInBand src/__tests__/navigationPushContract.test.ts src/__tests__/productionPushMigration.test.ts`  
Expected: PASS.

```powershell
git add -- supabase/functions/send-push/apns.ts supabase/functions/send-push/messages.ts supabase/functions/send-push/index.ts apps/mobile/src/__tests__/navigationPushContract.test.ts
git commit -m "feat: orchestrate navigation live activity pushes"
```

### Task 9: MetricKit native spool and JS ingestion

**Files:**
- Create: `apps/mobile/modules/hither-metrics/expo-module.config.json`
- Create: `apps/mobile/modules/hither-metrics/ios/HitherMetricsModule.swift`
- Create: `apps/mobile/modules/hither-metrics/android/src/main/java/expo/modules/hithermetrics/HitherMetricsModule.kt`
- Create: `apps/mobile/src/native/metrics.ts`
- Modify: `apps/mobile/src/native/index.ts`
- Modify: `apps/mobile/App.tsx`
- Create: `apps/mobile/src/__tests__/metricKitContract.test.ts`

**Interfaces:**
- Produces: `metrics.drainPayloads(): Promise<Array<{id:string;kind:'metric'|'diagnostic';json:string;receivedAt:number}>>`
- Produces: `metrics.removePayloads(ids: string[]): Promise<void>`

- [ ] **Step 1: Write failing native contract test**

Assert the Swift module imports MetricKit, conforms to `MXMetricManagerSubscriber`, registers on module creation, handles both `didReceive payloads: [MXMetricPayload]` and diagnostics, writes atomic JSON files under Application Support, caps files at 20, and unregisters on destroy.

- [ ] **Step 2: Run failing test**

Run: `npm test -- --runInBand src/__tests__/metricKitContract.test.ts`  
Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement native spool and startup drain**

Use `payload.jsonRepresentation()` and `diagnosticPayload.jsonRepresentation()`. Write each payload with `Data.write(options: .atomic)`. `App.tsx` drains files after session initialization, writes redacted metadata into diagnostics SQLite, uploads raw MetricKit JSON to `metric_payloads`, then removes only acknowledged file IDs. Android module returns an empty array.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- --runInBand src/__tests__/metricKitContract.test.ts`  
Expected: PASS.  
Run: `npm run typecheck`  
Expected: PASS.

```powershell
git add -- apps/mobile/modules/hither-metrics apps/mobile/src/native/metrics.ts apps/mobile/src/native/index.ts apps/mobile/App.tsx apps/mobile/src/__tests__/metricKitContract.test.ts
git commit -m "feat: collect metrickit payloads"
```

### Task 10: Privacy controls and diagnostic overlay

**Files:**
- Modify: `apps/mobile/src/state/PreferencesContext.tsx`
- Modify: `apps/mobile/src/screens/MapScreen/components/SettingsOverlay.tsx`
- Create: `apps/mobile/src/screens/MapScreen/components/DiagnosticsOverlay.tsx`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Modify: `apps/mobile/src/i18n/index.ts`
- Create: `apps/mobile/src/__tests__/diagnosticsUiContract.test.ts`

**Interfaces:**
- Produces preference: `sharingEnabled: boolean` persisted as `pref.sharingEnabled`, default `true` for existing users.
- Consumes: Task 4 summary/export and Task 2 session/member state.

- [ ] **Step 1: Write failing UI contract test**

Assert Settings contains location sharing switch and diagnostic row; turning sharing off calls `stopBackgroundJourney`, `purgeLocationOutbox` and ACKs `sharing_disabled`. Diagnostic overlay renders build/session/mode/callback/upload/error/Live Activity fields and calls `Sharing.share({ message: json })` on export.

- [ ] **Step 2: Run failing test**

Run: `npm test -- --runInBand src/__tests__/diagnosticsUiContract.test.ts`  
Expected: FAIL because controls do not exist.

- [ ] **Step 3: Implement settings and overlay**

Show diagnostics when `EXPO_PUBLIC_DIAGNOSTICS_ENABLED === 'true'` or `__DEV__`. Production minimal mode keeps the support row hidden. The share switch warning states that disabling stops team position updates but local map navigation remains available.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- --runInBand src/__tests__/diagnosticsUiContract.test.ts src/__tests__/mapUiContracts.test.ts`  
Expected: PASS.

```powershell
git add -- apps/mobile/src/state/PreferencesContext.tsx apps/mobile/src/screens/MapScreen/components/SettingsOverlay.tsx apps/mobile/src/screens/MapScreen/components/DiagnosticsOverlay.tsx apps/mobile/src/screens/MapScreen.tsx apps/mobile/src/i18n/index.ts apps/mobile/src/__tests__/diagnosticsUiContract.test.ts
git commit -m "feat: add location privacy and diagnostics ui"
```

### Task 11: Diagnostic EAS profile and full completion audit

**Files:**
- Modify: `apps/mobile/eas.json`
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/src/__tests__/productionConfig.test.ts`
- Create: `docs/testflight/team-navigation-test-matrix.md`

**Interfaces:**
- Produces EAS profile: `diagnostic` store distribution, channel `diagnostic`, full diagnostics.
- Preserves production profile: store distribution, channel `production`, minimal diagnostics, autoIncrement.

- [ ] **Step 1: Write failing config tests**

```ts
expect(eas.build.diagnostic.env.EXPO_PUBLIC_DIAGNOSTICS_ENABLED).toBe('true');
expect(eas.build.production.env.EXPO_PUBLIC_DIAGNOSTIC_LEVEL).toBe('minimal');
expect(app.expo.ios.infoPlist.NSSupportsLiveActivitiesFrequentUpdates).toBe(true);
```

- [ ] **Step 2: Run failing test**

Run: `npm test -- --runInBand src/__tests__/productionConfig.test.ts`  
Expected: FAIL because diagnostic profile is absent.

- [ ] **Step 3: Add profiles and the exact A–L physical-device matrix**

The matrix covers hidden/passive/foreground/teamNavigation/navigationMax, Wi-Fi/5G/offline, lock screen, force quit, permission denied, sharing disabled, push-to-start, update/end, two-fix arrival, outbox retry, JSON export and MetricKit next-day delivery. Each row records build, iOS, device, duration, callback count, upload count, errors and battery delta.

- [ ] **Step 4: Run complete local verification**

Run: `npm ci --include=dev --ignore-scripts`  
Expected: lockfile installs cleanly.  
Run: `npm test -- --runInBand`  
Expected: all suites pass.  
Run: `npm run typecheck`  
Expected: PASS.  
Run: `npm run lint`  
Expected: no errors.  
Run: `npx expo-doctor`  
Expected: no dependency/config incompatibilities.  
Run: `npx supabase db reset --local` and `npx supabase test db --local supabase/tests`  
Expected: migrations and pgTAP pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/mobile/eas.json apps/mobile/app.json apps/mobile/src/__tests__/productionConfig.test.ts docs/testflight/team-navigation-test-matrix.md
git commit -m "build: add diagnostic testflight profile"
```

### Task 12: Remote deploy, release commit/push, EAS Build and Submit

**Files:**
- No new product files unless verification exposes a defect.
- Preserve: `scripts/task-end-ship.sh` user modification.

**Interfaces:**
- Consumes: all previous tasks and explicit user authorization for remote Supabase/EAS/TestFlight operations.
- Produces: pushed feature branch, merged target branch, deployed migration/function, successful iOS build URL and TestFlight submission ID.

- [ ] **Step 1: Follow `hither-commit-push-ota` scope audit**

Run `git status --short`, `git diff --check`, `git diff --stat`, `git log -1 --oneline`, and verify only task files are staged. Native module/package/app/eas changes make the release OTA-ineligible.

- [ ] **Step 2: Dry-run and deploy Supabase**

Run: `npx supabase db push --linked --dry-run`  
Expected: only the team-navigation migration is pending.  
Run: `npx supabase db push --linked`  
Expected: migration applied.  
Run: `npx supabase functions deploy send-push --use-api`  
Expected: function deployed.  
Run security/performance advisors and resolve every new ERROR/WARN caused by this migration.

- [ ] **Step 3: Push and integrate Git refs**

Push the feature branch, merge/checkpoint into the release target according to `hither-commit-push-ota`, push the target, and verify local/remote SHA equality. Do not stage `scripts/task-end-ship.sh`.

- [ ] **Step 4: Build and submit iOS production**

Run from `apps/mobile`:

```powershell
npx eas-cli@latest build -p ios --profile production --non-interactive --wait
npx eas-cli@latest submit -p ios --profile production --latest --non-interactive --wait
```

Expected: EAS build finishes, App Store Connect accepts the binary, and submission reaches TestFlight processing. Capture build URL, build number and submission URL/ID.

- [ ] **Step 5: Final completion audit**

For each Phase 1–6 item, point to the migration, TypeScript/Swift implementation, focused test and final command output. Mark unverified physical-device behavior explicitly as TestFlight matrix work; do not claim it passed without device evidence. Confirm there is no OTA publish because runtime/native files changed.

---

## Self-review result

- Spec coverage: Phase 1 is Tasks 3/5/10; Phase 2 is Tasks 1/2/6; Phase 3 is Tasks 7/8; Phase 4 is Task 5; Phase 5 is Tasks 5/8; Phase 6 is Tasks 4/9/10/11. Remote deployment and TestFlight are Task 12.
- Known external boundary: Location Push Service Extension remains gated by Apple-granted `com.apple.developer.location.push`; silent/background refresh is fully implemented without claiming that entitlement.
- Type consistency: navigation session/member states, location event and diagnostic interfaces have one owner file and one consumer path.
- Placeholder scan: no deferred implementation markers are present; every task has exact files, commands, expected outcomes and commit scope.
