# Services classification (Route A)

How each service in this folder maps onto the new architecture. **Reference
only** — these files are not compiled into the shipping app (which is RN +
Supabase). Kept so the native-capability code can be ported.

## Port to a native module (device capability)

| File | Port to | Notes |
|---|---|---|
| `LocationService.swift` | `apps/mobile/modules/hither-location` | CoreLocation; drop Firestore writes (location goes to Supabase `member_locations` from RN). |
| `LiveActivityService.swift` | `apps/mobile/modules/hither-live-activity` | ActivityKit; pair with `../Models/ActivityAttributes.swift` and `../../Widgets/*`. |
| `NotificationService.swift` | `apps/mobile/modules/hither-notifications` | Keep device-token + handling only; sending is a Supabase Edge Function. |
| `GoogleMapsService.swift`, `DirectionService.swift` | `apps/mobile/modules/hither-maps` | Prefer Apple MapKit to drop the Google dependency + API key. |

## Do NOT reuse — superseded by RN + Supabase

| File | Replaced by |
|---|---|
| `GroupService.swift` | RN data layer over Supabase `groups` / `memberships` (RLS). |
| `ItineraryService.swift` | Supabase `itinerary_items` (RLS; leader-only writes). |
| `CommandService.swift` | RN + Supabase (table + Realtime / Edge Function). |
| `FindRequestService.swift` | RN + Supabase. |
| `AuthenticationService.swift` (Firebase/Apple/Google) | Supabase Auth (anonymous sign-in for MVP). |
| `DevelopmentService.swift`, `FirebaseExtensions.swift`, `ServiceOperationHandler.swift`, `DistanceCalculationManager.swift`, `LanguageService.swift`, `ThemeManager.swift`, `LocalizedLogger.swift` | RN equivalents / not needed. |

**Firebase is cut.** Any Firestore/FCM/Firebase Auth code here is dead for the
new app — keep it only as a behavioural reference while porting capability code.
