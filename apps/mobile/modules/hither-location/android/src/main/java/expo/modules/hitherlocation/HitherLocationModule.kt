package expo.modules.hitherlocation

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// SCAFFOLD (Phase B) — Android no-op stub.
//
// Exists so an Android build links and `requireOptionalNativeModule` can
// resolve the module name. Returns null so the JS layer
// (apps/mobile/src/native/location.ts) falls back to expo-location.
// Port FusedLocationProvider-based positioning here later if/when Android
// needs parity with the iOS native module.
class HitherLocationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HitherLocation")

    AsyncFunction("getCurrentLocation") {
      // TODO(Phase B): real Android implementation. Null -> JS fallback.
      null
    }
  }
}
