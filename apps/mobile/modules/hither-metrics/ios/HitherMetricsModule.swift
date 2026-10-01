import ExpoModulesCore
import Foundation
import MetricKit
import QuartzCore
import UIKit
import Darwin
import os.signpost

private final class MetricKitSubscriber: NSObject, MXMetricManagerSubscriber {
  private let queue = DispatchQueue(label: "app.hither.metrics-spool")
  private let maximumPayloadFiles = 20

  private lazy var spoolDirectory: URL = {
    let root = FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first!
    let directory = root.appendingPathComponent("HitherMetrics", isDirectory: true)
    try? FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )
    return directory
  }()

  func prepare() {
    _ = spoolDirectory
  }

  func drainPayloads() -> [[String: Any]] {
    queue.sync {
      payloadFiles().compactMap { url in
        guard let json = try? String(contentsOf: url, encoding: .utf8) else {
          return nil
        }
        let parts = url.deletingPathExtension().lastPathComponent.split(
          separator: "_",
          maxSplits: 2
        )
        guard parts.count == 3, let receivedAt = Int64(parts[0]) else {
          return nil
        }
        return [
          "id": String(parts[2]),
          "kind": String(parts[1]),
          "json": json,
          "receivedAt": receivedAt,
        ]
      }
    }
  }

  func removePayloads(ids: [String]) {
    queue.sync {
      let accepted = Set(ids)
      for url in payloadFiles() {
        let parts = url.deletingPathExtension().lastPathComponent.split(
          separator: "_",
          maxSplits: 2
        )
        if parts.count == 3 && accepted.contains(String(parts[2])) {
          try? FileManager.default.removeItem(at: url)
        }
      }
    }
  }

  func purgePayloads() {
    queue.sync {
      for url in payloadFiles() {
        try? FileManager.default.removeItem(at: url)
      }
    }
  }

  func didReceive(_ payloads: [MXMetricPayload]) {
    queue.async {
      for payload in payloads {
        self.write(payload.jsonRepresentation(), kind: "metric")
      }
    }
  }

  func didReceive(_ payloads: [MXDiagnosticPayload]) {
    queue.async {
      for diagnosticPayload in payloads {
        self.write(diagnosticPayload.jsonRepresentation(), kind: "diagnostic")
      }
    }
  }

  private func write(_ data: Data, kind: String) {
    let receivedAt = Int64(Date().timeIntervalSince1970 * 1_000)
    let id = UUID().uuidString.lowercased()
    let file = spoolDirectory.appendingPathComponent(
      "\(receivedAt)_\(kind)_\(id).json"
    )
    do {
      try data.write(to: file, options: .atomic)
      trimPayloadFiles()
    } catch {
      // Metric collection must never affect app startup or navigation.
    }
  }

  private func payloadFiles() -> [URL] {
    let urls = (try? FileManager.default.contentsOfDirectory(
      at: spoolDirectory,
      includingPropertiesForKeys: [.contentModificationDateKey],
      options: [.skipsHiddenFiles]
    )) ?? []
    return urls.filter { $0.pathExtension == "json" }.sorted { lhs, rhs in
      let left = (try? lhs.resourceValues(
        forKeys: [.contentModificationDateKey]
      ).contentModificationDate) ?? .distantPast
      let right = (try? rhs.resourceValues(
        forKeys: [.contentModificationDateKey]
      ).contentModificationDate) ?? .distantPast
      return left < right
    }
  }

  private func trimPayloadFiles() {
    let files = payloadFiles()
    guard files.count > maximumPayloadFiles else { return }
    for url in files.prefix(files.count - maximumPayloadFiles) {
      try? FileManager.default.removeItem(at: url)
    }
  }
}

private struct PerformanceSnapshot {
  let cpuTimeMs: Double?
  let memoryMb: Double?
  let batteryLevel: Double?
  let batteryState: String
  let lowPowerMode: Bool
  let thermalState: String
  let appState: String
}

private final class PerformanceSampler: NSObject {
  private var displayLink: CADisplayLink?
  private var frameIntervals: [Double] = []
  private var frameCount = 0
  private var lastTimestamp: CFTimeInterval?
  private var startedAt: Date?
  private var startedSnapshot: PerformanceSnapshot?
  private var completion: (([String: Any]) -> Void)?
  private var mainThreadDelayMs = 0.0
  private var expectedInterval = 1.0 / 60
  private var missedFrames = 0
  private var sampledMemoryPeakMb = 0.0
  private var memoryWarningCount = 0
  private var memoryWarningObserver: NSObjectProtocol?
  private var inactiveObserver: NSObjectProtocol?
  private var previousBatteryMonitoring = false
  private var sampleGeneration = 0
  private var enabled = false

  func setEnabled(_ enabled: Bool) {
    DispatchQueue.main.async {
      self.enabled = enabled
      if let observer = self.memoryWarningObserver {
        NotificationCenter.default.removeObserver(observer)
        self.memoryWarningObserver = nil
      }
      if let observer = self.inactiveObserver {
        NotificationCenter.default.removeObserver(observer)
        self.inactiveObserver = nil
      }
      if enabled {
        self.memoryWarningCount = 0
        self.sampledMemoryPeakMb = 0
        self.memoryWarningObserver = NotificationCenter.default.addObserver(
          forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.memoryWarningCount += 1 }
        self.inactiveObserver = NotificationCenter.default.addObserver(
          forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.cancelSample() }
      } else {
        self.cancelSample()
      }
    }
  }

  func sample(windowMs: Double, completion: @escaping ([String: Any]) -> Void) {
    let requestedAt = CACurrentMediaTime()
    DispatchQueue.main.async {
      guard self.enabled, UIApplication.shared.applicationState == .active, self.displayLink == nil else {
        completion([:])
        return
      }
      let device = UIDevice.current
      self.sampleGeneration += 1
      let generation = self.sampleGeneration
      self.previousBatteryMonitoring = device.isBatteryMonitoringEnabled
      device.isBatteryMonitoringEnabled = true
      self.mainThreadDelayMs = (CACurrentMediaTime() - requestedAt) * 1_000
      self.missedFrames = 0
      self.frameIntervals = []
      self.frameCount = 0
      self.lastTimestamp = nil
      self.startedAt = Date()
      self.startedSnapshot = self.snapshot()
      self.completion = completion

      let link = CADisplayLink(target: self, selector: #selector(self.tick(_:)))
      link.add(to: .main, forMode: .common)
      self.displayLink = link

      let boundedWindow = max(1_000, min(windowMs, 10_000))
      let finishAt = CACurrentMediaTime() + boundedWindow / 1_000
      DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(boundedWindow))) {
        guard self.sampleGeneration == generation else { return }
        self.mainThreadDelayMs = max(self.mainThreadDelayMs, (CACurrentMediaTime() - finishAt) * 1_000)
        self.finish()
      }
    }
  }

  private func cancelSample() {
    sampleGeneration += 1
    let wasSampling = displayLink != nil
    displayLink?.invalidate()
    displayLink = nil
    let completion = self.completion
    self.completion = nil
    startedAt = nil
    startedSnapshot = nil
    frameIntervals.removeAll()
    if wasSampling { UIDevice.current.isBatteryMonitoringEnabled = previousBatteryMonitoring }
    completion?([:])
  }

  @objc private func tick(_ link: CADisplayLink) {
    frameCount += 1
    if let previous = lastTimestamp {
      let interval = link.timestamp - previous
      if interval > 0 {
        frameIntervals.append(interval)
        // CADisplayLink target cadence adapts to ProMotion / Low Power Mode.
        if interval > expectedInterval * 1.5 { missedFrames += 1 }
      }
    }
    expectedInterval = max(link.targetTimestamp - link.timestamp, 0.001)
    lastTimestamp = link.timestamp
  }

  private func finish() {
    guard let startedAt, let startedSnapshot, let completion else { return }
    displayLink?.invalidate()
    displayLink = nil
    self.completion = nil

    let elapsed = max(Date().timeIntervalSince(startedAt), 0.001)
    let endedSnapshot = snapshot()
    let cpuTimeMs = endedSnapshot.cpuTimeMs.flatMap { end in
      startedSnapshot.cpuTimeMs.map { max(end - $0, 0) }
    }
    let processorCount = Double(max(ProcessInfo.processInfo.activeProcessorCount, 1))
    let cpuCorePercent = cpuTimeMs.map { max(($0 / 1_000) / elapsed * 100, 0) }
    let cpuPercent = cpuCorePercent.map { min($0 / processorCount, 100) }
    let maxFps = Double(UIScreen.main.maximumFramesPerSecond)
    let uiFps = Double(frameCount) / elapsed
    let sortedIntervals = frameIntervals.sorted()
    let p95Index = sortedIntervals.isEmpty
      ? 0
      : min(sortedIntervals.count - 1, Int(Double(sortedIntervals.count - 1) * 0.95))
    let frameTimeP95Ms = sortedIntervals.isEmpty ? nil : sortedIntervals[p95Index] * 1_000
    let missedFrameRatio: Double? = !frameIntervals.isEmpty
      ? Double(missedFrames) / Double(frameIntervals.count)
      : nil

    var result: [String: Any] = [
      "uiFps": uiFps,
      "cpuTimeKind": "window",
      "processSampleTimestampMs": Date().timeIntervalSince1970 * 1_000,
      "processorCount": processorCount,
      "mainThreadDelayMs": mainThreadDelayMs,
      "memoryWarningCount": memoryWarningCount,
      "nativeAppVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
      "nativeBuildNumber": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown",
      "hardwareModel": hardwareModel(),
      "displayMaxFps": maxFps,
      "batteryState": endedSnapshot.batteryState,
      "lowPowerMode": endedSnapshot.lowPowerMode,
      "thermalState": endedSnapshot.thermalState,
      "appState": endedSnapshot.appState,
      "deviceModel": UIDevice.current.model,
      "osVersion": UIDevice.current.systemVersion,
    ]
    if let cpuPercent { result["cpuPercent"] = cpuPercent }
    if let cpuTimeMs { result["cpuTimeMs"] = cpuTimeMs }
    if let cpuCorePercent { result["cpuCorePercent"] = cpuCorePercent }
    if let cumulative = endedSnapshot.cpuTimeMs { result["processCpuTimeMs"] = cumulative }
    if let memoryMb = endedSnapshot.memoryMb {
      result["memoryMb"] = memoryMb
      sampledMemoryPeakMb = max(sampledMemoryPeakMb, memoryMb, startedSnapshot.memoryMb ?? 0)
      result["sampledMemoryPeakMb"] = sampledMemoryPeakMb
    }
    UIDevice.current.isBatteryMonitoringEnabled = previousBatteryMonitoring
    if let frameTimeP95Ms { result["frameTimeP95Ms"] = frameTimeP95Ms }
    if let missedFrameRatio { result["missedFrameRatio"] = missedFrameRatio }
    if let batteryLevel = endedSnapshot.batteryLevel { result["batteryLevel"] = batteryLevel }
    result["sampleWindowMs"] = elapsed * 1_000
    completion(result)
  }

  private func snapshot() -> PerformanceSnapshot {
    let device = UIDevice.current
    let batteryLevel = device.batteryLevel >= 0 ? Double(device.batteryLevel) : nil
    let batteryState: String
    switch device.batteryState {
    case .charging: batteryState = "charging"
    case .full: batteryState = "full"
    case .unplugged: batteryState = "unplugged"
    default: batteryState = "unknown"
    }

    let thermalState: String
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: thermalState = "nominal"
    case .fair: thermalState = "fair"
    case .serious: thermalState = "serious"
    case .critical: thermalState = "critical"
    @unknown default: thermalState = "unknown"
    }

    let appState: String
    switch UIApplication.shared.applicationState {
    case .active: appState = "active"
    case .inactive: appState = "inactive"
    case .background: appState = "background"
    @unknown default: appState = "unknown"
    }

    return PerformanceSnapshot(
      cpuTimeMs: cpuTimeMs(),
      memoryMb: memoryMb(),
      batteryLevel: batteryLevel,
      batteryState: batteryState,
      lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled,
      thermalState: thermalState,
      appState: appState
    )
  }

  private func cpuTimeMs() -> Double? {
    // getrusage includes CPU from terminated threads, unlike TASK_THREAD_TIMES_INFO.
    var usage = rusage()
    guard getrusage(RUSAGE_SELF, &usage) == 0 else { return nil }
    let user = Double(usage.ru_utime.tv_sec) * 1_000 + Double(usage.ru_utime.tv_usec) / 1_000
    let system = Double(usage.ru_stime.tv_sec) * 1_000 + Double(usage.ru_stime.tv_usec) / 1_000
    return user + system
  }

  private func hardwareModel() -> String {
    var system = utsname()
    uname(&system)
    let capacity = MemoryLayout.size(ofValue: system.machine)
    return withUnsafePointer(to: &system.machine) {
      $0.withMemoryRebound(to: CChar.self, capacity: capacity) {
        String(cString: $0)
      }
    }
  }

  private func memoryMb() -> Double? {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(
      MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size
    )
    let status = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    guard status == KERN_SUCCESS else { return nil }
    return Double(info.phys_footprint) / 1_048_576
  }
}

private enum LaunchPhase: String, CaseIterable {
  case nativeModuleCreated = "native_module_created"
  case jsRootMounted = "js_root_mounted"
  case sessionResolved = "session_resolved"
  case navigationReady = "navigation_ready"
  case stable = "stable"
}

private final class LaunchBreadcrumbStore {
  private let defaults = UserDefaults.standard
  private let phaseKey = "hither.launch.phase.v1"
  private let buildKey = "hither.launch.build.v1"
  private let recordedAtKey = "hither.launch.recordedAt.v1"
  private(set) var previous: [String: Any]?

  init() {
    if let phase = defaults.string(forKey: phaseKey), phase != LaunchPhase.stable.rawValue {
      previous = [
        "phase": phase,
        "build": defaults.string(forKey: buildKey) ?? "unknown",
        "recordedAt": defaults.object(forKey: recordedAtKey) as? Double ?? 0,
      ]
    }
    mark(.nativeModuleCreated)
  }

  func mark(_ phase: LaunchPhase) {
    defaults.set(phase.rawValue, forKey: phaseKey)
    defaults.set(
      Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown",
      forKey: buildKey
    )
    defaults.set(Date().timeIntervalSince1970 * 1_000, forKey: recordedAtKey)
  }
}

private enum EnergySignpostName: String {
  case launch
  case mapReady = "map_ready"
  case locationAcquisition = "location_acquisition"
  case snapshot
  case routeCalculation = "route_calculation"
  case markerTracking = "marker_tracking"
  case backgroundTransition = "background_transition"
}

private struct ActiveEnergySignpost {
  let id: OSSignpostID
  let name: EnergySignpostName
}

public final class HitherMetricsModule: Module {
  private let subscriber = MetricKitSubscriber()
  private let sampler = PerformanceSampler()
  private let launch = LaunchBreadcrumbStore()
  private let collectionLock = NSLock()
  private let signpostLock = NSLock()
  private let energyLog = MXMetricManager.makeLogHandle(category: "energy")
  private var activeSignposts: [String: ActiveEnergySignpost] = [:]
  private var collectionEnabled = false
  private var powerObservers: [NSObjectProtocol] = []

  private func powerState() -> [String: Any] {
    let thermal: String
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: thermal = "nominal"
    case .fair: thermal = "fair"
    case .serious: thermal = "serious"
    case .critical: thermal = "critical"
    @unknown default: thermal = "unknown"
    }
    return ["thermalState": thermal, "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled]
  }

  private func stopPowerObserving() {
    for observer in powerObservers { NotificationCenter.default.removeObserver(observer) }
    powerObservers.removeAll()
  }

  private func staticSignpostName(_ name: EnergySignpostName) -> StaticString {
    switch name {
    case .launch: return "launch"
    case .mapReady: return "map_ready"
    case .locationAcquisition: return "location_acquisition"
    case .snapshot: return "snapshot"
    case .routeCalculation: return "route_calculation"
    case .markerTracking: return "marker_tracking"
    case .backgroundTransition: return "background_transition"
    }
  }

  private func emitEnergySignpost(name: String, phase: String, token: String?) {
    collectionLock.lock()
    defer { collectionLock.unlock() }
    let enabled = collectionEnabled
    guard enabled, let signpost = EnergySignpostName(rawValue: name) else { return }
    switch phase {
    case "event":
      mxSignpost(.event, log: energyLog, name: staticSignpostName(signpost))
    case "begin":
      let id = OSSignpostID(log: energyLog)
      if let token, !token.isEmpty {
        signpostLock.lock()
        activeSignposts[token] = ActiveEnergySignpost(id: id, name: signpost)
        signpostLock.unlock()
      }
      mxSignpost(
        .begin,
        log: energyLog,
        name: staticSignpostName(signpost),
        signpostID: id
      )
    case "end":
      guard let token, !token.isEmpty else { return }
      signpostLock.lock()
      let active = activeSignposts.removeValue(forKey: token)
      signpostLock.unlock()
      guard let active else { return }
      mxSignpost(
        .end,
        log: energyLog,
        name: staticSignpostName(active.name),
        signpostID: active.id
      )
    default:
      return
    }
  }

  public func definition() -> ModuleDefinition {
    Name("HitherMetrics")
    Events("powerStateChanged")

    OnStartObserving {
      // Read before registration: iOS otherwise may not activate thermal notifications.
      _ = self.powerState()
      self.stopPowerObserving()
      for name in [ProcessInfo.thermalStateDidChangeNotification, Notification.Name.NSProcessInfoPowerStateDidChange, UIApplication.didBecomeActiveNotification] {
        self.powerObservers.append(NotificationCenter.default.addObserver(
          forName: name, object: nil, queue: .main
        ) { [weak self] _ in
          guard let self else { return }
          self.sendEvent("powerStateChanged", self.powerState())
        })
      }
    }
    OnStopObserving { self.stopPowerObserving() }
    AsyncFunction("getPowerState") { () -> [String: Any] in self.powerState() }

    OnCreate {
      self.subscriber.prepare()
    }

    OnDestroy {
      self.stopPowerObserving()
      self.sampler.setEnabled(false)
      self.collectionLock.lock()
      let wasEnabled = self.collectionEnabled
      self.collectionEnabled = false
      self.collectionLock.unlock()
      self.signpostLock.lock()
      self.activeSignposts.removeAll()
      self.signpostLock.unlock()
      if wasEnabled {
        MXMetricManager.shared.remove(self.subscriber)
      }
    }

    AsyncFunction("setCollectionEnabled") { (enabled: Bool) -> Bool in
      self.collectionLock.lock()
      defer { self.collectionLock.unlock() }
      guard enabled != self.collectionEnabled else { return true }
      self.collectionEnabled = enabled
      self.sampler.setEnabled(enabled)
      if enabled {
        MXMetricManager.shared.add(self.subscriber)
      } else {
        self.signpostLock.lock()
        self.activeSignposts.removeAll()
        self.signpostLock.unlock()
        MXMetricManager.shared.remove(self.subscriber)
        self.subscriber.purgePayloads()
      }
      return true
    }

    AsyncFunction("purgePayloads") {
      self.subscriber.purgePayloads()
    }

    AsyncFunction("drainPayloads") { () -> [[String: Any]] in
      self.subscriber.drainPayloads()
    }

    AsyncFunction("removePayloads") { (ids: [String]) in
      self.subscriber.removePayloads(ids: ids)
    }

    AsyncFunction("samplePerformance") { (windowMs: Double, promise: Promise) in
      self.collectionLock.lock()
      let enabled = self.collectionEnabled
      self.collectionLock.unlock()
      guard enabled else {
        promise.resolve(nil)
        return
      }
      self.sampler.sample(windowMs: windowMs) { result in
        self.collectionLock.lock()
        let stillEnabled = self.collectionEnabled
        self.collectionLock.unlock()
        promise.resolve(stillEnabled ? result : nil)
      }
    }

    AsyncFunction("previousLaunch") { () -> [String: Any]? in
      self.launch.previous
    }

    AsyncFunction("markLaunchPhase") { (phase: String) in
      guard let value = LaunchPhase(rawValue: phase) else { return }
      self.launch.mark(value)
    }

    AsyncFunction("signpost") { (name: String, phase: String, token: String?) in
      self.emitEnergySignpost(name: name, phase: phase, token: token)
    }
  }
}
