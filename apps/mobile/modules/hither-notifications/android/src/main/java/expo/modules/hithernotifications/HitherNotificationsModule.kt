package expo.modules.hithernotifications

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// SCAFFOLD (Phase B) — Android no-op. Returns null so the JS layer treats
// remote push as unavailable. Port FCM token retrieval later if needed.
class HitherNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HitherNotifications")

    AsyncFunction("getDevicePushToken") { -> null }
  }
}
