import Foundation

private final class ObserverProbe: @unchecked Sendable {
  private let lock = NSLock()
  private var tasks: [Task<Void, Never>] = []
  private var cancellationCount = 0

  func createTask() -> Task<Void, Never> {
    let task = Task {
      while !Task.isCancelled { await Task.yield() }
      self.recordCancellation()
    }
    lock.lock()
    tasks.append(task)
    lock.unlock()
    return task
  }

  private func recordCancellation() {
    lock.lock()
    cancellationCount += 1
    lock.unlock()
  }

  var snapshot: (tasks: [Task<Void, Never>], cancellationCount: Int) {
    lock.lock()
    defer { lock.unlock() }
    return (tasks, cancellationCount)
  }
}

@main
struct HitherLiveActivityObserversTests {
  static func main() async {
    let observers = HitherLiveActivityObservers()
    let probe = ObserverProbe()
    DispatchQueue.concurrentPerform(iterations: 2048) { index in
      observers.observeActivity(id: "activity-\(index % 64)", createTask: probe.createTask)
      observers.observePushToStart(createTask: probe.createTask)
      observers.latestPushToStartToken = "token-\(index)"
      precondition(observers.latestPushToStartToken?.hasPrefix("token-") == true)
    }
    precondition(probe.snapshot.tasks.count == 65, "concurrent adoption creates one observer per activity and one push-to-start observer")

    DispatchQueue.concurrentPerform(iterations: 2048) { index in
      if index == 1024 { observers.stop() }
      observers.observeActivity(id: "new-activity-\(index)", createTask: probe.createTask)
      observers.observePushToStart(createTask: probe.createTask)
      observers.latestPushToStartToken = "late-token-\(index)"
      _ = observers.latestPushToStartToken
    }
    observers.stop()
    let registered = probe.snapshot.tasks
    observers.observeActivity(id: "resumed-after-destroy", createTask: probe.createTask)
    observers.observePushToStart(createTask: probe.createTask)
    observers.latestPushToStartToken = "resumed-after-destroy"
    precondition(probe.snapshot.tasks.count == registered.count, "a suspended start cannot register after module destruction")
    precondition(observers.latestPushToStartToken == nil, "destroyed observers cannot retain late tokens")
    for task in registered { await task.value }
    precondition(probe.snapshot.cancellationCount == registered.count, "teardown cancels every registered observer, including concurrent registrations")
    print("PASS concurrent Live Activity adoption and module-destruction lifetime")
  }
}
