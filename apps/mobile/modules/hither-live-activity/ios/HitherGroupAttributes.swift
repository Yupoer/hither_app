import ActivityKit
import Foundation

// Shared Live Activity attributes for the Hither "heading to gathering point"
// activity. This SAME type must compile into BOTH targets:
//   1) the HitherLiveActivity Expo module (this pod) — starts/updates/ends it
//   2) the Widget Extension — renders it on the lock screen / Dynamic Island
// so the system can match `Activity<HitherGroupAttributes>` across processes.
// The Widget target references a byte-for-byte COPY of this file (see
// apps/mobile/targets/live-activity/HitherGroupAttributes.swift); keep the two
// in lockstep, and keep the shape aligned with the JS `GroupActivityState` in
// src/native/liveActivity.ts.

// `ActivityAttributes` ships in ActivityKit (iOS 16.1+). Marking the type
// available keeps its 16.x API surface properly gated, so this module's pod
// still compiles down to the app's iOS 15.1 deployment floor instead of
// silently demanding 16.2 (which broke `import HitherLiveActivity` in the app
// target and failed the whole build, so no Live Activity ever appeared).
@available(iOS 16.1, *)
public struct HitherGroupAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var navigationSessionId: String?
    public var status: String?
    public var gatheringTitle: String?
    public var distanceMeters: Double?
    public var etaSeconds: Double?
    /// Flock progress toward the point, 0...1 (drives the progress bar).
    public var progress: Double?
    /// How many members have reached the point.
    public var gatheredCount: Int?
    /// Total members in the group (for the avatar stack).
    public var memberCount: Int?
    /// Active theme accent as a hex string ("#F5B142") — the widget tints with
    /// this so the Live Activity follows the app's theme colour.
    public var accentHex: String?
    /// Travel mode ("walk" | "transit" | "drive") for the transit glyph.
    public var travelMode: String?
    /// Member avatar emojis for the flock stack ("" = no emoji).
    public var memberEmojis: [String]?
    /// Arrival state aligned by index with `memberEmojis`.
    public var memberArrived: [Bool]?

    public init(
      navigationSessionId: String? = nil,
      status: String? = nil,
      gatheringTitle: String? = nil,
      distanceMeters: Double? = nil,
      etaSeconds: Double? = nil,
      progress: Double? = nil,
      gatheredCount: Int? = nil,
      memberCount: Int? = nil,
      accentHex: String? = nil,
      travelMode: String? = nil,
      memberEmojis: [String]? = nil,
      memberArrived: [Bool]? = nil
    ) {
      self.navigationSessionId = navigationSessionId
      self.status = status
      self.gatheringTitle = gatheringTitle
      self.distanceMeters = distanceMeters
      self.etaSeconds = etaSeconds
      self.progress = progress
      self.gatheredCount = gatheredCount
      self.memberCount = memberCount
      self.accentHex = accentHex
      self.travelMode = travelMode
      self.memberEmojis = memberEmojis
      self.memberArrived = memberArrived
    }

    /// Build a ContentState from the loosely-typed dict the JS bridge sends.
    public init(from state: [String: Any]) {
      self.navigationSessionId = state["navigationSessionId"] as? String
      self.status = state["status"] as? String
      self.gatheringTitle = state["gatheringTitle"] as? String
      self.distanceMeters = (state["distanceMeters"] as? NSNumber)?.doubleValue
      self.etaSeconds = (state["etaSeconds"] as? NSNumber)?.doubleValue
      self.progress = (state["progress"] as? NSNumber)?.doubleValue
      self.gatheredCount = (state["gatheredCount"] as? NSNumber)?.intValue
      self.memberCount = (state["memberCount"] as? NSNumber)?.intValue
      self.accentHex = state["accentHex"] as? String
      self.travelMode = state["travelMode"] as? String
      self.memberEmojis = state["memberEmojis"] as? [String]
      self.memberArrived = state["memberArrived"] as? [Bool]
    }

    /// "320 m" / "1.2 km" — matches the in-app carousel's formatting.
    public var formattedDistance: String? {
      guard let d = distanceMeters else { return nil }
      if d < 1000 { return "\(Int(d.rounded())) m" }
      return String(format: "%.1f km", d / 1000)
    }

    /// Compact ETA: "now" / "12 min" / "1hr30" / "1d12hr" — matches in-app formatShortEta.
    public var formattedEta: String? {
      guard let s = etaSeconds else { return nil }
      return Self.compactDuration(fromSeconds: s)
    }

    /// Shared compact duration used by the widget presentation helpers too.
    public static func compactDuration(fromSeconds seconds: Double) -> String {
      let m = Int((seconds / 60).rounded())
      if m < 1 { return "now" }
      if m < 60 { return "\(m) min" }
      return compactDuration(fromMinutes: m)
    }

    /// 90 → "1hr30", 300 → "5hr", 2160 → "1d12hr". Day scale drops remaining minutes.
    public static func compactDuration(fromMinutes minutes: Int) -> String {
      let m = max(0, minutes)
      if m < 60 { return "\(m)min" }
      let h = m / 60
      let mm = m % 60
      if h < 24 {
        return mm == 0 ? "\(h)hr" : "\(h)hr\(mm)"
      }
      let d = h / 24
      let rh = h % 24
      return rh == 0 ? "\(d)d" : "\(d)d\(rh)hr"
    }
  }

  public var groupName: String

  public init(groupName: String) {
    self.groupName = groupName
  }
}
