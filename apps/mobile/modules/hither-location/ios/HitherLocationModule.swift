import CoreLocation
import ExpoModulesCore
import UIKit

// Process-local background stream. Business policy stays in the existing JS controller.
public class HitherLocationModule: Module {
  private var updates: Task<Void, Never>?
  private var backgroundSession: AnyObject?
  private var generation = 0

  private func stopUpdates() {
    generation += 1
    updates?.cancel()
    updates = nil
  }

  private func releaseSession() {
    stopUpdates()
    if #available(iOS 18.0, *) {
      (backgroundSession as? CLServiceSession)?.invalidate()
    }
    backgroundSession = nil
  }

  public func definition() -> ModuleDefinition {
    Name("HitherLocation")
    // Protected data is a conservative lock signal, not a screen-on detector.
    AsyncFunction("isDeviceLocked") { () -> Bool? in
      if UIApplication.shared.applicationState == .active { return false }
      return UIApplication.shared.isProtectedDataAvailable ? nil : true
    }.runOnQueue(.main)
    Events("onBackgroundLocation", "onBackgroundLocationError")

    OnDestroy { self.releaseSession() }

    Function("supportsOrdinaryBackgroundLiveUpdates") { () -> Bool in
      if #available(iOS 18.0, *) { return true }
      return false
    }

    AsyncFunction("prepareBackgroundLocation") { (enabled: Bool) -> Bool in
      if !enabled {
        self.releaseSession()
        return false
      }
      guard #available(iOS 18.0, *), UIApplication.shared.applicationState == .active else { return false }
      guard CLLocationManager().authorizationStatus == .authorizedAlways else {
        self.releaseSession()
        return false
      }
      if self.backgroundSession == nil {
        self.backgroundSession = CLServiceSession(authorization: .always)
      }
      return true
    }.runOnQueue(.main)

    AsyncFunction("hasBackgroundLocation") { () -> Bool in self.updates != nil }.runOnQueue(.main)
    AsyncFunction("stopBackgroundLocation") { self.stopUpdates() }.runOnQueue(.main)

    AsyncFunction("startBackgroundLocation") { (options: [String: Any]) -> Bool in
      guard #available(iOS 18.0, *), self.backgroundSession != nil,
            UIApplication.shared.applicationState == .background else { return false }
      let authorization = CLLocationManager()
      guard authorization.authorizationStatus == .authorizedAlways else { return false }
      self.stopUpdates()
      let epoch = self.generation
      let minTime = max(1, (options["timeInterval"] as? Double ?? 5000) / 1000)
      // Core Location pauses while stationary and resumes for small movements.
      // No relaunch registration: a terminated process must leave GPS off.
      self.updates = Task { @MainActor [weak self] in
        var previous: CLLocation?
        do {
          for try await update in CLLocationUpdate.liveUpdates(.default) {
            guard !Task.isCancelled, let self, self.generation == epoch else { return }
            guard authorization.authorizationStatus == .authorizedAlways else {
              self.releaseSession()
              return
            }
            guard let location = update.location, location.horizontalAccuracy >= 0 else { continue }
            if let previous {
              let elapsed = location.timestamp.timeIntervalSince(previous.timestamp)
              let thermalLevel: Int
              switch ProcessInfo.processInfo.thermalState {
              case .serious: thermalLevel = 2
              case .critical: thermalLevel = 3
              default: thermalLevel = 0
              }
              if !LocationDeliveryPolicy.shouldDeliver(elapsed: elapsed, minimumInterval: minTime,
                                                       thermalLevel: thermalLevel) { continue }
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
