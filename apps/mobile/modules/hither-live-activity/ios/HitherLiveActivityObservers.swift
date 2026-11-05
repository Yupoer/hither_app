import Foundation

final class HitherLiveActivityObservers: @unchecked Sendable {
  private let lock = NSLock()
  private var activityTasks: [String: Task<Void, Never>] = [:]
  private var pushToStartTask: Task<Void, Never>?
  private var pushToStartToken: String?
  private var isStopped = false

  func observeActivity(id: String, createTask: () -> Task<Void, Never>) {
    lock.lock()
    defer { lock.unlock() }
    guard !isStopped, activityTasks[id] == nil else { return }
    activityTasks[id] = createTask()
  }

  func observePushToStart(createTask: () -> Task<Void, Never>) {
    lock.lock()
    defer { lock.unlock() }
    guard !isStopped, pushToStartTask == nil else { return }
    pushToStartTask = createTask()
  }

  var latestPushToStartToken: String? {
    get {
      lock.lock()
      defer { lock.unlock() }
      return pushToStartToken
    }
    set {
      lock.lock()
      defer { lock.unlock() }
      guard !isStopped else { return }
      pushToStartToken = newValue
    }
  }

  func stop() {
    lock.lock()
    isStopped = true
    var tasks = Array(activityTasks.values)
    if let task = pushToStartTask { tasks.append(task) }
    activityTasks.removeAll()
    pushToStartTask = nil
    pushToStartToken = nil
    lock.unlock()
    tasks.forEach { $0.cancel() }
  }
}
