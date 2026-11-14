import ExpoModulesCore
import MapKit
import Contacts

// Failure contract:
//   - searchPlaces: reject() on error.
//                   resolve([]) only when MapKit genuinely found nothing.
//   - getDirections: reject() on error / no route.
public class HitherMapsModule: Module {
  private struct ETARequest {
    let directions: MKDirections
    let promise: Promise

    func cancel() {
      directions.cancel()
      promise.resolve(nil)
    }
  }
  private var pendingETAs: [String: ETARequest] = [:]

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

    AsyncFunction("getDirections") { (from: [String: Any], to: [String: Any], travelMode: String, promise: Promise) in
      guard let fromCoord = Self.coordinate(from: from), let toCoord = Self.coordinate(from: to) else {
        promise.reject("ERR_MAPS_DIRECTIONS", "Invalid coordinates")
        return
      }
      let request = MKDirections.Request()
      request.source = MKMapItem(placemark: MKPlacemark(coordinate: fromCoord))
      request.destination = MKMapItem(placemark: MKPlacemark(coordinate: toCoord))
      switch travelMode {
      case "drive": request.transportType = .automobile
      case "transit": request.transportType = .transit
      default: request.transportType = .walking
      }
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
        promise.resolve([
          "distanceMeters": route.distance,
          "expectedTravelTimeSeconds": route.expectedTravelTime,
          "points": points,
        ])
      }
    }

    AsyncFunction("getTravelETA") { [self] (id: String, from: [String: Any], to: [String: Any], travelMode: String, promise: Promise) in
      guard let fromCoord = Self.coordinate(from: from), CLLocationCoordinate2DIsValid(fromCoord),
            let toCoord = Self.coordinate(from: to), CLLocationCoordinate2DIsValid(toCoord) else {
        promise.resolve(nil)
        return
      }
      let request = MKDirections.Request()
      request.source = MKMapItem(placemark: MKPlacemark(coordinate: fromCoord))
      request.destination = MKMapItem(placemark: MKPlacemark(coordinate: toCoord))
      switch travelMode {
      case "walk": request.transportType = .walking
      case "drive": request.transportType = .automobile
      case "transit": request.transportType = .transit
      case "bicycle": request.transportType = .cycling
      default:
        promise.resolve(nil)
        return
      }
      let transportType = request.transportType
      let directions = MKDirections(request: request)
      self.pendingETAs[id] = ETARequest(directions: directions, promise: promise)
      directions.calculateETA { [weak self] response, error in
        guard let pending = self?.pendingETAs.removeValue(forKey: id) else { return }
        guard error == nil, let response, response.transportType == transportType,
              response.expectedTravelTime.isFinite, response.expectedTravelTime > 0 else {
          pending.promise.resolve(nil)
          return
        }
        pending.promise.resolve(response.expectedTravelTime)
      }
    }.runOnQueue(.main)

    AsyncFunction("cancelTravelETA") { (id: String) in
      self.pendingETAs.removeValue(forKey: id)?.cancel()
    }.runOnQueue(.main)

    OnDestroy {
      DispatchQueue.main.async {
        let pending = self.pendingETAs
        self.pendingETAs.removeAll()
        for request in pending.values { request.cancel() }
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
