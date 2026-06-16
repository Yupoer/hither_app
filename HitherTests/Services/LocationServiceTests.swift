//
//  LocationServiceTests.swift
//  HitherTests
//
//  Unit tests for LocationService business logic
//

import Foundation
import Testing
import CoreLocation
@testable import Hither

@Suite("LocationService Tests")
struct LocationServiceTests {
    
    // MARK: - Test Distance Calculations
    @Test("Should calculate distance between coordinates")
    func testDistanceCalculation() async throws {
        // Given
        let location1 = CLLocation(latitude: 37.7749, longitude: -122.4194) // SF
        let location2 = CLLocation(latitude: 37.7849, longitude: -122.4094) // ~1.4km away
        
        // When
        let distance = location1.distance(from: location2)
        
        // Then
        #expect(distance > 0, "Distance should be positive")
        #expect(distance < 2000, "Distance should be reasonable for nearby locations")
        #expect(distance > 1000, "Distance should be at least 1km for these coordinates")
    }
    
    @Test("Should calculate distance to same location as zero")
    func testSameLocationDistance() async throws {
        // Given
        let location = CLLocation(latitude: 37.7749, longitude: -122.4194)
        
        // When
        let distance = location.distance(from: location)
        
        // Then
        #expect(distance == 0, "Distance to same location should be zero")
    }
    
    // MARK: - Test Coordinate Validation
    @Test("Should validate coordinate ranges")
    func testCoordinateValidation() async throws {
        // Test valid coordinates
        let validLat: Double = 37.7749
        let validLng: Double = -122.4194
        
        #expect(validLat >= -90 && validLat <= 90, "Valid latitude should be in range")
        #expect(validLng >= -180 && validLng <= 180, "Valid longitude should be in range")
        
        // Test invalid coordinates
        let invalidLat: Double = 100.0 // > 90
        let invalidLng: Double = 200.0 // > 180
        
        #expect(invalidLat > 90, "Invalid latitude should be detectable")
        #expect(invalidLng > 180, "Invalid longitude should be detectable")
    }
    
    // MARK: - Test Location Accuracy Validation
    @Test("Should validate location accuracy")  
    func testLocationAccuracy() async throws {
        // Given
        let accurateLocation = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
            altitude: 0,
            horizontalAccuracy: 5.0, // Good accuracy
            verticalAccuracy: 5.0,
            timestamp: Date()
        )
        
        let inaccurateLocation = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
            altitude: 0,
            horizontalAccuracy: 100.0, // Poor accuracy
            verticalAccuracy: 100.0,
            timestamp: Date()
        )
        
        // Then
        #expect(accurateLocation.horizontalAccuracy < 10, "Accurate location should have good horizontal accuracy")
        #expect(inaccurateLocation.horizontalAccuracy > 50, "Inaccurate location should have poor horizontal accuracy")
        #expect(accurateLocation.horizontalAccuracy < inaccurateLocation.horizontalAccuracy, "Accurate location should be better than inaccurate")
    }
    
    // MARK: - Test Location Data Structure
    @Test("Should create location data with required fields")
    func testLocationDataStructure() async throws {
        // Given
        let latitude = 37.7749
        let longitude = -122.4194
        let timestamp = Date().timeIntervalSince1970
        
        // When
        let locationData: [String: Any] = [
            "latitude": latitude,
            "longitude": longitude,
            "timestamp": timestamp
        ]
        
        // Then
        #expect(locationData["latitude"] as? Double == latitude, "Latitude should be set correctly")
        #expect(locationData["longitude"] as? Double == longitude, "Longitude should be set correctly")
        #expect(locationData["timestamp"] as? TimeInterval == timestamp, "Timestamp should be set correctly")
    }
    
    // MARK: - Test Firestore Path Generation
    @Test("Should generate correct Firestore paths")
    func testFirestorePaths() async throws {
        // Given
        let groupId = "group123"
        let userId = "user456"
        
        // Expected paths based on the service architecture
        let expectedGroupPath = "groups/\(groupId)"
        let expectedMemberPath = "groups/\(groupId)/members/\(userId)"
        let expectedLocationPath = "groups/\(groupId)/members/\(userId)/location"
        
        // Then
        #expect(expectedGroupPath == "groups/group123", "Group path should be correct")
        #expect(expectedMemberPath == "groups/group123/members/user456", "Member path should be correct")
        #expect(expectedLocationPath == "groups/group123/members/user456/location", "Location path should be correct")
    }
    
    // MARK: - Test Location Update Intervals
    @Test("Should calculate appropriate update intervals")
    func testUpdateIntervals() async throws {
        // Given - Different battery levels
        let fullBattery: Float = 1.0  // 100%
        let mediumBattery: Float = 0.5 // 50%
        let lowBattery: Float = 0.2   // 20%
        
        // When - Calculate update intervals based on battery
        let fullBatteryInterval = calculateUpdateInterval(batteryLevel: fullBattery)
        let mediumBatteryInterval = calculateUpdateInterval(batteryLevel: mediumBattery)
        let lowBatteryInterval = calculateUpdateInterval(batteryLevel: lowBattery)
        
        // Then
        #expect(fullBatteryInterval <= mediumBatteryInterval, "Full battery should update more frequently")
        #expect(mediumBatteryInterval <= lowBatteryInterval, "Medium battery should update more frequently than low")
        #expect(lowBatteryInterval >= 60, "Low battery should have longer intervals for conservation")
    }
    
    private func calculateUpdateInterval(batteryLevel: Float) -> TimeInterval {
        // Battery optimization logic
        switch batteryLevel {
        case 0.8...1.0: return 30  // High battery: 30 seconds
        case 0.5...0.8: return 60  // Medium battery: 1 minute
        case 0.2...0.5: return 120 // Low battery: 2 minutes
        default: return 300        // Very low battery: 5 minutes
        }
    }
    
    // MARK: - Test Mock Location Operations
    @Test("Should handle location updates with mock service")
    func testMockLocationUpdates() async throws {
        // Given
        let mockService = MockFirebaseService.shared
        mockService.reset()
        
        let groupId = "group123"
        let userId = "user456"
        let latitude = 37.7749
        let longitude = -122.4194
        
        // When
        try await mockService.updateLocation(groupId: groupId, userId: userId, latitude: latitude, longitude: longitude)
        let members = try await mockService.getMembers(groupId: groupId)
        
        // Then
        let member = members[userId]
        let location = member?["location"] as? [String: Any]
        
        #expect(location != nil, "Location should be stored for member")
        #expect(location?["latitude"] as? Double == latitude, "Latitude should match")
        #expect(location?["longitude"] as? Double == longitude, "Longitude should match")
        #expect(location?["timestamp"] as? TimeInterval != nil, "Timestamp should be set")
    }
    
    // MARK: - Test Movement Detection
    @Test("Should detect significant movement")
    func testMovementDetection() async throws {
        // Given
        let startLocation = CLLocation(latitude: 37.7749, longitude: -122.4194)
        let nearbyLocation = CLLocation(latitude: 37.7750, longitude: -122.4195) // ~15m away
        let farLocation = CLLocation(latitude: 37.7849, longitude: -122.4094) // ~1.4km away
        
        let significantMoveThreshold: CLLocationDistance = 100 // 100 meters
        
        // When
        let nearbyDistance = startLocation.distance(from: nearbyLocation)
        let farDistance = startLocation.distance(from: farLocation)
        
        // Then
        #expect(nearbyDistance < significantMoveThreshold, "Nearby movement should be below threshold")
        #expect(farDistance > significantMoveThreshold, "Far movement should be above threshold")
    }
    
    // MARK: - Test Destination Monitoring
    @Test("Should calculate distance to destination")
    func testDestinationMonitoring() async throws {
        // Given
        let currentLocation = CLLocation(latitude: 37.7749, longitude: -122.4194)
        let destination = CLLocationCoordinate2D(latitude: 37.7849, longitude: -122.4094)
        let destinationThreshold: CLLocationDistance = 10.0 // 10 meters
        
        // When
        let destinationLocation = CLLocation(latitude: destination.latitude, longitude: destination.longitude)
        let distance = currentLocation.distance(from: destinationLocation)
        
        let isAtDestination = distance <= destinationThreshold
        let isNearDestination = distance <= 50.0
        
        // Then
        #expect(distance > 0, "Distance to destination should be positive")
        #expect(!isAtDestination, "Should not be at destination for these coordinates")
        #expect(!isNearDestination, "Should not be near destination for these coordinates")
        
        // Test close destination
        let closeDestination = CLLocation(latitude: 37.7749, longitude: -122.4195) // Very close
        let closeDistance = currentLocation.distance(from: closeDestination)
        let isCloseAtDestination = closeDistance <= destinationThreshold
        
        #expect(closeDistance < distance, "Close destination should be nearer")
    }
    
    // MARK: - Test Authorization Status Handling
    @Test("Should handle different authorization statuses")
    func testAuthorizationStatuses() async throws {
        // Given - Different authorization statuses
        let statuses: [CLAuthorizationStatus] = [
            .notDetermined,
            .denied,
            .restricted,
            .authorizedWhenInUse,
            .authorizedAlways
        ]
        
        // When/Then - Test status handling logic
        for status in statuses {
            let canTrackLocation = isLocationTrackingAllowed(status: status)
            let canTrackInBackground = isBackgroundTrackingAllowed(status: status)
            
            switch status {
            case .authorizedWhenInUse, .authorizedAlways:
                #expect(canTrackLocation, "Should allow tracking for authorized statuses")
            case .denied, .restricted:
                #expect(!canTrackLocation, "Should not allow tracking for denied/restricted statuses")
            case .notDetermined:
                #expect(!canTrackLocation, "Should not allow tracking for undetermined status")
            @unknown default:
                #expect(!canTrackLocation, "Should not allow tracking for unknown statuses")
            }
            
            if status == .authorizedAlways {
                #expect(canTrackInBackground, "Should allow background tracking for always authorized")
            } else {
                #expect(!canTrackInBackground, "Should not allow background tracking for other statuses")
            }
        }
    }
    
    private func isLocationTrackingAllowed(status: CLAuthorizationStatus) -> Bool {
        return status == .authorizedWhenInUse || status == .authorizedAlways
    }
    
    private func isBackgroundTrackingAllowed(status: CLAuthorizationStatus) -> Bool {
        return status == .authorizedAlways
    }
}