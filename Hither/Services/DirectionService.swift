//
//  DirectionService.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation
import CoreLocation
import NearbyInteraction
import SwiftUI
import Combine

@MainActor
class DirectionService: NSObject, ObservableObject {
    @Published var distanceToLeader: Double?
    @Published var bearingToLeader: Double?
    @Published var distanceToTarget: Double?
    @Published var bearingToTarget: Double?
    @Published var isNearbyInteractionAvailable = false
    @Published var nearbyObjects: [NINearbyObject] = []
    @Published var errorMessage: String?
    
    private var niSession: NISession?
    private let locationService: LocationService
    private var targetLeaderLocation: CLLocationCoordinate2D?
    private var targetMemberLocation: CLLocationCoordinate2D?
    
    init(locationService: LocationService) {
        self.locationService = locationService
        super.init()
        
        setupNearbyInteraction()
        setupLocationObserver()
    }
    
    deinit {
        niSession?.invalidate()
    }
    
    private func setupNearbyInteraction() {
        if #available(iOS 16.0, *) {
            isNearbyInteractionAvailable = NISession.deviceCapabilities.supportsPreciseDistanceMeasurement
        } else {
            isNearbyInteractionAvailable = NISession.isSupported
        }
        
        if isNearbyInteractionAvailable {
            niSession = NISession()
            niSession?.delegate = self
        }
    }
    
    private func setupLocationObserver() {
        // Observe location changes to update direction calculations
        locationService.$currentLocation
            .compactMap { $0 }
            .sink { [weak self] location in
                self?.updateDirectionCalculations()
                self?.updateTargetDirectionCalculations()
            }
            .store(in: &cancellables)
    }
    
    private var cancellables = Set<AnyCancellable>()
    
    func setTargetLeader(location: CLLocationCoordinate2D) {
        targetLeaderLocation = location
        updateDirectionCalculations()
    }
    
    func setTargetMember(location: CLLocationCoordinate2D) {
        targetMemberLocation = location
        updateTargetDirectionCalculations()
    }
    
    func clearTargetMember() {
        targetMemberLocation = nil
        distanceToTarget = nil
        bearingToTarget = nil
    }
    
    private func updateDirectionCalculations() {
        guard let leaderLocation = targetLeaderLocation,
              let _ = locationService.currentLocation else {
            distanceToLeader = nil
            bearingToLeader = nil
            return
        }
        
        // Calculate distance
        distanceToLeader = locationService.calculateDistance(to: leaderLocation)
        
        // Calculate bearing
        bearingToLeader = locationService.calculateBearing(to: leaderLocation)
    }
    
    private func updateTargetDirectionCalculations() {
        guard let memberLocation = targetMemberLocation,
              let _ = locationService.currentLocation else {
            distanceToTarget = nil
            bearingToTarget = nil
            return
        }
        
        // Calculate distance
        distanceToTarget = locationService.calculateDistance(to: memberLocation)
        
        // Calculate bearing
        bearingToTarget = locationService.calculateBearing(to: memberLocation)
    }
    
    func startNearbyInteraction(with discoveryToken: NIDiscoveryToken) {
        guard let niSession = niSession,
              isNearbyInteractionAvailable else {
            errorMessage = "Nearby Interaction not supported on this device"
            return
        }
        
        do {
            let configuration = NINearbyPeerConfiguration(peerToken: discoveryToken)
            niSession.run(configuration)
        } catch {
            errorMessage = "Failed to start Nearby Interaction: \(error.localizedDescription)"
        }
    }
    
    func stopNearbyInteraction() {
        niSession?.pause()
        nearbyObjects.removeAll()
    }
    
    var currentDiscoveryToken: NIDiscoveryToken? {
        return niSession?.discoveryToken
    }
    
    // Helper functions for direction display
    func getDirectionArrowRotation() -> Angle {
        guard let bearing = bearingToLeader else { return .zero }
        return .degrees(bearing)
    }
    
    func getDistanceString() -> String {
        guard let distance = distanceToLeader else { return "Unknown" }
        
        if distance < 1000 {
            return String(format: "%.0fm", distance)
        } else {
            return String(format: "%.1fkm", distance / 1000)
        }
    }
    
    func getDirectionDescription() -> String {
        guard let bearing = bearingToLeader else { return "Unknown direction" }
        
        let directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        let index = Int((bearing + 22.5) / 45) % 8
        return directions[index]
    }
    
    // Helper functions for target member direction display
    func getTargetDirectionArrowRotation() -> Angle {
        guard let bearing = bearingToTarget else { return .zero }
        return .degrees(bearing)
    }
    
    func getTargetDistanceString() -> String {
        guard let distance = distanceToTarget else { return "Unknown" }
        
        if distance < 1000 {
            return String(format: "%.0fm", distance)
        } else {
            return String(format: "%.1fkm", distance / 1000)
        }
    }
    
    func getTargetDirectionDescription() -> String {
        guard let bearing = bearingToTarget else { return "Unknown direction" }
        
        let directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        let index = Int((bearing + 22.5) / 45) % 8
        return directions[index]
    }
}

extension DirectionService: @preconcurrency NISessionDelegate {
    nonisolated func session(_ session: NISession, didUpdate nearbyObjects: [NINearbyObject]) {
        Task { @MainActor in
            self.nearbyObjects = nearbyObjects
            
            // Update distance and direction from nearby interaction if available
            if let nearbyObject = nearbyObjects.first {
                if let distance = nearbyObject.distance {
                    distanceToLeader = Double(distance)
                }
                
                if let direction = nearbyObject.direction {
                    // Convert simd_float3 direction to bearing angle
                    let bearing = atan2(Double(direction.x), Double(direction.z)) * 180 / .pi
                    bearingToLeader = bearing >= 0 ? bearing : bearing + 360
                }
            }
        }
    }
    
    nonisolated func session(_ session: NISession, didRemove nearbyObjects: [NINearbyObject], reason: NINearbyObject.RemovalReason) {
        Task { @MainActor in
            self.nearbyObjects.removeAll { removedObject in
                nearbyObjects.contains { $0.discoveryToken == removedObject.discoveryToken }
            }
        }
    }
    
    nonisolated func sessionWasSuspended(_ session: NISession) {
        // Handle session suspension
    }
    
    nonisolated func sessionSuspensionEnded(_ session: NISession) {
        // Handle session resumption
    }
    
    nonisolated func session(_ session: NISession, didInvalidateWith error: Error) {
        Task { @MainActor in
            errorMessage = "Nearby Interaction session error: \(error.localizedDescription)"
            nearbyObjects.removeAll()
        }
    }
}