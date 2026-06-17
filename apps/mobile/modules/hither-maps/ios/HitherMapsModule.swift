import ExpoModulesCore

// SCAFFOLD (Phase B) — Apple MapKit search / directions native module.
//
// Backs `apps/mobile/src/native/maps.ts`. On a Dev Build this can replace
// the JS Nominatim fallback with MKLocalSearch / MKDirections for better
// quality. Reference for the place/route data shapes:
//   ios_native/hither/Hither/Services/GoogleMapsService.swift
//   ios_native/hither/Hither/Utils/GoogleMapsParser.swift
// (Prefer MapKit on iOS to avoid the Google dependency.)
//
// Exported names/shapes MUST match maps.ts:
//   searchPlaces(query, region?): Promise<PlaceResult[]>
//     PlaceResult = { id, name, address?, coordinates: {latitude, longitude} }
//   getDirections(from, to): Promise<{ distanceMeters, points: Coordinates[] }>
public class HitherMapsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HitherMaps")

    AsyncFunction("searchPlaces") { (query: String, region: [String: Any]?) -> [[String: Any]] in
      // TODO(Phase B): MKLocalSearch biased by `region`. Empty -> JS fallback.
      return []
    }

    AsyncFunction("getDirections") { (from: [String: Any], to: [String: Any]) -> [String: Any] in
      // TODO(Phase B): MKDirections route. Empty dict -> JS straight-line fallback.
      return [:]
    }
  }
}
