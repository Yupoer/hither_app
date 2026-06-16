//
//  DevelopmentService.swift
//  Hither
//
//  Created by Dillion on 2025/7/30.
//

import Foundation
import SwiftUI
import CoreLocation

class DevelopmentService: ObservableObject {
    static let shared = DevelopmentService()
    
    @Published var isDevelopmentModeEnabled = false
    @Published var spoofedLocation: CLLocation?
    @Published var isLocationSpoofingEnabled = false
    
    private init() {
        // Load development mode state from UserDefaults
        isDevelopmentModeEnabled = UserDefaults.standard.bool(forKey: "DevelopmentMode")
        isLocationSpoofingEnabled = UserDefaults.standard.bool(forKey: "LocationSpoofing")
        
        // Load spoofed location if exists
        if let data = UserDefaults.standard.data(forKey: "SpoofedLocation"),
           let coordinate = try? NSKeyedUnarchiver.unarchiveTopLevelObjectWithData(data) as? CLLocation {
            spoofedLocation = coordinate
        }
    }
    
    func toggleDevelopmentMode() {
        isDevelopmentModeEnabled.toggle()
        UserDefaults.standard.set(isDevelopmentModeEnabled, forKey: "DevelopmentMode")
        
        if !isDevelopmentModeEnabled {
            // Disable location spoofing when dev mode is disabled
            disableLocationSpoofing()
        }
    }
    
    func setSpoofedLocation(_ location: CLLocation) {
        spoofedLocation = location
        isLocationSpoofingEnabled = true
        
        // Save to UserDefaults
        if let data = try? NSKeyedArchiver.archivedData(withRootObject: location, requiringSecureCoding: false) {
            UserDefaults.standard.set(data, forKey: "SpoofedLocation")
        }
        UserDefaults.standard.set(true, forKey: "LocationSpoofing")
        
        // Notify location service of the change
        NotificationCenter.default.post(name: NSNotification.Name("DevelopmentLocationChanged"), object: nil)
    }
    
    func disableLocationSpoofing() {
        isLocationSpoofingEnabled = false
        spoofedLocation = nil
        UserDefaults.standard.set(false, forKey: "LocationSpoofing")
        UserDefaults.standard.removeObject(forKey: "SpoofedLocation")
    }
    
    func getCurrentLocation() -> CLLocation? {
        if isDevelopmentModeEnabled && isLocationSpoofingEnabled {
            return spoofedLocation
        }
        return nil // Return nil to use real location
    }
}