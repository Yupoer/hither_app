//
//  ItineraryService.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation
import FirebaseFirestore
import CoreLocation

@MainActor
class ItineraryService: ObservableObject {
    @Published var currentItinerary: GroupItinerary?
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let db = Firestore.firestore()
    private var itineraryListener: ListenerRegistration?
    private var liveActivityService: LiveActivityService?
    private var locationService: LocationService?
    
    init() {
        if #available(iOS 16.1, *) {
            liveActivityService = LiveActivityService()
        }
    }
    
    func setLocationService(_ locationService: LocationService) {
        self.locationService = locationService
    }
    
    deinit {
        itineraryListener?.remove()
    }
    
    func startListeningToItinerary(groupId: String, userId: String = "", groupName: String = "", userRole: String = "member", leaderName: String = "", memberCount: Int = 1) {
        itineraryListener?.remove()
        
        itineraryListener = db.collection("groups")
            .document(groupId)
            .collection("itinerary")
            .addSnapshotListener { [weak self] snapshot, error in
                Task { @MainActor in
                    if let error = error {
                        self?.errorMessage = "Failed to sync itinerary: \(error.localizedDescription)"
                        return
                    }
                    
                    guard let documents = snapshot?.documents else { return }
                    
                    if documents.isEmpty {
                        // Create new itinerary if none exists
                        self?.currentItinerary = GroupItinerary(groupId: groupId)
                    } else {
                        self?.parseItineraryFromDocuments(documents, groupId: groupId, userId: userId, groupName: groupName, userRole: userRole, leaderName: leaderName, memberCount: memberCount)
                    }
                }
            }
    }
    
    func stopListeningToItinerary() {
        itineraryListener?.remove()
        itineraryListener = nil
        currentItinerary = nil
    }
    
    func addWaypoint(
        name: String,
        description: String? = nil,
        type: WaypointType,
        location: CLLocationCoordinate2D,
        groupId: String,
        createdBy: String
    ) async {
        isLoading = true
        errorMessage = nil
        
        let geoPoint = GeoPoint(from: location)
        let order = (currentItinerary?.waypoints.count ?? 0)
        
        let waypoint = Waypoint(
            groupId: groupId,
            name: name,
            description: description,
            type: type,
            location: geoPoint,
            createdBy: createdBy,
            order: order
        )
        
        do {
            // Add waypoint to Firestore (no duplicate id or groupId)
            try await db.collection("groups")
                .document(groupId)
                .collection("itinerary")
                .document(waypoint.id)
                .setData([
                    "name": waypoint.name,
                    "description": waypoint.description ?? "",
                    "createdBy": waypoint.createdBy,
                    "type": waypoint.type.rawValue,
                    "location": waypoint.location.toFirestoreData(),
                    "createdAt": Timestamp(date: waypoint.createdAt),
                    "updatedAt": Timestamp(date: waypoint.updatedAt),
                    "isActive": waypoint.isActive,
                    "isCompleted": waypoint.isCompleted,
                    "isInProgress": waypoint.isInProgress,
                    "order": waypoint.order
                ])
            
            // Update itinerary document
            // No need to update central itinerary document
            
            // Send notification about itinerary update
            await notifyItineraryUpdate(
                groupId: groupId,
                action: .added,
                waypointName: waypoint.name,
                updatedBy: createdBy
            )
            
        } catch {
            errorMessage = "Failed to add waypoint: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    func updateWaypoint(
        waypointId: String,
        name: String? = nil,
        description: String? = nil,
        location: CLLocationCoordinate2D? = nil,
        groupId: String,
        updatedBy: String
    ) async {
        guard var itinerary = currentItinerary,
              let waypointIndex = itinerary.waypoints.firstIndex(where: { $0.id == waypointId }) else {
            errorMessage = "Waypoint not found"
            return
        }
        
        isLoading = true
        errorMessage = nil
        
        var waypoint = itinerary.waypoints[waypointIndex]
        
        if let name = name { waypoint.name = name }
        if let description = description { waypoint.description = description }
        if let location = location { waypoint.location = GeoPoint(from: location) }
        waypoint.updatedAt = Date()
        
        do {
            try await db.collection("groups")
                .document(groupId)
                .collection("itinerary")
                .document(waypointId)
                .updateData([
                    "name": waypoint.name,
                    "description": waypoint.description ?? "",
                    "location": waypoint.location.toFirestoreData(),
                    "updatedAt": Timestamp(date: waypoint.updatedAt)
                ])
            
            // No need to update central itinerary document
            
            await notifyItineraryUpdate(
                groupId: groupId,
                action: .updated,
                waypointName: waypoint.name,
                updatedBy: updatedBy
            )
            
        } catch {
            errorMessage = "Failed to update waypoint: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    func startWaypointProgress(waypointId: String, groupId: String, updatedBy: String, groupName: String, userRole: String, leaderName: String, memberCount: Int) async {
        guard let itinerary = currentItinerary,
              let waypoint = itinerary.waypoints.first(where: { $0.id == waypointId }) else {
            errorMessage = "Waypoint not found"
            return
        }
        
        isLoading = true
        errorMessage = nil
        
        do {
            // Stop any other waypoint that might be in progress
            for existingWaypoint in itinerary.waypoints where existingWaypoint.isInProgress {
                try await db.collection("groups")
                    .document(groupId)
                    .collection("itinerary")
                    .document(existingWaypoint.id)
                    .updateData([
                        "isInProgress": false,
                        "updatedAt": Timestamp(date: Date())
                    ])
            }
            
            // Start this waypoint
            try await db.collection("groups")
                .document(groupId)
                .collection("itinerary")
                .document(waypointId)
                .updateData([
                    "isInProgress": true,
                    "updatedAt": Timestamp(date: Date())
                ])
            
            // No need to update central itinerary document
            
            await notifyItineraryUpdate(
                groupId: groupId,
                action: .updated,
                waypointName: waypoint.name,
                updatedBy: updatedBy
            )
            
            // Start Live Activity
            await startLiveActivity(for: waypoint, groupId: groupId, userId: updatedBy, groupName: groupName, userRole: userRole, leaderName: leaderName, memberCount: memberCount)
            
            // Start automatic destination monitoring for Live Activity
            locationService?.startDestinationMonitoring(
                destination: waypoint.location.coordinate,
                destinationName: waypoint.name,
                onReached: { [weak self] in
                    Task { @MainActor in
                        // Automatically stop waypoint progress when destination is reached
                        await self?.stopWaypointProgress(waypointId: waypointId, groupId: groupId, updatedBy: updatedBy)
                        print("🎯 Automatically stopped waypoint progress - destination reached!")
                    }
                },
                onProgressUpdate: { [weak self] currentDistance, totalDistance in
                    Task { @MainActor in
                        // Update Live Activity progress
                        await self?.updateLiveActivityProgress(currentDistance: currentDistance, totalDistance: totalDistance ?? currentDistance)
                    }
                }
            )
            
        } catch {
            errorMessage = "Failed to start waypoint progress: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    func stopWaypointProgress(waypointId: String, groupId: String, updatedBy: String) async {
        guard let itinerary = currentItinerary,
              let waypoint = itinerary.waypoints.first(where: { $0.id == waypointId }) else {
            errorMessage = "Waypoint not found"
            return
        }
        
        isLoading = true
        errorMessage = nil
        
        do {
            try await db.collection("groups")
                .document(groupId)
                .collection("itinerary")
                .document(waypointId)
                .updateData([
                    "isInProgress": false,
                    "updatedAt": Timestamp(date: Date())
                ])
            
            // No need to update central itinerary document
            
            // Stop destination monitoring
            locationService?.stopDestinationMonitoring()
            
            // Stop Live Activity
            await stopLiveActivity()
            
        } catch {
            errorMessage = "Failed to stop waypoint progress: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    private func startLiveActivity(for waypoint: Waypoint, groupId: String, userId: String, groupName: String, userRole: String, leaderName: String, memberCount: Int) async {
        if #available(iOS 16.1, *) {
            guard let liveActivityService = liveActivityService else { return }
            
            // Calculate initial distance
            let locationService = LocationService()
            if let userLocation = locationService.currentLocation {
                let targetLocation = CLLocation(latitude: waypoint.location.latitude, longitude: waypoint.location.longitude)
                let totalDistance = userLocation.distance(from: targetLocation)
                
                await liveActivityService.startNavigationLiveActivity(
                    groupName: groupName,
                    groupId: groupId,
                    userId: userId,
                    userRole: userRole,
                    leaderName: leaderName,
                    memberCount: memberCount,
                    destinationName: waypoint.name,
                    currentDistance: totalDistance,
                    totalDistance: totalDistance,
                    groupStatus: "going",
                    message: "Going to \(waypoint.name)"
                )
            }
        }
    }
    
    private func stopLiveActivity() async {
        if #available(iOS 16.1, *) {
            guard let liveActivityService = liveActivityService else { return }
            await liveActivityService.stopLiveActivity()
        }
    }
    
    func updateLiveActivityProgress(currentDistance: Double, totalDistance: Double) async {
        if #available(iOS 16.1, *) {
            guard let liveActivityService = liveActivityService else { return }
            await liveActivityService.updateLocationProgress(
                currentDistance: currentDistance,
                totalDistance: totalDistance
            )
        }
    }
    
    func removeWaypoint(waypointId: String, groupId: String, updatedBy: String) async {
        guard let itinerary = currentItinerary,
              let waypoint = itinerary.waypoints.first(where: { $0.id == waypointId }) else {
            errorMessage = "Waypoint not found"
            return
        }
        
        isLoading = true
        errorMessage = nil
        
        do {
            try await db.collection("groups")
                .document(groupId)
                .collection("itinerary")
                .document(waypointId)
                .delete()
            
            // No need to update central itinerary document
            
            await notifyItineraryUpdate(
                groupId: groupId,
                action: .removed,
                waypointName: waypoint.name,
                updatedBy: updatedBy
            )
            
        } catch {
            errorMessage = "Failed to remove waypoint: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    func markWaypointCompleted(waypointId: String, groupId: String, updatedBy: String) async {
        guard let itinerary = currentItinerary,
              let waypoint = itinerary.waypoints.first(where: { $0.id == waypointId }) else {
            errorMessage = "Waypoint not found"
            return
        }
        
        isLoading = true
        errorMessage = nil
        
        do {
            // If waypoint is in progress, stop it first
            let updateData: [String: Any] = [
                "isCompleted": true,
                "isInProgress": false,  // Stop going when completed
                "updatedAt": Timestamp(date: Date())
            ]
            
            try await db.collection("groups")
                .document(groupId)
                .collection("itinerary")
                .document(waypointId)
                .updateData(updateData)
            
            // No need to update central itinerary document
            
            await notifyItineraryUpdate(
                groupId: groupId,
                action: .completed,
                waypointName: waypoint.name,
                updatedBy: updatedBy
            )
            
            // Stop Live Activity and destination monitoring if waypoint was in progress
            if waypoint.isInProgress {
                locationService?.stopDestinationMonitoring()
                await stopLiveActivity()
            }
            
        } catch {
            errorMessage = "Failed to mark waypoint as completed: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    func reorderWaypoints(waypoints: [Waypoint], groupId: String, updatedBy: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let batch = db.batch()
            
            for (index, waypoint) in waypoints.enumerated() {
                let waypointRef = db.collection("groups")
                    .document(groupId)
                    .collection("itinerary")
                    .document(waypoint.id)
                
                batch.updateData([
                    "order": index,
                    "updatedAt": Timestamp(date: Date())
                ], forDocument: waypointRef)
            }
            
            try await batch.commit()
            
            // No need to update central itinerary document
            
            await notifyItineraryUpdate(
                groupId: groupId,
                action: .reordered,
                waypointName: "waypoints",
                updatedBy: updatedBy
            )
            
        } catch {
            errorMessage = "Failed to reorder waypoints: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    // updateItineraryDocument method removed - no longer needed with new structure
    
    private func notifyItineraryUpdate(
        groupId: String,
        action: WaypointUpdate.WaypointAction,
        waypointName: String,
        updatedBy: String
    ) async {
        // In a real implementation, this would trigger push notifications
        // For now, we'll just log the update
        print("Itinerary updated: \(action.rawValue) \(waypointName) by \(updatedBy)")
    }
    
    private func parseItineraryFromDocuments(_ documents: [QueryDocumentSnapshot], groupId: String, userId: String = "", groupName: String = "", userRole: String = "member", leaderName: String = "", memberCount: Int = 1) {
        let waypoints = documents.compactMap { document -> Waypoint? in
            let data = document.data()
            let id = document.documentID // Use document ID instead of stored id
            
            guard let name = data["name"] as? String,
                  let typeString = data["type"] as? String,
                  let type = WaypointType(rawValue: typeString),
                  let locationData = data["location"] as? [String: Any],
                  let lat = locationData["latitude"] as? Double,
                  let lng = locationData["longitude"] as? Double,
                  let createdAtTimestamp = data["createdAt"] as? Timestamp,
                  let updatedAtTimestamp = data["updatedAt"] as? Timestamp,
                  let createdBy = data["createdBy"] as? String,
                  let isActive = data["isActive"] as? Bool,
                  let order = data["order"] as? Int else {
                return nil
            }
            
            let description = data["description"] as? String
            let isCompleted = data["isCompleted"] as? Bool ?? false
            let isInProgress = data["isInProgress"] as? Bool ?? false
            let location = GeoPoint(latitude: lat, longitude: lng)
            
            return Waypoint(
                id: id,
                groupId: groupId,
                name: name,
                description: description,
                type: type,
                location: location,
                createdAt: createdAtTimestamp.dateValue(),
                updatedAt: updatedAtTimestamp.dateValue(),
                createdBy: createdBy,
                isActive: isActive,
                isCompleted: isCompleted,
                isInProgress: isInProgress,
                order: order
            )
        }.sorted { $0.order < $1.order }
        
        var itinerary = GroupItinerary(groupId: groupId)
        itinerary.waypoints = waypoints
        currentItinerary = itinerary
        
        // Auto-start/restart Live Activity if there's already a current waypoint
        if let currentWaypoint = itinerary.currentWaypoint,
           let locationService = locationService,
           !userId.isEmpty {  // Only start if we have proper user context
            print("🎯 Found current waypoint: \(currentWaypoint.name) (inProgress: \(currentWaypoint.isInProgress)) - restarting Live Activity")
            
            // Restart Live Activity for current waypoint (ensures it's updated with latest destination)
            Task { @MainActor in
                // Stop any existing Live Activity first
                await stopLiveActivity()
                
                // Start fresh Live Activity with current waypoint
                await startLiveActivity(
                    for: currentWaypoint,
                    groupId: groupId,
                    userId: userId,
                    groupName: groupName.isEmpty ? "Current Group" : groupName,
                    userRole: userRole,
                    leaderName: leaderName.isEmpty ? "Leader" : leaderName,
                    memberCount: memberCount
                )
                
                // Restart destination monitoring
                locationService.stopDestinationMonitoring()  // Stop existing monitoring
                locationService.startDestinationMonitoring(
                    destination: currentWaypoint.location.coordinate,
                    destinationName: currentWaypoint.name,
                    onReached: { [weak self] in
                        Task { @MainActor in
                            if currentWaypoint.isInProgress {
                                await self?.stopWaypointProgress(waypointId: currentWaypoint.id, groupId: groupId, updatedBy: userId)
                                print("🎯 Auto-stopped waypoint progress - destination reached")
                            }
                        }
                    },
                    onProgressUpdate: { [weak self] currentDistance, totalDistance in
                        Task { @MainActor in
                            await self?.updateLiveActivityProgress(currentDistance: currentDistance, totalDistance: totalDistance ?? currentDistance)
                        }
                    }
                )
            }
        } else if !userId.isEmpty {
            // No current waypoint - stop Live Activity if running
            Task { @MainActor in
                await stopLiveActivity()
                locationService?.stopDestinationMonitoring()
            }
        }
    }
    
    private func parseItineraryFromData(_ data: [String: Any], groupId: String) {
        // Legacy method - now deprecated
        print("🔍 parseItineraryFromData called - this method is deprecated")
    }
    
    private func fetchWaypoints(groupId: String) async {
        do {
            let snapshot = try await db.collection("groups")
                .document(groupId)
                .collection("itinerary")
                .order(by: "order")
                .getDocuments()
            
            let waypoints = snapshot.documents.compactMap { document -> Waypoint? in
                let data = document.data()
                let id = document.documentID // Use document ID instead of stored id
                
                guard let name = data["name"] as? String,
                      let typeString = data["type"] as? String,
                      let type = WaypointType(rawValue: typeString),
                      let locationData = data["location"] as? [String: Any],
                      let lat = locationData["latitude"] as? Double,
                      let lng = locationData["longitude"] as? Double,
                      let createdAtTimestamp = data["createdAt"] as? Timestamp,
                      let updatedAtTimestamp = data["updatedAt"] as? Timestamp,
                      let createdBy = data["createdBy"] as? String,
                      let isActive = data["isActive"] as? Bool,
                      let order = data["order"] as? Int else {
                    return nil
                }
                
                let description = data["description"] as? String
                let isCompleted = data["isCompleted"] as? Bool ?? false
                let isInProgress = data["isInProgress"] as? Bool ?? false
                let location = GeoPoint(latitude: lat, longitude: lng)
                
                // Create waypoint from Firestore data
                return Waypoint(
                    id: id,
                    groupId: groupId,
                    name: name,
                    description: description,
                    type: type,
                    location: location,
                    createdAt: createdAtTimestamp.dateValue(),
                    updatedAt: updatedAtTimestamp.dateValue(),
                    createdBy: createdBy,
                    isActive: isActive,
                    isCompleted: isCompleted,
                    isInProgress: isInProgress,
                    order: order
                )
            }
            
            var itinerary = GroupItinerary(groupId: groupId)
            itinerary.waypoints = waypoints
            currentItinerary = itinerary
            
        } catch {
            errorMessage = "Failed to fetch waypoints: \(error.localizedDescription)"
        }
    }
    
    func calculateDistanceToWaypoint(_ waypoint: Waypoint, from location: CLLocationCoordinate2D) -> CLLocationDistance {
        let waypointLocation = CLLocation(
            latitude: waypoint.location.latitude,
            longitude: waypoint.location.longitude
        )
        let currentLocation = CLLocation(latitude: location.latitude, longitude: location.longitude)
        return currentLocation.distance(from: waypointLocation)
    }
}