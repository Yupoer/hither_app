# Hither 導航效能、耗電與發熱優化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不犧牲使用者本機定位即時性與抵達判定準確度的前提下，移除導航期間不必要的 GPS、網路、SQLite、Log 與 React Native bridge 工作，將 90 分鐘實機導航的耗電、發熱和資源使用降至可驗收範圍。

**Architecture:** 前景地圖沿用現有 MapKit `showsUserLocation` 原生藍點，並把 `onUserLocationChange` 當作前景唯一定位來源，停止第二條 `expo-location.watchPositionAsync`。背景沿用既有 Expo/Core Location task，但改成 walking/fitness activity、允許系統自動暫停，且不再預設使用 `BestForNavigation`。定位上傳、diagnostics 與 performance telemetry 分離：位置資料可以準時送出，診斷與效能資料必須低頻批次送出，永久拒絕事件不可重試。

**Tech Stack:** Expo SDK 54、React Native 0.81、react-native-maps 1.20.1（iOS MapKit）、expo-location 19、Expo TaskManager、Expo SQLite、Supabase/PostgreSQL、MetricKit、Jest。

## Global Constraints

- 不新增地圖、定位、狀態管理或 telemetry dependency。
- iOS 最低版本維持 15.1；Android 行為不可退化，但本計畫的實機耗電驗收先以 iOS 為主。
- 本機位置視覺更新與雲端成員位置上傳是兩條不同 SLO；不可為了讓自己藍點平滑而提高 Supabase 上傳頻率。
- 前景同一時間只能有一個持續定位 owner；背景同一時間只能有既有 `hither-background-journey-location` task。
- 不用 GPS 座標外推製造假位置；平滑顯示只能在真實 fix 之間插值，或使用 MapKit 系統藍點。
- `BestForNavigation` 不得成為 walking/team navigation 預設值；只有明確、短時且有實測必要時才能重新引入。
- 永久拒絕、重複 ID 與無效事件必須視為已處理，不得留在 outbox 反覆上傳。
- Full API tracing 不得用來做耗電驗收；耗電驗收使用低負載 energy samples、MetricKit 與 Instruments。
- 所有改動先以測試證明失敗，再做最小實作；每個 Task 獨立 commit。

---

## 1. 查證結果與根因

### 1.1 Supabase／MetricKit 證據

查詢範圍從 2026-07-18 09:00（Asia/Taipei）開始。以下數字是資料庫實際結果，不是估算：

| 訊號 | 結果 | 判讀 |
|---|---:|---|
| `performance_events` | 753 筆，09:21:42–09:23:49 | 只有約 128 秒有效 trace，不能代表完整 1.5 小時 |
| `destination_arrivals` | 711 次；09:22 單分鐘 332 次、09:23 單分鐘 294 次 | 約 5–6 SELECT/s；是明確 API/SQLite/網路熱點 |
| runtime thermal samples | 2 筆皆 `nominal` | 只能證明該 65 秒沒有升溫，不能證明整段路線 thermal 正常 |
| runtime memory | 106.7 MB → 263.5 MB（約 65 秒） | 增幅異常，但樣本太少；需 Instruments/長時 sample 確認 |
| team navigation accepted uploads | 258 筆，09:33–17:05，平均 105.7 秒/筆 | 雲端更新遠慢於本機藍點；不應拿此頻率驅動自己的位置顯示 |
| team navigation accuracy | 平均 61.7 m、P95 200.7 m | 要求高 accuracy 並沒有換得穩定高品質 fix，仍付出耗電成本 |
| location enqueue | team navigation 477 筆 | outbox 持續累積 |
| location upload attempts | 504 次；失敗 472 次、成功 31 次 | retry 熱點比定位採樣本身更嚴重 |
| outbox 最大 remaining | 316 | 永久拒絕／舊事件未被丟棄，造成長時間 retry |
| MetricKit `BestAccuracyForNavigation` | 4,529 秒（75.5 分鐘） | 幾乎涵蓋整段使用時間，與 1.5 小時快速耗電高度一致 |
| MetricKit background location | 3,139 秒（52.3 分鐘） | 背景定位長時間持續活躍 |
| MetricKit GPU | 5,564 秒（92.7 分鐘） | 地圖/螢幕渲染是另一個主要能源來源 |
| MetricKit CPU | 2,474 秒（41.2 分鐘） | API、JS、SQLite、地圖與 telemetry 疊加 |
| MetricKit logical writes | 1,686,976 kB（約 1.69 GB） | 高頻 SQLite event insert/cleanup/retry 是首要嫌疑 |
| MetricKit Wi‑Fi transfer | upload 153,543 kB、download 86,611 kB | 不符合位置分享應有的資料量；Log/API storm 放大 radio 使用 |
| MetricKit peak memory | 854,516 kB | 必須做 Allocations/VM Tracker 驗證 |
| MetricKit reliability | 1 watchdog、1 memory pressure、2 bad access | 不可只把問題歸類為「稍微發熱」 |

MetricKit payload 是日聚合資料，該筆 `timeStampBegin=2026-07-17 00:00:00`、`timeStampEnd=2026-07-18 00:00:00`；它可證明同一 build/device 的資源風險，但不能逐秒歸因到單一路線。實作後必須用相同裝置、固定亮度與相同路線重新建立可比較樣本。

### 1.2 現有程式根因

1. `GroupMap.tsx` 的 `showsUserLocation` 讓 MapKit 自行啟動 Core Location；`useDeviceLocation.ts` 又啟動 `expo-location.watchPositionAsync`。前景存在兩個持續定位 consumer。
2. `backgroundJourneyController.ts` 把 `teamNavigation` 設成 `Accuracy.Highest`，`navigationMax` 設成 `BestForNavigation`，而 navigation 又把 `pausesUpdatesAutomatically` 設成 `false`，且沒有指定 walking 對應的 `activityType`。
3. `backgroundJourney.ts` 每個接受的 callback 都依序寫多筆 SQLite diagnostics、送 location RPC、再送 diagnostics RPC；位置熱路徑被 telemetry 加倍。
4. `locationOutbox.ts` 忽略 RPC 的 `rejected` 分類。伺服器明確拒絕的事件仍當作 transient failure 重試到 24 小時 TTL。
5. `PerformanceService.ts` 使用普通 `insert`；已存在的 UUID 會讓批次回 409。`performance.ts` 又沒有 retry backoff，5 秒後重送同一批。
6. Full performance tracing 有 30 天 TTL、每 5 秒 flush，且每分鐘跑 5 秒 `CADisplayLink` + JS `requestAnimationFrame` sampler。這會嚴重污染耗電測試本身。
7. 09:21 的 711 次 `destination_arrivals` 發生在 commit `c6e8872`（09:48）以前；目前程式已有 stable translator、single-flight 與 2.5 秒 gate。這一項應做回歸驗證，不重寫已存在的修正。

## 2. 競品與平台做法

### Apple / MapKit / Core Location

- Apple 要求使用「最低足夠 accuracy、最大可接受 distance filter、停止不需要的 location updates、適當 `activityType`、允許自動 pause」；高 accuracy 會同時啟動更多裝置子系統。來源：[Accessing the device’s location efficiently](https://developer.apple.com/documentation/xcode/accessing-the-device-s-location-efficiently)、[Getting the current location of a device](https://developer.apple.com/documentation/CoreLocation/getting-the-current-location-of-a-device)、[activityType](https://developer.apple.com/documentation/CoreLocation/CLLocationManager/activityType)。
- MapKit 的 `showsUserLocation` 自己使用 Core Location，提供系統藍點與原生更新 callback；不需要把每個位置先送到 JS 再畫回地圖。來源：[MKUserLocationView](https://developer.apple.com/documentation/mapkit/mkuserlocationview)、[didUpdateUserLocation](https://developer.apple.com/documentation/mapkit/mkmapviewdelegate/mapview%28_%3Adidupdate%3A%29)。
- Apple 建議批次網路、減少頻繁 radio wakeups，失敗採 exponential backoff。來源：[Reducing networking and Bluetooth power usage](https://developer.apple.com/documentation/xcode/reducing-networking-and-bluetooth-power-usage)。
- Power Profiler 能把 CPU、GPU、display、network power 與程式工作對齊；MetricKit 的 `cumulativeBestAccuracyForNavigationTime` 是實際 best-navigation location 時間。來源：[Analyzing your app’s battery use](https://developer.apple.com/documentation/xcode/analyzing-your-app-s-battery-use)、[Power Profiler](https://developer.apple.com/documentation/xcode/measuring-your-app-s-power-use-with-power-profiler)、[MetricKit location metric](https://developer.apple.com/documentation/metrickit/mxlocationactivitymetric/cumulativebestaccuracyfornavigationtime)。

### Google Maps Navigation

- Google iOS Navigation SDK 使用單一 `GMSRoadSnappedLocationProvider`，同一 provider 同時驅動 road-snapped 藍點與 navigation listener；需要時 `startUpdatingLocation`，離開時明確 `stopUpdatingLocation`。來源：[Road-snapped provider](https://developers.google.com/maps/documentation/navigation/ios-sdk/reference/objc/Classes/GMSRoadSnappedLocationProvider.html)、[Navigation events](https://developers.google.com/maps/documentation/navigation/ios-sdk/events)。
- 依 Google 官方揭露的 provider 架構推論，其「平滑且看起來即時」主要來自 raw location、道路吸附與原生 map location provider 共用，不需要把每個 GPS fix 上傳雲端；至於產品內部是否另有插值，官方文件未完整揭露。官方也明確警告 continuous updates 影響電池。
- Google 的剩餘距離 callback 支援用較大 threshold，接近目的地後再縮小 threshold，避免全程使用相同高頻率。來源：[Navigation SDK FAQ](https://developers.google.com/maps/documentation/navigation/ios-sdk/faq)。

### Mapbox（非 Apple/Google 的可比較方案）

- Mapbox Maps SDK 用一個 `LocationManager` 同時管理 puck 與 follow viewport，並允許覆寫單一 location provider。來源：[Mapbox iOS user location](https://docs.mapbox.com/ios/maps/guides/user-location/)。
- Navigation SDK 把 raw fix 做 route/road matching，再以 enhanced location 驅動 puck；camera bearing smoothing 與 location matching 分開處理。來源：[Mapbox Navigation SDK](https://docs.mapbox.com/ios/navigation/guides/)、[Navigation camera](https://docs.mapbox.com/ios/navigation/guides/map-and-camera/navigation-camera/)。
- 這類 SDK 可以提供 road snapping，但會新增大型 binary、授權/計費、供應商鎖定與遷移成本。Hither 目前是 walking/group navigation，現有 MapKit 原生藍點已能解決「自己位置平滑」；現階段不換 SDK。

### 採用方案

採用「現有 MapKit 單一前景 provider + Core Location adaptive background policy + telemetry cold path」。

不採用：

- 只調整 `timeInterval`：無法解決雙重定位 owner、retry storm、1.69 GB 寫入與 153 MB upload。
- 自行做 Kalman filter / dead reckoning：目前沒有 raw IMU/road graph 驗證，會製造假位置且增加 CPU。
- 直接換 Google/Mapbox Navigation SDK：能做 road snapping，但不是目前耗電根因，改動與依賴成本過大。

---

### Task 1: 讓 performance tracing 不再放大被測問題

**Files:**
- Modify: `apps/mobile/src/api/services/PerformanceService.ts`
- Modify: `apps/mobile/src/state/performance.ts`
- Modify: `apps/mobile/src/__tests__/performanceFlush.test.ts`
- Modify: `apps/mobile/src/__tests__/performanceTracingContract.test.ts`

**Interfaces:**
- Consumes: existing `PerformanceUploadRecord[]`.
- Produces: idempotent `uploadPerformanceBatch(records): Promise<string[]>` and sampled success traces; error traces remain unsampled.

- [ ] **Step 1: Write failing tests for duplicate-safe upload and bounded tracing**

In `performanceTracingContract.test.ts`, assert the uploader uses idempotent upsert and the hot-path constants are bounded:

```ts
const service = readFileSync(
  join(__dirname, '../api/services/PerformanceService.ts'),
  'utf8',
);
const performance = readFileSync(
  join(__dirname, '../state/performance.ts'),
  'utf8',
);

it('acknowledges duplicate performance ids without a 409 retry loop', () => {
  expect(service).toContain(".upsert(");
  expect(service).toContain("onConflict: 'id'");
  expect(service).toContain('ignoreDuplicates: true');
});

it('keeps full tracing short and samples successful API spans', () => {
  expect(performance).toContain('TRACE_TTL_MS = 2 * 60 * 60 * 1_000');
  expect(performance).toContain('SUCCESS_TRACE_MIN_INTERVAL_MS = 10_000');
  expect(performance).toContain('SAMPLE_WINDOW_MS = 1_000');
  expect(performance).toContain('SAMPLE_INTERVAL_MS = 5 * 60_000');
  expect(performance).toContain('FLUSH_DELAY_MS = 60_000');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd apps/mobile
npm test -- --runInBand src/__tests__/performanceTracingContract.test.ts src/__tests__/performanceFlush.test.ts
```

Expected: FAIL because upload currently uses `insert`, full tracing lasts 30 days, success spans are unbounded, sampling runs 5 seconds per minute, and flush delay is 5 seconds.

- [ ] **Step 3: Make performance upload idempotent**

Replace the insert in `PerformanceService.ts` with:

```ts
const { error } = await baseSupabase.from('performance_events').upsert(
  records.map((record) => ({
    id: record.id,
    user_id: userId,
    session_id: record.sessionId,
    occurred_at: new Date(record.timestamp).toISOString(),
    event_type: record.eventType,
    operation: record.operation,
    payload: record.payload,
  })),
  { onConflict: 'id', ignoreDuplicates: true },
);
orThrow(error);
return records.map((record) => record.id);
```

Duplicate rows are already durable, so returning all input IDs is correct and removes them from the local queue.

- [ ] **Step 4: Bound tracing overhead**

In `performance.ts`, use:

```ts
const TRACE_TTL_MS = 2 * 60 * 60 * 1_000;
const SUCCESS_TRACE_MIN_INTERVAL_MS = 10_000;
const SAMPLE_WINDOW_MS = 1_000;
const SAMPLE_INTERVAL_MS = 5 * 60_000;
const FLUSH_DELAY_MS = 60_000;
const lastSuccessTraceAt = new Map<string, number>();

function shouldRecordSuccess(operation: string, now: number): boolean {
  const last = lastSuccessTraceAt.get(operation) ?? 0;
  if (now - last < SUCCESS_TRACE_MIN_INTERVAL_MS) return false;
  lastSuccessTraceAt.set(operation, now);
  return true;
}
```

Change `scheduleFlush()` to use `FLUSH_DELAY_MS`. In `traceApi`, always record failures, but only record successful spans when `shouldRecordSuccess(operation, Date.now())` returns true. In `startPerformanceMonitor`, replace `60_000` with `SAMPLE_INTERVAL_MS`.

Move retention cleanup out of every `insertEvent`; run it at initialization and no more than once every 15 minutes. One sampled event should cause one insert, not one insert plus two deletes.

- [ ] **Step 5: Run tests**

Run:

```bash
cd apps/mobile
npm test -- --runInBand src/__tests__/performanceTracingContract.test.ts src/__tests__/performanceFlush.test.ts
npm run typecheck
```

Expected: both suites PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api/services/PerformanceService.ts apps/mobile/src/state/performance.ts apps/mobile/src/__tests__/performanceFlush.test.ts apps/mobile/src/__tests__/performanceTracingContract.test.ts
git commit -m "fix: bound navigation performance tracing overhead"
```

---

### Task 2: 終止 location outbox 永久重試並移除 callback telemetry storm

**Files:**
- Modify: `apps/mobile/src/state/locationOutbox.ts`
- Modify: `apps/mobile/src/state/backgroundJourney.ts`
- Modify: `apps/mobile/src/screens/MapScreen/hooks/useDeviceLocation.ts`
- Modify: `apps/mobile/src/__tests__/locationOutbox.test.ts`
- Modify: `apps/mobile/src/__tests__/backgroundJourney.test.ts`

**Interfaces:**
- Produces: `LocationFlushResult { sent, discarded, remaining, retryScheduled }`.
- Permanent RPC `rejected` IDs are deleted; only thrown transport/auth/service failures receive exponential backoff.
- Diagnostics no longer flush from every background location callback.

- [ ] **Step 1: Write failing tests for terminal rejects**

Add to `locationOutbox.test.ts`:

```ts
it('deletes permanent RPC rejects and retries only transport failures', async () => {
  const database = new MemoryLocationOutboxDatabase();
  const upload = jest.fn(async (events: LocationUploadEvent[]) => ({
    acceptedIds: [events[0]!.id],
    rejected: [{ id: events[1]!.id, reason: 'invalid_event' }],
  }));
  const outbox = createLocationOutbox(database, upload, () => 10_000);
  await outbox.enqueue(event({ id: '00000000-0000-4000-8000-000000000001' }));
  await outbox.enqueue(event({ id: '00000000-0000-4000-8000-000000000002' }));

  await expect(outbox.flush()).resolves.toEqual({
    sent: 1,
    discarded: 1,
    remaining: 0,
    retryScheduled: 0,
  });
  expect(database.entries.size).toBe(0);
});
```

Update the existing offline test to expect `retryScheduled: 1` and `discarded: 0`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd apps/mobile
npm test -- --runInBand src/__tests__/locationOutbox.test.ts src/__tests__/backgroundJourney.test.ts
```

Expected: FAIL because rejected IDs are currently retried and the result type has only `sent/remaining`.

- [ ] **Step 3: Classify accepted, discarded and retryable rows**

Add:

```ts
export interface LocationFlushResult {
  sent: number;
  discarded: number;
  remaining: number;
  retryScheduled: number;
}
```

Inside `flush`, preserve whether `upload()` threw. When RPC returns normally, put every `result.rejected[].id` that belongs to the due batch into `discardedIds`; pass accepted plus discarded IDs to `database.resolveBatch` for deletion. Only rows not accepted/rejected after a thrown request are backoff candidates.

Use `MAX_BATCH = 50` so one successful radio wake drains accumulated rows in one request. Keep the existing 15-minute maximum backoff and 24-hour TTL.

- [ ] **Step 4: Remove diagnostics from the hot callback path**

In `backgroundJourney.ts`:

- Keep `location_callback` only for error callbacks; production minimal mode already suppresses normal callbacks.
- Remove `location_upload_started` and per-callback `location_upload_succeeded` writes.
- Write `location_upload_failed` only when `retryScheduled > 0`.
- Write one `location_upload_discarded` event when `discarded > 0`, including `count` and `remaining`.
- Remove `await diagnostics.flush()` from the background callback. Diagnostics flush stays on foreground resume and explicit「同步資料庫」流程.

The decision block becomes:

```ts
const upload = await flushLocationOutbox();
if (upload.retryScheduled > 0) {
  await diagnostics.write({
    event: 'location_upload_failed',
    navigationSessionId: config.navigationSessionId,
    count: upload.retryScheduled,
    remaining: upload.remaining,
    errorCode: 'retry_scheduled',
    sequence,
  });
} else if (upload.discarded > 0) {
  await diagnostics.write({
    event: 'location_upload_discarded',
    navigationSessionId: config.navigationSessionId,
    count: upload.discarded,
    remaining: upload.remaining,
    errorCode: 'permanent_reject',
    sequence,
  });
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd apps/mobile
npm test -- --runInBand src/__tests__/locationOutbox.test.ts src/__tests__/backgroundJourney.test.ts src/__tests__/diagnostics.test.ts src/__tests__/uploadLocalLogs.test.ts
npm run typecheck
```

Expected: PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/state/locationOutbox.ts apps/mobile/src/state/backgroundJourney.ts apps/mobile/src/screens/MapScreen/hooks/useDeviceLocation.ts apps/mobile/src/__tests__/locationOutbox.test.ts apps/mobile/src/__tests__/backgroundJourney.test.ts
git commit -m "fix: stop permanent location upload retries"
```

---

### Task 3: 前景改用 MapKit 單一定位來源並保留原生平滑藍點

**Files:**
- Modify: `apps/mobile/src/components/GroupMap.tsx`
- Create: `apps/mobile/src/screens/MapScreen/foregroundLocationSource.ts`
- Modify: `apps/mobile/src/screens/MapScreen/hooks/useDeviceLocation.ts`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Create: `apps/mobile/src/__tests__/foregroundLocationSource.test.tsx`
- Modify: `apps/mobile/src/__tests__/performanceRegression.test.ts`

**Interfaces:**
- `GroupMapProps.onUserLocationSample?: (sample: LocationSample) => void`.
- `createForegroundLocationSource({ nativeMapAvailable, watchLocation, onSample })` owns the choice between MapKit events and the Expo watcher.
- `useDeviceLocation.consumeForegroundSample(sample): void` applies existing UI/upload/motion gates.
- `watchPositionAsync` remains only as fallback when native map location is unavailable; normal iOS MapScreen must not start it.

- [ ] **Step 1: Write failing source-ownership tests**

Create `foregroundLocationSource.test.tsx` with a mocked map event and mocked `location.watchLocation`:

```ts
it('uses the MapKit sample without starting a second foreground watcher', async () => {
  const watchLocation = jest.fn();
  const onSample = jest.fn();
  const sample = {
    coordinates: { latitude: 25.033, longitude: 121.5654 },
    accuracy: 8,
    timestamp: 1_789_000_000_000,
  };

  const source = createForegroundLocationSource({
    nativeMapAvailable: true,
    watchLocation,
    onSample,
  });
  source.acceptMapSample(sample);

  expect(onSample).toHaveBeenCalledWith(sample);
  expect(watchLocation).not.toHaveBeenCalled();
});
```

Implement this pure helper in `apps/mobile/src/screens/MapScreen/foregroundLocationSource.ts`. Its returned object has `start(): Promise<void>`, `acceptMapSample(sample): void`, and `stop(): void`; `start()` calls `watchLocation(onSample)` only when `nativeMapAvailable` is false, and `stop()` removes that subscription. Do not introduce a class or generic provider framework.

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd apps/mobile
npm test -- --runInBand src/__tests__/foregroundLocationSource.test.tsx src/__tests__/performanceRegression.test.ts
```

Expected: FAIL because MapKit samples are not connected to `useDeviceLocation` and the Expo watcher always starts in foreground.

- [ ] **Step 3: Emit MapKit user-location samples**

Add `onUserLocationSample` to `GroupMapProps`. On `MapView`, add:

```tsx
onUserLocationChange={(event) => {
  const coordinate = event.nativeEvent.coordinate;
  if (!coordinate) return;
  const { latitude, longitude, accuracy, timestamp } = coordinate;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  onUserLocationSample?.({
    coordinates: { latitude, longitude },
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  });
}}
```

Keep `showsUserLocation` enabled. The system blue dot remains native and smooth; React state is not used to redraw the self marker.

- [ ] **Step 4: Reuse existing business gates for MapKit samples**

Extract the watch callback body in `useDeviceLocation` into stable `consumeForegroundSample(sample)`. It must:

1. update motion state;
2. update `deviceCoords` only when `shouldAcceptUiSample` passes;
3. enqueue cloud upload only when `shouldUploadSample` passes;
4. never call `getCurrentLocation` for each MapKit event.

Add `nativeMapLocationEnabled: boolean` to the hook parameters. When true, skip `location.watchLocation`; manual refresh remains available as a one-shot fallback.

In `MapScreen.tsx`, pass `nativeMapLocationEnabled={Platform.OS === 'ios'}` to the hook and `onUserLocationSample={consumeForegroundSample}` to `GroupMap`.

- [ ] **Step 5: Run tests**

Run:

```bash
cd apps/mobile
npm test -- --runInBand src/__tests__/foregroundLocationSource.test.tsx src/__tests__/performanceRegression.test.ts src/__tests__/locationPolicy.test.ts
npm run typecheck
```

Expected: PASS. The regression test must assert `showsUserLocation`, `onUserLocationChange`, and that iOS MapScreen disables the second watcher.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/GroupMap.tsx apps/mobile/src/screens/MapScreen/foregroundLocationSource.ts apps/mobile/src/screens/MapScreen/hooks/useDeviceLocation.ts apps/mobile/src/screens/MapScreen.tsx apps/mobile/src/__tests__/foregroundLocationSource.test.tsx apps/mobile/src/__tests__/performanceRegression.test.ts
git commit -m "perf: use MapKit as foreground location owner"
```

---

### Task 4: 把 walking navigation 從持續 BestForNavigation 降為 Core Location 自適應模式

**Files:**
- Modify: `apps/mobile/src/state/backgroundJourneyController.ts`
- Modify: `apps/mobile/src/utils/locationPolicy.ts`
- Modify: `apps/mobile/src/__tests__/backgroundJourney.test.ts`
- Modify: `apps/mobile/src/__tests__/locationPolicy.test.ts`

**Interfaces:**
- `teamNavigation`: `Accuracy.High`（10 m 目標），activity type Fitness，自動 pause。
- `navigationMax` / `manualHighAccuracy`: `Accuracy.Highest`，不使用 `BestForNavigation`。
- `passiveBackground`: existing Low profile + automatic pause.

- [ ] **Step 1: Write failing policy tests**

Add/replace assertions:

```ts
it('uses fitness High accuracy for walking team navigation', () => {
  expect(backgroundLocationOptions('journey', false, 'teamNavigation')).toMatchObject({
    accuracy: 4,
    activityType: 3,
    pausesUpdatesAutomatically: true,
    deferredUpdatesDistance: 30,
    deferredUpdatesInterval: 30_000,
  });
});

it('never promotes manual walking precision to BestForNavigation', () => {
  expect(backgroundLocationOptions('journey', true, 'navigationMax')).toMatchObject({
    accuracy: 5,
    activityType: 3,
    pausesUpdatesAutomatically: true,
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd apps/mobile
npm test -- --runInBand src/__tests__/backgroundJourney.test.ts src/__tests__/locationPolicy.test.ts
```

Expected: FAIL because team navigation currently uses 5, navigation max uses 6, navigation disables auto-pause, and no activity type is sent.

- [ ] **Step 3: Apply the minimum native policy change**

In `backgroundLocationOptions`:

```ts
const accuracyCode = mode === 'navigationMax' || mode === 'manualHighAccuracy'
  ? 5
  : mode === 'teamNavigation'
    ? 4
    : policy.accuracy === 'high'
      ? 4
      : policy.accuracy === 'low'
        ? 2
        : 3;

return {
  accuracy: accuracyCode,
  activityType: powerMode === 'journey' ? 3 : 1,
  distanceInterval: policy.distanceInterval,
  timeInterval: policy.timeInterval,
  deferredUpdatesDistance: deferredDistance,
  deferredUpdatesInterval: deferredInterval,
  pausesUpdatesAutomatically: true,
  showsBackgroundLocationIndicator: mode !== 'passiveBackground',
};
```

Use numeric Expo constants already used by this adapter: Fitness = 3, Other = 1. Do not import platform modules into this pure controller.
The shown object lists only the policy fields being changed; preserve the controller's existing `foregroundService` property and Android notification strings byte-for-byte.

Keep `teamNavigation` deferred interval at 30 seconds / 30 metres. This affects background cloud/arrival work only; the foreground MapKit blue dot remains native and immediate.

- [ ] **Step 4: Run tests**

Run:

```bash
cd apps/mobile
npm test -- --runInBand src/__tests__/backgroundJourney.test.ts src/__tests__/locationPolicy.test.ts src/__tests__/navigationSessionState.test.tsx
npm run typecheck
```

Expected: PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/state/backgroundJourneyController.ts apps/mobile/src/utils/locationPolicy.ts apps/mobile/src/__tests__/backgroundJourney.test.ts apps/mobile/src/__tests__/locationPolicy.test.ts
git commit -m "perf: lower walking navigation location power"
```

---

### Task 5: 建立不污染耗電測試的 navigation energy samples

**Files:**
- Modify: `apps/mobile/src/state/performance.ts`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Modify: `apps/mobile/src/__tests__/performanceFlush.test.ts`
- Modify: `apps/mobile/src/__tests__/performanceTracingContract.test.ts`

**Interfaces:**
- Produces `startNavigationEnergyMonitor(context): () => void`.
- Emits at most one 1-second sample every 5 minutes while navigation is active, plus start/end samples.
- Works without `EXPO_PUBLIC_PERFORMANCE_TRACING=full`; does not trace every API.

- [ ] **Step 1: Write failing cadence test**

Use Jest fake timers and a mocked `metrics.samplePerformance`:

```ts
it('records navigation energy at start and at five-minute cadence only', async () => {
  jest.useFakeTimers();
  const stop = startNavigationEnergyMonitor({
    navigationSessionId: '00000000-0000-4000-8000-000000000001',
    trackingMode: 'teamNavigation',
  });

  await jest.advanceTimersByTimeAsync(4 * 60_000);
  expect(samplePerformance).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(samplePerformance).toHaveBeenCalledTimes(2);
  stop();
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd apps/mobile
npm test -- --runInBand src/__tests__/performanceFlush.test.ts src/__tests__/performanceTracingContract.test.ts
```

Expected: FAIL because no navigation-scoped low-overhead monitor exists.

- [ ] **Step 3: Implement the navigation-only monitor**

Add safe payload fields `navigationSessionId` and `trackingMode`. Add an internal `recordEnergySample` path that writes a `sample` event even when full API tracing is off, but still uses the 60-second batched flush from Task 1.

```ts
export function startNavigationEnergyMonitor(context: {
  navigationSessionId: string | null;
  trackingMode: string;
}): () => void {
  let stopped = false;
  const sample = () => {
    if (stopped || nativeSampleInFlight) return;
    void collectEnergySample('navigation.energy.sample', context);
  };
  sample();
  const timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
    void collectEnergySample('navigation.energy.end', context);
    void flushPerformance();
  };
}
```

`collectEnergySample` uses `metrics.samplePerformance(1_000)` and does not start the JS FPS sampler. Native `uiFps`, CPU, memory, battery and thermal are sufficient for this low-overhead trend.

In `MapScreen.tsx`, start it only when `journeyActive && appState === 'active'`; cleanup on navigation stop, group change or background transition.

- [ ] **Step 4: Run tests**

Run:

```bash
cd apps/mobile
npm test -- --runInBand src/__tests__/performanceFlush.test.ts src/__tests__/performanceTracingContract.test.ts
npm run typecheck
```

Expected: PASS; fake timer test observes one sample at start and one after five minutes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/state/performance.ts apps/mobile/src/screens/MapScreen.tsx apps/mobile/src/__tests__/performanceFlush.test.ts apps/mobile/src/__tests__/performanceTracingContract.test.ts
git commit -m "feat: add low-overhead navigation energy samples"
```

---

### Task 6: 回歸驗證 API storm 已消失，並建立實機耗電 gate

**Files:**
- Modify: `apps/mobile/src/__tests__/performanceRegression.test.ts`
- Modify: `docs/testflight/team-navigation-test-matrix.md`
- Create: `docs/testflight/navigation-energy-acceptance.md`

**Interfaces:**
- Produces a repeatable 30-minute smoke route and 90-minute acceptance route.
- Produces exact Supabase SQL checks and pass/fail thresholds.

- [ ] **Step 1: Strengthen the `destination_arrivals` regression test**

Keep the current stable translator test, and assert the gathering workflow effect has only stable dependencies, single-flight and a minimum interval. The contract must match:

```ts
expect(mapScreen).toContain('workflowInFlightRef');
expect(mapScreen).toContain('WORKFLOW_MIN_INTERVAL_MS');
expect(mapScreen).toContain('tRef.current');
expect(mapScreen).toMatch(
  /}, \[groupId, loadGatheringWorkflow, scheduleWorkflowReload\]\);/,
);
```

- [ ] **Step 2: Write the exact acceptance matrix**

`navigation-energy-acceptance.md` must require:

| Gate | 30-minute smoke | 90-minute acceptance |
|---|---:|---:|
| Battery delta, fixed 50% brightness | ≤10% | ≤25% |
| Thermal | no `serious`/`critical` | no `serious`/`critical`; `fair` cumulative ≤10 min |
| Self blue-dot visual latency | P95 ≤1 s | P95 ≤1 s |
| Stop/resume visual response | ≤2 s | ≤2 s |
| Valid fix horizontal accuracy | median ≤15 m, P95 ≤50 m | same |
| False arrival | 0 | 0 |
| `BestAccuracyForNavigation` | 0 by default | 0 by default |
| Location outbox remaining | ≤10 | ≤20 and falling after reconnect |
| Location upload terminal retry | 0 | 0 |
| `destination_arrivals` with no DB changes | initial load only | ≤3 total |
| Hither logical writes | ≤35 MB | ≤100 MB |
| Hither network excluding map tiles | ≤5 MB | ≤15 MB |
| Peak memory | ≤350 MB | ≤350 MB |
| Watchdog / crash / memory pressure | 0 | 0 |

Test on the same physical device and OS as baseline, Low Power Mode off, battery 80–100%, fixed route, fixed brightness, same network type. Run once with screen continuously on and once with 30 minutes foreground + 60 minutes locked/background.

- [ ] **Step 3: Add Supabase verification queries to the acceptance doc**

Use this API-rate query:

```sql
select operation,
       count(*) as calls,
       min(occurred_at) at time zone 'Asia/Taipei' as first_taipei,
       max(occurred_at) at time zone 'Asia/Taipei' as last_taipei
from public.performance_events
where occurred_at >= :route_started_at
  and occurred_at < :route_ended_at
group by operation
order by calls desc;
```

Use this location query:

```sql
select tracking_mode,
       count(*) as uploads,
       round(avg(horizontal_accuracy)::numeric, 1) as avg_accuracy_m,
       percentile_cont(0.95) within group (order by horizontal_accuracy) as p95_accuracy_m,
       round(
         extract(epoch from (max(captured_at) - min(captured_at)))::numeric /
         nullif(count(*) - 1, 0),
         1
       ) as avg_interval_s
from public.location_upload_events
where captured_at >= :route_started_at
  and captured_at < :route_ended_at
group by tracking_mode;
```

Use this retry query:

```sql
select event,
       coalesce(payload->>'errorCode', '') as error_code,
       count(*) as count,
       max(nullif(payload->>'remaining', '')::int) as max_remaining
from public.diagnostic_events
where occurred_at >= :route_started_at
  and occurred_at < :route_ended_at
group by event, error_code
order by count desc;
```

- [ ] **Step 4: Run automated verification**

Run:

```bash
cd apps/mobile
npm test -- --runInBand src/__tests__/locationPolicy.test.ts src/__tests__/backgroundJourney.test.ts src/__tests__/locationOutbox.test.ts src/__tests__/performanceFlush.test.ts src/__tests__/performanceTracingContract.test.ts src/__tests__/performanceRegression.test.ts src/__tests__/foregroundLocationSource.test.tsx
npm run typecheck
npm run lint
```

Expected: all suites PASS; typecheck and lint exit 0.

- [ ] **Step 5: Profile the physical-device route**

Use Xcode Instruments Power Profiler together with CPU Profiler, Network Connections and HTTP Traffic for the 30-minute smoke route. Record:

- location accuracy tier time;
- CPU/GPU/display/network power lanes;
- Hither HTTP request count by endpoint;
- SQLite write stacks;
- resident/physical footprint trend.

Do not run `EXPO_PUBLIC_PERFORMANCE_TRACING=full` during this measurement. If the 30-minute smoke route fails any gate, fix the measured stack before attempting the 90-minute route.

- [ ] **Step 6: Commit documentation and regression gate**

```bash
git add apps/mobile/src/__tests__/performanceRegression.test.ts docs/testflight/team-navigation-test-matrix.md docs/testflight/navigation-energy-acceptance.md
git commit -m "test: add navigation energy acceptance gate"
```

---

## 3. Rollout order and stop conditions

1. Ship Tasks 1–2 first. They address the measured 1.69 GB write、153 MB upload、409 duplicate 與 472 failed retries，且不改定位精準度。
2. 用 30 分鐘 smoke route 驗證 API/telemetry 熱點下降。
3. Ship Tasks 3–4。這才改 location ownership 與 accuracy policy；必須單獨比較抵達判定和藍點反應。
4. Ship Task 5，收集低負載趨勢；等下一個 MetricKit 日報後做 90 分鐘 acceptance。
5. 若 GPU 仍未達 gate，先用 Instruments 確認是 MapKit tile/render、custom markers、blur overlays 或 React rerender；沒有 stack 證據前不更換 SDK、不刪地圖功能。

## 4. 未納入本輪

- Google/Mapbox Navigation SDK migration：只有在 MapKit 原生藍點 + 單一 provider 通過耗電 gate，但仍無法達到 route snapping/隧道/都市峽谷精度時再評估。
- Kalman filter、IMU dead reckoning、座標外推：目前缺少真值資料與誤差模型。
- Android 專用 Fused Location Provider 重寫：先保持現有 Expo 行為，iOS gate 通過後以同一 SLO 另開計畫。
- 地圖 POI、3D、marker 視覺降級：GPU stack 未定位前不做推測性改版。

## 5. 計畫自我審查

- 所有需求都有對應 task：Log 分析（Tasks 1、2、5、6）、實際耗電與定位平滑（Tasks 3、4、6）、競品策略（第 2 節）、可執行實作步驟（Tasks 1–6）。
- 無新增 dependency，沿用現有 MapKit、Expo Location、SQLite、Supabase 與 MetricKit。
- 所有新增介面在首次使用前定義；`LocationFlushResult`、MapKit sample callback 與 energy monitor 名稱一致。
- `destination_arrivals` storm 已確認發生在修正 commit 之前，本計畫只補回歸 gate，避免重複實作。
- MetricKit 日資料與 1.5 小時路線的歸因限制已明確標示，不把相關性寫成單一路線因果。
