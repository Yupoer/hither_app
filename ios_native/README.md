# ios_native/ — status after Route A refactor

Hither's UI and business logic now live in **React Native** (`apps/mobile`),
with thin native modules under `apps/mobile/modules/` and the backend on
**Supabase**. This `ios_native/` tree is the **old standalone Swift app** and
is kept for **reference only** — nothing here is the shipping app anymore.

Two things still make it useful, so it is **not deleted**:

1. **Native-module base** — the device-capability services are the source to
   port from when filling in the Phase B stubs in `apps/mobile/modules/`.
2. **Design/behaviour reference** — the SwiftUI screens document the intended
   UX while the RN screens catch up.

## Classification

### A. Native-module base (port device-capability code from here → `apps/mobile/modules/`)

| Swift source | → RN native module | JS boundary |
|---|---|---|
| `hither/Hither/Services/LocationService.swift` | `hither-location` | `src/native/location.ts` |
| `hither/Hither/Services/LiveActivityService.swift` + `Models/ActivityAttributes.swift` + `Widgets/*` | `hither-live-activity` | `src/native/liveActivity.ts` |
| `hither/Hither/Services/NotificationService.swift` | `hither-notifications` | `src/native/notifications.ts` |
| `hither/Hither/Services/GoogleMapsService.swift` + `DirectionService.swift` + `Utils/GoogleMapsParser.swift` | `hither-maps` (prefer MapKit) | `src/native/maps.ts` |

Port **device-capability code only**. Drop the Firebase coupling.

### B. Business logic — DO NOT reuse (now RN + Supabase)

`GroupService`, `ItineraryService`, `CommandService`, `FindRequestService`,
`AuthenticationService`, `DistanceCalculationManager`, and the Firebase-bound
models are **superseded**. Group / itinerary / member / command logic lives in
RN against Supabase (Postgres + RLS + Realtime); auth is Supabase anonymous
sign-in. **Firebase is cut** — do not wire any of these into the new app. See
`hither/Hither/Services/SERVICES_CLASSIFICATION.md`.

### C. Pure UI / demo — reference only

- `hitherUI/` — the SwiftUI design prototype. See `hitherUI/REFERENCE_ONLY.md`.
- `hither/Hither/ContentView.swift`, `HitherApp.swift`, and the SwiftUI views —
  reference for screen structure; the RN screens in `apps/mobile/src/screens`
  are the real implementation.

> Files are left in place (not moved) so the two Xcode projects still build as
> a reference. Remove this tree only once the RN + native-module + Supabase
> stack is proven end-to-end.
