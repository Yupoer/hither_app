# Android ↔ iPhone Parity QA Matrix

**Date:** 2026-07-20  
**Scope:** M4 Task 12 — App 內 1:1 視覺、操作與 accessibility parity gate  
**Rule:** Fail only for missing in-app info/action. OS-only UI (Dynamic Island, Liquid Glass material, ActivityKit avatar stack) may be **platform-equivalent** with evidence.

| Flow | iPhone reference | Android result | Status | Diff evidence | Fix task / commit |
|---|---|---|---|---|---|
| Login / guest | Guest + Email + Google + Apple | Guest + Email + Google; Apple hidden | platform-equivalent | Apple only on iOS | Task 7 |
| Login / register | Email create account | Same screens | pass | Shared LoginScreen | — |
| Onboarding | Role + permissions steps | Same RN onboarding | pass | Shared onboarding | — |
| Role selection | Leader / follower | Same | pass | Shared | — |
| Create / join / My teams | Full flow | Same | pass | Shared MyTeamsScreen | — |
| Map markers | Dest + members + pending | Google Maps provider + same overlays | pass | GroupMap PROVIDER_GOOGLE | Task 2 |
| Bottom sheet 3 stages | Peek / half / full | Same math + gestures | pass | sheetMath + MapScreen | — |
| Members / route / tools tabs | 3 tabs | Same a11y labels | pass | androidParityContract | Task 12 |
| Place search | MapKit / proxy | Google proxy + quota fallback | pass | maps.ts + google-maps fn | Task 4–5 |
| Coordinate / long-press | Sheet + validate | Same CoordinateDestinationSheet | pass | Task 3 | Task 3 |
| KML import | Document picker | content:// via copyToCacheDirectory | pass | kml tests | Task 3 |
| Sort / multi-day / meet time | Trip day + meet clock | Same | pass | Shared | — |
| Start / pause / arrive / history | Journey + history | Same domain | pass | Shared | — |
| Subgroup / solo / invite | Full | Same | pass | Shared | — |
| Commands | Leader / follower | Same + FCM/APNs | pass | send-push dual | Task 9 |
| Notification prefs | 4 toggles | Same | pass | Shared | — |
| Theme / type scale | Dynamic Type | Same RN typeScale | pass | dynamicTypeContract | — |
| Diagnostics | MetricKit + upload | Android runtime metrics + empty MetricKit spool | platform-equivalent | No MXMetricKit on Android | Task 13 |
| Live Activity | Dynamic Island / LA | Ongoing notification / ProgressStyle API 36 | platform-equivalent | No RemoteViews / no Island | Task 10 |
| Background location | Always / When in use | FG then BG; approximate-only OK | pass | backgroundJourneyController | Task 11 |
| Logout / leave cleanup | End LA + stop BG | endAllGroupActivities + stop journey | pass | clearLiveActivities | — |
| External navigation | Apple Maps | Google Maps URL | platform-equivalent | externalNavigation.ts | Task 6 |
| Haptics | UIImpact | expo-haptics | platform-equivalent | Feel may differ; presence required | Task 12 |
| Glass chrome | Liquid Glass iOS 26 | BlurView dark fallback | platform-equivalent | liquidGlass.tsx | Task 12 |

## Device matrix (manual)

| Device | API | Cases | Result | Notes |
|---|---|---|---|---|
| Pixel (target) | 36 | Live Update ProgressStyle, permissions | pending device | Promotion optional |
| Pixel / emulator | 34 | FGS location, notifications | pending device | — |
| Non-Pixel OEM | 31–34 | Background OEM limits | pending device | Record OEM name |

## Status legend

- **pass** — same in-app outcome  
- **platform-equivalent** — OS capability differs; Android native equivalent documented  
- **fail** — must fix before release (none open for code contracts)
