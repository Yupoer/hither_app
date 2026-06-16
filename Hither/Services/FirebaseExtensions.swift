//
//  FirebaseExtensions.swift
//  Hither
//
//  Firebase operation consolidation utilities to reduce duplicate
//  Firestore patterns found across GroupService, LocationService, and ItineraryService.
//

import Foundation
import FirebaseFirestore

/// Extensions to consolidate common Firebase operations that were
/// duplicated across multiple services
extension Firestore {
    
    /// Consolidated group document reference creation pattern
    /// found in GroupService, LocationService, ItineraryService
    func groupDocumentRef(_ groupId: String) -> DocumentReference {
        return collection("groups").document(groupId)
    }
    
    /// Consolidated group member document reference pattern
    /// found in GroupService and LocationService
    func groupMemberRef(_ groupId: String, userId: String) -> DocumentReference {
        return collection("groups").document(groupId).collection("members").document(userId)
    }
    
    /// Consolidated itinerary document reference pattern
    /// found in ItineraryService
    func itineraryRef(_ groupId: String, waypointId: String) -> DocumentReference {
        return collection("groups").document(groupId).collection("itinerary").document(waypointId)
    }
}

/// Extensions for common document operations that were duplicated
extension DocumentReference {
    
    /// Consolidated updateData operation with consistent error patterns
    func updateDataWithLogging(_ data: [String: Any], operationName: String) async throws {
        do {
            try await updateData(data)
            LocalizedLogger.debug("Successfully completed \(operationName)")
        } catch {
            LocalizedLogger.error("Failed to \(operationName): \(error.localizedDescription)")
            throw error
        }
    }
    
    /// Consolidated setData operation with consistent error patterns
    func setDataWithLogging(_ data: [String: Any], operationName: String, merge: Bool = false) async throws {
        do {
            try await setData(data, merge: merge)
            LocalizedLogger.debug("Successfully completed \(operationName)")
        } catch {
            LocalizedLogger.error("Failed to \(operationName): \(error.localizedDescription)")
            throw error
        }
    }
}

/// Timestamp utilities to consolidate duplicate date-to-timestamp conversions
extension Timestamp {
    
    /// Creates a Timestamp from current date - pattern used across all services
    static func now() -> Timestamp {
        return Timestamp(date: Date())
    }
    
    /// Creates a Timestamp from a specific date - consolidates the pattern
    /// found in GroupService, ItineraryService, LocationService
    static func from(_ date: Date) -> Timestamp {
        return Timestamp(date: date)
    }
}