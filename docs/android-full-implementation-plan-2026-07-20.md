# Hither Android 完整功能移植實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在維持單一 React Native codebase 的前提下，讓 Android 具備現有 iPhone App 的完整業務功能、資訊架構、品牌視覺與操作流程，並以 Android 原生能力實作通知、背景定位與 Live Updates。

**Architecture:** 共用畫面、狀態與 Supabase domain logic 維持不分叉；平台差異只留在既有 `src/native/*` capability boundary、Expo local modules 與少量 `Platform.OS` 呈現分支。Android 地圖使用 Google Maps；Places／Routes 由受驗證的 Supabase Edge Function 代理，避免把 web-service key 放進 APK；一般通知依 token 的 `platform` 分流至 APNs 或 FCM。

**Tech Stack:** Expo SDK 56、React Native 0.85.3、React 19.2.3、TypeScript 6、Kotlin／Expo Modules、react-native-maps 1.27.2、expo-location、expo-notifications、Firebase Cloud Messaging、Supabase Edge Functions／Postgres、Jest、Android API 24–36。

## Global Constraints

- Android package 固定為 `app.hither.mobile`；Maps Android key 必須限制 package 與簽章 SHA-1，key 不得寫入 Git。
- Android 原生地圖使用 Google Maps，不建立 MapKit JS／WebView 第二套地圖。
- App 內畫面、資訊、狀態、操作順序與 iPhone 對齊；Dynamic Island、ActivityKit、Liquid Glass 等 OS 介面只要求 Android 原生功能與資訊等價。
- Android 16／API 36 使用 Live Updates／`Notification.ProgressStyle`；API 24–35 使用 ongoing foreground notification。
- Android Live Updates 不使用 `RemoteViews`，避免違反官方 promoted notification 限制。
- Places／Routes 必須經登入驗證的 server proxy；不得把 server API key 放入 APK。
- Places 只要求 `id`、名稱、地址、座標；Routes 只要求距離、時間、encoded polyline，避免不必要的高價 field mask。
- Places／Routes 上線前必須設硬 quota、budget alert 與 fail-closed；超限時保留座標新增、本機距離／估算 ETA 與外部 Google Maps 導航。
- 道路 ETA 顯示為「路線預估」；haversine／固定速度結果顯示為「估算」，不得宣稱為即時交通 ETA。
- 背景定位必須尊重拒絕、approximate-only、關閉分享、登出與離隊；不能因缺少 fine/background permission 阻塞其他 App 功能。
- 不新增狀態管理、地圖或通知套件；優先復用 `expo-notifications`、`expo-location`、`react-native-maps` 與現有 adapter。
- 商店購買不在本計畫內：目前 iPhone 與 Android 的 `purchasePro()`／`restorePurchases()` 都固定 `unavailable`，沒有可移植的 iPhone 完成功能。

---

## 驗收定義與交付分期

| 層級 | 交付內容 | 驗收標準 |
|---|---|---|
| M0 可建置基線 | Android config、native prebuild、debug APK | 實機可安裝、啟動、登入，不洩漏 service-account |
| M1 免費核心 | Google 地圖、marker、KML／長按／經緯度集合點、本機距離與估算 ETA、外部導航 | 不啟用 Places／Routes 仍可完成集合流程 |
| M2 網路服務 | Places 搜尋、Routes polyline／ETA、quota fallback | App 內搜尋與路線體驗對齊 iPhone；API 失敗可降級 |
| M3 通知與系統整合 | FCM、背景定位、Live Updates／ongoing notification | 前景、背景、鎖屏、App 被系統回收後的主要通知流程可驗證 |
| M4 完整等價與發佈 | Android metrics、UI／a11y／KML regression、APK/AAB | Android 12、14、16 測試矩陣通過，無 P0/P1 差異 |

## 檔案責任圖

### 新增

- `apps/mobile/app.config.ts`：從環境注入 Maps key 與 `google-services.json` 路徑，不保存密鑰值。
- `apps/mobile/src/native/externalNavigation.ts`：唯一的 Apple Maps／Google Maps deep-link boundary。
- `apps/mobile/src/components/CoordinateDestinationSheet.tsx`：長按選點、手動經緯度、自訂名稱的共用確認表單。
- `apps/mobile/src/utils/polyline.ts`：Google encoded polyline 純函式解碼。
- `supabase/functions/google-maps/index.ts`：驗證使用者、驗證 action 與輸入、執行 quota gate。
- `supabase/functions/google-maps/google.ts`：呼叫 Places／Routes 並限制 field mask。
- `supabase/functions/google-maps/types.ts`：proxy request／response discriminated union。
- `supabase/functions/send-push/fcm.ts`：Firebase service-account OAuth 與 FCM HTTP v1 發送器。
- `apps/mobile/modules/hither-live-activity/android/src/main/java/expo/modules/hitherliveactivity/HitherLiveUpdateService.kt`：建立、更新、結束 Android 導航通知。
- `apps/mobile/modules/hither-live-activity/android/src/main/java/expo/modules/hitherliveactivity/HitherMessagingService.kt`：處理需更新導航通知的 FCM data message。
- `apps/mobile/src/__tests__/android*.test.ts(x)`：Android 平台 contract 與 UI regression。
- `supabase/functions/google-maps/google_test.ts`、`supabase/functions/send-push/fcm_test.ts`：Edge Function 純函式與 payload 測試。

### 主要修改

- `apps/mobile/app.json`、`apps/mobile/eas.json`、`.gitignore`：Android build、權限、secret 與 profile。
- `apps/mobile/src/components/GroupMap.tsx`：Android Google provider、長按回呼、marker／polyline parity。
- `apps/mobile/src/components/DestinationSearch.tsx`：完整搜尋、座標新增入口、quota／offline 降級。
- `apps/mobile/src/native/maps.ts`：修正 Android stub 短路，接 Places／Routes proxy。
- `apps/mobile/src/screens/MapScreen.tsx`：接座標新增、路線來源標籤、外部導航與 Android system UI。
- `apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts`：跨平台 navigation URL 與 route state。
- `apps/mobile/src/state/useAuthFlow.ts`、`apps/mobile/src/screens/LoginScreen.tsx`：Android guest／Email／Google 登入；Apple 入口只保留 iOS。
- `apps/mobile/src/native/notifications.ts`、`apps/mobile/src/state/usePushRegistration.ts`、`apps/mobile/src/api/services/NotificationService.ts`：FCM token 與 platform。
- `supabase/functions/send-push/index.ts`：APNs／FCM 分流、死 token 清除與單一回應摘要。
- `apps/mobile/src/state/backgroundJourney*.ts`：Android permission／foreground service／重啟驗證。
- `apps/mobile/src/native/liveActivity.ts`、`apps/mobile/src/state/useLiveActivity.ts`：ActivityKit／Android Live Update 共用介面。
- `apps/mobile/modules/hither-metrics/android/.../HitherMetricsModule.kt`：Android runtime／memory 指標。

---

### Task 1: 建立可重現且不洩密的 Android build 基線

**Files:**
- Create: `apps/mobile/app.config.ts`
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/eas.json`
- Modify: `apps/mobile/.gitignore`
- Generate: `apps/mobile/android/`（只由 Expo prebuild 產生，不手工維護生成內容）
- Test: `apps/mobile/src/__tests__/androidConfig.test.ts`

**Interfaces:**
- Consumes: `GOOGLE_MAPS_ANDROID_API_KEY`、`GOOGLE_SERVICES_JSON` EAS environment variables。
- Produces: Expo config 中 `android.config.googleMaps.apiKey`、`android.googleServicesFile`、package `app.hither.mobile`、API 36 build 能力。

- [ ] **Step 1: 寫失敗的 config contract test**

```ts
import { getConfig } from '@expo/config';

it('keeps Android identity and required platform files in generated config', () => {
  const config = getConfig(process.cwd(), { skipSDKVersionRequirement: true }).exp;
  expect(config.android?.package).toBe('app.hither.mobile');
  expect(config.android?.googleServicesFile).toBeTruthy();
  expect(config.android?.config?.googleMaps?.apiKey).toBeTruthy();
});
```

- [ ] **Step 2: 執行測試並確認因尚未注入 Android Maps config 而失敗**

Run: `cd apps/mobile && GOOGLE_MAPS_ANDROID_API_KEY=test-key npm test -- --runInBand src/__tests__/androidConfig.test.ts`

Expected: FAIL，`googleServicesFile` 或 `googleMaps.apiKey` 為空。

- [ ] **Step 3: 用 dynamic Expo config 注入環境值**

```ts
import base from './app.json';
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...base.expo,
  ...config,
  android: {
    ...base.expo.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    config: {
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '' },
    },
  },
});
```

將 `secrets/`、service-account JSON、local `.env*` 加入 ignore；`google-services.json` 依部署政策決定由 EAS file secret 注入或提交公開 Firebase client config，但 Firebase Admin service-account JSON 一律不得提交。

- [ ] **Step 4: 加入 Android build profile 與通知權限**

在 `app.json` Android permissions 保留 coarse／fine／background／foreground-service-location，加入 `POST_NOTIFICATIONS`；在 `eas.json` 增加內部 QA APK profile：

```json
"androidQa": {
  "node": "22.16.0",
  "distribution": "internal",
  "channel": "preview",
  "android": { "buildType": "apk" }
}
```

- [ ] **Step 5: 產生 native project 並驗證 config**

Run: `cd apps/mobile && npx expo config --type public`

Expected: package、Maps key placeholder、google-services file、location 與 notification permissions 都存在；輸出不得含 Firebase Admin private key。

Run: `cd apps/mobile && npx expo prebuild --platform android --clean`

Expected: `android/` 產生成功，Gradle compile SDK 支援 API 36。

- [ ] **Step 6: 編譯 debug APK**

Run: `cd apps/mobile && npm run android`

Expected: `BUILD SUCCESSFUL`，實機／emulator 可啟動 Hither。

- [ ] **Step 7: 提交**

```bash
git add apps/mobile/app.config.ts apps/mobile/app.json apps/mobile/eas.json apps/mobile/.gitignore apps/mobile/src/__tests__/androidConfig.test.ts
git commit -m "build(android): add reproducible secure app config"
```

**Acceptance:** fresh checkout 只需注入兩個 EAS secrets 即可 build；Git history 不含 Maps key、FCM private key 或 service-account JSON。

---

### Task 2: Google Maps 原生地圖與現有地圖 UI 等價

**Files:**
- Modify: `apps/mobile/src/components/GroupMap.tsx`
- Modify: `apps/mobile/src/components/mapCameraMath.ts`
- Modify: `apps/mobile/src/__tests__/mapUiContracts.test.ts`
- Create: `apps/mobile/src/__tests__/androidMapContract.test.ts`

**Interfaces:**
- Consumes: 現有 `GroupMapProps`、`Destination[]`、`MemberLocation[]`、`routePoints`。
- Produces: Android Google Map 上一致的 destination marker、member marker、pending marker、route polyline、camera handle。

- [ ] **Step 1: 寫 Android map contract test**

```ts
it('selects Google provider only on Android and preserves every shared overlay', () => {
  const source = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');
  expect(source).toContain("Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined");
  expect(source).toContain('<DestinationMarker');
  expect(source).toContain('<MemberMarker');
  expect(source).toContain('<PendingPlaceMarker');
  expect(source).toContain('<Polyline');
});
```

- [ ] **Step 2: 執行並確認 provider contract 失敗**

Run: `cd apps/mobile && npm test -- --runInBand src/__tests__/androidMapContract.test.ts`

Expected: FAIL，尚未指定 Android provider。

- [ ] **Step 3: 只在 Android 指定 Google provider**

```tsx
import { Platform } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker, MarkerAnimated, Polyline } from 'react-native-maps';

<MapView
  provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
  {...sharedProps}
/>
```

保留 iOS MapKit、現有 marker 元件、`tracksViewChanges` 最佳化、route polyline 與 camera methods；不得建立 `GroupMap.android.tsx` 複製整個畫面。

- [ ] **Step 4: 真機驗證地圖狀態**

依序驗證：無 GPS／無集合點 fallback center、只有 GPS、單一集合點、多日集合點、10 位隊員、route polyline、light／dark theme、rotate／pitch、fit members／fit route。

Expected: 無灰底或 key error；self 使用 Google blue dot；其他成員與集合點 marker 可讀且不持續重繪。

- [ ] **Step 5: 跑地圖 regression**

Run: `cd apps/mobile && npm test -- --runInBand src/__tests__/androidMapContract.test.ts src/__tests__/mapUiContracts.test.ts src/__tests__/mapInitialRegion.test.ts src/__tests__/mapVisibleBand.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/mobile/src/components/GroupMap.tsx apps/mobile/src/components/mapCameraMath.ts apps/mobile/src/__tests__/androidMapContract.test.ts apps/mobile/src/__tests__/mapUiContracts.test.ts
git commit -m "feat(android): render shared map UI with Google Maps"
```

---

### Task 3: 座標型集合點完整流程（KML、長按、手動經緯度）

**Files:**
- Create: `apps/mobile/src/components/CoordinateDestinationSheet.tsx`
- Modify: `apps/mobile/src/components/GroupMap.tsx`
- Modify: `apps/mobile/src/components/DestinationSearch.tsx`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Modify: `apps/mobile/src/i18n/translations.ts`
- Test: `apps/mobile/src/__tests__/coordinateDestination.test.tsx`
- Test: `apps/mobile/src/__tests__/kml.test.ts`

**Interfaces:**
- Produces: `onLongPressCoordinate?: (coordinates: Coordinates) => void`；`CoordinateDestinationInput { title: string; coordinates: Coordinates }`。
- Consumes: 現有 `addDestination(groupId, { title, address?, coordinates })` 與 `KmlImportSheet`。

- [ ] **Step 1: 寫座標驗證與提交測試**

```tsx
it.each([
  ['91', '121', false],
  ['25.0339', '181', false],
  ['25.0339', '121.5645', true],
])('validates latitude %s and longitude %s', async (lat, lng, valid) => {
  const { getByLabelText, getByText, queryByText } = renderCoordinateSheet();
  fireEvent.changeText(getByLabelText('緯度'), lat);
  fireEvent.changeText(getByLabelText('經度'), lng);
  fireEvent.press(getByText('新增集合點'));
  expect(onSubmit).toHaveBeenCalledTimes(valid ? 1 : 0);
  if (!valid) expect(queryByText('請輸入有效座標')).toBeTruthy();
});
```

- [ ] **Step 2: 實作單一座標確認 sheet**

```ts
export interface CoordinateDestinationInput {
  title: string;
  coordinates: Coordinates;
}

export interface CoordinateDestinationSheetProps {
  visible: boolean;
  initialCoordinates?: Coordinates;
  onClose: () => void;
  onSubmit: (input: CoordinateDestinationInput) => Promise<void>;
}
```

規則：名稱 trim 後不可空；latitude 必須 `-90..90`；longitude 必須 `-180..180`；送出期間 disable；失敗保留輸入與顯示既有 `map.setFailedTitle`。

- [ ] **Step 3: 將地圖長按接到同一 sheet**

`GroupMap` 將 `event.nativeEvent.coordinate` 傳給 `onLongPressCoordinate`。`MapScreen` 以該座標開啟 sheet；手動入口則不給 initial coordinate。兩者最後都呼叫同一個 `addDestination` callback。

- [ ] **Step 4: 保留 KML 匯入並做 Android URI 驗證**

使用既有 `expo-document-picker` 與 `parseKml()`；Android `content://` 由 picker 的 `copyToCacheDirectory: true` 取得可讀 URI，不新增 storage permission。驗證含單一 Point、多個 Placemark、LineString 第一座標、無效座標與取消 picker。

- [ ] **Step 5: 跑測試**

Run: `cd apps/mobile && npm test -- --runInBand src/__tests__/coordinateDestination.test.tsx src/__tests__/kml.test.ts src/__tests__/gatheringWorkflowContract.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/mobile/src/components/CoordinateDestinationSheet.tsx apps/mobile/src/components/GroupMap.tsx apps/mobile/src/components/DestinationSearch.tsx apps/mobile/src/screens/MapScreen.tsx apps/mobile/src/i18n/translations.ts apps/mobile/src/__tests__/coordinateDestination.test.tsx apps/mobile/src/__tests__/kml.test.ts
git commit -m "feat: add coordinate-based gathering points on Android"
```

---

### Task 4: Places／Routes 安全代理、quota 與型別契約

**Files:**
- Create: `supabase/functions/google-maps/index.ts`
- Create: `supabase/functions/google-maps/google.ts`
- Create: `supabase/functions/google-maps/types.ts`
- Create: `supabase/functions/google-maps/google_test.ts`
- Create: `supabase/migrations/20260720_google_maps_quota.sql`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: authenticated Supabase JWT、`GOOGLE_MAPS_SERVER_API_KEY`、`action: 'search' | 'route'`。
- Produces:

```ts
type GoogleMapsRequest =
  | { action: 'search'; query: string; region?: MapRegion; languageCode: 'zh-TW' }
  | { action: 'route'; from: Coordinates; to: Coordinates; travelMode: TravelMode };

type GoogleMapsResponse =
  | { action: 'search'; places: PlaceResult[] }
  | { action: 'route'; route: DirectionsResult | null }
  | { error: 'quota_exceeded' | 'invalid_input' | 'upstream_unavailable' };
```

- [ ] **Step 1: 寫 request validation 與 field-mask 測試**

```ts
Deno.test('search rejects blank and overlong queries', () => {
  assertEquals(validateRequest({ action: 'search', query: ' ' }), null);
  assertEquals(validateRequest({ action: 'search', query: 'x'.repeat(201) }), null);
});

Deno.test('Places requests only display fields used by Hither', () => {
  assertEquals(PLACES_FIELD_MASK, 'places.id,places.displayName,places.formattedAddress,places.location');
});

Deno.test('Routes requests only route geometry and timing fields', () => {
  assertEquals(ROUTES_FIELD_MASK, 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline');
});
```

- [ ] **Step 2: 建立 quota migration**

建立 `google_maps_daily_usage(day date, user_id uuid, action text, count int)`，primary key `(day,user_id,action)`；建立 security-definer RPC `consume_google_maps_quota(p_action text, p_limit int)`，只允許 `search`、`route`，在單一 transaction 中加一並於超限回傳 false。預設 server hard limits：search 每人每日 100、route 每人每日 100；部署環境可往下調，不可由 client 往上調。

- [ ] **Step 3: 實作驗證順序**

1. 只接受 POST。
2. 由 Authorization header 驗證 Supabase user；anon／過期 JWT 回 401。
3. 驗證 action、query 長度、座標 finite 與合法範圍、travel mode enum。
4. 先 consume quota；false 回 429 `{ error: 'quota_exceeded' }`，不得呼叫 Google。
5. server key 缺失回 503，response 不回傳 key 或 upstream body。

- [ ] **Step 4: 實作 Google calls**

Places 使用 Text Search POST 與 `X-Goog-FieldMask`；`locationBias` 只在合法 region 存在時送出。Routes 使用 Compute Routes POST；drive 設 `TRAFFIC_AWARE`，walk／transit 不偽裝車流；duration 解析 `"123s"` 為整數秒；無 routes 回 `route: null`。

- [ ] **Step 5: 執行 Edge Function tests**

Run: `cd supabase/functions/google-maps && deno test --allow-env google_test.ts`

Expected: PASS，測試只使用 mock fetch，不呼叫真實 Google API。

- [ ] **Step 6: 本機驗證未授權與 quota fail-closed**

Run: `supabase functions serve google-maps --no-verify-jwt=false`

Expected: 無 Authorization 回 401；超限回 429；Google key 缺失回 503。

- [ ] **Step 7: 提交**

```bash
git add supabase/functions/google-maps supabase/migrations/20260720_google_maps_quota.sql supabase/config.toml
git commit -m "feat(maps): proxy Places and Routes with hard quotas"
```

---

### Task 5: App 內搜尋、route polyline、ETA 與降級策略

**Files:**
- Modify: `apps/mobile/src/native/maps.ts`
- Create: `apps/mobile/src/utils/polyline.ts`
- Modify: `apps/mobile/src/components/DestinationSearch.tsx`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Modify: `apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts`
- Test: `apps/mobile/src/__tests__/mapsDirections.test.ts`
- Create: `apps/mobile/src/__tests__/mapsSearchFallback.test.ts`
- Create: `apps/mobile/src/__tests__/polyline.test.ts`

**Interfaces:**
- `searchPlaces(query, region)` 維持回傳 `Promise<PlaceResult[]>`。
- `getDirections(from, to, travelMode)` 維持回傳 `Promise<DirectionsResult | null>`。
- 新增 `RouteSource = 'native' | 'google' | 'estimate'`，UI 依來源標示「路線預估」或「估算」。

- [ ] **Step 1: 先鎖定 Android stub 的 root-cause regression**

```ts
it('does not treat an empty Android native result as a successful search', async () => {
  mockNativeSearch.mockResolvedValue([]);
  mockProxySearch.mockResolvedValue([station]);
  await expect(searchPlaces('台北車站')).resolves.toEqual([station]);
});
```

這個測試必須失敗於目前 `HitherMaps.searchPlaces()` 的空陣列短路。

- [ ] **Step 2: 修正 shared boundary 一次，不在每個 caller 補 guard**

Android 搜尋順序：authenticated Google proxy → 明確顯示 quota／offline 狀態 → 使用者仍可改用座標流程。iOS 保留 native MapKit。公共 Photon／Nominatim 不作為 Android production autocomplete；只保留 development／web fallback。

- [ ] **Step 3: 實作 encoded polyline decoder**

```ts
export function decodePolyline(encoded: string): Coordinates[];
```

處理空字串、截斷輸入、負 delta 與 1e-5 scaling；截斷資料回空陣列，不回部分 route。

- [ ] **Step 4: 將 route 結果接回現有 GroupMap**

選定／開始目的地時，以目前位置、目的地、travel mode 呼叫 `getDirections`；成功時把 decoded points 傳給 `routePoints`、呼叫 `fitRoute()`，距離與 ETA 使用 Google response。401／429／503／offline 或空 route 時，清除舊 polyline，回到 `distanceMeters()`＋`etaSecondsFor()`，避免顯示上一條路線。

- [ ] **Step 5: 處理 stale request**

以遞增 request id 或 `AbortController` 確保快速切換目的地時，舊搜尋／舊 route response 不覆蓋新狀態；離開畫面時 abort。

- [ ] **Step 6: 跑測試**

Run: `cd apps/mobile && npm test -- --runInBand src/__tests__/mapsDirections.test.ts src/__tests__/mapsSearchFallback.test.ts src/__tests__/polyline.test.ts src/__tests__/mapRouteUiContract.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/mobile/src/native/maps.ts apps/mobile/src/utils/polyline.ts apps/mobile/src/components/DestinationSearch.tsx apps/mobile/src/screens/MapScreen.tsx apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts apps/mobile/src/__tests__/mapsDirections.test.ts apps/mobile/src/__tests__/mapsSearchFallback.test.ts apps/mobile/src/__tests__/polyline.test.ts
git commit -m "feat(android): add in-app place search and route ETA"
```

---

### Task 6: 跨平台外部導航與零 API 費用 fallback

**Files:**
- Create: `apps/mobile/src/native/externalNavigation.ts`
- Modify: `apps/mobile/src/native/index.ts`
- Modify: `apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts`
- Test: `apps/mobile/src/__tests__/externalNavigation.test.ts`
- Modify: `apps/mobile/src/__tests__/journeyNavigation.test.tsx`

**Interfaces:**

```ts
export function buildNavigationUrl(
  platform: 'ios' | 'android',
  destination: Destination,
  travelMode: TravelMode,
): string;

export function openExternalNavigation(
  destination: Destination,
  travelMode: TravelMode,
): Promise<void>;
```

- [ ] **Step 1: 寫 URL encoding 測試**

```ts
expect(buildNavigationUrl('android', taipei101, 'walk')).toBe(
  'https://www.google.com/maps/dir/?api=1&destination=25.0339%2C121.5645&travelmode=walking',
);
expect(buildNavigationUrl('ios', taipei101, 'walk')).toContain('maps.apple.com');
```

- [ ] **Step 2: 實作平台 boundary**

Android 使用 Google Maps universal URL，不要求 API key；iOS 保留 Apple Maps URL。所有 label／座標都用 `URLSearchParams`，禁止手工字串拼接未 escape 的 title。

- [ ] **Step 3: 取代 `openInAppleMaps`**

將 hook return key 改為 `openExternalNavigation`，更新唯一 caller 與 test；Android 無 Google Maps App 時由 browser 開啟 web route，不視為錯誤。

- [ ] **Step 4: 跑測試並提交**

Run: `cd apps/mobile && npm test -- --runInBand src/__tests__/externalNavigation.test.ts src/__tests__/journeyNavigation.test.tsx`

Expected: PASS。

```bash
git add apps/mobile/src/native/externalNavigation.ts apps/mobile/src/native/index.ts apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts apps/mobile/src/__tests__/externalNavigation.test.ts apps/mobile/src/__tests__/journeyNavigation.test.tsx
git commit -m "feat: open native navigation on iOS and Android"
```

---

### Task 7: Android 登入功能等價（guest、email、Google）

**Files:**
- Modify: `apps/mobile/src/state/useAuthFlow.ts`
- Modify: `apps/mobile/src/screens/LoginScreen.tsx`
- Modify: `apps/mobile/src/__tests__/appleAuth.test.ts`
- Modify: `apps/mobile/src/__tests__/appleLoginUiContract.test.ts`
- Create: `apps/mobile/src/__tests__/androidAuth.test.ts`

**Interfaces:**
- iOS `signInWithApple()` 維持 native identity-token flow。
- Android 不顯示 Apple 登入入口，也不執行 Apple web OAuth；Android 只提供 guest、Email/password、Google OAuth。

- [ ] **Step 1: 寫平台分流測試**

```ts
it('keeps Apple login iOS-only while Android keeps Google OAuth', async () => {
  mockPlatform('android');
  const screen = renderLoginScreen();
  expect(screen.queryByLabelText('使用 Apple 登入')).toBeNull();
  await signInWithGoogle();
  expect(mockSignInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }));
});
```

- [ ] **Step 2: 抽出既有 OAuth callback session exchange**

把 Google 已有的 browser callback 處理抽成檔內私有 `completeOAuth(url): Promise<AuthUser>`，同時支援 authorization code 與 access/refresh token；只供 Google OAuth 使用，不新增 auth class。

- [ ] **Step 3: Android 顯示 Apple button**

`LoginScreen` 的 `appleAvailable` 改成只有 `Platform.OS === 'ios'` 時才呼叫 `AppleAuthentication.isAvailableAsync()`；Android 與 web 都固定為 false，Apple button 不 mount。iOS 的 button 位置、busy/cancel/error 行為與 accessibility label 保持不變。

- [ ] **Step 4: 跑 auth regression 並提交**

Run: `cd apps/mobile && npm test -- --runInBand src/__tests__/androidAuth.test.ts src/__tests__/appleAuth.test.ts src/__tests__/appleLoginUiContract.test.ts src/__tests__/anonymousSignOut.test.ts`

Expected: PASS。

```bash
git add apps/mobile/src/state/useAuthFlow.ts apps/mobile/src/screens/LoginScreen.tsx apps/mobile/src/__tests__/androidAuth.test.ts apps/mobile/src/__tests__/appleAuth.test.ts apps/mobile/src/__tests__/appleLoginUiContract.test.ts
git commit -m "fix(android): keep Apple login iOS-only"
```

---

### Task 8: Android FCM token 註冊與資料模型分流

**Files:**
- Modify: `apps/mobile/src/native/notifications.ts`
- Modify: `apps/mobile/src/state/usePushRegistration.ts`
- Modify: `apps/mobile/src/api/services/NotificationService.ts`
- Modify: `apps/mobile/modules/hither-notifications/android/.../HitherNotificationsModule.kt`（刪除 no-op 邏輯或不再短路 Expo fallback）
- Create: `supabase/migrations/20260720_push_token_platform.sql`
- Modify: `apps/mobile/src/__tests__/client.test.ts`
- Create: `apps/mobile/src/__tests__/androidPushRegistration.test.ts`

**Interfaces:**
- Produces: `PushPlatform = 'ios' | 'android'`；`savePushToken(token, platform)`。
- Consumes: `Notifications.getDevicePushTokenAsync()`，Android 回傳原生 FCM token。

- [x] **Step 1: 寫 no-op stub regression**

```ts
it('falls through to expo-notifications when optional native module returns null', async () => {
  mockNativeGetToken.mockResolvedValue(null);
  mockExpoGetToken.mockResolvedValue({ type: 'fcm', data: 'fcm-token' });
  await expect(getDevicePushToken()).resolves.toBe('fcm-token');
});
```

- [ ] **Step 2: 修正 token boundary**

optional module 回傳非空字串才直接 return；null 繼續走既有 Expo implementation。Android 13+ 先要求 notification permission；拒絕回 null，不重複彈窗。不要額外引入 Firebase client SDK。

- [ ] **Step 3: 自動保存平台**

`usePushRegistration` 使用 `Platform.OS === 'android' ? 'android' : 'ios'` 傳給 `savePushToken`。migration 將 platform 加上 `check (platform in ('ios','android'))`，既有 row 保留 ios default。

- [ ] **Step 4: 驗證 token rotation 與登出**

App 每次 user id 改變重註冊；相同 `(user_id,token)` upsert 更新 platform/time。登出不刪 server token，以 FCM/APNs dead-token response 清理；若產品決定登出立即撤銷，另開安全需求，不混入這個任務。

- [ ] **Step 5: 跑測試並提交**

Run: `cd apps/mobile && npm test -- --runInBand src/__tests__/androidPushRegistration.test.ts src/__tests__/client.test.ts src/__tests__/productionPushMigration.test.ts`

Expected: PASS。

```bash
git add apps/mobile/src/native/notifications.ts apps/mobile/src/state/usePushRegistration.ts apps/mobile/src/api/services/NotificationService.ts apps/mobile/modules/hither-notifications/android supabase/migrations/20260720_push_token_platform.sql apps/mobile/src/__tests__/androidPushRegistration.test.ts apps/mobile/src/__tests__/client.test.ts
git commit -m "feat(android): register FCM device tokens"
```

---

### Task 9: send-push 同時支援 APNs 與 FCM

**Files:**
- Create: `supabase/functions/send-push/fcm.ts`
- Create: `supabase/functions/send-push/fcm_test.ts`
- Modify: `supabase/functions/send-push/index.ts`
- Modify: `supabase/functions/send-push/messages.ts`
- Modify: `apps/mobile/src/__tests__/navigationPushContract.test.ts`

**Interfaces:**

```ts
interface DeviceTokenRow {
  user_id: string;
  token: string;
  platform: 'ios' | 'android';
}

interface PushResult {
  token: string;
  status: number;
  dead: boolean;
  provider: 'apns' | 'fcm';
}
```

- [ ] **Step 1: 寫 FCM payload 與 dead-token test**

```ts
Deno.test('builds an Android alert with string data values', () => {
  assertEquals(buildFcmMessage('token', alert), {
    message: {
      token: 'token',
      notification: { title: alert.title, body: alert.body },
      data: { category: alert.data.category, groupId: alert.data.groupId },
      android: { priority: 'high' },
    },
  });
});
```

同時測試 FCM `UNREGISTERED`／`INVALID_ARGUMENT`（token invalid context）標為 dead；401/429/5xx 不刪 token。

- [ ] **Step 2: 實作 Firebase service-account OAuth**

從單一 env `FIREBASE_SERVICE_ACCOUNT_JSON` 讀 `project_id`、`client_email`、`private_key`；用 WebCrypto 簽 RS256 service-account JWT，交換 `https://oauth2.googleapis.com/token`，cache access token 到到期前 5 分鐘。log 不輸出 JSON、private key、access token 或完整 device token。

- [ ] **Step 3: 依 platform 查詢與 fan-out**

所有 `push_tokens` select 加 `platform`；ios rows 走既有 APNs，android rows 走 FCM HTTP v1。只有存在 ios rows 或 ActivityKit sessions 時才讀 APNs config；只有 android rows 時 APNs secret 缺失不能造成整批 500。

- [ ] **Step 4: 保留 category 與偏好一致性**

兩個 provider 共用 `buildMessage()`、recipient scope、notification preferences；Android data keys 與現有 foreground listener 使用的 `category/groupId/memberId/senderId/requestId` 完全一致。`location_refresh` 使用 data-only high-priority message；一般 alert 使用 notification + data。

- [ ] **Step 5: 合併結果與清 dead tokens**

response 增加 `apnsSent`、`fcmSent`、`total`、`pruned`；只有 provider 明確認定 dead 才刪。單一 token 失敗不阻止其他 token，provider config 整體缺失則回 500 並保留所有 token。

- [ ] **Step 6: 執行測試並部署 staging**

Run: `cd supabase/functions/send-push && deno test --allow-env fcm_test.ts`

Run: `cd apps/mobile && npm test -- --runInBand src/__tests__/navigationPushContract.test.ts src/__tests__/productionPushMigration.test.ts`

Expected: PASS。

在 staging 用同一事件同時送一台 iPhone 與一台 Android；驗證 title/body/data、偏好關閉、不送 sender、dead token 清除。

- [ ] **Step 7: 提交**

```bash
git add supabase/functions/send-push apps/mobile/src/__tests__/navigationPushContract.test.ts
git commit -m "feat(push): fan out alerts through APNs and FCM"
```

---

### Task 10: Android Live Updates 與舊版 ongoing notification

**Files:**
- Modify: `apps/mobile/src/native/liveActivity.ts`
- Modify: `apps/mobile/src/state/useLiveActivity.ts`
- Modify: `apps/mobile/modules/hither-live-activity/android/build.gradle`
- Modify: `apps/mobile/modules/hither-live-activity/android/.../HitherLiveActivityModule.kt`
- Create: `apps/mobile/modules/hither-live-activity/android/.../HitherLiveUpdateService.kt`
- Create: `apps/mobile/modules/hither-live-activity/android/.../HitherMessagingService.kt`
- Modify: `apps/mobile/modules/hither-live-activity/expo-module.config.json`
- Create: `apps/mobile/src/__tests__/androidLiveUpdateContract.test.ts`
- Modify: `apps/mobile/src/__tests__/liveActivityContract.test.ts`

**Interfaces:**
- Shared operations 保持 `isSupported/startGroupActivity/updateGroupActivity/updateAllGroupActivities/endGroupActivity/endAllGroupActivities`。
- Android handle 使用 stable navigation session id；iOS handle 保持 ActivityKit activity id。

- [ ] **Step 1: 寫 Android system contract test**

```ts
it('uses ProgressStyle on API 36 and a normal ongoing notification below 36', () => {
  expect(androidService).toContain('Build.VERSION.SDK_INT >= 36');
  expect(androidService).toContain('Notification.ProgressStyle');
  expect(androidService).toContain('setOngoing(true)');
  expect(androidService).not.toContain('RemoteViews');
});
```

- [ ] **Step 2: 定義 notification channels 與 IDs**

建立 `hither_navigation` high-importance channel（使用者可調整）與 stable notification id（session UUID hash）。內容固定包含：集合點、剩餘距離、ETA／估算標記、0–100 進度、點擊回 App、停止導航 action。不得顯示 iOS avatar stack 的假等價版。

- [ ] **Step 3: 實作版本分層**

API 36+ 使用 standard progress-centric notification 與 promoted ongoing request；API 24–35 使用 `NotificationCompat.Builder` ongoing notification。兩者共用同一 `LiveUpdateState` mapping；到達或停止時 cancel，必要時另送一次一般「已抵達」通知。

- [ ] **Step 4: 接 JS/local GPS 更新**

現有 `backgroundJourney.ts` 已呼叫 `updateAllGroupActivities()`；Android module 必須實際更新 notification，距離更新節流到至多每 5 秒或距離改變 20 公尺，避免 notification spam。使用既有 progress／arrival state，不另寫第二套計算。

- [ ] **Step 5: 接 FCM navigation data**

`HitherMessagingService` 只處理 `navigation_session`、`journey`、`arrival` 所需 data；缺 group/session/destination 時忽略並記 diagnostics；停止事件 cancel 對應 notification。一般 alert 仍由 expo-notifications 處理。

- [ ] **Step 6: 驗證 lifecycle**

測試開始、update、切換目的地、pause、arrival、leave group、sign out、force-stop 後重開、reboot 後不恢復過期 session。Android 16 promotion 未出現但一般 notification 存在時視為功能通過，因 promotion 受 OS／OEM 控制。

- [ ] **Step 7: 跑 contract 並提交**

Run: `cd apps/mobile && npm test -- --runInBand src/__tests__/androidLiveUpdateContract.test.ts src/__tests__/liveActivityContract.test.ts src/__tests__/backgroundJourney.test.ts`

Expected: PASS。

```bash
git add apps/mobile/src/native/liveActivity.ts apps/mobile/src/state/useLiveActivity.ts apps/mobile/modules/hither-live-activity apps/mobile/src/__tests__/androidLiveUpdateContract.test.ts apps/mobile/src/__tests__/liveActivityContract.test.ts
git commit -m "feat(android): add live navigation updates and fallback notification"
```

---

### Task 11: Android 背景定位、權限與抵達流程驗證

**Files:**
- Modify: `apps/mobile/src/state/backgroundJourneyController.ts`
- Modify: `apps/mobile/src/state/backgroundJourney.ts`
- Modify: `apps/mobile/src/native/location.ts`
- Modify: `apps/mobile/src/screens/MapScreen/hooks/useDeviceLocation.ts`
- Modify: `apps/mobile/src/i18n/translations.ts`
- Modify: `apps/mobile/src/__tests__/backgroundJourney.test.ts`
- Create: `apps/mobile/src/__tests__/androidLocationPermissions.test.ts`

**Interfaces:**
- 現有 `startBackgroundJourney(config): Promise<'started'|'permission_denied'|'hidden'>` 不變。
- 新增 UI 可區分 foreground denied、background denied、approximate only，但 domain 不依賴 Android-specific type。

- [ ] **Step 1: 寫 permission progression test**

```ts
it('requests foreground before background and does not start service when denied', async () => {
  foreground.mockResolvedValue({ status: 'granted' });
  background.mockResolvedValue({ status: 'denied' });
  await expect(controller.start(config)).resolves.toBe('permission_denied');
  expect(startLocationUpdates).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 保留既有 controller，補 Android UX 而非重寫定位層**

首次只要求 foreground；使用者開始群組背景分享／導航時才解釋並要求 background。Android 12+ approximate-only 仍可顯示位置與粗略進度，但抵達 confirmation 使用 accuracy-aware 現有 reducer，不降低 radius 來假裝精確。

- [ ] **Step 3: 驗證 foreground service**

開始背景更新時 channel 可見，notification title/body 對應 all-day／journey；停止導航、關閉分享、登出、離隊與 hidden mode 必須 stop updates 並清 AsyncStorage config。Android 14+ service type 為 location，缺 permission 不可 crash。

- [ ] **Step 4: 測 OEM／電池情境**

至少真機驗證 Pixel/Android 16 與一台非 Pixel Android 12–14：鎖屏 30 分鐘、切換網路、低電量模式、approximate-only、拒絕 background、App 從 recent 移除後重開。每個 case 記錄 callback 間隔、notification 是否存在與位置 outbox 是否補送。

- [ ] **Step 5: 跑 regression 並提交**

Run: `cd apps/mobile && npm test -- --runInBand src/__tests__/androidLocationPermissions.test.ts src/__tests__/backgroundJourney.test.ts src/__tests__/locationPolicy.test.ts src/__tests__/locationOutbox.test.ts src/__tests__/navigationArrival.test.ts`

Expected: PASS。

```bash
git add apps/mobile/src/state/backgroundJourneyController.ts apps/mobile/src/state/backgroundJourney.ts apps/mobile/src/native/location.ts apps/mobile/src/screens/MapScreen/hooks/useDeviceLocation.ts apps/mobile/src/i18n/translations.ts apps/mobile/src/__tests__/androidLocationPermissions.test.ts apps/mobile/src/__tests__/backgroundJourney.test.ts
git commit -m "fix(android): verify background location and arrival lifecycle"
```

---

### Task 12: App 內 1:1 視覺、操作與 accessibility parity gate

**Files:**
- Modify: `apps/mobile/src/native/liquidGlass.tsx`
- Modify: `apps/mobile/src/utils/haptics.ts`
- Create: `apps/mobile/src/__tests__/androidParityContract.test.ts`
- Create: `docs/android-parity-qa-matrix-2026-07-20.md`

**Interfaces:**
- Consumes: 共用 screens/components/theme/i18n。
- Produces: 每個 iPhone flow 都有 Android outcome；OS-only capability 有明確 Android 對應與不可等價註記。

- [ ] **Step 1: 建立逐流程 QA matrix**

矩陣必含：登入／註冊／guest、Onboarding、角色選擇、建立／加入／我的隊伍、地圖 marker、三段 bottom sheet、成員／路線／工具 tabs、集合點搜尋／座標／KML／排序／跨日／集合時間、開始／暫停／抵達／歷史、小隊／暫離／邀請、群組指令、通知偏好、主題／字體、diagnostics、登出／離隊清理。

每列欄位固定為：iPhone reference、Android result、狀態（pass／platform-equivalent／fail）、差異證據、修正 task／commit。

- [ ] **Step 2: 鎖定共用 UI contract**

```tsx
it.each(['members', 'route', 'tools'])('keeps the %s map tab on Android', (tab) => {
  expect(renderMapOnAndroid().getByA11yLabel(tab)).toBeTruthy();
});
```

並測試所有主要 action 有 `accessibilityRole`／label、44dp 最小觸控區、Dynamic Type 不截斷核心文字、Android back 關閉 modal/sheet 而非直接離開 App。

- [ ] **Step 3: 只在 capability boundary 處理材質差異**

`liquidGlass.GlassView` 在 Android 使用現有 blur／半透明 surface fallback；不得在每個 screen 加 Android style fork。`haptics.ts` 維持 `expo-haptics`，驗收行為存在，不驗收與 iPhone 震感相同。

- [ ] **Step 4: 視覺比對**

以相同測試資料、相同 viewport 分別截 iPhone 與 Android：Login、Role、空地圖、有隊員地圖、route active、bottom sheet 三段、設定、Live Update／notification。App 內元件允許系統字型 rasterization 與地圖底圖差異；spacing、層級、色彩 token、資訊與 action 不可缺。

- [ ] **Step 5: 跑共用 regression**

Run: `cd apps/mobile && npm test -- --runInBand src/__tests__/androidParityContract.test.tsx src/__tests__/flow.test.ts src/__tests__/mapUiContracts.test.ts src/__tests__/glassChromeContract.test.ts src/__tests__/dynamicTypeContract.test.ts src/__tests__/gatheringWorkflowContract.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/mobile/src/native/liquidGlass.tsx apps/mobile/src/utils/haptics.ts apps/mobile/src/__tests__/androidParityContract.test.tsx docs/android-parity-qa-matrix-2026-07-20.md
git commit -m "test(android): enforce full app feature parity"
```

---

### Task 13: Android diagnostics／performance native metrics

**Files:**
- Modify: `apps/mobile/modules/hither-metrics/android/.../HitherMetricsModule.kt`
- Modify: `apps/mobile/src/native/metrics.ts`
- Modify: `apps/mobile/src/state/diagnostics.ts`
- Create: `apps/mobile/src/__tests__/androidMetricsContract.test.ts`
- Modify: `apps/mobile/src/__tests__/diagnostics.test.ts`
- Modify: `apps/mobile/src/__tests__/metricKitContract.test.ts`

**Interfaces:**
- 完整保留 `HitherMetricsModule` 七個方法：`drainPayloads`、`removePayloads`、`samplePerformance`、`setCollectionEnabled`、`purgePayloads`、`previousLaunch`、`markLaunchPhase`。
- `samplePerformance(durationMs)` 回傳符合 `PerformanceSample` 的 map；Android 沒有可靠 crash/ANR spool 前，`drainPayloads()` 明確回空陣列。

- [ ] **Step 1: 寫 contract**

```ts
it('returns finite Android runtime metrics without iOS-only MetricKit keys', () => {
  expect(androidModule).toContain('Debug.MemoryInfo');
  expect(androidModule).toContain('Runtime.getRuntime()');
  expect(androidModule).not.toContain('emptyMap<String, Any?>()');
});
```

- [ ] **Step 2: 實作最小可信指標**

回傳 process CPU time、PSS memory MB、display refresh rate、battery level/state、power-save mode、thermal status、app state、device model 與 OS version，映射到既有 `PerformanceSample` 欄位；無權限或 API 不支援的欄位回 null，不填 0。`setCollectionEnabled` 必須保存 consent；`purgePayloads` 清本地資料；`previousLaunch`／`markLaunchPhase` 使用 SharedPreferences 保存上一輪 bounded launch phase。ANR/crash 若目前沒有可靠本地來源，`drainPayloads` 保持空陣列並在文件標示能力缺口，不自建 crash SDK。

- [ ] **Step 3: 驗證 privacy 與上傳**

payload 不含精確位置、token、email、group code；沿用現有 diagnostics consent、batch、retry 與成功後 remove 流程。

- [ ] **Step 4: 跑測試並提交**

Run: `cd apps/mobile && npm test -- --runInBand src/__tests__/androidMetricsContract.test.ts src/__tests__/diagnostics.test.ts src/__tests__/metricKitContract.test.ts src/__tests__/performanceTracingContract.test.ts`

Expected: PASS。

```bash
git add apps/mobile/modules/hither-metrics/android/src/main/java/expo/modules/hithermetrics/HitherMetricsModule.kt apps/mobile/src/native/metrics.ts apps/mobile/src/state/diagnostics.ts apps/mobile/src/__tests__/androidMetricsContract.test.ts apps/mobile/src/__tests__/diagnostics.test.ts apps/mobile/src/__tests__/metricKitContract.test.ts
git commit -m "feat(android): report runtime performance metrics"
```

---

### Task 14: 全量驗證、費用護欄、APK／AAB 與發佈證據

**Files:**
- Create: `docs/android-release-runbook.md`
- Modify: `docs/android-parity-qa-matrix-2026-07-20.md`
- Modify: `apps/mobile/eas.json`
- No source change unless a test exposes a defect。

**Interfaces:**
- Produces: signed internal APK、production AAB、可重跑的測試證據、quota／secret／Play policy checklist。

- [ ] **Step 1: 全量靜態與單元測試**

Run: `cd apps/mobile && npm run typecheck`

Run: `cd apps/mobile && npm run lint`

Run: `cd apps/mobile && npm test -- --runInBand`

Expected: 全部 exit 0；任何既有 unrelated failure 必須在 runbook 記錄 test 名稱與既有 commit 證據，不得寫成泛稱「known issue」。

- [ ] **Step 2: Edge Function 與 DB tests**

Run: `supabase test db`

Run: `deno test --allow-env supabase/functions/google-maps/google_test.ts supabase/functions/send-push/fcm_test.ts`

Expected: quota atomicity、RLS、invalid input、dead token、APNs/FCM split 全部 PASS。

- [ ] **Step 3: 建 Android 版本矩陣**

- Android 12／API 31：approximate location、舊版 ongoing notification、Google Maps、KML。
- Android 14／API 34：foreground service location、notification dismiss、背景限制。
- Android 16／API 36：Live Update `ProgressStyle`、狀態列 chip（若 OS promotion）、runtime permissions。
- 至少一台 Pixel 與一台非 Pixel OEM 真機；emulator 不替代 background/OEM 驗收。

- [ ] **Step 4: E2E 雙平台事件矩陣**

用 iPhone + Android 同群組測：建立集合點、搜尋與座標新增、開始導航、route update、隊友抵達、脫隊、集合時間、指令、notification preference off、pause、leave、sign out。驗證 Supabase Realtime、APNs、FCM 與 Live Activity/Live Update 同步，不要求兩個 OS 通知像素相同。

- [ ] **Step 5: 啟用成本與安全護欄後才開 production API**

確認 Android key restriction、server key 僅 Edge Function secret、Maps／Places／Routes 分開 quota、billing budget alert、proxy 每人 daily hard limit、429 UI fallback、log redaction。先保持 Places／Routes production flag off；完成 smoke + quota 測試後再開。

- [ ] **Step 6: Build internal APK 與 production AAB**

Run: `cd apps/mobile && eas build --platform android --profile androidQa`

Expected: 可下載 APK，在非開發機安裝並完成 smoke test。

Run: `cd apps/mobile && eas build --platform android --profile production`

Expected: 產出 signed AAB；versionCode 自動遞增；不提交 Play，直到背景定位 disclosure、data safety 與通知用途審查完成。

- [ ] **Step 7: Runbook 必須記錄的證據**

記錄 commit SHA、EAS build URL、APK/AAB checksum、測試日期／裝置／API level、Maps key restriction screenshot reference、quota 值、Supabase function version、已知 platform-equivalent 差異、rollback build id。

- [ ] **Step 8: 提交**

```bash
git add docs/android-release-runbook.md docs/android-parity-qa-matrix-2026-07-20.md apps/mobile/eas.json
git commit -m "docs(android): add release and parity verification evidence"
```

---

## 明確不做／延後項目

- 不建立第二套 Android UI codebase；共用 React Native screen 是驗收主體。
- 不用 MapKit JS／WebView 模擬 Apple Maps。
- 不以 `RemoteViews` 複製 Dynamic Island；Android 只用官方 notification styles。
- 不做 App 內完整 turn-by-turn Navigation SDK；本計畫提供 Hither route overview／ETA 與外部 Google Maps turn-by-turn。
- 不在本輪接 Google Play Billing；iPhone StoreKit 也尚未完成，沒有既有功能可移植。
- 不在第一個 production build 啟用 Route Matrix；只有觀測到多人道路 ETA 的實際需求且 billable elements 可控時才加入。
- 不新增 crash analytics SDK；先完成現有 diagnostics 與 Android runtime metrics。

## 完成定義

- 14 個 task 各自的測試、真機驗收與 commit 均完成。
- `android-parity-qa-matrix` 不存在 fail；允許的差異只能標為 platform-equivalent，並附 Android 官方限制或實機證據。
- Android 能完成 iPhone 現有的登入、隊伍、地圖、集合點、行程、即時同步、通知、背景定位、設定、KML、diagnostics 流程。
- APNs 與 FCM 同時可用；Android 16 有 Live Update，舊版有 ongoing notification fallback。
- Places／Routes 故障或 quota 用盡時，座標新增、本機距離／估算 ETA、KML 與外部導航仍可用。
- signed APK 可內測，signed AAB 可上傳；repo 與 build log 不含 server secrets。

## Project 未來方向、未來功能、未來風險

### 未來方向

- 先量測 Places／Routes 真實使用量，再調整 per-user quota，不以推測提高額度。
- 維持 capability boundary；新增平台能力時只擴充 `src/native` 與對應 Expo module。
- 將 Android parity matrix 納入每次 release gate，避免 iOS-only 功能再次無聲加入。

### 未來功能

- Route Matrix 多隊員道路 ETA。
- Android 16 更細的 journey milestones 與 Wear OS 顯示。
- 有明確產品需求後再評估 Navigation SDK App 內 turn-by-turn。
- iOS StoreKit 與 Google Play Billing 作為獨立跨平台付費專案。

### 未來風險

- OEM 背景限制、通知 promotion 與省電策略無法由單一 Pixel 測試覆蓋。
- Places field mask 或 Routes retry loop 配置錯誤會提高 SKU／費用。
- Google Play 對 background location 的 disclosure 與審查可能阻擋上架，即使 APK 技術上可用。
- Apple native login 只在 iOS 驗收；Android 不維護 Apple OAuth secret 或 web redirect。
- Android API 36 Live Updates 行為仍受 OS／OEM／使用者通知設定控制，不能承諾 chip 一定出現。
- native config／權限變更不能靠 OTA 修正，必須發新 APK/AAB。

## Self-review 結果

- 研究文件第 1–14 節均有對應 task；通知、FCM、Live Updates、完整 App 內功能移植已納入；Android Apple 登入入口已依需求移除。
- 已排除 iPhone 本身未完成的購買功能，避免把「Android parity」擴張成新產品。
- Places／Routes 與免費核心分期，但都在本計畫內，不再只規劃第一階段。
- Shared interface 名稱統一使用 `PlaceResult`、`DirectionsResult`、`TravelMode`、`openExternalNavigation`、`PushPlatform`。
- 所有 task 都有明確檔案、介面、測試命令、預期結果與提交範圍，沒有留空的實作步驟。
