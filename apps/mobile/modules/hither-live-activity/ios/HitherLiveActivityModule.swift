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
  private let observers = HitherLiveActivityObservers()
  private let snapshotUpdates = HitherLiveActivityUpdateQueue()
  @available(iOS 16.2, *)
  private typealias ContentState = HitherGroupAttributes.ContentState
  // Retain newer GPS receipts even when the rendered minute and progress did not change.
  private var latestSnapshots: [String: (activity: Data, merged: [String: Any])] = [:]

  @available(iOS 17.2, *)
  private func observePushToStartTokens() {
    observers.observePushToStart {
      Task { [weak self] in
        for await token in Activity<HitherGroupAttributes>.pushToStartTokenUpdates {
          guard !Task.isCancelled else { return }
          let tokenString = token.hexString
          self?.observers.latestPushToStartToken = tokenString
          self?.sendEvent("onPushToStartToken", ["token": tokenString])
        }
      }
    }
  }

  @available(iOS 16.2, *)
  private func observePushToken(for activity: Activity<HitherGroupAttributes>) {
    observers.observeActivity(id: activity.id) {
      Task { [weak self] in
        for await token in activity.pushTokenUpdates {
          self?.sendEvent("onPushToken", [
            "activityId": activity.id,
            "pushToken": token.hexString,
            "navigationSessionId": activity.content.state.navigationSessionId as Any,
            "destinationId": activity.content.state.destinationId as Any,
          ])
        }
      }
    }
  }

  @available(iOS 16.2, *)
  private func update(_ activity: Activity<HitherGroupAttributes>, incoming: [String: Any]) async {
    guard activity.activityState == .active || activity.activityState == .stale else { return }
    let previousState = activity.content.state
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    guard let data = try? encoder.encode(previousState),
          let displayed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
    let cached = latestSnapshots[activity.id]
    let current = cached?.activity == data ? cached?.merged ?? displayed : displayed
    guard HitherLiveActivitySnapshot.matchesScope(incoming: incoming, current: current) else { return }
    let merged = HitherLiveActivitySnapshot.merge(incoming: incoming, current: current)
    let nextState = ContentState(from: merged)
    let now = Date()
    let groupName = activity.attributes.groupName
    let previous = previousState.presentation(groupName: groupName, now: now)
    let next = nextState.presentation(groupName: groupName, now: now)
    latestSnapshots[activity.id] = (data, merged)
    if next.phase == .allArrived {
      await finish(activity, state: nextState, previous: previous.phase)
      return
    }
    guard previous != next
      || previousState.destinationId != nextState.destinationId
      || previousState.navigationSessionId != nextState.navigationSessionId
      || previousState.personalArrived != nextState.personalArrived
      || previousState.personalArrivalAtMs != nextState.personalArrivalAtMs
      || previousState.personalArrivalSequence != nextState.personalArrivalSequence
      || previousState.personalArrivalCorrectionAtMs != nextState.personalArrivalCorrectionAtMs else { return }
    let content = ActivityContent(state: nextState, staleDate: now.addingTimeInterval(Self.staleInterval))
    await activity.update(content, alertConfiguration: alert(for: next, from: previous.phase))
    if let updated = try? encoder.encode(nextState) {
      latestSnapshots[activity.id] = (updated, merged)
    }
  }

  @available(iOS 16.2, *)
  private func alert(for next: ContentState.Presentation, from previous: ContentState.Phase) -> AlertConfiguration? {
    guard next.phase != previous else { return nil }
    let title: LocalizedStringResource
    switch next.phase {
    case .enRoute: return nil
    case .late: title = next.english ? "You may be late" : "可能遲到"
    case .arrivedWaiting: title = next.english ? "You arrived" : "你已抵達"
    case .allArrived: title = next.english ? "Everyone arrived" : "全員到齊"
    }
    return AlertConfiguration(title: title, body: "\(next.title)", sound: .default)
  }

  @available(iOS 16.2, *)
  private func finish(_ activity: Activity<HitherGroupAttributes>, state: ContentState, previous: ContentState.Phase) async {
    guard activity.activityState == .active || activity.activityState == .stale else { return }
    let content = ActivityContent(state: state, staleDate: nil)
    let presentation = state.presentation(groupName: activity.attributes.groupName)
    if let alert = alert(for: presentation, from: previous) {
      await activity.update(content, alertConfiguration: alert)
    }
    await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(5 * 60)))
    latestSnapshots.removeValue(forKey: activity.id)
  }

  @available(iOS 16.2, *)
  private func dismiss(_ activity: Activity<HitherGroupAttributes>) async {
    guard activity.activityState != .ended && activity.activityState != .dismissed else { return }
    await activity.end(nil, dismissalPolicy: .immediate)
    latestSnapshots.removeValue(forKey: activity.id)
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
      self.observers.stop()
    }

    AsyncFunction("startPushToStartTokenObservation") {
      guard #available(iOS 17.2, *) else {
        self.sendEvent("onPushToStartToken", ["token": NSNull()])
        return
      }
      self.observePushToStartTokens()
      if let token = self.observers.latestPushToStartToken {
        self.sendEvent("onPushToStartToken", ["token": token])
      }
    }

    AsyncFunction("observeExistingActivities") {
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<HitherGroupAttributes>.activities {
        self.observePushToken(for: activity)
      }
    }

    AsyncFunction("listGroupActivities") { () -> [[String: String]] in
      guard #available(iOS 16.2, *) else { return [] }
      return Activity<HitherGroupAttributes>.activities.filter {
        $0.activityState != .ended && $0.activityState != .dismissed
      }.map { activity in
        var row = ["activityId": activity.id]
        if let sessionId = activity.content.state.navigationSessionId { row["navigationSessionId"] = sessionId }
        if let destinationId = activity.content.state.destinationId { row["destinationId"] = destinationId }
        if let token = activity.pushToken {
          row["pushToken"] = token.hexString
        }
        return row
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
      if let existing = Activity<HitherGroupAttributes>.activities.first(where: {
        $0.activityState != .ended && $0.activityState != .dismissed
      }) {
        let current = [
          "navigationSessionId": existing.content.state.navigationSessionId as Any,
          "destinationId": existing.content.state.destinationId as Any,
        ]
        if HitherLiveActivitySnapshot.matchesScope(incoming: state, current: current) {
          self.observePushToken(for: existing)
          var adopted = ["activityId": existing.id]
          if let pushToken = existing.pushToken {
            adopted["pushToken"] = pushToken.hexString
          }
          return adopted
        }
        // A cold-start adoption at another point must create a new owner.
        await self.snapshotUpdates.perform {
          await self.dismiss(existing)
        }
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
      await self.snapshotUpdates.perform {
        for activity in Activity<HitherGroupAttributes>.activities
        where activity.id == handle {
          await self.update(activity, incoming: state)
        }
      }
    }

    // Headless background location callbacks do not retain the JS activity
    // handle. ActivityKit can safely enumerate this app's own activities.
    AsyncFunction("updateAllGroupActivities") { (state: [String: Any]) in
      guard #available(iOS 16.2, *) else { return }
      await self.snapshotUpdates.perform {
        for activity in Activity<HitherGroupAttributes>.activities {
          await self.update(activity, incoming: state)
        }
      }
    }

    AsyncFunction("completeGroupActivity") { (navigationSessionId: String, destinationId: String) in
      guard #available(iOS 16.2, *) else { return }
      await self.snapshotUpdates.perform {
        for activity in Activity<HitherGroupAttributes>.activities {
          var state = activity.content.state
          guard state.navigationSessionId == navigationSessionId,
                state.destinationId == destinationId || state.destinationId == nil else { continue }
          let previous = state.presentation(groupName: activity.attributes.groupName).phase
          state.phase = .allArrived
          state.gatheredCount = state.memberCount
          await self.finish(activity, state: state, previous: previous)
        }
      }
    }

    AsyncFunction("endGroupActivity") { (handle: String) in
      guard #available(iOS 16.2, *) else { return }
      await self.snapshotUpdates.perform {
        for activity in Activity<HitherGroupAttributes>.activities
        where activity.id == handle {
          await self.dismiss(activity)
        }
      }
    }

    // Ends every Hither Live Activity regardless of JS handle. Used on leave,
    // sign-out, and cold start so orphaned lock-screen activities cannot stick
    // after the in-memory activity id is lost.
    AsyncFunction("endAllGroupActivities") {
      guard #available(iOS 16.2, *) else { return }
      await self.snapshotUpdates.perform {
        for activity in Activity<HitherGroupAttributes>.activities {
          await self.dismiss(activity)
        }
      }
    }
  }
}

private extension Data {
  var hexString: String {
    map { String(format: "%02x", $0) }.joined()
  }
}
