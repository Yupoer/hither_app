import ExpoModulesCore
import Foundation
import MetricKit

public final class HitherMetricsModule: Module, MXMetricManagerSubscriber {
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

  public func definition() -> ModuleDefinition {
    Name("HitherMetrics")

    OnCreate {
      _ = self.spoolDirectory
      MXMetricManager.shared.add(self)
    }

    OnDestroy {
      MXMetricManager.shared.remove(self)
    }

    AsyncFunction("drainPayloads") { () -> [[String: Any]] in
      self.queue.sync {
        self.payloadFiles().compactMap { url in
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

    AsyncFunction("removePayloads") { (ids: [String]) in
      self.queue.sync {
        let accepted = Set(ids)
        for url in self.payloadFiles() {
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
  }

  public func didReceive(_ payloads: [MXMetricPayload]) {
    queue.async {
      for payload in payloads {
        self.write(payload.jsonRepresentation(), kind: "metric")
      }
    }
  }

  public func didReceive(_ payloads: [MXDiagnosticPayload]) {
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
