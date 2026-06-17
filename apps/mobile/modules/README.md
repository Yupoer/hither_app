# Hither native modules (Phase B scaffold)

Custom Expo modules (Expo Modules API) that are the iOS/Android native
backing for the JS capability boundary in `apps/mobile/src/native/*`.

| Module | JS boundary | Native base to port from |
|---|---|---|
| `hither-location` | `src/native/location.ts` | `ios_native/hither/Hither/Services/LocationService.swift` |
| `hither-live-activity` | `src/native/liveActivity.ts` | `LiveActivityService.swift` + `Models/ActivityAttributes.swift` + `Widgets/WidgetsLiveActivity.swift` |
| `hither-notifications` | `src/native/notifications.ts` | `NotificationService.swift` |
| `hither-maps` | `src/native/maps.ts` | `GoogleMapsService.swift` (prefer Apple MapKit) |

## Status: SCAFFOLD ONLY — not yet compiled or verified

These contain Swift/Kotlin **stubs** (return null / empty). They are **not**
loaded in Expo Go and **cannot be compiled on Windows** — building iOS
native code needs macOS/Xcode or EAS (cloud macOS).

### How the seam works (no Expo Go regression)

`src/native/*` reaches each module by name with
`requireOptionalNativeModule('HitherXxx')` from `expo-modules-core`:

- **Expo Go**: the module is absent → returns `null` → the existing Expo
  implementation (expo-location / expo-notifications / Nominatim) runs.
- **EAS Dev Build / prebuild**: the module is linked → it backs the call
  through the identical interface.

The app JS never imports these modules' own source, so Metro/Expo Go ignore
them entirely until a native build.

## To actually build & verify (later, needs macOS or EAS)

```bash
cd apps/mobile
npx expo prebuild                       # generates ios/ android/, autolinks modules/
eas build --profile development --platform ios   # cloud macOS build
# install the dev build, then `npx expo start --dev-client`
```

Until then, treat every native path as a stub. Do not claim Live Activities,
APNs tokens, precise/background GPS, or MapKit search work — they don't yet.

## Boundary rule

Keep ONLY device-capability code in these modules. Group / itinerary /
member / command business logic stays in RN + Supabase (RLS). No Firebase.
