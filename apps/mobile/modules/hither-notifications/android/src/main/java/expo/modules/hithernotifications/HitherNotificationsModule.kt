package expo.modules.hithernotifications

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Optional native push token hook. Returns null so the JS boundary falls
// through to expo-notifications (FCM device token). Do not short-circuit
// Android remote push from this stub.
class HitherNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HitherNotifications")

    AsyncFunction("getDevicePushToken") { ->
      null as String?
    }
  }
}
