import ActivityKit
import Foundation

// The app module and widget extension compile identical copies of this ActivityKit payload.
@available(iOS 16.1, *)
public struct HitherGroupAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var navigationSessionId: String?
    public var destinationId: String?
    public var personalArrived: Bool?
    public var personalArrivalAtMs: Double?
    public var personalArrivalSequence: Double?
    public var personalArrivalCorrectionAtMs: Double?
    public var status: String?
    public var phase: Phase?
    public var gatheringTitle: String?
    public var distanceMeters: Double?
    public var etaSeconds: Double?
    public var sampledAtMs: Double?
    public var etaTargetAtMs: Double?
    public var progress: Double?
    public var gatheredCount: Int?
    public var memberCount: Int?
    public var accentHex: String?
    public var travelMode: String?
    public var memberEmojis: [String]?
    public var memberArrived: [Bool]?
    public var destinationEmoji: String?
    public var language: String?
    public var meetTimeMs: Double?
    public var dayColorHex: String?
    public var selfFace: Face?
    public var memberColors: [String]?

    public struct Face: Codable, Hashable {
      public var emoji: String
      public var colorHex: String?
      public var arrived: Bool

      public init(emoji: String, colorHex: String? = nil, arrived: Bool = false) {
        self.emoji = emoji
        self.colorHex = colorHex
        self.arrived = arrived
      }
    }

    public enum Phase: String, Codable, Hashable {
      case enRoute, late, arrivedWaiting, allArrived
    }

    public struct Presentation: Equatable {
      public var phase: Phase
      public var title: String
      public var icon: String
      public var accentHex: String?
      public var dayColorHex: String?
      public var etaMinutes: Int?
      public var progress: Double
      public var meetTime: Date?
      public var arrived: Int
      public var total: Int
      public var selfFace: Face?
      public var memberFaces: [Face]
      public var english: Bool

      public var arrivalRatio: Double { total > 0 ? Double(arrived) / Double(total) : 0 }
      public var countLabel: String { total > 0 ? "\(arrived)/\(total)" : "–" }
      public var etaUnit: String { english ? "min" : "分" }
      public var isTraveling: Bool { phase == .enRoute || phase == .late }
    }

    public init(
      navigationSessionId: String? = nil,
      destinationId: String? = nil,
      personalArrived: Bool? = nil,
      personalArrivalAtMs: Double? = nil,
      personalArrivalSequence: Double? = nil,
      personalArrivalCorrectionAtMs: Double? = nil,
      status: String? = nil,
      phase: Phase? = nil,
      gatheringTitle: String? = nil,
      distanceMeters: Double? = nil,
      etaSeconds: Double? = nil,
      sampledAtMs: Double? = nil,
      etaTargetAtMs: Double? = nil,
      progress: Double? = nil,
      gatheredCount: Int? = nil,
      memberCount: Int? = nil,
      accentHex: String? = nil,
      travelMode: String? = nil,
      memberEmojis: [String]? = nil,
      memberArrived: [Bool]? = nil,
      destinationEmoji: String? = nil,
      language: String? = nil,
      meetTimeMs: Double? = nil,
      dayColorHex: String? = nil,
      selfFace: Face? = nil,
      memberColors: [String]? = nil
    ) {
      self.navigationSessionId = navigationSessionId
      self.destinationId = destinationId
      self.personalArrived = personalArrived
      self.personalArrivalAtMs = personalArrivalAtMs
      self.personalArrivalSequence = personalArrivalSequence
      self.personalArrivalCorrectionAtMs = personalArrivalCorrectionAtMs
      self.status = status
      self.phase = phase
      self.gatheringTitle = gatheringTitle
      self.distanceMeters = distanceMeters
      self.etaSeconds = etaSeconds
      self.sampledAtMs = sampledAtMs
      self.etaTargetAtMs = etaTargetAtMs
      self.progress = progress
      self.gatheredCount = gatheredCount
      self.memberCount = memberCount
      self.accentHex = accentHex
      self.travelMode = travelMode
      self.memberEmojis = memberEmojis
      self.memberArrived = memberArrived
      self.destinationEmoji = destinationEmoji
      self.language = language
      self.meetTimeMs = meetTimeMs
      self.dayColorHex = dayColorHex
      self.selfFace = selfFace
      self.memberColors = memberColors
    }

    /// Build a ContentState from the loosely-typed dict the JS bridge sends.
    public init(from state: [String: Any]) {
      self.navigationSessionId = state["navigationSessionId"] as? String
      self.destinationId = state["destinationId"] as? String
      self.personalArrived = state["personalArrived"] as? Bool
      self.personalArrivalAtMs = (state["personalArrivalAtMs"] as? NSNumber)?.doubleValue
      self.personalArrivalSequence = (state["personalArrivalSequence"] as? NSNumber)?.doubleValue
      self.personalArrivalCorrectionAtMs = (state["personalArrivalCorrectionAtMs"] as? NSNumber)?.doubleValue
      self.status = state["status"] as? String
      self.phase = (state["phase"] as? String).flatMap(Phase.init(rawValue:))
      self.gatheringTitle = state["gatheringTitle"] as? String
      self.distanceMeters = (state["distanceMeters"] as? NSNumber)?.doubleValue
      self.etaSeconds = (state["etaSeconds"] as? NSNumber)?.doubleValue
      self.sampledAtMs = (state["sampledAtMs"] as? NSNumber)?.doubleValue
      self.etaTargetAtMs = (state["etaTargetAtMs"] as? NSNumber)?.doubleValue
      self.progress = (state["progress"] as? NSNumber)?.doubleValue
      self.gatheredCount = (state["gatheredCount"] as? NSNumber)?.intValue
      self.memberCount = (state["memberCount"] as? NSNumber)?.intValue
      self.accentHex = state["accentHex"] as? String
      self.travelMode = state["travelMode"] as? String
      self.memberEmojis = state["memberEmojis"] as? [String]
      self.memberArrived = state["memberArrived"] as? [Bool]
      self.destinationEmoji = state["destinationEmoji"] as? String
      self.language = state["language"] as? String
      self.meetTimeMs = (state["meetTimeMs"] as? NSNumber)?.doubleValue
      self.dayColorHex = state["dayColorHex"] as? String
      self.memberColors = state["memberColors"] as? [String]
      if let face = state["selfFace"] as? [String: Any], let emoji = face["emoji"] as? String {
        self.selfFace = Face(
          emoji: emoji,
          colorHex: face["colorHex"] as? String,
          arrived: face["arrived"] as? Bool ?? false
        )
      }
    }

    public func presentation(groupName: String, now: Date = .now) -> Presentation {
      let english = language?.lowercased().hasPrefix("en") == true
      let title = [gatheringTitle, groupName].compactMap {
        $0?.trimmingCharacters(in: .whitespacesAndNewlines)
      }.first(where: { !$0.isEmpty }) ?? (english ? "Meeting point" : "集合點")
      let destinationIcon = destinationEmoji?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let total = max(0, memberCount ?? memberEmojis?.count ?? 0)
      let arrived = max(0, min(total, gatheredCount ?? memberArrived?.filter { $0 }.count ?? 0))
      let validEta = etaSeconds.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
      let minutes = status == "starting" && validEta == 0 ? nil : validEta.map {
        Int(min(9999, ($0 / 60).rounded(.up)))
      }
      let meetTime = meetTimeMs.flatMap { value in
        value.isFinite && value > 0 ? Date(timeIntervalSince1970: value / 1000) : nil
      }
      let etaTarget = etaTargetAtMs.flatMap { value in
        value.isFinite && value > 0 ? Date(timeIntervalSince1970: value / 1000) : nil
      } ?? minutes.map { now.addingTimeInterval(Double($0) * 60) }

      let phase: Phase
      if self.phase == .allArrived || (total > 0 && arrived == total) {
        phase = .allArrived
      } else if personalArrived == true {
        phase = .arrivedWaiting
      } else if let meetTime, let etaTarget, etaTarget > meetTime {
        phase = .late
      } else {
        phase = .enRoute
      }
      let traveling = phase == .enRoute || phase == .late
      let progress = progress.flatMap { $0.isFinite ? min(1, max(0, $0)) : nil } ?? 0
      let faceCount = min(6, max(total, memberEmojis?.count ?? 0))
      let faces = phase == .arrivedWaiting ? (0..<faceCount).map { index in
        Face(
          emoji: memberEmojis?[safe: index] ?? "",
          colorHex: memberColors?[safe: index],
          arrived: memberArrived?[safe: index] ?? false
        )
      } : []
      return Presentation(
        phase: phase,
        title: title,
        icon: destinationIcon.isEmpty ? "🚩" : destinationIcon,
        accentHex: accentHex,
        dayColorHex: dayColorHex,
        etaMinutes: traveling ? minutes : nil,
        progress: traveling ? (progress * 100).rounded() / 100 : 0,
        meetTime: phase == .late ? meetTime : nil,
        arrived: arrived,
        total: total,
        selfFace: traveling ? selfFace : nil,
        memberFaces: faces,
        english: english
      )
    }
  }

  public var groupName: String

  public init(groupName: String) {
    self.groupName = groupName
  }
}

private extension Array {
  subscript(safe index: Int) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
