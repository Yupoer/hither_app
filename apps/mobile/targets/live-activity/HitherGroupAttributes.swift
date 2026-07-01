import ActivityKit
import Foundation

// COPY of apps/mobile/modules/hither-live-activity/ios/HitherGroupAttributes.swift
// so this widget target compiles standalone. ActivityKit matches the activity
// across the app and this extension by the attributes' type name + structure,
// so the two definitions MUST stay byte-for-byte equivalent in shape. If you
// edit one, edit the other.

// Keep in sync with the module copy: `@available(iOS 16.1, *)` gates the
// ActivityKit-backed type so the module pod compiles to the app's 15.1 floor.
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

    public init(
      gatheringTitle: String? = nil,
      distanceMeters: Double? = nil,
      etaSeconds: Double? = nil,
      progress: Double? = nil,
      gatheredCount: Int? = nil,
      memberCount: Int? = nil
    ) {
      self.gatheringTitle = gatheringTitle
      self.distanceMeters = distanceMeters
      self.etaSeconds = etaSeconds
      self.progress = progress
      self.gatheredCount = gatheredCount
      self.memberCount = memberCount
    }

    public init(from state: [String: Any]) {
      self.gatheringTitle = state["gatheringTitle"] as? String
      self.distanceMeters = (state["distanceMeters"] as? NSNumber)?.doubleValue
      self.etaSeconds = (state["etaSeconds"] as? NSNumber)?.doubleValue
      self.progress = (state["progress"] as? NSNumber)?.doubleValue
      self.gatheredCount = (state["gatheredCount"] as? NSNumber)?.intValue
      self.memberCount = (state["memberCount"] as? NSNumber)?.intValue
    }

    public var formattedDistance: String? {
      guard let d = distanceMeters else { return nil }
      if d < 1000 { return "\(Int(d.rounded())) m" }
      return String(format: "%.1f km", d / 1000)
    }

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
