package expo.modules.hithermaps

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// SCAFFOLD (Phase B) — Android no-op. The JS Nominatim fallback in maps.ts
// handles Android; port a native provider here only if needed.
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
