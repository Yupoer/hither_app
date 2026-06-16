//
//  GoogleMapsService.swift
//  Hither
//
//  Google Maps SDK integration service
//

import Foundation
import CoreLocation
import SwiftUI

// MARK: - Google Map Type Enum
enum GoogleMapType {
    case roadmap
    case satellite
    case hybrid
    case terrain
}

class GoogleMapsService: ObservableObject {
    static let shared = GoogleMapsService()
    
    // Google Maps API Configuration
    private let apiKey = "AIzaSyCx0cyeUy7O4HEdZcGSlElYJibPVT5ciZQ"
    private let baseURL = "https://maps.googleapis.com/maps/api"
    
    // MARK: - API Restrictions (as per user requirements)
    // - Routes API
    // - Places API (New)
    // - Maps SDK for iOS
    
    @Published var isConfigured = false
    @Published var errorMessage: String?
    
    init() {
        configureGoogleMaps()
    }
    
    private func configureGoogleMaps() {
        // Note: Google Maps SDK configuration would be done here
        // For now, we'll implement the web APIs that are available
        isConfigured = true
    }
    
    // MARK: - Places API (New) - Autocomplete
    
    func searchPlaces(query: String) async throws -> [PlaceResult] {
        guard !query.isEmpty else { return [] }
        
        let encodedQuery = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let urlString = "\(baseURL)/place/autocomplete/json?input=\(encodedQuery)&key=\(apiKey)"
        
        guard let url = URL(string: urlString) else {
            throw GoogleMapsError.invalidURL
        }
        
        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(PlaceAutocompleteResponse.self, from: data)
        
        if response.status != "OK" {
            throw GoogleMapsError.apiError(response.status)
        }
        
        return response.predictions
    }
    
    func getPlaceDetails(placeId: String) async throws -> PlaceDetails {
        let urlString = "\(baseURL)/place/details/json?place_id=\(placeId)&key=\(apiKey)"
        
        guard let url = URL(string: urlString) else {
            throw GoogleMapsError.invalidURL
        }
        
        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(PlaceDetailsResponse.self, from: data)
        
        if response.status != "OK" {
            throw GoogleMapsError.apiError(response.status)
        }
        
        return response.result
    }
    
    // MARK: - Routes API - Directions
    
    func getDirections(from origin: CLLocationCoordinate2D, to destination: CLLocationCoordinate2D) async throws -> RouteResponse {
        let originString = "\(origin.latitude),\(origin.longitude)"
        let destinationString = "\(destination.latitude),\(destination.longitude)"
        
        let urlString = "\(baseURL)/directions/json?origin=\(originString)&destination=\(destinationString)&key=\(apiKey)"
        
        guard let url = URL(string: urlString) else {
            throw GoogleMapsError.invalidURL
        }
        
        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(DirectionsResponse.self, from: data)
        
        if response.status != "OK" {
            throw GoogleMapsError.apiError(response.status)
        }
        
        return RouteResponse(
            routes: response.routes.map { route in
                GoogleRoute(
                    overview_polyline: route.overview_polyline,
                    legs: route.legs,
                    bounds: route.bounds
                )
            }
        )
    }
    
    // MARK: - Utility Methods
    
    func decodePolyline(_ polyline: String) -> [CLLocationCoordinate2D] {
        var coordinates: [CLLocationCoordinate2D] = []
        var index = polyline.startIndex
        var lat = 0
        var lng = 0
        
        while index < polyline.endIndex {
            var shift = 0
            var result = 0
            
            repeat {
                let byte = Int(polyline[index].asciiValue! - 63)
                index = polyline.index(after: index)
                result |= (byte & 0x1F) << shift
                shift += 5
            } while (result & 0x20) != 0
            
            let deltaLat = (result & 1) != 0 ? ~(result >> 1) : (result >> 1)
            lat += deltaLat
            
            shift = 0
            result = 0
            
            repeat {
                let byte = Int(polyline[index].asciiValue! - 63)
                index = polyline.index(after: index)
                result |= (byte & 0x1F) << shift
                shift += 5
            } while (result & 0x20) != 0
            
            let deltaLng = (result & 1) != 0 ? ~(result >> 1) : (result >> 1)
            lng += deltaLng
            
            let coordinate = CLLocationCoordinate2D(
                latitude: Double(lat) / 1E5,
                longitude: Double(lng) / 1E5
            )
            coordinates.append(coordinate)
        }
        
        return coordinates
    }
}

// MARK: - Data Models

enum GoogleMapsError: Error, LocalizedError {
    case invalidURL
    case apiError(String)
    case noResults
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .apiError(let status):
            return "API Error: \(status)"
        case .noResults:
            return "No results found"
        }
    }
}

// Places API Models
struct PlaceAutocompleteResponse: Codable {
    let predictions: [PlaceResult]
    let status: String
}

struct PlaceResult: Codable, Identifiable {
    let place_id: String
    let description: String
    let structured_formatting: StructuredFormatting?
    
    var id: String { place_id }
}

struct StructuredFormatting: Codable {
    let main_text: String
    let secondary_text: String?
}

struct PlaceDetailsResponse: Codable {
    let result: PlaceDetails
    let status: String
}

struct PlaceDetails: Codable {
    let place_id: String
    let name: String
    let geometry: PlaceGeometry
    let formatted_address: String
}

struct PlaceGeometry: Codable {
    let location: PlaceLocation
}

struct PlaceLocation: Codable {
    let lat: Double
    let lng: Double
    
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }
}

// Directions API Models
struct DirectionsResponse: Codable {
    let routes: [DirectionsRoute]
    let status: String
}

struct DirectionsRoute: Codable {
    let overview_polyline: OverviewPolyline
    let legs: [RouteLeg]
    let bounds: RouteBounds
}

struct OverviewPolyline: Codable {
    let points: String
}

struct RouteLeg: Codable {
    let distance: Distance
    let duration: Duration
    let start_location: PlaceLocation
    let end_location: PlaceLocation
}

struct Distance: Codable {
    let text: String
    let value: Int
}

struct Duration: Codable {
    let text: String
    let value: Int
}

struct RouteBounds: Codable {
    let northeast: PlaceLocation
    let southwest: PlaceLocation
}

// Simplified route models for internal use
struct RouteResponse {
    let routes: [GoogleRoute]
}

struct GoogleRoute {
    let overview_polyline: OverviewPolyline
    let legs: [RouteLeg]
    let bounds: RouteBounds
    
    var polylineCoordinates: [CLLocationCoordinate2D] {
        GoogleMapsService.shared.decodePolyline(overview_polyline.points)
    }
}