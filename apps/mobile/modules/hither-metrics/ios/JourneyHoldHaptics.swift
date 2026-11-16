import CoreHaptics

final class JourneyHoldHaptics {
  private var engine: CHHapticEngine?
  private var player: (any CHHapticPatternPlayer)?

  func start(durationMs: Double, intervalMs: Double) throws {
    stop()
    guard CHHapticEngine.capabilitiesForHardware().supportsHaptics,
          durationMs > 0, durationMs <= 2_000, intervalMs >= 20, intervalMs < durationMs else { return }

    let engine = try self.engine ?? CHHapticEngine()
    engine.playsHapticsOnly = true
    engine.isAutoShutdownEnabled = true
    self.engine = engine

    let parameters = [
      CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.65),
      CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.8),
    ]
    let pulses = stride(from: 0.0, to: durationMs, by: intervalMs).map { offset in
      CHHapticEvent(eventType: .hapticTransient, parameters: parameters, relativeTime: offset / 1_000)
    }
    let pattern = try CHHapticPattern(events: pulses, parameters: [])
    try engine.start()
    let player = try engine.makePlayer(with: pattern)
    try player.start(atTime: CHHapticTimeImmediate)
    self.player = player
  }

  func stop() {
    try? player?.stop(atTime: CHHapticTimeImmediate)
    player = nil
  }
}
