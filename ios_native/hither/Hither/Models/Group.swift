//
//  Group.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation
import CoreLocation

enum MemberRole: String, Codable, CaseIterable {
    case leader = "leader"
    case follower = "follower"
}

enum MemberStatus: String, Codable, CaseIterable {
    case gathered = "gathered"        // ✅ Ready/assembled
    case deviated = "deviated"        // ❌ Off course/too far  
    case resting = "resting"          // 😴 Taking a break
    case help = "help"                // 🆘 Needs assistance
    case normal = "normal"            // Default state (no special status)
    
    var emoji: String {
        switch self {
        case .gathered: return "✅"
        case .deviated: return "❌"
        case .resting: return "😴"
        case .help: return "🆘"
        case .normal: return ""
        }
    }
}

struct GroupMember: Identifiable, Codable, Equatable {
    let id: String
    let userId: String
    let displayName: String
    var nickname: String?
    var avatarEmoji: String?
    let role: MemberRole
    let joinedAt: Date
    var location: GeoPoint?
    var lastLocationUpdate: Date?
    var status: MemberStatus
    
    init(userId: String, displayName: String, role: MemberRole, nickname: String? = nil, avatarEmoji: String? = nil) {
        self.id = UUID().uuidString
        self.userId = userId
        self.displayName = displayName
        self.nickname = nickname
        self.avatarEmoji = avatarEmoji
        self.role = role
        self.joinedAt = Date()
        self.location = nil
        self.lastLocationUpdate = nil
        self.status = .normal
    }
    
    init(id: String, userId: String, displayName: String, nickname: String? = nil, avatarEmoji: String? = nil, role: MemberRole, joinedAt: Date, location: GeoPoint? = nil, lastLocationUpdate: Date? = nil, status: MemberStatus = .normal) {
        self.id = id
        self.userId = userId
        self.displayName = displayName
        self.nickname = nickname
        self.avatarEmoji = avatarEmoji
        self.role = role
        self.joinedAt = joinedAt
        self.location = location
        self.lastLocationUpdate = lastLocationUpdate
        self.status = status
    }
}

struct GeoPoint: Codable, Equatable {
    let latitude: Double
    let longitude: Double
    
    init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
    
    init(from coordinate: CLLocationCoordinate2D) {
        self.latitude = coordinate.latitude
        self.longitude = coordinate.longitude
    }
    
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

struct HitherGroup: Identifiable, Codable, Equatable {
    let id: String
    let name: String
    let leaderId: String
    let createdAt: Date
    let inviteCode: String
    let inviteExpiresAt: Date
    var isActive: Bool
    var settings: GroupSettings
    
    // Members are now loaded separately from subcollection
    var _loadedMembers: [GroupMember] = []
    
    init(name: String, leaderId: String, leaderName: String) {
        self.id = UUID().uuidString
        self.name = name
        self.leaderId = leaderId
        self.createdAt = Date()
        self.inviteCode = String.generateInviteCode()
        self.inviteExpiresAt = Date().addingTimeInterval(24 * 60 * 60) // 24 hours
        self.isActive = true
        self.settings = GroupSettings()
        self._loadedMembers = [GroupMember(userId: leaderId, displayName: leaderName, role: .leader)]
    }
    
    init(id: String, name: String, leaderId: String, leaderName: String, createdAt: Date, inviteCode: String, inviteExpiresAt: Date, members: [GroupMember], isActive: Bool, settings: GroupSettings = GroupSettings()) {
        self.id = id
        self.name = name
        self.leaderId = leaderId
        self.createdAt = createdAt
        self.inviteCode = inviteCode
        self.inviteExpiresAt = inviteExpiresAt
        self.isActive = isActive
        self.settings = settings
        self._loadedMembers = members
    }
    
    // Computed properties for accessing loaded members
    var members: [GroupMember] {
        get { _loadedMembers }
        set { _loadedMembers = newValue }
    }
    
    var leader: GroupMember? {
        _loadedMembers.first { $0.role == .leader }
    }
    
    var followers: [GroupMember] {
        _loadedMembers.filter { $0.role == .follower }
    }
}

enum FindRequestStatus: String, Codable, CaseIterable {
    case pending = "pending"
    case approved = "approved"
    case denied = "denied"
    case expired = "expired"
}

struct FindRequest: Identifiable, Codable, Equatable {
    let id: String
    let requesterId: String
    let targetId: String
    var status: FindRequestStatus
    let createdAt: Date
    let expiresAt: Date
    var approvedAt: Date?
    
    init(requesterId: String, targetId: String) {
        self.id = UUID().uuidString
        self.requesterId = requesterId
        self.targetId = targetId
        self.status = .pending
        self.createdAt = Date()
        self.expiresAt = Date().addingTimeInterval(30 * 60) // 30 minutes
        self.approvedAt = nil
    }
    
    init(id: String, requesterId: String, targetId: String, status: FindRequestStatus, createdAt: Date, expiresAt: Date, approvedAt: Date? = nil) {
        self.id = id
        self.requesterId = requesterId
        self.targetId = targetId
        self.status = status
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.approvedAt = approvedAt
    }
    
    var isExpired: Bool {
        Date() > expiresAt
    }
    
    var isActive: Bool {
        status == .pending && !isExpired
    }
}

struct GroupSettings: Codable, Equatable {
    var freeRoamMode: Bool
    var freeRoamEnabledBy: String?
    var freeRoamEnabledAt: Date?
    
    init() {
        self.freeRoamMode = false
        self.freeRoamEnabledBy = nil
        self.freeRoamEnabledAt = nil
    }
    
    init(freeRoamMode: Bool, freeRoamEnabledBy: String? = nil, freeRoamEnabledAt: Date? = nil) {
        self.freeRoamMode = freeRoamMode
        self.freeRoamEnabledBy = freeRoamEnabledBy
        self.freeRoamEnabledAt = freeRoamEnabledAt
    }
}

extension String {
    static func generateInviteCode() -> String {
        let letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        return String((0..<6).map { _ in letters.randomElement()! })
    }
}