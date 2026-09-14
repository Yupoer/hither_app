import CoreLocation
import ExpoModulesCore
import UIKit

// Process-local background stream. Business policy stays in the existing JS controller.
public class HitherLocationModule: Module {
  private var updates: Task<Void, Never>?
  private var backgroundSession: AnyObject?
  private var foregroundSeen = false
  private var generation = 0

  private func stopUpdates() {
    generation += 1
    updates?.cancel()
    updates = nil
  }

  public func definition() -> ModuleDefinition {
    Name("HitherLocation")
    Events("onBackgroundLocation", "onBackgroundLocationError")

    OnAppBecomesActive { self.foregroundSeen = true }
    OnDestroy {
      self.stopUpdates()
      if #available(iOS 17.0, *) {
        (self.backgroundSession as? CLBackgroundActivitySession)?.invalidate()
      }
      self.backgroundSession = nil
    }

    Function("supportsBackgroundLiveUpdates") { () -> Bool in
      if #available(iOS 17.0, *) { return true }
      return false
    }

    AsyncFunction("prepareBackgroundLocation") { (enabled: Bool) -> Bool in
      guard #available(iOS 17.0, *) else { return false }
      if !enabled {
        self.stopUpdates()
        (self.backgroundSession as? CLBackgroundActivitySession)?.invalidate()
        self.backgroundSession = nil
        return false
      }
      guard UIApplication.shared.applicationState == .active else { return false }
      self.foregroundSeen = true
      let status = CLLocationManager().authorizationStatus
      guard status == .authorizedAlways || status == .authorizedWhenInUse else { return false }
      if self.backgroundSession == nil { self.backgroundSession = CLBackgroundActivitySession() }
      return true
    }.runOnQueue(.main)

    AsyncFunction("hasBackgroundLocation") { () -> Bool in self.updates != nil }.runOnQueue(.main)
    AsyncFunction("stopBackgroundLocation") { self.stopUpdates() }.runOnQueue(.main)

    AsyncFunction("startBackgroundLocation") { (options: [String: Any]) -> Bool in
      guard #available(iOS 17.0, *), self.foregroundSeen, self.backgroundSession != nil else { return false }
      let status = CLLocationManager().authorizationStatus
      guard status == .authorizedAlways || status == .authorizedWhenInUse else { return false }
      self.stopUpdates()
      let epoch = self.generation
      let journey = (options["activityType"] as? Int) == 3
      let minTime = max(1, (options["timeInterval"] as? Double ?? 5000) / 1000)
      let minDistance = options["distanceInterval"] as? Double ?? 10
      // Core Location pauses while stationary and resumes for small movements.
      // No relaunch registration: a terminated process must leave GPS off.
      self.updates = Task { @MainActor [weak self] in
        var previous: CLLocation?
        do {
          for try await update in CLLocationUpdate.liveUpdates(journey ? .fitness : .default) {
            guard !Task.isCancelled, let self, self.generation == epoch else { return }
            guard let location = update.location, location.horizontalAccuracy >= 0 else { continue }
            if let previous {
              let elapsed = location.timestamp.timeIntervalSince(previous.timestamp)
              if elapsed <= 0 { continue }
              if !update.isStationary && elapsed < minTime { continue }
              if !journey && !update.isStationary && location.distance(from: previous) < minDistance { continue }
            }
            previous = location
            self.sendEvent("onBackgroundLocation", [
              "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
              "stationary": update.isStationary,
              "coords": ["latitude": location.coordinate.latitude, "longitude": location.coordinate.longitude,
                         "accuracy": location.horizontalAccuracy, "speed": location.speed, "heading": location.course],
            ])
          }
          if let self, self.generation == epoch { self.updates = nil }
        } catch {
          guard !Task.isCancelled, let self, self.generation == epoch else { return }
          self.updates = nil
          self.sendEvent("onBackgroundLocationError", ["code": "location_stream_failed"])
        }
      }
      return true
    }.runOnQueue(.main)

  }
}
