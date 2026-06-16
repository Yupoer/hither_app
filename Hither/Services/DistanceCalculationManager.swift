//
//  DistanceCalculationManager.swift
//  Hither
//
//  Centralized distance calculation manager to replace multiple timers
//  and optimize performance by debouncing distance calculations
//

import Foundation
import CoreLocation

@MainActor
class DistanceCalculationManager: ObservableObject {
    static let shared = DistanceCalculationManager()
    
    // PERFORMANCE: Centralized distance calculation with debouncing
    private var monitoredTargets: [String: DistanceTarget] = [:]
    private var calculationTimer: Timer?
    private let debounceInterval: TimeInterval = 2.0 // 2 seconds minimum between calculations
    private var lastCalculationTime: Date?
    private var pendingCalculations: Set<String> = []
    
    // PERFORMANCE: Background queue for distance calculations to avoid blocking UI
    private let calculationQueue = DispatchQueue(label: "com.hither.distance-calculation", qos: .utility)
    
    private init() {
        startCalculationTimer()
    }
    
    deinit {
        calculationTimer?.invalidate()
    }
    
    // MARK: - Public API
    
    func startMonitoring(
        targetId: String,
        coordinate: CLLocationCoordinate2D,
        onDistanceUpdate: @escaping (Double) -> Void
    ) {
        let target = DistanceTarget(
            id: targetId,
            coordinate: coordinate,
            onUpdate: onDistanceUpdate
        )
        
        monitoredTargets[targetId] = target
        LocalizedLogger.debug("📏 Started monitoring distance for target: \(targetId)")
    }
    
    func stopMonitoring(targetId: String) {
        monitoredTargets.removeValue(forKey: targetId)
        pendingCalculations.remove(targetId)
        LocalizedLogger.debug("📏 Stopped monitoring distance for target: \(targetId)")
    }
    
    func requestDistanceCalculation(
        targetId: String,
        userLocation: CLLocationCoordinate2D,
        targetLocation: CLLocationCoordinate2D,
        completion: @escaping (Double) -> Void
    ) {
        // PERFORMANCE: Only queue calculation if enough time has passed or this is a new target
        let currentTime = Date()
        let shouldDebounce = lastCalculationTime.map { currentTime.timeIntervalSince($0) < debounceInterval } ?? false
        
        if !shouldDebounce || !monitoredTargets.keys.contains(targetId) {
            // Immediate calculation for new targets or when debounce period has passed
            performDistanceCalculation(
                userLocation: userLocation,
                targetLocation: targetLocation,
                completion: completion
            )
        } else {
            // Queue for next batch calculation
            pendingCalculations.insert(targetId)
            
            // Update target location in case it changed
            if var target = monitoredTargets[targetId] {
                target.coordinate = targetLocation
                target.lastUserLocation = userLocation
                monitoredTargets[targetId] = target
            }
        }
    }
    
    // MARK: - Private Implementation
    
    private func startCalculationTimer() {
        // PERFORMANCE: Timer runs every 2 seconds to batch process distance calculations
        calculationTimer = Timer.scheduledTimer(withTimeInterval: debounceInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.processPendingCalculations()
            }
        }
    }
    
    private func processPendingCalculations() {
        guard !pendingCalculations.isEmpty else { return }
        
        let targetIdsToProcess = Array(pendingCalculations)
        pendingCalculations.removeAll()
        
        LocalizedLogger.debug("📏 Processing \(targetIdsToProcess.count) pending distance calculations")
        
        // PERFORMANCE: Process calculations with proper concurrency handling
        Task {
            await withTaskGroup(of: Void.self) { group in
                for targetId in targetIdsToProcess {
                    guard let target = monitoredTargets[targetId],
                          let userLocation = target.lastUserLocation else { continue }
                    
                    group.addTask {
                        let distance = await self.calculateDistanceAsync(
                            from: userLocation,
                            to: target.coordinate
                        )
                        
                        await MainActor.run {
                            target.onUpdate(distance)
                        }
                    }
                }
            }
            
            lastCalculationTime = Date()
        }
    }
    
    private func performDistanceCalculation(
        userLocation: CLLocationCoordinate2D,
        targetLocation: CLLocationCoordinate2D,
        completion: @escaping (Double) -> Void
    ) {
        // PERFORMANCE: Calculate asynchronously
        Task {
            let distance = await calculateDistanceAsync(from: userLocation, to: targetLocation)
            
            await MainActor.run {
                completion(distance)
                self.lastCalculationTime = Date()
            }
        }
    }
    
    private func calculateDistanceAsync(
        from userLocation: CLLocationCoordinate2D,
        to targetLocation: CLLocationCoordinate2D
    ) async -> Double {
        return await withCheckedContinuation { continuation in
            calculationQueue.async {
                let userCLLocation = CLLocation(
                    latitude: userLocation.latitude,
                    longitude: userLocation.longitude
                )
                let targetCLLocation = CLLocation(
                    latitude: targetLocation.latitude,
                    longitude: targetLocation.longitude
                )
                
                let distance = userCLLocation.distance(from: targetCLLocation)
                continuation.resume(returning: distance)
            }
        }
    }
    
    // MARK: - Debug Methods
    
    func getActiveTargetCount() -> Int {
        return monitoredTargets.count
    }
    
    func getPendingCalculationCount() -> Int {
        return pendingCalculations.count
    }
}

// MARK: - Supporting Types

private struct DistanceTarget {
    let id: String
    var coordinate: CLLocationCoordinate2D
    var lastUserLocation: CLLocationCoordinate2D?
    let onUpdate: (Double) -> Void
}