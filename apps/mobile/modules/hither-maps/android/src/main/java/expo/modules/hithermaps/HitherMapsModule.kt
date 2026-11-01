package expo.modules.hithermaps

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HitherMapsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HitherMaps")

    AsyncFunction("searchPlaces") { _: String, _: Map<String, Any?>? ->
      emptyList<Map<String, Any?>>()
    }
    AsyncFunction("getDirections") { _: Map<String, Any?>, _: Map<String, Any?> ->
      emptyMap<String, Any?>()
    }
  }
}
