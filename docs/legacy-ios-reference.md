# Legacy Native iOS App — Reference Notes

> Extracted from `ios_native/hither` and `ios_native/hitherUI` before deletion.
> These projects were Firebase-backed Swift/SwiftUI prototypes superseded by the current React Native + Supabase stack in `apps/mobile`.

---

## 1. Design System (DSD v1.2)

**Design Philosophy (3 principles):**
1. **Clarity First** — 資訊清晰勝過裝飾。充足留白、強視覺層級、一致佈局。
2. **Purposeful Energy** — 在關鍵互動點注入活力。顏色和動效引導用戶、提供回饋。
3. **Fluid & Responsive** — 每次點擊滑動即時回饋。細膩轉場、手勢操作。

**Color System (semantic, dark/light):**

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--background` | `#f8fafc` | `#020817` | Page background |
| `--foreground` | `#020817` | `#f8fafc` | Primary text |
| `--card` | `#ffffff` | `#0f172a` | Card backgrounds |
| `--primary` | `#2563eb` | `#3b82f6` | Core action buttons, focus |
| `--secondary` | `#f1f5f9` | `#1e293b` | Secondary buttons, info blocks |
| `--accent` | `#eff6ff` | `#172554` | Selected item highlight |
| `--destructive` | `#ef4444` | `#7f1d1d` | Danger-only actions |

**Typography:**
- H1: 32pt Bold / H2: 24pt Bold / Body: 17pt Regular / Caption: 15pt Regular / Button: 17pt SemiBold
- Sans: SF Pro (all UI) / Serif: New York (marketing headers only) / Mono: SF Mono (invite codes)

**Spacing/Radius:** Base 4pt unit (`--spacing: 0.25rem`). Main radius 12pt (`--radius: 0.75rem`).

**Icon Color Strategy (Duotone):**
- **Default — Trusty Blue:** fill `#2563eb` / accent `#eff6ff` (dark: `#3b82f6` / `#172554`) — all persistent/functional icons (tab bar, settings)
- **Situational — Indigo Energy:** `#4f46e5` / `#7c3aed` — reward/achievement unlocks
- **Situational — Stable Green:** `#16a34a` / `#f1f5f9` — success/connected/safe states

**Brand:** 綿羊 (sheep) is the official Hither mascot — used in error and success illustrations.

---

## 2. Domain Models

### MemberRole & MemberStatus

```swift
enum MemberRole: String { case leader, follower }

enum MemberStatus: String {
    case gathered  // ✅ Ready/assembled
    case deviated  // ❌ Off course/too far
    case resting   // 😴 Taking a break
    case help      // 🆘 Needs assistance
    case normal    // Default (no special status)
}
```

### WaypointType (with icon + color)

```swift
enum WaypointType: String {
    case meetingPoint  // icon: "person.2.circle",   color: blue
    case restStop      // icon: "pause.circle",       color: orange
    case lunch         // icon: "fork.knife.circle",  color: green
    case destination   // icon: "flag.circle",        color: red
    case checkpoint    // icon: "checkmark.circle",   color: purple
    case emergency     // icon: "cross.circle",       color: red
    case custom        // icon: "mappin.circle",      color: gray
}
```

Waypoint state machine flags: `isActive`, `isCompleted`, `isInProgress` (going state).

`GroupItinerary` computed helpers: `activeWaypoints`, `upcomingWaypoints`, `currentWaypoint`, `completedWaypoints`, `nextWaypoint`.

### CommandType (Leader vs Follower, with icon + i18n)

**Leader commands:** `gather`, `depart`, `rest`, `beCareful`, `goLeft`, `goRight`, `stop`, `hurryUp`, `custom`

**Follower requests:** `needRestroom`, `needBreak`, `needHelp`, `foundSomething`

Each case has: `.displayName` (localized), `.icon` (SF Symbol name), `.defaultMessage` (localized), `.isLeaderCommand` bool.

Pattern: enum with rich associated metadata. Avoid stringly-typed command strings — use this enum shape in React Native equivalent.

### GroupCommand & FindRequest

```swift
struct GroupCommand { id, groupId, senderId, senderName, type: CommandType, message, timestamp, location }
struct FindRequest { id, requesterId, targetId, status: FindRequestStatus, createdAt, expiresAt }
// FindRequestStatus: pending | approved | denied | expired — expires after 30 min
```

### Invite Code Generation

```swift
// 6-char alphanumeric, uppercase
let letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
String((0..<6).map { _ in letters.randomElement()! })
```

### Group Session Status

`groupStatus` string values: `"going"`, `"stop"`, `"rest"`, `"waiting"`, `"arrived"`

Status → color map: going→blue, stop→red, rest→orange, waiting→gray, arrived→green

---

## 3. Native Capabilities (not yet in React Native)

### 3.1 NearbyInteraction (UWB Precision Finding)

Uses Apple's `NearbyInteraction` framework for <50m precision (like AirTag). Requires UWB hardware (iPhone 11+).

```swift
// Setup
if #available(iOS 16.0, *) {
    isAvailable = NISession.deviceCapabilities.supportsPreciseDistanceMeasurement
} else {
    isAvailable = NISession.isSupported
}
niSession = NISession()
niSession?.delegate = self

// Start session with peer token (token must be exchanged out-of-band, e.g., via Supabase)
let config = NINearbyPeerConfiguration(peerToken: discoveryToken)
niSession.run(config)

// Delegate: convert simd_float3 direction to bearing angle
func session(_ session: NISession, didUpdate nearbyObjects: [NINearbyObject]) {
    if let direction = nearbyObject.direction {
        let bearing = atan2(Double(direction.x), Double(direction.z)) * 180 / .pi
        // normalize to 0-360: bearing >= 0 ? bearing : bearing + 360
    }
}
```

**Integration point:** `currentDiscoveryToken` must be shared to the remote peer via Supabase realtime or presence. Both peers run a session and exchange tokens to enable UWB ranging.

**RN module target:** `apps/mobile/modules/hither-location` or a new `hither-nearby` module.

### 3.2 Live Activities (Lock Screen / Dynamic Island)

Requires iOS 16.1+. Widget Extension target needed in Xcode.

**ActivityAttributes shape:**

```swift
struct HitherGroupAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let currentDistance: Double?   // meters to destination
        let totalDistance: Double?     // meters at start
        let destinationName: String?
        let groupStatus: String        // "going"|"stop"|"rest"|"waiting"|"arrived"
        let memberCount: Int
        let leaderName: String
        let isCountdownActive: Bool
        let countdownStartTime: Date?
        let countdownDuration: TimeInterval  // default 60s
        let message: String?

        // Computed
        var remainingTime: TimeInterval  // countdownDuration - elapsed
        var formattedRemainingTime: String  // "MM:SS"
        var progressPercentage: Double   // 0-100 countdown
        var locationProgressPercentage: Double  // (total-current)/total * 100
        var formattedCurrentDistance: String  // "500 m" or "1.2 km"
    }

    let groupName: String
    let groupId: String
    let userRole: String   // "leader" | "follower"
    let activityType: String  // "navigation"
}
```

**Key API calls:**

```swift
// Start
let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)

// Update
await activity.update(ActivityContent(state: newState, staleDate: ...))

// End
await activity.end(.init(state: finalState, staleDate: nil), dismissalPolicy: .immediate)
```

**Gotchas:**
- Live Activities do not work on Simulator — must test on device.
- Check `ActivityAuthorizationInfo().areActivitiesEnabled` before calling.
- Stale date: set ~2 hours out for navigation, ~2 minutes for frequent updates.
- 1-minute countdown pattern: set `countdownStartTime = Date()`, sleep 61s, then call `finishCountdown()`.

**RN module target:** `apps/mobile/modules/hither-live-activity`

### 3.3 Battery-Aware Location Tracking

```swift
// Location update interval adapts to battery
func getOptimalUpdateInterval() -> TimeInterval {
    let level = UIDevice.current.batteryLevel
    let state = UIDevice.current.batteryState

    var interval: TimeInterval = 30  // default
    if level < 0.2 { interval = 120 }       // <20%: every 2 min
    else if level < 0.5 { interval = 60 }   // <50%: every 1 min
    if state == .charging || state == .full { interval = min(interval, 15) }
    return interval
}

// Accuracy also degrades under low battery
if level < 0.2 {
    accuracy = kCLLocationAccuracyHundredMeters
    distanceFilter = 50
} else {
    accuracy = kCLLocationAccuracyBest
    distanceFilter = 10
}
```

Also sends low-battery notification when battery is 10-15% (can trigger push to group).

Background tracking: only enabled when `UIBackgroundModes` key exists in Info.plist AND authorization is `.authorizedAlways`.

### 3.4 Destination Proximity Monitoring (for Live Activity)

Arrival threshold: 10m. Records `initialDistance` at start to compute progress percentage.
Fires `onReached()` callback once within threshold, then clears itself.
`onProgressUpdate(currentDistance, initialDistance)` fires on every location update.

### 3.5 Bearing Calculation (GPS-based)

```swift
func calculateBearing(to coordinate: CLLocationCoordinate2D) -> Double? {
    let lat1 = currentLocation.coordinate.latitude * .pi / 180
    let lat2 = coordinate.latitude * .pi / 180
    let dLon = (coordinate.longitude - currentLocation.coordinate.longitude) * .pi / 180
    let y = sin(dLon) * cos(lat2)
    let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
    let bearing = atan2(y, x) * 180 / .pi
    return bearing >= 0 ? bearing : bearing + 360
}

// Convert bearing to 8-compass direction
let directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
let index = Int((bearing + 22.5) / 45) % 8
```

---

## 4. Performance Patterns

### Debounced Distance Calculation Manager

Singleton that batches GPS distance calculations to avoid timer proliferation and UI thread pressure.

```swift
// Pattern: centralized manager, 2s debounce, background queue
class DistanceCalculationManager {
    static let shared = DistanceCalculationManager()
    private let debounceInterval: TimeInterval = 2.0
    private let calculationQueue = DispatchQueue(label: "com.hither.distance-calculation", qos: .utility)

    // Register a target to monitor
    func startMonitoring(targetId: String, coordinate: CLLocationCoordinate2D, onDistanceUpdate: (Double) -> Void)

    // One-shot request: immediate if debounce expired, else queued to next batch
    func requestDistanceCalculation(targetId:, userLocation:, targetLocation:, completion:)
}

// Timer fires every 2s, processes all pending calculations concurrently with TaskGroup
Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
    Task { await processPendingCalculations() }
}
```

**Why this matters:** Without this, each map member card creates its own Timer. With 10+ members, that causes 10+ concurrent timers hammering the main thread. This manager collapses them to one 2s cycle.

---

## 5. UI Patterns (from hitherUI prototype)

**Tab bar height:** 49pt (standard iOS tab bar height).

Note: DSD v1.2 colors (section 1 above) are the current design authority. The early hitherUI red palette (`#EA2A33`) was abandoned.

---

## 6. What Was NOT Kept

The following were Firebase-specific and have been replaced in Supabase + RN:

- `GroupService` / `ItineraryService` / `CommandService` / `FindRequestService` → Supabase tables + Realtime
- `AuthenticationService` (Firebase anonymous auth) → Supabase anonymous sign-in
- `FirebaseExtensions` / `ServiceOperationHandler`
- Firestore schema (groups/{id}/members/{id} subcollection pattern) → Supabase flat tables with RLS

Unit/UI tests were Firebase-dependent — not preserved. Test scenarios (group lifecycle, map interaction, find-member flow, command broadcast) should be rewritten against the Supabase stack.
