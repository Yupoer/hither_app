import Foundation
private final class ProbeRuntimeExecutor: JavaScriptExecutor, @unchecked Sendable {}
func checkRuntimeSeparation() {
  let global = JavaScriptExecutor()
  let bridge = JavaScriptExecutor(capture: JavaScriptJobCapture(), owner: Thread.current)
  let runtimeA = ProbeRuntimeExecutor()
  let runtimeB = ProbeRuntimeExecutor()
  precondition(global.isSameExclusiveExecutionContext(other: bridge))
  precondition(bridge.isSameExclusiveExecutionContext(other: global))
  precondition(!bridge.isSameExclusiveExecutionContext(other: runtimeA))
  precondition(!runtimeA.isSameExclusiveExecutionContext(other: bridge))
  precondition(!runtimeA.isSameExclusiveExecutionContext(other: runtimeB))
  precondition(runtimeA.isSameExclusiveExecutionContext(other: runtimeA))
}
struct MoveOnly: ~Copyable { let value: Int }
enum ProbeError: Error { case expected }
@JavaScriptActor func moduleDefinition(_ value: Int) -> Int { value + 1 }
func threadID() -> UInt64 { var value:UInt64=0;pthread_threadid_np(nil,&value);return value }
@main struct Main {
 static func main() {
  print("Foundation runtime: \(ProcessInfo.processInfo.operatingSystemVersionString)")
  if CommandLine.arguments.contains("ui") {
   // Expo AppContext.prepareUIRuntime runs synchronously on MainActor while
   // the regular JS runtime lives on another thread. Keep multithreading active
   // so the single-threaded fallback cannot hide a rejected UI runtime.
   let started = DispatchSemaphore(value: 0)
   let release = DispatchSemaphore(value: 0)
   let worker = Thread { started.signal(); release.wait() }
   worker.start()
   started.wait()
   precondition(Thread.isMainThread && Thread.isMultiThreaded())
   let original = threadID()
   let answer = JavaScriptActor.assumeIsolated {
    precondition(threadID() == original)
    return JavaScriptActor.assumeIsolated { moduleDefinition(41) }
   }
   precondition(answer == 42)
   do {
    let _: Int = try JavaScriptActor.assumeIsolated { () throws(ProbeError) -> Int in
     precondition(threadID() == original)
     throw .expected
    }
    preconditionFailure("Expected UI typed throw")
   } catch ProbeError.expected {} catch { preconditionFailure("Wrong UI typed error") }
   release.signal()
   print("UI runtime main-thread/nested/typed-throw=PASS")
  }
  let count = CommandLine.arguments.contains("many") ? 10000 : 1
  let done = DispatchSemaphore(value: 0)
  for runtime in 0..<2 {
   let thread = Thread {
    Thread.current.name = CommandLine.arguments.contains("wrong") ? "wrong" : "com.facebook.react.runtime.JavaScript"
    let original = threadID()
    if !CommandLine.arguments.contains("wrong") { checkRuntimeSeparation() }
    let empty: Int? = JavaScriptActor.assumeIsolated { nil }
    precondition(empty == nil)
    let start = Date()
    for i in 0..<count {
     let borrowed = MoveOnly(value: i)
     let answer: MoveOnly = JavaScriptActor.assumeIsolated {
      precondition(threadID() == original)
      let nested = JavaScriptActor.assumeIsolated {
       precondition(threadID() == original)
       return moduleDefinition(borrowed.value)
      }
      return MoveOnly(value: nested)
     }
     precondition(answer.value == i + 1)
     do {
      let _: Int = try JavaScriptActor.assumeIsolated { () throws(ProbeError) -> Int in
       precondition(threadID() == original)
       throw .expected
      }
      preconditionFailure("Expected typed throw")
     } catch ProbeError.expected {} catch { preconditionFailure("Wrong typed error") }
     precondition(JavaScriptActor.assumeIsolated { moduleDefinition(i) } == i + 1)
    }
    let elapsed = Date().timeIntervalSince(start)
    print("runtime=\(runtime) result=42 count=\(count) elapsed=\(elapsed) ms/iteration=\(elapsed * 1000 / Double(count)) nested/thread/throw/noncopyable=PASS")
    done.signal()
   }
   thread.start()
  }
  done.wait();done.wait()
 }
}
