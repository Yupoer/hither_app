import Foundation

private func snapshot(_ sample: Double?, destination: String = "point-a", session: String = "session-a") -> [String: Any] {
  var row: [String: Any] = ["navigationSessionId": session, "destinationId": destination,
    "distanceMeters": 400.0, "etaSeconds": 120.0, "etaTargetAtMs": 122000.0,
    "progress": 0.4, "gatheredCount": 1]
  row["sampledAtMs"] = sample
  return row
}

private func number(_ row: [String: Any], _ key: String) -> Double? {
  (row[key] as? NSNumber)?.doubleValue
}

private actor UpdateProbe {
  var state = snapshot(2000)
  var started = false
  func hasStarted() -> Bool { started }
  func apply(_ incoming: [String: Any], delay: UInt64) async {
    let read = state
    started = true
    if delay > 0 { try? await Task.sleep(nanoseconds: delay) }
    state = HitherLiveActivitySnapshot.merge(incoming: incoming, current: read)
  }
  func sample() -> Double? { number(state, "sampledAtMs") }
}

@main
struct HitherLiveActivitySnapshotTests {
  static func main() async {
    var newer = snapshot(2000)
    newer["distanceMeters"] = 200.0
    newer["progress"] = 0.8
    newer["etaTargetAtMs"] = 62000.0
    var older = snapshot(1000)
    older["gatheredCount"] = 2
    let resumed = HitherLiveActivitySnapshot.merge(incoming: older, current: newer)
    precondition(number(resumed, "sampledAtMs") == 2000)
    precondition(number(resumed, "distanceMeters") == 200)
    precondition(number(resumed, "progress") == 0.8)
    precondition(number(resumed, "etaTargetAtMs") == 62000)
    precondition(number(resumed, "gatheredCount") == 2, "metadata must still update")

    for invalid: Double? in [nil, .nan, .infinity, -1, 2000] {
      let merged = HitherLiveActivitySnapshot.merge(incoming: snapshot(invalid), current: newer)
      precondition(number(merged, "etaTargetAtMs") == 62000, "missing/equal/invalid samples must not reset ETA")
    }
    precondition(number(HitherLiveActivitySnapshot.merge(incoming: snapshot(3000), current: newer), "sampledAtMs") == 3000)
    precondition(number(HitherLiveActivitySnapshot.merge(incoming: snapshot(1000, destination: "point-b"), current: newer), "sampledAtMs") == 1000)
    precondition(number(HitherLiveActivitySnapshot.merge(incoming: snapshot(1000, session: "session-b"), current: newer), "sampledAtMs") == 1000)
    precondition(!HitherLiveActivitySnapshot.matchesScope(incoming: snapshot(1000, destination: "point-b"), current: newer))
    precondition(!HitherLiveActivitySnapshot.matchesScope(incoming: snapshot(1000, session: "session-b"), current: newer))

    var radiusOnly = older
    radiusOnly["progress"] = 1.0
    radiusOnly["etaSeconds"] = 0.0
    precondition(number(HitherLiveActivitySnapshot.merge(incoming: radiusOnly, current: newer), "progress") == 0.8)

    var receipt = older
    receipt["personalArrived"] = true
    receipt["personalArrivalAtMs"] = 4000.0
    let arrived = HitherLiveActivitySnapshot.merge(incoming: receipt, current: newer)
    precondition(number(arrived, "progress") == 1)
    precondition(number(arrived, "etaSeconds") == 0)
    precondition(number(arrived, "sampledAtMs") == 2000, "receipt does not make old GPS fresh")
    precondition(number(HitherLiveActivitySnapshot.merge(incoming: snapshot(5000), current: arrived), "progress") == 1)
    var oldUndo = snapshot(5000)
    oldUndo["personalArrived"] = false
    oldUndo["personalArrivalAtMs"] = 3000.0
    precondition(number(HitherLiveActivitySnapshot.merge(incoming: oldUndo, current: arrived), "progress") == 1)
    oldUndo["personalArrivalAtMs"] = 6000.0
    let undone = HitherLiveActivitySnapshot.merge(incoming: oldUndo, current: arrived)
    precondition(undone["personalArrived"] as? Bool == false)
    precondition(number(undone, "progress") == 0.4)
    oldUndo["sampledAtMs"] = 1000.0
    let staleUndo = HitherLiveActivitySnapshot.merge(incoming: oldUndo, current: arrived)
    precondition(number(staleUndo, "sampledAtMs") == 2000)
    precondition(number(staleUndo, "distanceMeters") == 200)
    precondition(staleUndo["progress"] == nil && staleUndo["etaSeconds"] == nil && staleUndo["etaTargetAtMs"] == nil,
      "old GPS undo clears receipt without mixing estimates from different fixes")
    let refreshedUndo = HitherLiveActivitySnapshot.merge(incoming: snapshot(7000), current: staleUndo)
    precondition(number(refreshedUndo, "sampledAtMs") == 7000 && number(refreshedUndo, "progress") == 0.4)
    var sequencedArrival = arrived
    sequencedArrival["personalArrivalSequence"] = 10.0
    oldUndo["personalArrivalSequence"] = 11.0
    oldUndo["personalArrivalAtMs"] = 100.0
    let clockRollbackUndo = HitherLiveActivitySnapshot.merge(incoming: oldUndo, current: sequencedArrival)
    precondition(clockRollbackUndo["personalArrived"] as? Bool == false,
      "durable sequence orders a new undo even when the wall clock rolls back")
    oldUndo["personalArrivalSequence"] = 9.0
    oldUndo["personalArrivalAtMs"] = 9000.0
    precondition(number(HitherLiveActivitySnapshot.merge(incoming: oldUndo, current: sequencedArrival), "progress") == 1)

    // Exercise the real async queue: the first operation suspends after reading
    // current state. The stale caller must wait, then read the updated snapshot.
    let queue = HitherLiveActivityUpdateQueue()
    let probe = UpdateProbe()
    let first = Task { await queue.perform { await probe.apply(snapshot(3000), delay: 50_000_000) } }
    while !(await probe.hasStarted()) { await Task.yield() }
    let second = Task { await queue.perform { await probe.apply(snapshot(1000), delay: 0) } }
    await first.value
    await second.value
    let finalSample = await probe.sample()
    precondition(finalSample == 3000, "late stale foreground completion cannot overwrite headless GPS")
    print("PASS native snapshot matrix and serialized foreground/headless race")
  }
}
