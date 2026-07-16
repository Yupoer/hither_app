import ActivityKit
import ExpoModulesCore
import Foundation

// ActivityKit Live Activity module (iOS 16.2+). Backs the JS boundary
// `apps/mobile/src/native/liveActivity.ts`. The app target drives the activity
// here; the Widget Extension (apps/mobile/targets/live-activity) renders it
// using the shared `HitherGroupAttributes`.
//
// Exported names/shapes MUST match liveActivity.ts:
//   isSupported(): boolean
//   startGroupActivity(state): Promise<{activityId, pushToken?} | null>
//   updateGroupActivity(handle, state): Promise<void>
//   endGroupActivity(handle): Promise<void>
//   endAllGroupActivities(): Promise<void>
//
// All calls degrade safely below iOS 16.2 (isSupported() false, requests no-op).
public class HitherLiveActivityModule: Module {
  // Stale ~2h out: navigation activities update infrequently and we end them
  // explicitly on pause/leave, so a long staleness window avoids premature
  // "stale" UI without leaving zombies (the end call removes them).
  private static let staleInterval: TimeInterval = 2 * 60 * 60
  private var pushToStartTask: Task<Void, Never>?
  private var activityTokenTasks: [String: Task<Void, Never>] = [:]
  private var latestPushToStartToken: String?

  @available(iOS 17.2, *)
  private func observePushToStartTokens() {
    guard pushToStartTask == nil else { return }
    pushToStartTask = Task { [weak self] in
      for await token in Activity<HitherGroupAttributes>.pushToStartTokenUpdates {
        guard !Task.isCancelled else { return }
        let tokenString = token.hexString
        self?.latestPushToStartToken = tokenString
        self?.sendEvent("onPushToStartToken", ["token": tokenString])
      }
    }
  }

  @available(iOS 16.2, *)
  private func observePushToken(for activity: Activity<HitherGroupAttributes>) {
    guard activityTokenTasks[activity.id] == nil else { return }
    activityTokenTasks[activity.id] = Task { [weak self] in
      for await token in activity.pushTokenUpdates {
        self?.sendEvent("onPushToken", [
          "activityId": activity.id,
          "pushToken": token.hexString,
          "navigationSessionId": activity.content.state.navigationSessionId as Any,
        ])
      }
    }
  }

  public func definition() -> ModuleDefinition {
    Name("HitherLiveActivity")
    Events("onPushToken", "onPushToStartToken")

    OnCreate {
      if #available(iOS 16.2, *) {
        for activity in Activity<HitherGroupAttributes>.activities {
          self.observePushToken(for: activity)
        }
      }
      if #available(iOS 17.2, *) {
        self.observePushToStartTokens()
      }
    }

    OnDestroy {
      self.pushToStartTask?.cancel()
      self.pushToStartTask = nil
      self.activityTokenTasks.values.forEach { $0.cancel() }
      self.activityTokenTasks.removeAll()
    }

    AsyncFunction("startPushToStartTokenObservation") {
      guard #available(iOS 17.2, *) else {
        self.sendEvent("onPushToStartToken", ["token": NSNull()])
        return
      }
      self.observePushToStartTokens()
      if let token = self.latestPushToStartToken {
        self.sendEvent("onPushToStartToken", ["token": token])
      }
    }

    AsyncFunction("observeExistingActivities") {
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<HitherGroupAttributes>.activities {
        self.observePushToken(for: activity)
      }
    }

    Function("isSupported") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("startGroupActivity") { (state: [String: Any]) -> [String: String]? in
      guard #available(iOS 16.2, *),
            ActivityAuthorizationInfo().areActivitiesEnabled else {
        return nil
      }
      let attributes = HitherGroupAttributes(
        groupName: state["groupName"] as? String ?? ""
      )
      let content = ActivityContent(
        state: HitherGroupAttributes.ContentState(from: state),
        staleDate: Date().addingTimeInterval(Self.staleInterval)
      )
      do {
        let activity = try Activity.request(
          attributes: attributes,
          content: content,
          pushType: .token
        )
        self.observePushToken(for: activity)
        var result = ["activityId": activity.id]
        if let pushToken = activity.pushToken {
          result["pushToken"] = pushToken.hexString
        }
        return result
      } catch {
        return nil
      }
    }

    AsyncFunction("updateGroupActivity") { (handle: String, state: [String: Any]) in
      guard #available(iOS 16.2, *) else { return }
      let content = ActivityContent(
        state: HitherGroupAttributes.ContentState(from: state),
        staleDate: Date().addingTimeInterval(Self.staleInterval)
      )
      for activity in Activity<HitherGroupAttributes>.activities
      where activity.id == handle {
        await activity.update(content)
      }
    }

    // Headless background location callbacks do not retain the JS activity
    // handle. ActivityKit can safely enumerate this app's own activities.
    AsyncFunction("updateAllGroupActivities") { (state: [String: Any]) in
      guard #available(iOS 16.2, *) else { return }
      let content = ActivityContent(
        state: HitherGroupAttributes.ContentState(from: state),
        staleDate: Date().addingTimeInterval(Self.staleInterval)
      )
      for activity in Activity<HitherGroupAttributes>.activities {
        await activity.update(content)
      }
    }

    AsyncFunction("endGroupActivity") { (handle: String) in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<HitherGroupAttributes>.activities
      where activity.id == handle {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }

    // Ends every Hither Live Activity regardless of JS handle. Used on leave,
    // sign-out, and cold start so orphaned lock-screen activities cannot stick
    // after the in-memory activity id is lost.
    AsyncFunction("endAllGroupActivities") {
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<HitherGroupAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}

private extension Data {
  var hexString: String {
    map { String(format: "%02x", $0) }.joined()
  }
}
