import ExpoModulesCore

// SCAFFOLD (Phase B) — APNs / notifications native module.
//
// Backs `apps/mobile/src/native/notifications.ts`. Port the device-token /
// permission / handling pieces from:
//   ios_native/hither/Hither/Services/NotificationService.swift
// NOTE: deciding WHEN to push / WHO to push is server-side (Supabase Edge
// Function + APNs), NOT here. This module only obtains the device token and
// surfaces incoming notifications.
//
// Exported names/shapes MUST match notifications.ts:
//   getDevicePushToken(): Promise<string | null>
public class HitherNotificationsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HitherNotifications")

    AsyncFunction("getDevicePushToken") { () -> String? in
      // TODO(Phase B): register with APNs and return the hex device token.
      // Null -> JS treats remote push as unavailable (expo fallback).
      return nil
    }
  }
}
