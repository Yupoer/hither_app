import ExpoModulesCore

// APNs device-token module — backs `apps/mobile/src/native/notifications.ts`.
//
// INTENTIONAL no-op: on an EAS Dev Build, `expo-notifications`'
// `getDevicePushTokenAsync()` already returns the real APNs hex token (it owns
// the AppDelegate remote-registration plumbing), and notifications.ts uses that
// path when this module returns null. Re-implementing AppDelegate token capture
// here would duplicate and fight expo-notifications, so we deliberately defer to
// it. This stub stays only as the explicit native seam the JS boundary probes
// first; returning nil routes to the expo implementation.
//
// (Deciding WHEN / WHO to push is server-side — the send-push Edge Function —
// never here.)
public class HitherNotificationsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HitherNotifications")

    AsyncFunction("getDevicePushToken") { () -> String? in
      // Defer to expo-notifications (see notes above).
      return nil
    }
  }
}
