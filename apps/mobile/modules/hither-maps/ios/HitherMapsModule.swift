import ExpoModulesCore
import MapKit
import Contacts

// Phase B — Apple MapKit search / directions native module.
//
// Backs `apps/mobile/src/native/maps.ts`. On a Dev Build this replaces the
// JS Nominatim fallback with MKLocalSearch / MKDirections (Apple Maps),
// which gives far better quality search and real walking routes.
//
// Failure contract (so the JS layer can degrade gracefully):
//   - searchPlaces: reject() on error -> JS falls back to Nominatim.
//                   resolve([]) only when MapKit genuinely found nothing.
//   - getDirections: reject() on error / no route -> JS straight-line fallback.
public class HitherMapsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HitherMaps")

    AsyncFunction("searchPlaces") { (query: String, region: [String: Any]?, promise: Promise) in
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = query
      if let r = Self.coordinateRegion(from: region) {
        request.region = r
      }
      MKLocalSearch(request: request).start { response, error in
        if let error = error {
          promise.reject("ERR_MAPS_SEARCH", error.localizedDescription)
          return
        }
        let items = response?.mapItems ?? []
        let results: [[String: Any]] = items.map { item in
          let coord = item.placemark.coordinate
          return [
            "id": "\(coord.latitude),\(coord.longitude)",
            "name": item.name ?? item.placemark.name ?? query,
            "address": Self.address(for: item.placemark),
            "coordinates": ["latitude": coord.latitude, "longitude": coord.longitude],
          ]
        }
        promise.resolve(results)
      }
    }

    AsyncFunction("getDirections") { (from: [String: Any], to: [String: Any], promise: Promise) in
      guard let fromCoord = Self.coordinate(from: from), let toCoord = Self.coordinate(from: to) else {
        promise.reject("ERR_MAPS_DIRECTIONS", "Invalid coordinates")
        return
      }
      let request = MKDirections.Request()
      request.source = MKMapItem(placemark: MKPlacemark(coordinate: fromCoord))
      request.destination = MKMapItem(placemark: MKPlacemark(coordinate: toCoord))
      request.transportType = .walking
      MKDirections(request: request).calculate { response, error in
        if let error = error {
          promise.reject("ERR_MAPS_DIRECTIONS", error.localizedDescription)
          return
        }
        guard let route = response?.routes.first else {
          promise.reject("ERR_MAPS_DIRECTIONS", "No route found")
          return
        }
        let count = route.polyline.pointCount
        var coords = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: count)
        route.polyline.getCoordinates(&coords, range: NSRange(location: 0, length: count))
        let points = coords.map { ["latitude": $0.latitude, "longitude": $0.longitude] }
        promise.resolve(["distanceMeters": route.distance, "points": points])
      }
    }
  }

  private static func coordinate(from dict: [String: Any]?) -> CLLocationCoordinate2D? {
    guard let dict = dict,
      let lat = (dict["latitude"] as? NSNumber)?.doubleValue,
      let lon = (dict["longitude"] as? NSNumber)?.doubleValue else { return nil }
    return CLLocationCoordinate2D(latitude: lat, longitude: lon)
  }

  private static func coordinateRegion(from dict: [String: Any]?) -> MKCoordinateRegion? {
    guard let center = coordinate(from: dict),
      let latDelta = (dict?["latitudeDelta"] as? NSNumber)?.doubleValue,
      let lonDelta = (dict?["longitudeDelta"] as? NSNumber)?.doubleValue else { return nil }
    return MKCoordinateRegion(center: center, span: MKCoordinateSpan(latitudeDelta: latDelta, longitudeDelta: lonDelta))
  }

  private static func address(for placemark: MKPlacemark) -> String {
    if let postal = placemark.postalAddress {
      return CNPostalAddressFormatter.string(from: postal, style: .mailingAddress).replacingOccurrences(of: "\n", with: ", ")
    }
    return placemark.title ?? ""
  }
}
