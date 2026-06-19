import ActivityKit
import Foundation

// Shared Live Activity attributes for the Hither "heading to gathering point"
// activity. This SAME type must compile into BOTH targets:
//   1) the HitherLiveActivity Expo module (this pod) — starts/updates/ends it
//   2) the Widget Extension — renders it on the lock screen / Dynamic Island
// so the system can match `Activity<HitherGroupAttributes>` across processes.
// The Widget target references this file via the expo-apple-targets config
// (see apps/mobile/targets/live-activity); keep the shape in lockstep with the
// JS `GroupActivityState` in src/native/liveActivity.ts.

public struct HitherGroupAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var gatheringTitle: String?
    public var distanceMeters: Double?
    public var etaSeconds: Double?

    public init(
      gatheringTitle: String? = nil,
      distanceMeters: Double? = nil,
      etaSeconds: Double? = nil
    ) {
      self.gatheringTitle = gatheringTitle
      self.distanceMeters = distanceMeters
      self.etaSeconds = etaSeconds
    }

    /// Build a ContentState from the loosely-typed dict the JS bridge sends.
    public init(from state: [String: Any]) {
      self.gatheringTitle = state["gatheringTitle"] as? String
      self.distanceMeters = (state["distanceMeters"] as? NSNumber)?.doubleValue
      self.etaSeconds = (state["etaSeconds"] as? NSNumber)?.doubleValue
    }

    /// "320 m" / "1.2 km" — matches the in-app banner's formatting.
    public var formattedDistance: String? {
      guard let d = distanceMeters else { return nil }
      if d < 1000 { return "\(Int(d.rounded())) m" }
      return String(format: "%.1f km", d / 1000)
    }

    /// "about 4 min" — rough walking ETA for the lock-screen line.
    public var formattedEta: String? {
      guard let s = etaSeconds else { return nil }
      let minutes = Int((s / 60).rounded())
      return minutes < 1 ? "< 1 min" : "about \(minutes) min"
    }
  }

  public var groupName: String

  public init(groupName: String) {
    self.groupName = groupName
  }
}
