package expo.modules.hithermetrics

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HitherMetricsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HitherMetrics")
    AsyncFunction("drainPayloads") { emptyList<Map<String, Any>>() }
    AsyncFunction("removePayloads") { _: List<String> -> Unit }
  }
}
