import Foundation

/// Apply a time budget to real Core Location fixes, including stationary fixes.
/// Distance is an upload choice; it must not suppress a due presence heartbeat.
enum LocationDeliveryPolicy {
  static func usesFitness(journey: Bool, accuracyCode: Int) -> Bool {
    // Balanced team navigation is code 4; explicit precise modes are code 5.
    return journey && accuracyCode >= 5
  }
  static func shouldDeliver(elapsed: TimeInterval, minimumInterval: TimeInterval,
                            thermalLevel: Int) -> Bool {
    let thermalInterval: TimeInterval = thermalLevel >= 3 ? 60 : thermalLevel >= 2 ? 30 : 0
    return elapsed > 0 && elapsed >= max(minimumInterval, thermalInterval)
  }
}
