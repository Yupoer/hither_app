import Foundation

/// Merge at the native boundary: foreground JS can retain a pre-background
/// snapshot while a headless callback has already advanced ActivityKit.
enum HitherLiveActivitySnapshot {
  private static let personalKeys = [
    "distanceMeters", "etaSeconds", "etaTargetAtMs", "progress", "sampledAtMs",
  ]

  private static func timestamp(_ value: Any?) -> Double? {
    guard let value = (value as? NSNumber)?.doubleValue,
          value.isFinite, value >= 0 else { return nil }
    return value
  }

  static func matchesScope(incoming: [String: Any], current: [String: Any]) -> Bool {
    for key in ["navigationSessionId", "destinationId"] {
      if let old = current[key] as? String, let new = incoming[key] as? String,
         old != new { return false }
    }
    return true
  }

  static func merge(incoming: [String: Any], current: [String: Any]) -> [String: Any] {
    // A new navigation session/point owns its own distance baseline and ETA.
    if !matchesScope(incoming: incoming, current: current) { return incoming }
    var merged = incoming
    let oldSample = timestamp(current["sampledAtMs"])
    let newSample = timestamp(incoming["sampledAtMs"])
    let preservesSample = oldSample != nil && (newSample == nil || newSample! <= oldSample!)
    if preservesSample {
      for key in personalKeys { merged[key] = current[key] }
    }
    // Legacy payloads cannot discard a known scope or arrival receipt.
    for key in ["navigationSessionId", "destinationId"] where merged[key] == nil {
      merged[key] = current[key]
    }
    let oldArrival = timestamp(current["personalArrivalAtMs"])
    let newArrival = timestamp(incoming["personalArrivalAtMs"])
    let oldSequence = timestamp(current["personalArrivalSequence"])
    let newSequence = timestamp(incoming["personalArrivalSequence"])
    let newerReceipt = oldSequence != nil && newSequence != nil
      ? newSequence! > oldSequence!
      : oldArrival == nil || (newArrival != nil && newArrival! > oldArrival!)
    let acceptsReceipt = newArrival != nil && newerReceipt
      && incoming["personalArrived"] is Bool
    if !acceptsReceipt {
      merged["personalArrived"] = current["personalArrived"]
      merged["personalArrivalAtMs"] = current["personalArrivalAtMs"]
      merged["personalArrivalSequence"] = current["personalArrivalSequence"]
    }
    // Only an explicit durable receipt reaches this branch. Radius progress=1
    // alone never grants arrival authority; a later undo can clear the receipt.
    if merged["personalArrived"] as? Bool == true {
      merged["progress"] = 1.0
      merged["etaSeconds"] = 0.0
      merged["etaTargetAtMs"] = merged["personalArrivalAtMs"]
    } else if acceptsReceipt && preservesSample && current["personalArrived"] as? Bool == true {
      // A new undo clears arrival authority, but an old fix cannot supply a
      // replacement estimate. Keep the latest distance/sample and show unknown
      // progress/ETA until a fresh GPS estimate arrives.
      merged.removeValue(forKey: "progress")
      merged.removeValue(forKey: "etaSeconds")
      merged.removeValue(forKey: "etaTargetAtMs")
    }
    return merged
  }
}

/// ActivityKit update awaits must not allow a foreground/background caller to
/// read the same old state and complete later in the opposite order.
actor HitherLiveActivityUpdateQueue {
  private var tail: Task<Void, Never>?

  func perform(_ operation: @escaping () async -> Void) async {
    let previous = tail
    let next = Task {
      await previous?.value
      await operation()
    }
    tail = next
    await next.value
  }
}
