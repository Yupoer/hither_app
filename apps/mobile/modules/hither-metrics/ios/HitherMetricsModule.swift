import ExpoModulesCore
import Foundation
import MetricKit
import QuartzCore
import UIKit
import Darwin

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

  func sample(windowMs: Double, completion: @escaping ([String: Any]) -> Void) {
    DispatchQueue.main.async {
      guard self.displayLink == nil else {
        completion([:])
        return
      }
      let device = UIDevice.current
      device.isBatteryMonitoringEnabled = true
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
      DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(boundedWindow))) {
        self.finish()
      }
    }
  }

  @objc private func tick(_ link: CADisplayLink) {
    frameCount += 1
    if let previous = lastTimestamp {
      let interval = link.timestamp - previous
      if interval > 0 { frameIntervals.append(interval) }
    }
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
    let cpuPercent = cpuTimeMs.map { min(max(($0 / 1_000) / elapsed / processorCount * 100, 0), 100) }
    let maxFps = Double(UIScreen.main.maximumFramesPerSecond)
    let uiFps = Double(frameCount) / elapsed
    let sortedIntervals = frameIntervals.sorted()
    let p95Index = sortedIntervals.isEmpty
      ? 0
      : min(sortedIntervals.count - 1, Int(Double(sortedIntervals.count - 1) * 0.95))
    let frameTimeP95Ms = sortedIntervals.isEmpty ? nil : sortedIntervals[p95Index] * 1_000
    let targetInterval = maxFps > 0 ? 1 / maxFps : 0
    let missedFrameRatio: Double? = targetInterval > 0 && !frameIntervals.isEmpty
      ? Double(frameIntervals.filter { $0 > targetInterval * 1.5 }.count) / Double(frameIntervals.count)
      : nil

    var result: [String: Any] = [
      "uiFps": uiFps,
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
    if let memoryMb = endedSnapshot.memoryMb { result["memoryMb"] = memoryMb }
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
    var info = task_thread_times_info_data_t()
    var count = mach_msg_type_number_t(
      MemoryLayout<task_thread_times_info_data_t>.size / MemoryLayout<integer_t>.size
    )
    let status = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_THREAD_TIMES_INFO), $0, &count)
      }
    }
    guard status == KERN_SUCCESS else { return nil }
    let user = Double(info.user_time.seconds) * 1_000 + Double(info.user_time.microseconds) / 1_000
    let system = Double(info.system_time.seconds) * 1_000 + Double(info.system_time.microseconds) / 1_000
    return user + system
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

public final class HitherMetricsModule: Module {
  private let subscriber = MetricKitSubscriber()
  private let sampler = PerformanceSampler()

  public func definition() -> ModuleDefinition {
    Name("HitherMetrics")

    OnCreate {
      let subscriber = self.subscriber
      subscriber.prepare()
      MXMetricManager.shared.add(subscriber)
    }

    OnDestroy {
      let subscriber = self.subscriber
      MXMetricManager.shared.remove(subscriber)
    }

    AsyncFunction("drainPayloads") { () -> [[String: Any]] in
      self.subscriber.drainPayloads()
    }

    AsyncFunction("removePayloads") { (ids: [String]) in
      self.subscriber.removePayloads(ids: ids)
    }

    AsyncFunction("samplePerformance") { (windowMs: Double, promise: Promise) in
      self.sampler.sample(windowMs: windowMs) { result in
        promise.resolve(result)
      }
    }
  }
}
