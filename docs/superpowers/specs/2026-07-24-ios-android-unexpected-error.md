# iOS／Android「Something went wrong」React render error 與 Supabase 關聯 Spec

**Status:** diagnosis-complete; implementation-not-started

## Problem Statement

使用者在 iOS 看到：

> Something went wrong
> The screen hit an unexpected error. You can try again.

並被要求 Retry。使用者表示過去沒有發生，Android 可能有相似症狀。這個畫面是目前 root React Error Boundary 的 fallback，不代表 Supabase 本身掛掉，也不代表 native crash 已被攔截。

截至 2026-07-24 的證據：

- Supabase project htqrucnjafhhvxdqslbv 在 2026-07-24 08:18:26.2 UTC 記錄 1 筆 error.react_render。
- 事件為 app/runtime 0.1.3、isFatal=false、exceptionKind=Error、stackHash=37a18da1、lastScreen=unknown、errorCode=unclassified_error。
- 最近 30 天目前只查到這 1 筆 React render error；沒有足夠證據宣稱 Android 已發生同一類事件。
- 同一時間窗另有 PostgreSQL「leader role required」、Google Maps Edge Function 503、Live Activity token 409，但現有 telemetry 沒有 request/action correlation，不能證明它們是同一根因。
- 現有 app code 已有 root boundary、retry remount、performance outbox 與 shared UI action runner，但 screen/route/action/component context 不完整；setLastScreenName 尚未接到導航，UI action 的 actionId/screen 欄位也會在 sanitized payload 階段遺失。

目前可以定位為「iOS 發生 React render error，且 fallback 成功顯示」，但尚不能定位到實際 component、觸發操作或 Supabase request。

## Solution

在不新增 crash SDK、不先切換 Hermes/JSC、Google Maps renderer 或導航框架的前提下，建立跨 iOS/Android 的可驗證錯誤定位與恢復流程：

1. 以現有 root Error Boundary、performance outbox、shared UI action runner 與既有 Supabase client/Edge Function error handling 為最高測試 seam。
2. 補齊 sanitized correlation：screen、route name/key、actionId、request operation/status/error code、OTA update/runtime、device/OS，以及 component stack hash；禁止 token、使用者 ID、精確座標、原始 response、完整 stack。
3. 將 React render error、event-handler/action error、Supabase API/RPC error、Edge Function 5xx、Map surface failure、native crash/ANR 分類，不互相假設。
4. 對 leader-only RPC 與 Google Maps 503 等已觀察候選訊號建立明確錯誤分類與可恢復 UI；預期授權失敗不得把畫面變成空白或 root render fallback。
5. 以 iOS 原始裝置與 Android Pixel 實機重現同一組 flow，保留 route state、screen/action breadcrumb、Supabase correlation、logcat/crash buffer/exit-info，分辨 React-tree、Map-only、overlay/loading 與整個 Activity 的失敗。
6. Retry 必須是有限且可驗證的 recovery；不得用無限 remount、週期性 MapView remount 或全域吞錯掩蓋 native crash/ANR。

## User Stories

1. As an iOS user, I want the app to show a recoverable error surface instead of a blank or frozen screen, so that I can continue using the app.
2. As an Android user, I want the same failure categories and recovery behavior, so that platform differences do not change whether the app is usable.
3. As a user who taps Retry, I want the retry to rebuild only the failed React flow, so that existing group/session data is not silently discarded.
4. As a user, I want a network or Supabase authorization failure to remain an actionable error, so that I can retry or cancel without losing the current screen.
5. As a user, I want the app to distinguish a map-only failure from a whole-screen failure, so that I can still use available controls or return home.
6. As a user, I want duplicate taps to result in one side effect, so that navigation, group changes, alerts, and submissions are not duplicated.
7. As a user, I want a timed-out action to stop showing a permanent spinner, so that I know the operation can be retried.
8. As a user, I want a failed action to preserve data already shown on screen, so that a transient backend failure does not erase my current group state.
9. As a leader, I want leader-only operations to be validated against the current group role, so that a stale group selection does not produce an opaque generic error.
10. As a follower, I want leader-only controls and background effects not to invoke leader-only RPCs, so that I do not see an irrelevant error.
11. As a user, I want a Google Maps proxy failure to be reported as a map/search/network problem, so that it is not misrepresented as an app-wide render failure.
12. As a user, I want a Live Activity token conflict to be non-fatal when the rest of the map flow is healthy, so that notification registration does not replace the main screen.
13. As a developer, I want each render error to include a sanitized component-stack fingerprint, so that the failing component can be identified without uploading raw stacks.
14. As a developer, I want each error to include the current screen, route, route key, action, update ID, runtime, device model, and OS version, so that regressions can be grouped by release and flow.
15. As a developer, I want Supabase request failures to include a safe operation name, HTTP status, RPC/function name, and database error code, so that backend and frontend events can be correlated.
16. As a developer, I want the telemetry payload to preserve safe correlation fields during sanitization, so that the data visible in Supabase matches the fields emitted by the app.
17. As a developer, I want expected authorization and transient network errors to be classified separately from unexpected render errors, so that triage does not chase the wrong subsystem.
18. As a developer, I want iOS and Android test runs to capture the same evidence set, so that a platform-specific regression can be compared against a control run.
19. As a developer, I want native crash and ANR evidence to remain separate from JavaScript recovery telemetry, so that a Retry screen is not treated as proof that a native issue is fixed.
20. As a release owner, I want a release gate for this flow, so that a new OTA/update cannot ship a regression without evidence from both platforms.
21. As a release owner, I want the error cluster to be tied to an OTA update/runtime version, so that rollback or rollout narrowing can be considered safely.
22. As a tester, I want the map → menu/settings → home → create/join → map re-entry flow to be repeatable, so that route-stack and native surface regressions can be reproduced.
23. As a tester, I want offline, slow-network, role mismatch, foreground/background, and theme-change cases covered, so that transient state races are not mistaken for random crashes.
24. As a tester, I want a retry/cancel assertion after every error class, so that the test proves recovery rather than only error detection.

## Implementation Decisions

- Reuse the existing root React Error Boundary, shared UI action runner, performance outbox, diagnostic consent/batch upload, React Navigation, Supabase client, Google Maps Edge Function, and existing map lifecycle hooks.
- Use one shared sanitized error context model across iOS and Android. The model must carry only bounded, allow-listed fields.
- Wire screen and route breadcrumbs at the highest stable navigation boundary instead of adding per-component manual logging.
- Preserve an action correlation ID from the shared UI action runner through performance recording and any Supabase request trace initiated by that action.
- Preserve a safe Supabase operation name, RPC/Edge Function name, HTTP status, database error code, and outcome. Do not persist raw error text, tokens, user identifiers, coordinates, or complete stack traces.
- Derive a bounded component-stack fingerprint from React ErrorInfo and keep the existing error stack hash for clustering. The fingerprint must not contain raw source text or the full component stack.
- Classify failures into render, action, timeout, API/RPC, Edge Function, map surface, native crash, and ANR. A single event may include a parent correlation ID but must not be collapsed into one generic error.
- Keep the existing leader-only authorization contract for straggler reporting. Add client-side role/group correlation and safe handling so a leader role required response is diagnosable and cannot escalate to root render fallback.
- Keep Google Maps 503 handling at the map/search boundary. Do not switch renderer or add a retry loop until native and request evidence shows that is required.
- Keep root retry and map-local recovery finite and observable. A retry must emit a new event linked to the original error and must not clear memberships or active group data by default.
- Use the existing performance_events storage path unless the current payload constraints make the required safe fields impossible. Avoid a schema change if an allow-list/client change is sufficient.
- Add only the minimum contract tests needed for sanitized context preservation, route/action correlation, error classification, and finite recovery. Use existing action, error-boundary, map lifecycle, and performance regression test patterns.
- For release verification, use a TestFlight iOS build on the affected original device class and a release-like Android Pixel build. Simulator/emulator results remain supplementary.

## Testing Decisions

- Test external behavior and telemetry contracts, not implementation details.
- Add or extend a root error-boundary contract that verifies a render error produces a visible fallback, a bounded sanitized event, a component/route context, and a retry event linked to the original error.
- Add or extend a shared UI action contract covering sync throw, rejected Promise, timeout, duplicate tap, finally cleanup, stale result, retry, and cancellation.
- Add an API/RPC classification contract covering leader-role rejection, Google Maps 503, Live Activity token conflict, and ordinary successful requests.
- Add a navigation breadcrumb contract covering screen/route updates and map re-entry with only one current Map route.
- Add a sanitizer contract proving safe correlation fields survive and forbidden data is dropped.
- Add a map lifecycle contract covering mount, ready, loaded, unmount, surface failure, one user retry, and terminal fallback without timer remount.
- Use the existing performance/error contract tests and map/performance regression tests as prior art.
- On iOS and Android, run the same scripted flow at least 10 times for re-entry, main actions, retry/cancel, foreground/background, and offline recovery; capture logs and screen classification for every failed run.
- Treat native crash, ANR, Activity exit, and frozen frames as separate failures; a visible Retry screen cannot satisfy those gates.
- Acceptance target: no unexplained root render error in the release-gate run, no permanent loading after timeout, no duplicate side effect, no multiple current Map routes, and no native crash/ANR.

## Out of Scope

- Proving that Supabase itself is the root cause from the current logs alone.
- Treating the single error.react_render event as proof that the Google Maps 503, Live Activity 409, or leader role required event caused the screen fallback.
- Replacing Hermes, enabling/disabling New Architecture, changing Google Maps renderer, changing Play Services, or changing iOS native runtime without device evidence.
- Adding a new crash analytics SDK, a second telemetry pipeline, a new state-management library, or a new navigation framework.
- Rewriting every UI callback when the existing shared action boundary covers the behavior.
- Uploading raw exception messages, full stacks, component source paths, access tokens, user IDs, exact coordinates, or raw API responses.
- Claiming Android is fixed, iOS is fixed, or native crash/ANR is resolved without the required real-device evidence.
- Broad schema redesign or historical backfill unless the existing performance_events contract cannot carry the bounded fields.

## Further Notes

The strongest current conclusion is: the user-visible screen was produced by a non-fatal React render error in app/runtime 0.1.3, and Supabase received the corresponding telemetry. Exact component/root cause is currently unresolvable because lastScreen is unknown, the component stack is absent, and action/request correlation is missing.

The same-second PostgreSQL leader role required and nearby Google Maps 503/Live Activity token 409 should be retained as investigation signals, not asserted as causality. The first implementation slice should make the next occurrence locally attributable before changing backend authorization or native rendering.

Future direction: aggregate error clusters by update/runtime, screen/route, action, device/OS, and native surface; then use staged OTA rollout and platform-specific release gates.

Future risks: the current telemetry allow-list can silently discard new context fields; a non-cancellable Promise can still complete after timeout; React Error Boundary cannot catch event-handler exceptions, native crashes, or ANRs; iOS Hermes/runtime regressions and Android map/GPU failures may require native evidence rather than more JavaScript retries.

## Execution boundary

This document is the diagnosis and implementation specification only. No application
code, Supabase schema, OTA, GitHub issue, or tracker ticket is changed by this phase.
The implementation must remain local until the ticket acceptance criteria pass.

## Evidence classification

### Confirmed

- The user-visible fallback is produced by the root React Error Boundary. The
  recorded event was `error.react_render`, `isFatal=false`, `exceptionKind=Error`,
  `errorCode=unclassified_error`, `lastScreen=unknown`, and update `019f92dd-2f21-7a79-99e5-ae982c0ea175`.
- `lastScreen=unknown` is a telemetry defect: the app defines `setLastScreenName`,
  but the navigation container does not currently call it.
- The error record has no component stack, raw error message, source frame,
  action correlation, or Supabase request correlation. The existing hash cannot
  identify the failing component by itself.
- Supabase/PostgREST errors are commonly returned as a resolved result with an
  `error` member. The current API trace path records rejected promises only;
  therefore a resolved RPC error can be absent from performance error events.
- The current allow-list drops emitted `actionId`, `screen`, `requestId`, and
  several source/context fields before they reach `performance_events`.

### Correlated but not proven causal

- A PostgreSQL `leader role required` event occurred in the same investigation
  window. The call site already catches this straggler-report rejection, so the
  event is a likely authorization/state-race signal, not proof of the root
  render failure.
- Google Maps Edge Function 503 responses occurred nearby. The map layer already
  falls back for these responses, so they remain an upstream dependency signal,
  not proof of the root render failure.
- `device_live_activity_tokens_token` duplicate-key 409s occurred nearby. They
  should be classified as registration/idempotency failures and must not be
  treated as a React render cause without a correlated stack and route.

### Not inferable from current data

- The exact React component, source line, or render input that produced
  `stackHash=37a18da1`.
- Whether iOS, Android, OTA update code, map rendering, auth state, or a backend
  response is the initiating cause.
- Whether Android has a native crash or ANR; the current event is JavaScript
  telemetry and does not prove native health.

## Detailed implementation order

1. Expand the existing bounded telemetry contract. Preserve route name/key,
   current screen, UI action ID, request ID, operation name, HTTP status, RPC
   code, update/runtime/build context, error message/details/hint, source frame,
   React component stack, and parent trace ID. Redact credentials, UUIDs,
   coordinates, URLs with query strings, and unbounded values before the SQLite
   outbox write.
2. Record the deepest active React Navigation route on ready and state change.
   Pass React `ErrorInfo.componentStack` from both the root and map-local
   boundaries into the same sanitizer. Keep the existing fingerprint for
   grouping, but add bounded human-readable source breadcrumbs for direct
   localization.
3. Change the shared Supabase trace boundary to classify both rejected network
   promises and resolved `{ error }` responses. Record operation, RPC/table
   name, status, code, message, details, duration, route, and action context.
   Keep the original response behavior unchanged so service-level `orThrow`
   semantics remain intact.
4. Add explicit classification at the Google Maps proxy and Live Activity
   registration boundaries. Preserve existing fallback/idempotency behavior;
   only prevent these expected upstream conflicts from being mistaken for root
   render failures.
5. Keep the root Retry and map-local recovery behavior finite. Add telemetry for
   the original failure and the retry/cancel outcome. Do not clear auth,
   membership, or active group state as part of recovery.
6. Add contract tests for allow-list retention/redaction, route/action
   propagation, resolved Supabase errors, rejected network errors, component
   stack capture, and classification of 403/503/409 responses.
7. Verify the same scripted flows on iOS and Android emulator/release-like
   builds. Real-device evidence is only a follow-up gate if logs show native
   crash, ANR, GPU/renderer, or OS-specific behavior; it is not required to
   validate this JavaScript telemetry and recovery change.

## Definition of done

The next occurrence of the fallback must produce one searchable error cluster
whose event contains `updateId`, `runtimeVersion`, `routeName`, `lastScreen`,
`actionId` when applicable, `supabaseOperation` when applicable, `supabaseCode`
or `httpStatus` when applicable, `errorMessage`, `errorFrames` or
`componentStack`, and `stackHash`. A maintainer must be able to identify the
failing subsystem and source breadcrumb from Supabase without reproducing the
failure first.
