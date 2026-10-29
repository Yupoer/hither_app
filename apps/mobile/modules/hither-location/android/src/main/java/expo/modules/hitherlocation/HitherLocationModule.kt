package expo.modules.hitherlocation

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HitherLocationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HitherLocation")

    AsyncFunction("getCurrentLocation") {
      null
    }
  }
}
