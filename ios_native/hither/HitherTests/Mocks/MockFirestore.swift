//
//  MockFirestore.swift
//  HitherTests
//
//  Simple test doubles for Firebase dependencies
//

import Foundation
@testable import Hither

// MARK: - Mock Firebase Service for Testing
class MockFirebaseService {
    static let shared = MockFirebaseService()
    
    var shouldSimulateError = false
    var simulatedError: Error = NSError(domain: "MockError", code: 500, userInfo: [NSLocalizedDescriptionKey: "Simulated network error"])
    var simulatedDelay: TimeInterval = 0.1
    
    private var mockGroups: [String: [String: Any]] = [:]
    private var mockMembers: [String: [String: [String: Any]]] = [:]
    private var mockCommands: [String: [[String: Any]]] = [:]
    
    func reset() {
        shouldSimulateError = false
        mockGroups.removeAll()
        mockMembers.removeAll()
        mockCommands.removeAll()
    }
    
    // MARK: - Mock Group Operations
    func createGroup(id: String, data: [String: Any]) async throws {
        if shouldSimulateError {
            throw simulatedError
        }
        
        try await Task.sleep(nanoseconds: UInt64(simulatedDelay * 1_000_000_000))
        mockGroups[id] = data
    }
    
    func getGroup(id: String) async throws -> [String: Any]? {
        if shouldSimulateError {
            throw simulatedError
        }
        
        try await Task.sleep(nanoseconds: UInt64(simulatedDelay * 1_000_000_000))
        return mockGroups[id]
    }
    
    func updateGroup(id: String, data: [String: Any]) async throws {
        if shouldSimulateError {
            throw simulatedError
        }
        
        try await Task.sleep(nanoseconds: UInt64(simulatedDelay * 1_000_000_000))
        if mockGroups[id] != nil {
            mockGroups[id] = data
        }
    }
    
    func deleteGroup(id: String) async throws {
        if shouldSimulateError {
            throw simulatedError
        }
        
        try await Task.sleep(nanoseconds: UInt64(simulatedDelay * 1_000_000_000))
        mockGroups.removeValue(forKey: id)
        mockMembers.removeValue(forKey: id)
        mockCommands.removeValue(forKey: id)
    }
    
    // MARK: - Mock Member Operations
    func addMember(groupId: String, memberId: String, data: [String: Any]) async throws {
        if shouldSimulateError {
            throw simulatedError
        }
        
        try await Task.sleep(nanoseconds: UInt64(simulatedDelay * 1_000_000_000))
        if mockMembers[groupId] == nil {
            mockMembers[groupId] = [:]
        }
        mockMembers[groupId]?[memberId] = data
    }
    
    func removeMember(groupId: String, memberId: String) async throws {
        if shouldSimulateError {
            throw simulatedError
        }
        
        try await Task.sleep(nanoseconds: UInt64(simulatedDelay * 1_000_000_000))
        mockMembers[groupId]?.removeValue(forKey: memberId)
    }
    
    func getMembers(groupId: String) async throws -> [String: [String: Any]] {
        if shouldSimulateError {
            throw simulatedError
        }
        
        try await Task.sleep(nanoseconds: UInt64(simulatedDelay * 1_000_000_000))
        return mockMembers[groupId] ?? [:]
    }
    
    // MARK: - Mock Command Operations
    func addCommand(groupId: String, data: [String: Any]) async throws {
        if shouldSimulateError {
            throw simulatedError
        }
        
        try await Task.sleep(nanoseconds: UInt64(simulatedDelay * 1_000_000_000))
        if mockCommands[groupId] == nil {
            mockCommands[groupId] = []
        }
        mockCommands[groupId]?.append(data)
    }
    
    func getCommands(groupId: String) async throws -> [[String: Any]] {
        if shouldSimulateError {
            throw simulatedError
        }
        
        try await Task.sleep(nanoseconds: UInt64(simulatedDelay * 1_000_000_000))
        return mockCommands[groupId] ?? []
    }
    
    // MARK: - Mock Location Operations
    func updateLocation(groupId: String, userId: String, latitude: Double, longitude: Double) async throws {
        if shouldSimulateError {
            throw simulatedError
        }
        
        try await Task.sleep(nanoseconds: UInt64(simulatedDelay * 1_000_000_000))
        
        let locationData: [String: Any] = [
            "latitude": latitude,
            "longitude": longitude,
            "timestamp": Date().timeIntervalSince1970
        ]
        
        if mockMembers[groupId] == nil {
            mockMembers[groupId] = [:]
        }
        if mockMembers[groupId]?[userId] == nil {
            mockMembers[groupId]?[userId] = [:]
        }
        mockMembers[groupId]?[userId]?["location"] = locationData
    }
}

// MARK: - Test Data Builders
struct TestDataBuilder {
    static func buildGroupData(name: String, leaderId: String, leaderName: String) -> [String: Any] {
        return [
            "name": name,
            "leaderId": leaderId,
            "leaderName": leaderName,
            "inviteCode": generateMockInviteCode(),
            "createdAt": Date().timeIntervalSince1970,
            "isActive": true
        ]
    }
    
    static func buildMemberData(userId: String, userName: String, role: String = "follower") -> [String: Any] {
        return [
            "id": userId,
            "name": userName,
            "role": role,
            "joinedAt": Date().timeIntervalSince1970,
            "isActive": true
        ]
    }
    
    static func buildCommandData(type: String, senderId: String, senderName: String, message: String? = nil) -> [String: Any] {
        var data: [String: Any] = [
            "id": UUID().uuidString,
            "type": type,
            "senderId": senderId,
            "senderName": senderName,
            "timestamp": Date().timeIntervalSince1970
        ]
        
        if let message = message {
            data["message"] = message
        }
        
        return data
    }
    
    private static func generateMockInviteCode() -> String {
        let letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        return String((0..<6).map{ _ in letters.randomElement()! })
    }
}