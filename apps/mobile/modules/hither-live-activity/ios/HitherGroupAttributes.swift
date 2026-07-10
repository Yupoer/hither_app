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

    public init(
      gatheringTitle: String? = nil,
      distanceMeters: Double? = nil,
      etaSeconds: Double? = nil,
      progress: Double? = nil,
      gatheredCount: Int? = nil,
      memberCount: Int? = nil,
      accentHex: String? = nil,
      travelMode: String? = nil,
      memberEmojis: [String]? = nil
    ) {
      self.gatheringTitle = gatheringTitle
      self.distanceMeters = distanceMeters
      self.etaSeconds = etaSeconds
      self.progress = progress
      self.gatheredCount = gatheredCount
      self.memberCount = memberCount
      self.accentHex = accentHex
      self.travelMode = travelMode
      self.memberEmojis = memberEmojis
    }

    /// Build a ContentState from the loosely-typed dict the JS bridge sends.
    public init(from state: [String: Any]) {
      self.gatheringTitle = state["gatheringTitle"] as? String
      self.distanceMeters = (state["distanceMeters"] as? NSNumber)?.doubleValue
      self.etaSeconds = (state["etaSeconds"] as? NSNumber)?.doubleValue
      self.progress = (state["progress"] as? NSNumber)?.doubleValue
      self.gatheredCount = (state["gatheredCount"] as? NSNumber)?.intValue
      self.memberCount = (state["memberCount"] as? NSNumber)?.intValue
      self.accentHex = state["accentHex"] as? String
      self.travelMode = state["travelMode"] as? String
      self.memberEmojis = state["memberEmojis"] as? [String]
    }

    /// "320 m" / "1.2 km" — matches the in-app carousel's formatting.
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
