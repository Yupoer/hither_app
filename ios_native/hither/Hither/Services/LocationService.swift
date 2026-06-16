//
//  LocationService.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation
import CoreLocation
import FirebaseFirestore
import UIKit

@MainActor
class LocationService: NSObject, ObservableObject {
    @Published var currentLocation: CLLocation?
    @Published var authorizationStatus: CLAuthorizationStatus = .notDetermined
    @Published var isTracking = false
    @Published var errorMessage: String?
    
    private let locationManager = CLLocationManager()
    private let db = Firestore.firestore()
    private var groupId: String?
    private var userId: String?
    private var locationUpdateTimer: Timer?
    private let developmentService = DevelopmentService.shared
    
    // Live Activity destination monitoring
    var activeDestination: CLLocationCoordinate2D?
    var activeDestinationName: String?
    var onDestinationReached: (() -> Void)?
    private let destinationThreshold: CLLocationDistance = 10.0 // 10 meters
    private var initialDistance: CLLocationDistance?
    private var liveActivityUpdateCallback: ((CLLocationDistance, CLLocationDistance?) -> Void)?
    
    override init() {
        super.init()
        setupLocationManager()
        setupBatteryMonitoring()
    }
    
    private func setupBatteryMonitoring() {
        UIDevice.current.isBatteryMonitoringEnabled = true
    }
    
    private func setupLocationManager() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 10 // Update every 10 meters
        authorizationStatus = locationManager.authorizationStatus
        
        // Listen to development service changes
        setupDevelopmentModeObserver()
    }
    
    private func setupDevelopmentModeObserver() {
        // Observe changes to development service to update location immediately
        NotificationCenter.default.addObserver(
            forName: NSNotification.Name("DevelopmentLocationChanged"),
            object: nil,
            queue: .main
        ) { _ in
            self.updateLocationFromDevelopmentService()
        }
    }
    
    private func updateLocationFromDevelopmentService() {
        if let spoofedLocation = developmentService.getCurrentLocation() {
            currentLocation = spoofedLocation
            
            // Check destination proximity for Live Activity
            checkDestinationProximity(at: spoofedLocation)
            
            // Sync to Firestore when tracking
            if isTracking {
                Task {
                    await syncLocationToFirestore()
                }
            }
        }
    }
    
    func requestLocationPermission() {
        switch authorizationStatus {
        case .notDetermined:
            locationManager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            errorMessage = "Location access is required for group tracking. Please enable it in Settings."
        case .authorizedWhenInUse:
            locationManager.requestAlwaysAuthorization()
        case .authorizedAlways:
            break
        @unknown default:
            break
        }
    }
    
    func preloadLocationServices() {
        // Initialize location services early for better performance
        requestLocationPermission()
        
        if authorizationStatus == .authorizedAlways || authorizationStatus == .authorizedWhenInUse {
            // Start location updates without full tracking setup
            locationManager.startUpdatingLocation()
            
            // Stop after getting initial location to save battery
            DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) {
                if !self.isTracking {
                    self.locationManager.stopUpdatingLocation()
                }
            }
        }
    }
    
    func startTracking(groupId: String, userId: String) {
        guard authorizationStatus == .authorizedAlways || authorizationStatus == .authorizedWhenInUse else {
            requestLocationPermission()
            return
        }
        
        self.groupId = groupId
        self.userId = userId
        self.isTracking = true
        
        locationManager.startUpdatingLocation()
        
        // Only enable background location updates if we have proper authorization and capabilities
        if authorizationStatus == .authorizedAlways {
            // Background location updates require "location" background mode capability
            // Only enable if the app is configured for background execution
            if Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") != nil {
                locationManager.allowsBackgroundLocationUpdates = true
                locationManager.pausesLocationUpdatesAutomatically = false
            }
        }
        
        // Start periodic updates to Firestore
        startPeriodicLocationSync()
    }
    
    func stopTracking() {
        isTracking = false
        locationManager.stopUpdatingLocation()
        
        // Only disable if it was enabled
        if locationManager.allowsBackgroundLocationUpdates {
            locationManager.allowsBackgroundLocationUpdates = false
        }
        
        stopPeriodicLocationSync()
    }
    
    private func startPeriodicLocationSync() {
        // Adaptive update frequency based on movement and battery
        let updateInterval = getOptimalUpdateInterval()
        
        locationUpdateTimer = Timer.scheduledTimer(withTimeInterval: updateInterval, repeats: true) { [weak self] _ in
            Task {
                await self?.syncLocationToFirestore()
                await self?.checkBatteryAndAdjustTracking()
            }
        }
    }
    
    private func getOptimalUpdateInterval() -> TimeInterval {
        // Battery optimization logic
        let batteryLevel = UIDevice.current.batteryLevel
        let batteryState = UIDevice.current.batteryState
        
        // Base intervals
        var interval: TimeInterval = 30.0 // Default 30 seconds
        
        // Adjust based on battery level
        if batteryLevel < 0.2 { // Less than 20%
            interval = 120.0 // 2 minutes
        } else if batteryLevel < 0.5 { // Less than 50%
            interval = 60.0 // 1 minute
        }
        
        // Reduce frequency if charging
        if batteryState == .charging || batteryState == .full {
            interval = min(interval, 15.0) // More frequent when charging
        }
        
        // Reduce frequency if stationary (could be enhanced with motion detection)
        if let lastLocation = currentLocation {
            // Simple stationary detection - in real app would use more sophisticated logic
            interval = max(interval, 45.0)
        }
        
        return interval
    }
    
    private func checkBatteryAndAdjustTracking() async {
        let batteryLevel = UIDevice.current.batteryLevel
        
        // Send low battery alert if needed
        if batteryLevel < 0.15 && batteryLevel > 0.10 { // Between 10-15%
            await sendLowBatteryAlert()
        }
        
        // Adjust tracking precision based on battery
        if batteryLevel < 0.2 {
            locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            locationManager.distanceFilter = 50 // Update every 50 meters
        } else {
            locationManager.desiredAccuracy = kCLLocationAccuracyBest
            locationManager.distanceFilter = 10 // Update every 10 meters
        }
    }
    
    private func sendLowBatteryAlert() async {
        // This would integrate with NotificationService in a real implementation
        print("Low battery alert: Location tracking may be affected")
    }
    
    private func stopPeriodicLocationSync() {
        locationUpdateTimer?.invalidate()
        locationUpdateTimer = nil
    }
    
    private func syncLocationToFirestore() async {
        guard let groupId = groupId,
              let userId = userId,
              let location = currentLocation else { return }
        
        let geoPoint = GeoPoint(from: location.coordinate)
        
        do {
            // Update user location in groups/{groupId}/members/{userId} subcollection
            try await db.collection("groups").document(groupId)
                .collection("members").document(userId).updateData([
                    "location": [
                        "latitude": geoPoint.latitude,
                        "longitude": geoPoint.longitude
                    ],
                    "lastLocationUpdate": Timestamp(date: Date())
                ])
        } catch {
            errorMessage = "Failed to sync location: \(error.localizedDescription)"
        }
    }
    
    func calculateDistance(to coordinate: CLLocationCoordinate2D) -> CLLocationDistance? {
        guard let currentLocation = currentLocation else { return nil }
        let targetLocation = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        return currentLocation.distance(from: targetLocation)
    }
    
    static func formatDistance(_ distance: CLLocationDistance) -> String {
        if distance < 1000 {
            return String(format: "%.0f m", distance)
        } else {
            return String(format: "%.1f km", distance / 1000)
        }
    }
    
    func calculateBearing(to coordinate: CLLocationCoordinate2D) -> Double? {
        guard let currentLocation = currentLocation else { return nil }
        
        let lat1 = currentLocation.coordinate.latitude * .pi / 180
        let lat2 = coordinate.latitude * .pi / 180
        let dLon = (coordinate.longitude - currentLocation.coordinate.longitude) * .pi / 180
        
        let y = sin(dLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        
        let bearing = atan2(y, x) * 180 / .pi
        return bearing >= 0 ? bearing : bearing + 360
    }
    
    // MARK: - Live Activity Destination Monitoring
    
    func startDestinationMonitoring(
        destination: CLLocationCoordinate2D,
        destinationName: String,
        onReached: @escaping () -> Void,
        onProgressUpdate: ((CLLocationDistance, CLLocationDistance?) -> Void)? = nil
    ) {
        activeDestination = destination
        activeDestinationName = destinationName
        onDestinationReached = onReached
        liveActivityUpdateCallback = onProgressUpdate
        
        // Calculate initial distance
        if let currentLocation = currentLocation {
            let destinationLocation = CLLocation(latitude: destination.latitude, longitude: destination.longitude)
            initialDistance = currentLocation.distance(from: destinationLocation)
        }
        
        print("🎯 Started monitoring destination: \(destinationName)")
        
        // Check immediately if already within threshold
        if let currentLocation = currentLocation {
            checkDestinationProximity(at: currentLocation)
        }
    }
    
    func stopDestinationMonitoring() {
        activeDestination = nil
        activeDestinationName = nil
        onDestinationReached = nil
        liveActivityUpdateCallback = nil
        initialDistance = nil
        
        print("⏹️ Stopped destination monitoring")
    }
    
    private func checkDestinationProximity(at location: CLLocation) {
        guard let destination = activeDestination,
              let destinationName = activeDestinationName,
              let onReached = onDestinationReached else { return }
        
        let destinationLocation = CLLocation(latitude: destination.latitude, longitude: destination.longitude)
        let distance = location.distance(from: destinationLocation)
        
        print("📍 Distance to \(destinationName): \(String(format: "%.1f", distance))m")
        
        // Update Live Activity progress if callback is available
        liveActivityUpdateCallback?(distance, initialDistance)
        
        if distance <= destinationThreshold {
            print("🎯 Destination reached! Distance: \(String(format: "%.1f", distance))m")
            
            // Clear monitoring before calling callback to prevent re-triggering
            stopDestinationMonitoring()
            onReached()
        }
    }
}

extension LocationService: CLLocationManagerDelegate {
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        
        // Use spoofed location if development mode is enabled
        let effectiveLocation = developmentService.getCurrentLocation() ?? location
        currentLocation = effectiveLocation
        
        // Check destination proximity for Live Activity
        checkDestinationProximity(at: effectiveLocation)
        
        // Sync to Firestore when tracking and location changes significantly
        if isTracking {
            Task {
                await syncLocationToFirestore()
            }
        }
    }
    
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        errorMessage = "Location update failed: \(error.localizedDescription)"
    }
    
    func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        authorizationStatus = status
        
        switch status {
        case .authorizedWhenInUse, .authorizedAlways:
            errorMessage = nil
        case .denied, .restricted:
            errorMessage = "Location access denied. Please enable it in Settings."
            stopTracking()
        case .notDetermined:
            break
        @unknown default:
            break
        }
    }
}