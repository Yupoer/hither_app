# iOS Native Salvage Reference

When moving to the React Native app, the old SwiftUI **layout (Views)** is being
dropped. The **reusable tools** — domain logic, parsers, and service contracts —
are worth porting to TypeScript. This file catalogues what existed in
`ios_native/hither/Hither` so that logic can be re-implemented in
`apps/mobile/src` without re-deriving it.

> The Swift source for these still lives under `ios_native/hither/Hither/{Services,Utils,Models}`.
> Only `Views/` was deleted (old layout). Treat the items below as **reference to
> port**, not as code to call directly from React Native.

## High-value tools to port (logic, not layout)

| Swift source | What it does | Port target in RN |
| --- | --- | --- |
| `Utils/GoogleMapsParser.swift` | Parses Google Maps share/app URLs (`?q=lat,lng`, `maps.app.goo.gl`, etc.) into coordinate + name/address. Pure string/URL logic. | `src/utils/googleMapsParser.ts` — used when importing a destination from a pasted Maps link. |
| `Services/DistanceCalculationManager.swift` | Debounced (2s) distance monitoring between the user and targets, off the UI thread. | `src/utils/distance.ts` — Haversine + debounce; feeds member distance on Map screen. |
| `Services/DirectionService.swift` | Bearing/distance to leader & targets; NearbyInteraction (UWB) for close-range direction. | Bearing math is portable; UWB is iOS-only and stays a native module if needed. |
| `Services/GoogleMapsService.swift` / `Services/ItineraryService.swift` | Directions API calls (travel distance/time in m/s) and itinerary CRUD. | Map to `src/api/client.ts` calls against the Vapor API (`/groups/:id/itineraries`). |
| `Services/GroupService.swift` / `Services/AuthenticationService.swift` | Group create/join/leave + invite codes; login/JWT session handling. | Already stubbed in `src/api/client.ts`; wire to real endpoints. |
| `Services/LocationService.swift` | Foreground/background location updates. | RN: `expo-location`; pushes to `PUT /me/location`. |
| `Services/LanguageService.swift` | Mixed zh/en localization handling. | RN i18n config. |

## Native-only / lower priority (keep as iOS native module or defer)

- `LiveActivityService.swift`, `Models/ActivityAttributes.swift` — Live Activities (out of MVP scope; iOS-only).
- `NotificationService.swift` — push notifications (platform-specific).
- `ThemeManager.swift`, `ThemeConfiguration.swift` — theming; superseded by RN design system.
- `CommandService.swift`, `FindRequestService.swift`, `DevelopmentService.swift`, `ServiceOperationHandler.swift`, `LocalizedLogger.swift`, `FirebaseExtensions.swift` — review per feature when that feature is built in RN.

## Data models cross-check

`Models/{Group,User,Itinerary,Command,MapTypes}.swift` were cross-checked against
the new TypeScript types in `src/types`. The RN types are aligned to the **Vapor
API** (`hither_api`) models, which is the source of truth — see `src/types/*`.
