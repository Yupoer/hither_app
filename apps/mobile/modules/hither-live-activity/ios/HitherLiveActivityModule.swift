import ActivityKit
import ExpoModulesCore

// ActivityKit Live Activity module (iOS 16.2+). Backs the JS boundary
// `apps/mobile/src/native/liveActivity.ts`. The app target drives the activity
// here; the Widget Extension (apps/mobile/targets/live-activity) renders it
// using the shared `HitherGroupAttributes`.
//
// Exported names/shapes MUST match liveActivity.ts:
//   isSupported(): boolean
//   startGroupActivity(state): Promise<string | null>   // activity id
//   updateGroupActivity(handle, state): Promise<void>
//   endGroupActivity(handle): Promise<void>
//
// All calls degrade safely below iOS 16.2 (isSupported() false, requests no-op).
public class HitherLiveActivityModule: Module {
  // Stale ~2h out: navigation activities update infrequently and we end them
  // explicitly on pause/leave, so a long staleness window avoids premature
  // "stale" UI without leaving zombies (the end call removes them).
  private static let staleInterval: TimeInterval = 2 * 60 * 60

  public func definition() -> ModuleDefinition {
    Name("HitherLiveActivity")

    Function("isSupported") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("startGroupActivity") { (state: [String: Any]) -> String? in
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
          pushType: nil
        )
        return activity.id
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

    AsyncFunction("endGroupActivity") { (handle: String) in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<HitherGroupAttributes>.activities
      where activity.id == handle {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
