//
//  Itinerary.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation
import CoreLocation

enum WaypointType: String, CaseIterable, Codable {
    case meetingPoint = "meeting_point"
    case restStop = "rest_stop"
    case lunch = "lunch"
    case destination = "destination"
    case checkpoint = "checkpoint"
    case emergency = "emergency"
    case custom = "custom"
    
    var displayName: String {
        switch self {
        case .meetingPoint: return "waypoint_meeting_point".localized
        case .restStop: return "waypoint_rest_stop".localized
        case .lunch: return "waypoint_lunch".localized
        case .destination: return "waypoint_destination".localized
        case .checkpoint: return "waypoint_checkpoint".localized
        case .emergency: return "waypoint_emergency".localized
        case .custom: return "waypoint_custom".localized
        }
    }
    
    var icon: String {
        switch self {
        case .meetingPoint: return "person.2.circle"
        case .restStop: return "pause.circle"
        case .lunch: return "fork.knife.circle"
        case .destination: return "flag.circle"
        case .checkpoint: return "checkmark.circle"
        case .emergency: return "cross.circle"
        case .custom: return "mappin.circle"
        }
    }
    
    var color: String {
        switch self {
        case .meetingPoint: return "blue"
        case .restStop: return "orange"
        case .lunch: return "green"
        case .destination: return "red"
        case .checkpoint: return "purple"
        case .emergency: return "red"
        case .custom: return "gray"
        }
    }
}

struct Waypoint: Identifiable, Codable, Equatable {
    let id: String
    let groupId: String
    var name: String
    var description: String?
    let type: WaypointType
    var location: GeoPoint
    let createdAt: Date
    var updatedAt: Date
    let createdBy: String
    var isActive: Bool
    var isCompleted: Bool
    var isInProgress: Bool // "going" state
    var order: Int
    
    init(
        groupId: String,
        name: String,
        description: String? = nil,
        type: WaypointType,
        location: GeoPoint,
        createdBy: String,
        order: Int = 0
    ) {
        self.id = UUID().uuidString
        self.groupId = groupId
        self.name = name
        self.description = description
        self.type = type
        self.location = location
        self.createdAt = Date()
        self.updatedAt = Date()
        self.createdBy = createdBy
        self.isActive = true
        self.isCompleted = false
        self.isInProgress = false
        self.order = order
    }
    
    // Initialize from Firestore data
    init?(
        id: String,
        groupId: String,
        name: String,
        description: String?,
        type: WaypointType,
        location: GeoPoint,
        createdAt: Date,
        updatedAt: Date,
        createdBy: String,
        isActive: Bool,
        isCompleted: Bool,
        isInProgress: Bool,
        order: Int
    ) {
        self.id = id
        self.groupId = groupId
        self.name = name
        self.description = description
        self.type = type
        self.location = location
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.createdBy = createdBy
        self.isActive = isActive
        self.isCompleted = isCompleted
        self.isInProgress = isInProgress
        self.order = order
    }
    
    // MARK: - Equatable
    static func == (lhs: Waypoint, rhs: Waypoint) -> Bool {
        return lhs.id == rhs.id &&
               lhs.groupId == rhs.groupId &&
               lhs.name == rhs.name &&
               lhs.description == rhs.description &&
               lhs.type == rhs.type &&
               lhs.location == rhs.location &&
               lhs.createdBy == rhs.createdBy &&
               lhs.isActive == rhs.isActive &&
               lhs.isCompleted == rhs.isCompleted &&
               lhs.isInProgress == rhs.isInProgress &&
               lhs.order == rhs.order
    }
}

struct GroupItinerary: Identifiable, Codable {
    let id: String
    let groupId: String
    var waypoints: [Waypoint]
    let createdAt: Date
    var updatedAt: Date
    
    init(groupId: String) {
        self.id = UUID().uuidString
        self.groupId = groupId
        self.waypoints = []
        self.createdAt = Date()
        self.updatedAt = Date()
    }
    
    var activeWaypoints: [Waypoint] {
        waypoints.filter { $0.isActive && !$0.isCompleted }.sorted { $0.order < $1.order }
    }
    
    var upcomingWaypoints: [Waypoint] {
        waypoints.filter { $0.isActive && !$0.isCompleted && !$0.isInProgress }.sorted { $0.order < $1.order }
    }
    
    var nextWaypoint: Waypoint? {
        activeWaypoints.first
    }
    
    var currentWaypoint: Waypoint? {
        waypoints.first { $0.isInProgress }
    }
    
    var completedWaypoints: [Waypoint] {
        waypoints.filter { $0.isCompleted }.sorted { $0.order < $1.order }
    }
}

struct WaypointUpdate: Codable {
    let waypointId: String
    let groupId: String
    let action: WaypointAction
    let updatedBy: String
    let timestamp: Date
    
    enum WaypointAction: String, Codable {
        case added = "added"
        case updated = "updated"
        case removed = "removed"
        case completed = "completed"
        case reordered = "reordered"
    }
}