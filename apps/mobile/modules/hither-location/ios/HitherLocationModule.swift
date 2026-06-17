import ExpoModulesCore

// SCAFFOLD (Phase B) — not yet wired to real CoreLocation.
//
// Route A: this thin Expo module is the iOS native backing for the JS
// boundary `apps/mobile/src/native/location.ts`. Port the precise /
// background positioning logic from the existing standalone service:
//   ios_native/hither/Hither/Services/LocationService.swift
// Keep ONLY device-capability code here — no Firebase / business logic
// (groups, itineraries) which live in RN + Supabase.
//
// The exported function name + shape MUST match what location.ts expects:
//   getCurrentLocation(): Promise<{ coordinates: {latitude, longitude},
//                                   accuracy?: number, timestamp: number } | null>
//
// This compiles only under an EAS Dev Build (expo prebuild). It is never
// loaded in Expo Go; `requireOptionalNativeModule('HitherLocation')` returns
// null there and the Expo (expo-location) fallback runs.
public class HitherLocationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HitherLocation")

    AsyncFunction("getCurrentLocation") { () -> [String: Any]? in
      // TODO(Phase B): use a CLLocationManager-backed manager ported from
      // LocationService.swift and return the latest fix. Returning nil for
      // now keeps the JS layer falling back to expo-location.
      return nil
    }
  }
}
