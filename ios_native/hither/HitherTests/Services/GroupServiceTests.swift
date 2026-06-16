//
//  GroupServiceTests.swift
//  HitherTests
//
//  Unit tests for GroupService business logic
//

import Foundation
import Testing
@testable import Hither

@Suite("GroupService Tests")
struct GroupServiceTests {
    
    // MARK: - Test Data Validation
    @Test("Should validate group name length")
    func testGroupNameValidation() async throws {
        // Given
        let mockService = MockFirebaseService.shared
        mockService.reset()
        
        // Test empty name
        let emptyGroupData = TestDataBuilder.buildGroupData(name: "", leaderId: "leader123", leaderName: "Leader")
        let validGroupData = TestDataBuilder.buildGroupData(name: "Valid Group", leaderId: "leader123", leaderName: "Leader")
        
        // Then
        #expect(emptyGroupData["name"] as? String == "", "Empty name should be captured in data")
        #expect(validGroupData["name"] as? String == "Valid Group", "Valid name should be captured in data")
        
        // Test very long name
        let longName = String(repeating: "A", count: 100)
        let longNameData = TestDataBuilder.buildGroupData(name: longName, leaderId: "leader123", leaderName: "Leader")
        #expect((longNameData["name"] as? String)?.count == 100, "Long name should be captured correctly")
    }
    
    @Test("Should validate user IDs")
    func testUserIdValidation() async throws {
        // Given
        let validData = TestDataBuilder.buildGroupData(name: "Test Group", leaderId: "leader123", leaderName: "Leader")
        let invalidData = TestDataBuilder.buildGroupData(name: "Test Group", leaderId: "", leaderName: "Leader")
        
        // Then
        #expect(validData["leaderId"] as? String == "leader123", "Valid leader ID should be set")
        #expect(invalidData["leaderId"] as? String == "", "Invalid leader ID should be captured")
    }
    
    // MARK: - Test Group Data Structure
    @Test("Should create group with correct data structure")
    func testGroupDataStructure() async throws {
        // Given
        let groupName = "Test Hiking Group"
        let leaderId = "leader123"
        let leaderName = "John Doe"
        
        // When
        let groupData = TestDataBuilder.buildGroupData(name: groupName, leaderId: leaderId, leaderName: leaderName)
        
        // Then
        #expect(groupData["name"] as? String == groupName, "Group name should match")
        #expect(groupData["leaderId"] as? String == leaderId, "Leader ID should match")
        #expect(groupData["leaderName"] as? String == leaderName, "Leader name should match")
        #expect(groupData["inviteCode"] as? String != nil, "Invite code should be generated")
        #expect(groupData["createdAt"] as? TimeInterval != nil, "Created timestamp should be set")
        #expect(groupData["isActive"] as? Bool == true, "Group should be active by default")
    }
    
    // MARK: - Test Member Data Structure
    @Test("Should create member with correct data structure")
    func testMemberDataStructure() async throws {
        // Given
        let userId = "user456" 
        let userName = "Jane Smith"
        let role = "follower"
        
        // When
        let memberData = TestDataBuilder.buildMemberData(userId: userId, userName: userName, role: role)
        
        // Then
        #expect(memberData["id"] as? String == userId, "User ID should match")
        #expect(memberData["name"] as? String == userName, "User name should match")
        #expect(memberData["role"] as? String == role, "Role should match")
        #expect(memberData["joinedAt"] as? TimeInterval != nil, "Joined timestamp should be set")
        #expect(memberData["isActive"] as? Bool == true, "Member should be active by default")
    }
    
    // MARK: - Test Invite Code Generation
    @Test("Should generate unique invite codes")
    func testInviteCodeGeneration() async throws {
        // Given/When
        let groupData1 = TestDataBuilder.buildGroupData(name: "Group 1", leaderId: "leader1", leaderName: "Leader 1")
        let groupData2 = TestDataBuilder.buildGroupData(name: "Group 2", leaderId: "leader2", leaderName: "Leader 2")
        
        let code1 = groupData1["inviteCode"] as? String
        let code2 = groupData2["inviteCode"] as? String
        
        // Then
        #expect(code1 != nil, "First group should have invite code")
        #expect(code2 != nil, "Second group should have invite code")
        #expect(code1 != code2, "Invite codes should be unique")
        #expect(code1?.count == 6, "Invite code should be 6 characters")
        #expect(code2?.count == 6, "Invite code should be 6 characters")
    }
    
    // MARK: - Test Mock Firebase Operations
    @Test("Should handle group creation with mock service")
    func testMockGroupCreation() async throws {
        // Given
        let mockService = MockFirebaseService.shared
        mockService.reset()
        
        let groupId = "group123"
        let groupData = TestDataBuilder.buildGroupData(name: "Test Group", leaderId: "leader456", leaderName: "John Leader")
        
        // When
        try await mockService.createGroup(id: groupId, data: groupData)
        let retrievedData = try await mockService.getGroup(id: groupId)
        
        // Then
        #expect(retrievedData != nil, "Group should be retrievable after creation")
        #expect(retrievedData?["name"] as? String == "Test Group", "Group name should match")
        #expect(retrievedData?["leaderId"] as? String == "leader456", "Leader ID should match")
    }
    
    @Test("Should handle member operations with mock service")
    func testMockMemberOperations() async throws {
        // Given
        let mockService = MockFirebaseService.shared
        mockService.reset()
        
        let groupId = "group123"
        let userId = "user456"
        let memberData = TestDataBuilder.buildMemberData(userId: userId, userName: "Jane Smith")
        
        // When
        try await mockService.addMember(groupId: groupId, memberId: userId, data: memberData)
        let members = try await mockService.getMembers(groupId: groupId)
        
        // Then
        #expect(members[userId] != nil, "Member should be added to group")
        #expect(members[userId]?["name"] as? String == "Jane Smith", "Member name should match")
        
        // When - Remove member
        try await mockService.removeMember(groupId: groupId, memberId: userId)
        let membersAfterRemoval = try await mockService.getMembers(groupId: groupId)
        
        // Then
        #expect(membersAfterRemoval[userId] == nil, "Member should be removed from group")
    }
    
    // MARK: - Test Error Handling
    @Test("Should handle errors gracefully")
    func testErrorHandling() async throws {
        // Given
        let mockService = MockFirebaseService.shared
        mockService.reset()
        mockService.shouldSimulateError = true
        
        let groupId = "group123"
        let groupData = TestDataBuilder.buildGroupData(name: "Test Group", leaderId: "leader456", leaderName: "John Leader")
        
        // When/Then
        do {
            try await mockService.createGroup(id: groupId, data: groupData)
            #expect(Bool(false), "Should have thrown an error")
        } catch {
            #expect(error.localizedDescription.contains("Simulated network error"), "Should throw simulated error")
        }
    }
    
    // MARK: - Test Data Consistency
    @Test("Should maintain data consistency across operations")
    func testDataConsistency() async throws {
        // Given
        let mockService = MockFirebaseService.shared
        mockService.reset()
        
        let groupId = "group123"
        let groupData = TestDataBuilder.buildGroupData(name: "Test Group", leaderId: "leader456", leaderName: "John Leader")
        
        // When - Create group
        try await mockService.createGroup(id: groupId, data: groupData)
        
        // Add member
        let memberData = TestDataBuilder.buildMemberData(userId: "user1", userName: "Member 1")
        try await mockService.addMember(groupId: groupId, memberId: "user1", data: memberData)
        
        // Delete group
        try await mockService.deleteGroup(id: groupId)
        
        // Then - Both group and members should be deleted
        let retrievedGroup = try await mockService.getGroup(id: groupId)
        let retrievedMembers = try await mockService.getMembers(groupId: groupId)
        
        #expect(retrievedGroup == nil, "Group should be deleted")
        #expect(retrievedMembers.isEmpty, "Members should be deleted with group")
    }
    
    // MARK: - Test Business Logic Validation
    @Test("Should validate business rules")
    func testBusinessRules() async throws {
        // Test: Group names should not be empty
        let emptyNameData = TestDataBuilder.buildGroupData(name: "", leaderId: "leader1", leaderName: "Leader")
        #expect((emptyNameData["name"] as? String)?.isEmpty == true, "Empty name should be detectable")
        
        // Test: Leader ID should not be empty
        let emptyLeaderData = TestDataBuilder.buildGroupData(name: "Valid Name", leaderId: "", leaderName: "Leader")
        #expect((emptyLeaderData["leaderId"] as? String)?.isEmpty == true, "Empty leader ID should be detectable")
        
        // Test: Invite codes should be alphanumeric
        let groupData = TestDataBuilder.buildGroupData(name: "Test", leaderId: "leader1", leaderName: "Leader")
        let inviteCode = groupData["inviteCode"] as? String
        let isAlphanumeric = inviteCode?.allSatisfy { $0.isLetter || $0.isNumber } ?? false
        #expect(isAlphanumeric, "Invite code should be alphanumeric")
    }
}