# iOS MapKit and Apple Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Hither iOS App 內提供 MapKit 原生搜尋、真實路線／ETA／Polyline、45 度地圖鏡頭，以及 Supabase 原生 Sign in with Apple。

**Architecture:** 保留現有 `react-native-maps` 與 `HitherMaps` Expo Module；Swift 只負責呼叫 MapKit，TypeScript 負責 fallback、快取與畫面狀態。Apple 登入使用 `expo-apple-authentication` 取得 Apple identity token，再交給既有 Supabase session flow。

**Tech Stack:** Expo 54、React Native 0.81、react-native-maps、Swift MapKit、expo-apple-authentication、Supabase Auth、Jest。

---

## File structure

- `apps/mobile/src/native/maps.ts`: 地圖原生邊界、路線型別、MapKit 不可用時的 fallback。
- `apps/mobile/modules/hither-maps/ios/HitherMapsModule.swift`: `MKLocalSearch` 與 `MKDirections` 實作。
- `apps/mobile/src/components/GroupMap.tsx`: Polyline 與地圖 camera 命令。
- `apps/mobile/src/screens/MapScreen/hooks/useMapKitRoutes.ts`: 自身路線與每位成員 ETA 的快取、過期結果保護。
- `apps/mobile/src/screens/MapScreen.tsx`: 將路線結果接到現有卡片與成員列。
- `apps/mobile/src/state/useAuthFlow.ts`: Apple credential 與 Supabase session/profile 寫入。
- `apps/mobile/src/state/SessionContext.tsx`: 對 UI 暴露 `signInWithApple`。
- `apps/mobile/src/screens/LoginScreen.tsx`: Apple 原生按鈕。
- `apps/mobile/app.json`, `apps/mobile/package.json`, `apps/mobile/package-lock.json`: entitlement、plugin 與相依套件。
- `apps/mobile/src/__tests__/mapsDirections.test.ts`: 路線 fallback 契約。
- `apps/mobile/src/__tests__/mapKitRoutes.test.ts`: 成員各自 ETA 與過期結果保護。
- `apps/mobile/src/__tests__/appleAuth.test.ts`: Apple 成功、取消與首次姓名保存。

### Task 1: TypeScript directions boundary

**Files:**
- Modify: `apps/mobile/src/native/maps.ts`
- Create: `apps/mobile/src/__tests__/mapsDirections.test.ts`

- [ ] **Step 1: Write the failing native-boundary test**

Mock `expo-modules-core.requireOptionalNativeModule` and assert that `getDirections` passes the selected mode through and returns MapKit fields:

```ts
const nativeGetDirections = jest.fn().mockResolvedValue({
  distanceMeters: 1234,
  expectedTravelTimeSeconds: 900,
  points: [{ latitude: 25.03, longitude: 121.56 }],
});

jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => ({
    searchPlaces: jest.fn(),
    getDirections: nativeGetDirections,
  }),
}));

it('returns the native MapKit route for the selected travel mode', async () => {
  const { getDirections } = require('../native/maps');
  await expect(getDirections(FROM, TO, 'drive')).resolves.toMatchObject({
    distanceMeters: 1234,
    expectedTravelTimeSeconds: 900,
  });
  expect(nativeGetDirections).toHaveBeenCalledWith(FROM, TO, 'drive');
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --runInBand src/__tests__/mapsDirections.test.ts`

Expected: FAIL because `getDirections` is not exported and the native type has no `getDirections` contract.

- [ ] **Step 3: Add the minimal route contract**

Add these exports and extend the optional native module type:

```ts
export type TravelMode = 'walk' | 'drive' | 'transit';

export interface DirectionsResult {
  distanceMeters: number;
  expectedTravelTimeSeconds: number;
  points: Coordinates[];
}

const HitherMaps = requireOptionalNativeModule<{
  searchPlaces(query: string, region?: MapRegion): Promise<PlaceResult[]>;
  getDirections(
    from: Coordinates,
    to: Coordinates,
    travelMode: TravelMode,
  ): Promise<DirectionsResult>;
}>('HitherMaps');

export async function getDirections(
  from: Coordinates,
  to: Coordinates,
  travelMode: TravelMode,
): Promise<DirectionsResult | null> {
  if (!HitherMaps) return null;
  try {
    const route = await HitherMaps.getDirections(from, to, travelMode);
    return route.points.length > 0 ? route : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the focused test**

Run: `npm test -- --runInBand src/__tests__/mapsDirections.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit only the boundary and test**

```bash
git add apps/mobile/src/native/maps.ts apps/mobile/src/__tests__/mapsDirections.test.ts
git commit -m "feat(mobile): expose MapKit directions"
```

### Task 2: MapKit directions implementation

**Files:**
- Modify: `apps/mobile/modules/hither-maps/ios/HitherMapsModule.swift`

- [ ] **Step 1: Extend the Swift function signature**

Change the native function to accept `travelMode` and map it explicitly:

```swift
AsyncFunction("getDirections") { (
  from: [String: Any],
  to: [String: Any],
  travelMode: String,
  promise: Promise
) in
  guard let fromCoord = Self.coordinate(from: from),
        let toCoord = Self.coordinate(from: to) else {
    promise.reject("ERR_MAPS_DIRECTIONS", "Invalid coordinates")
    return
  }

  let request = MKDirections.Request()
  request.source = MKMapItem(placemark: MKPlacemark(coordinate: fromCoord))
  request.destination = MKMapItem(placemark: MKPlacemark(coordinate: toCoord))
  switch travelMode {
  case "drive": request.transportType = .automobile
  case "transit": request.transportType = .transit
  default: request.transportType = .walking
  }
```

- [ ] **Step 2: Return MapKit ETA with the polyline**

Use the first route already selected by the module and resolve:

```swift
promise.resolve([
  "distanceMeters": route.distance,
  "expectedTravelTimeSeconds": route.expectedTravelTime,
  "points": points,
])
```

- [ ] **Step 3: Verify the TypeScript/native signatures match**

Run: `npm run typecheck`

Expected: PASS; Swift is not compiled on Windows, but the JS call has exactly three arguments matching the Swift function.

- [ ] **Step 4: Commit the native change**

```bash
git add apps/mobile/modules/hither-maps/ios/HitherMapsModule.swift
git commit -m "feat(ios): return MapKit route ETA"
```

### Task 3: Route state, member ETA cache, and stale-result protection

**Files:**
- Create: `apps/mobile/src/screens/MapScreen/hooks/useMapKitRoutes.ts`
- Create: `apps/mobile/src/__tests__/mapKitRoutes.test.ts`

- [ ] **Step 1: Write failing tests for route inputs and stale results**

Use `renderHook` with a deferred first request and an immediate second request. Assert that changing destination ignores the first result, and that every member request uses that member as `from` and the gathering point as `to`.

```ts
expect(getDirections).toHaveBeenCalledWith(memberA.coordinates, gathering.coordinates, 'walk');
expect(getDirections).toHaveBeenCalledWith(memberB.coordinates, gathering.coordinates, 'walk');
expect(result.current.memberRoutes.memberA.expectedTravelTimeSeconds).toBe(600);
expect(result.current.selfRoute?.points).toEqual(NEW_ROUTE.points);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --runInBand src/__tests__/mapKitRoutes.test.ts`

Expected: FAIL because `useMapKitRoutes` does not exist.

- [ ] **Step 3: Implement one focused hook**

The hook accepts `{ selfCoordinates, members, gathering, travelMode }`, calls `maps.getDirections`, and returns:

```ts
interface MapKitRoutesState {
  selfRoute: DirectionsResult | null;
  memberRoutes: Record<string, DirectionsResult>;
}
```

Use a monotonically increasing `requestIdRef`; each effect captures its ID and only publishes when it still matches. Cache promises in a module-level `Map<string, Promise<DirectionsResult | null>>` with keys rounded to five decimal places:

```ts
const key = [
  travelMode,
  from.latitude.toFixed(5),
  from.longitude.toFixed(5),
  to.latitude.toFixed(5),
  to.longitude.toFixed(5),
].join(':');
```

Use `Promise.all` so one member failure becomes `null` without preventing other member rows from updating. Do not add timers or background polling; existing location updates naturally change hook inputs.

- [ ] **Step 4: Run the hook test**

Run: `npm test -- --runInBand src/__tests__/mapKitRoutes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the hook and test**

```bash
git add apps/mobile/src/screens/MapScreen/hooks/useMapKitRoutes.ts apps/mobile/src/__tests__/mapKitRoutes.test.ts
git commit -m "feat(mobile): calculate member MapKit ETAs"
```

### Task 4: Polyline, true ETA, and 45-degree camera

**Files:**
- Modify: `apps/mobile/src/components/GroupMap.tsx`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`

- [ ] **Step 1: Add route props and map commands**

Extend `GroupMapProps` with `routePoints?: Coordinates[]` and `routeColor?: string`. Extend `GroupMapHandle` with:

```ts
focusOblique: (coordinates: Coordinates) => void;
fitRoute: (coordinates: Coordinates[]) => void;
```

Implement `focusOblique` with:

```ts
mapRef.current?.animateCamera(
  { center: coordinates, pitch: 45, heading: 0, altitude: 1200 },
  { duration: 500 },
);
```

Implement `fitRoute` using existing `fitToCoordinates` and render one `Polyline` when at least two points exist:

```tsx
<Polyline
  coordinates={routePoints}
  strokeColor={routeColor}
  strokeWidth={5}
  lineCap="round"
  lineJoin="round"
/>
```

- [ ] **Step 2: Wire the route hook into MapScreen**

Call `useMapKitRoutes` with `fromCoords`, `members`, `activePoint`, and `travelMode`. Pass `selfRoute?.points` into `GroupMap`. When the route changes, call `fitRoute` once for the new point set.

- [ ] **Step 3: Replace estimated values only when MapKit data exists**

For the selected destination/self card use MapKit values when its destination matches the active route; otherwise preserve the existing `distanceMeters` / `etaSecondsFor` fallback. For each member row use:

```ts
const memberRoute = memberRoutes[m.userId];
const distance = memberRoute?.distanceMeters ?? distanceToGathering;
const etaSeconds = memberRoute?.expectedTravelTimeSeconds
  ?? (distanceToGathering != null ? etaSecondsFor(distanceToGathering, travelMode) : undefined);
```

This deliberately changes the row from member-to-self to member-to-gathering. The self row also receives an ETA when an active gathering point exists.

- [ ] **Step 4: Change only the add-place location button to oblique camera**

Replace the confirm-card handler with:

```tsx
onPress={() => mapRef.current?.focusOblique(pendingPlace.coordinates)}
```

Leave general recenter and fit-all controls unchanged.

- [ ] **Step 5: Run map-focused tests and typecheck**

Run: `npm test -- --runInBand src/__tests__/mapKitRoutes.test.ts src/__tests__/geo.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit without including unrelated MapScreen work**

Review `git diff -- apps/mobile/src/screens/MapScreen.tsx` first, then stage only the route-related hunks interactively or by a temporary patch. Commit:

```bash
git add apps/mobile/src/components/GroupMap.tsx
git add -p apps/mobile/src/screens/MapScreen.tsx
git commit -m "feat(mobile): draw MapKit route and member ETAs"
```

### Task 5: Native Sign in with Apple

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/package-lock.json`
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/src/state/useAuthFlow.ts`
- Modify: `apps/mobile/src/state/SessionContext.tsx`
- Modify: `apps/mobile/src/screens/LoginScreen.tsx`
- Modify: `apps/mobile/src/i18n/index.ts`
- Create: `apps/mobile/src/__tests__/appleAuth.test.ts`

- [ ] **Step 1: Install the SDK-compatible Expo package**

Run: `npx expo install expo-apple-authentication`

Expected: package and lockfile change to the Expo SDK 54-compatible version.

- [ ] **Step 2: Enable the iOS capability through Expo config**

Set:

```json
{
  "expo": {
    "ios": { "usesAppleSignIn": true },
    "plugins": ["expo-apple-authentication"]
  }
}
```

Merge the plugin into the existing plugin array; do not remove location, notifications, Apple targets, secure store, or datetime picker plugins.

- [ ] **Step 3: Write failing Apple auth tests**

Mock `expo-apple-authentication` and Supabase. Cover:

```ts
it('exchanges the Apple identity token and saves the first-login name', async () => {
  signInAsync.mockResolvedValue({
    identityToken: 'apple.jwt',
    fullName: { givenName: 'Alex', familyName: 'Chen' },
    email: 'alex@privaterelay.appleid.com',
  });
  await result.current.signInWithApple();
  expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'apple', token: 'apple.jwt' }),
  );
  expect(profileUpsert).toHaveBeenCalledWith(
    expect.objectContaining({ nickname: 'Alex Chen' }),
    expect.anything(),
  );
});

it('returns null when Apple sign-in is cancelled', async () => {
  signInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
  await expect(result.current.signInWithApple()).resolves.toBeNull();
});
```

- [ ] **Step 4: Run the Apple auth test and verify failure**

Run: `npm test -- --runInBand src/__tests__/appleAuth.test.ts`

Expected: FAIL because `signInWithApple` is not exported.

- [ ] **Step 5: Add the minimal auth flow**

In `useAuthFlow`, generate a nonce using installed `expo-crypto`, call `AppleAuthentication.signInAsync`, validate `identityToken`, then call:

```ts
const { data, error } = await supabase.auth.signInWithIdToken({
  provider: 'apple',
  token: credential.identityToken,
  nonce,
});
```

Build the nickname from the first non-empty value: Apple full name, existing profile nickname, email prefix, then `Apple User`. Upsert `profiles` while preserving the existing avatar/preferences behavior already present in the dirty worktree. Return `null` only for `ERR_REQUEST_CANCELED`; throw all other failures.

- [ ] **Step 6: Expose and render the Apple action**

Add `signInWithApple: () => Promise<User | null>` to `SessionContextValue`, return it from `useAuthFlow`, and include it in the memoized context. In `LoginScreen`, render the official `AppleAuthenticationButton` beside the existing Google control only when `isAvailableAsync()` resolves true. Use `SIGN_IN` in sign-in mode and `SIGN_UP` in sign-up mode, with explicit width/height and `cornerRadius`; reuse the existing busy state and `goToApp` navigation.

- [ ] **Step 7: Add translations and run tests**

Add the existing locale keys for Apple caption/error text, preserving all unrelated localization changes.

Run: `npm test -- --runInBand src/__tests__/appleAuth.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit only Apple-auth changes**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/app.json apps/mobile/src/screens/LoginScreen.tsx apps/mobile/src/__tests__/appleAuth.test.ts
git add -p apps/mobile/src/state/useAuthFlow.ts apps/mobile/src/state/SessionContext.tsx apps/mobile/src/i18n/index.ts
git commit -m "feat(mobile): add native Apple sign in"
```

### Task 6: Full verification and iOS handoff

**Files:**
- Modify only if verification exposes a defect in files above.

- [ ] **Step 1: Run complete automated verification**

Run: `npm test -- --runInBand`

Expected: all Jest suites PASS.

Run: `npm run typecheck`

Expected: exit code 0.

Run: `npm run lint`

Expected: no new lint errors.

- [ ] **Step 2: Verify Expo config contains the entitlement**

Run: `npx expo config --type public`

Expected: output includes `ios.usesAppleSignIn: true` and `expo-apple-authentication` in plugins.

- [ ] **Step 3: Review the final diff against the approved scope**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; unrelated pre-existing user changes remain untouched and unstaged.

- [ ] **Step 4: Document the Mac verification commands**

On macOS, rebuild the binary with `npx expo run:ios` or EAS Development Build. In Simulator, set a location and verify nearby restaurant search, each travel mode, Polyline, each member ETA, and the 45-degree confirmation camera. Verify Apple login in Simulator, then repeat Apple first login and returning login once on a physical device or TestFlight.
