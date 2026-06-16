//
//  GoogleMapsParser.swift
//  Hither
//
//  Created by Claude on 2025/7/29.
//

import Foundation
import CoreLocation

struct GoogleMapsParser {
    
    struct ParsedLocation {
        let coordinate: CLLocationCoordinate2D
        let name: String?
        let address: String?
    }
    
    static func parseGoogleMapsURL(_ urlString: String) -> ParsedLocation? {
        guard let url = URL(string: urlString) else { return nil }
        
        // Handle different Google Maps URL formats
        if url.host?.contains("maps.google") == true || url.host?.contains("goo.gl") == true {
            return parseGoogleMapsShareURL(url)
        } else if url.host?.contains("maps.app.goo.gl") == true {
            return parseGoogleMapsAppURL(url)
        }
        
        return nil
    }
    
    private static func parseGoogleMapsShareURL(_ url: URL) -> ParsedLocation? {
        let urlString = url.absoluteString
        
        // Try to extract coordinates from various Google Maps URL formats
        
        // Format 1: https://maps.google.com/maps?q=37.7749,-122.4194
        if let qMatch = extractQueryParameter(from: urlString, parameter: "q") {
            if let coordinate = parseCoordinateString(qMatch) {
                return ParsedLocation(coordinate: coordinate, name: nil, address: nil)
            }
        }
        
        // Format 2: https://www.google.com/maps/@37.7749,-122.4194,15z
        if let atMatch = extractAtCoordinates(from: urlString) {
            return ParsedLocation(coordinate: atMatch, name: nil, address: nil)
        }
        
        // Format 3: https://maps.google.com/maps/place/Name/@37.7749,-122.4194,15z
        if let placeMatch = extractPlaceCoordinates(from: urlString) {
            return placeMatch
        }
        
        return nil
    }
    
    private static func parseGoogleMapsAppURL(_ url: URL) -> ParsedLocation? {
        // Handle shortened Google Maps app URLs like https://maps.app.goo.gl/xyz
        // These would need to be expanded first, which requires a network request
        // For now, return nil and suggest users use the full URL
        return nil
    }
    
    private static func extractQueryParameter(from urlString: String, parameter: String) -> String? {
        guard let components = URLComponents(string: urlString),
              let queryItems = components.queryItems else { return nil }
        
        return queryItems.first { $0.name == parameter }?.value
    }
    
    private static func extractAtCoordinates(from urlString: String) -> CLLocationCoordinate2D? {
        // Pattern: /@latitude,longitude,zoom
        let pattern = "/@(-?\\d+\\.\\d+),(-?\\d+\\.\\d+),\\d+"
        
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: urlString, range: NSRange(location: 0, length: urlString.count)) else {
            return nil
        }
        
        let nsString = urlString as NSString
        guard let latString = nsString.substring(with: match.range(at: 1)) as String?,
              let lngString = nsString.substring(with: match.range(at: 2)) as String?,
              let latitude = Double(latString),
              let longitude = Double(lngString) else {
            return nil
        }
        
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
    
    private static func extractPlaceCoordinates(from urlString: String) -> ParsedLocation? {
        // Pattern: /place/PlaceName/@latitude,longitude,zoom
        let pattern = "/place/([^/]+)/@(-?\\d+\\.\\d+),(-?\\d+\\.\\d+),\\d+"
        
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: urlString, range: NSRange(location: 0, length: urlString.count)) else {
            return nil
        }
        
        let nsString = urlString as NSString
        guard let nameString = nsString.substring(with: match.range(at: 1)) as String?,
              let latString = nsString.substring(with: match.range(at: 2)) as String?,
              let lngString = nsString.substring(with: match.range(at: 3)) as String?,
              let latitude = Double(latString),
              let longitude = Double(lngString) else {
            return nil
        }
        
        // Decode URL-encoded place name
        let decodedName = nameString.removingPercentEncoding?.replacingOccurrences(of: "+", with: " ")
        
        return ParsedLocation(
            coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
            name: decodedName,
            address: nil
        )
    }
    
    private static func parseCoordinateString(_ coordinateString: String) -> CLLocationCoordinate2D? {
        // Handle formats like "37.7749,-122.4194" or "37.7749, -122.4194"
        let components = coordinateString.replacingOccurrences(of: " ", with: "").split(separator: ",")
        
        guard components.count == 2,
              let latitude = Double(components[0]),
              let longitude = Double(components[1]) else {
            return nil
        }
        
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
    
    // Validate that coordinates are within valid ranges
    static func isValidCoordinate(_ coordinate: CLLocationCoordinate2D) -> Bool {
        return coordinate.latitude >= -90.0 && coordinate.latitude <= 90.0 &&
               coordinate.longitude >= -180.0 && coordinate.longitude <= 180.0
    }
}