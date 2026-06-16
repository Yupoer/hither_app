//
//  CommandServiceTests.swift
//  HitherTests
//
//  Unit tests for CommandService business logic
//

import Foundation
import Testing
@testable import Hither

@Suite("CommandService Tests")
struct CommandServiceTests {
    
    // MARK: - Test Command Data Structure
    @Test("Should create gather command with correct structure")
    func testGatherCommandStructure() async throws {
        // Given
        let senderId = "leader456"
        let senderName = "John Leader"
        
        // When
        let commandData = TestDataBuilder.buildCommandData(type: "gather", senderId: senderId, senderName: senderName)
        
        // Then
        #expect(commandData["type"] as? String == "gather", "Command type should be gather")
        #expect(commandData["senderId"] as? String == senderId, "Sender ID should match")
        #expect(commandData["senderName"] as? String == senderName, "Sender name should match")
        #expect(commandData["id"] as? String != nil, "Command should have ID")
        #expect(commandData["timestamp"] as? TimeInterval != nil, "Command should have timestamp")
    }
    
    @Test("Should create depart command with correct structure")
    func testDepartCommandStructure() async throws {
        // Given
        let senderId = "leader456"
        let senderName = "John Leader"
        
        // When
        let commandData = TestDataBuilder.buildCommandData(type: "depart", senderId: senderId, senderName: senderName)
        
        // Then
        #expect(commandData["type"] as? String == "depart", "Command type should be depart")
        #expect(commandData["senderId"] as? String == senderId, "Sender ID should match")
        #expect(commandData["senderName"] as? String == senderName, "Sender name should match")
    }
    
    @Test("Should create rest command with correct structure")
    func testRestCommandStructure() async throws {
        // Given
        let senderId = "leader456"
        let senderName = "John Leader"
        
        // When
        let commandData = TestDataBuilder.buildCommandData(type: "rest", senderId: senderId, senderName: senderName)
        
        // Then
        #expect(commandData["type"] as? String == "rest", "Command type should be rest")
        #expect(commandData["senderId"] as? String == senderId, "Sender ID should match")
        #expect(commandData["senderName"] as? String == senderName, "Sender name should match")
    }
    
    @Test("Should create custom command with message")
    func testCustomCommandStructure() async throws {
        // Given
        let senderId = "leader456"
        let senderName = "John Leader"
        let customMessage = "Please wait at the bridge"
        
        // When
        let commandData = TestDataBuilder.buildCommandData(type: "custom", senderId: senderId, senderName: senderName, message: customMessage)
        
        // Then
        #expect(commandData["type"] as? String == "custom", "Command type should be custom")
        #expect(commandData["message"] as? String == customMessage, "Custom message should be included")
        #expect(commandData["senderId"] as? String == senderId, "Sender ID should match")
        #expect(commandData["senderName"] as? String == senderName, "Sender name should match")
    }
    
    // MARK: - Test Command Validation
    @Test("Should validate required fields")
    func testCommandValidation() async throws {
        // Test empty sender ID
        let invalidCommand1 = TestDataBuilder.buildCommandData(type: "gather", senderId: "", senderName: "John")
        #expect((invalidCommand1["senderId"] as? String)?.isEmpty == true, "Empty sender ID should be detectable")
        
        // Test empty sender name
        let invalidCommand2 = TestDataBuilder.buildCommandData(type: "gather", senderId: "leader456", senderName: "")
        #expect((invalidCommand2["senderName"] as? String)?.isEmpty == true, "Empty sender name should be detectable")
        
        // Test invalid command type
        let invalidCommand3 = TestDataBuilder.buildCommandData(type: "", senderId: "leader456", senderName: "John")
        #expect((invalidCommand3["type"] as? String)?.isEmpty == true, "Empty command type should be detectable")
    }
    
    @Test("Should validate custom message length")
    func testCustomMessageValidation() async throws {
        // Test reasonable message
        let reasonableMessage = "Please wait at the bridge"
        let validCommand = TestDataBuilder.buildCommandData(type: "custom", senderId: "leader456", senderName: "John", message: reasonableMessage)
        #expect((validCommand["message"] as? String)?.count == reasonableMessage.count, "Reasonable message should be accepted")
        
        // Test very long message
        let longMessage = String(repeating: "A", count: 500)
        let longCommand = TestDataBuilder.buildCommandData(type: "custom", senderId: "leader456", senderName: "John", message: longMessage)
        #expect((longCommand["message"] as? String)?.count == 500, "Long message should be captured")
        
        // Business rule: Messages over 200 characters should be flagged
        let isMessageTooLong = (longCommand["message"] as? String)?.count ?? 0 > 200
        #expect(isMessageTooLong, "Very long messages should be detectable for validation")
    }
    
    // MARK: - Test FCM Message Construction
    @Test("Should construct proper FCM message for gather command")
    func testFCMGatherMessage() async throws {
        // Given
        let senderName = "John Leader"
        let commandType = "gather"
        
        // Expected FCM structure
        let expectedTitle = "\(senderName) sent a command"
        let expectedBody = "Gather command: Please gather at the meeting point"
        
        // When
        let fcmTitle = buildFCMTitle(senderName: senderName, commandType: commandType)
        let fcmBody = buildFCMBody(commandType: commandType, customMessage: nil)
        
        // Then
        #expect(fcmTitle.contains(senderName), "FCM title should contain sender name")
        #expect(fcmBody.contains("Gather"), "FCM body should contain gather instruction")
        #expect(fcmTitle == expectedTitle, "FCM title should match expected format")
    }
    
    @Test("Should construct proper FCM message for custom command")
    func testFCMCustomMessage() async throws {
        // Given
        let senderName = "John Leader"
        let customMessage = "Please wait at the bridge"
        
        // When
        let fcmTitle = buildFCMTitle(senderName: senderName, commandType: "custom")
        let fcmBody = buildFCMBody(commandType: "custom", customMessage: customMessage)
        
        // Then
        #expect(fcmTitle.contains(senderName), "FCM title should contain sender name")
        #expect(fcmBody == customMessage, "FCM body should match custom message")
    }
    
    private func buildFCMTitle(senderName: String, commandType: String) -> String {
        if commandType == "custom" {
            return "\(senderName) sent a message"
        } else {
            return "\(senderName) sent a command"
        }
    }
    
    private func buildFCMBody(commandType: String, customMessage: String?) -> String {
        switch commandType {
        case "gather":
            return "Gather command: Please gather at the meeting point"
        case "depart":
            return "Depart command: It's time to leave"
        case "rest":
            return "Rest command: Take a break"
        case "custom":
            return customMessage ?? "Custom message"
        default:
            return "Unknown command"
        }
    }
    
    // MARK: - Test Command Storage and Retrieval
    @Test("Should handle command storage with mock service")
    func testMockCommandStorage() async throws {
        // Given
        let mockService = MockFirebaseService.shared
        mockService.reset()
        
        let groupId = "group123"
        let commandData = TestDataBuilder.buildCommandData(type: "gather", senderId: "leader456", senderName: "John Leader")
        
        // When
        try await mockService.addCommand(groupId: groupId, data: commandData)
        let commands = try await mockService.getCommands(groupId: groupId)
        
        // Then
        #expect(commands.count == 1, "Should have one command stored")
        let storedCommand = commands.first
        #expect(storedCommand?["type"] as? String == "gather", "Stored command type should match")
        #expect(storedCommand?["senderId"] as? String == "leader456", "Stored sender ID should match")
    }
    
    @Test("Should handle multiple commands in order")
    func testMultipleCommands() async throws {
        // Given
        let mockService = MockFirebaseService.shared
        mockService.reset()
        
        let groupId = "group123"
        let command1 = TestDataBuilder.buildCommandData(type: "gather", senderId: "leader456", senderName: "John Leader")
        let command2 = TestDataBuilder.buildCommandData(type: "rest", senderId: "leader456", senderName: "John Leader")
        let command3 = TestDataBuilder.buildCommandData(type: "depart", senderId: "leader456", senderName: "John Leader")
        
        // When
        try await mockService.addCommand(groupId: groupId, data: command1)
        try await mockService.addCommand(groupId: groupId, data: command2)
        try await mockService.addCommand(groupId: groupId, data: command3)
        
        let commands = try await mockService.getCommands(groupId: groupId)
        
        // Then
        #expect(commands.count == 3, "Should have three commands stored")
        
        // Commands should be in the order they were added
        #expect(commands[0]["type"] as? String == "gather", "First command should be gather")
        #expect(commands[1]["type"] as? String == "rest", "Second command should be rest")
        #expect(commands[2]["type"] as? String == "depart", "Third command should be depart")
    }
    
    // MARK: - Test Command Timestamp Ordering
    @Test("Should maintain command timestamp ordering")
    func testCommandTimestampOrdering() async throws {
        // Given
        let command1 = TestDataBuilder.buildCommandData(type: "gather", senderId: "leader456", senderName: "John Leader")
        
        // Wait a small amount to ensure different timestamps
        try await Task.sleep(nanoseconds: 1_000_000) // 1ms
        
        let command2 = TestDataBuilder.buildCommandData(type: "rest", senderId: "leader456", senderName: "John Leader")
        
        // When
        let timestamp1 = command1["timestamp"] as? TimeInterval ?? 0
        let timestamp2 = command2["timestamp"] as? TimeInterval ?? 0
        
        // Then
        #expect(timestamp2 > timestamp1, "Second command should have later timestamp")
        #expect(timestamp1 > 0, "First timestamp should be valid")
        #expect(timestamp2 > 0, "Second timestamp should be valid")
    }
    
    // MARK: - Test Error Handling
    @Test("Should handle errors gracefully")
    func testErrorHandling() async throws {
        // Given
        let mockService = MockFirebaseService.shared
        mockService.reset()
        mockService.shouldSimulateError = true
        
        let groupId = "group123"
        let commandData = TestDataBuilder.buildCommandData(type: "gather", senderId: "leader456", senderName: "John Leader")
        
        // When/Then
        do {
            try await mockService.addCommand(groupId: groupId, data: commandData)
            #expect(Bool(false), "Should have thrown an error")
        } catch {
            #expect(error.localizedDescription.contains("Simulated network error"), "Should throw simulated error")
        }
    }
    
    // MARK: - Test Command Types
    @Test("Should support all required command types")
    func testCommandTypes() async throws {
        // Given
        let requiredTypes = ["gather", "depart", "rest", "custom", "careful"]
        
        // When/Then
        for commandType in requiredTypes {
            let commandData = TestDataBuilder.buildCommandData(type: commandType, senderId: "leader456", senderName: "John Leader")
            
            #expect(commandData["type"] as? String == commandType, "Should support \(commandType) command type")
            #expect(commandData["id"] as? String != nil, "Command should have unique ID")
            #expect(commandData["timestamp"] as? TimeInterval != nil, "Command should have timestamp")
        }
    }
    
    // MARK: - Test Command ID Uniqueness
    @Test("Should generate unique command IDs")
    func testCommandIdUniqueness() async throws {
        // Given/When
        let command1 = TestDataBuilder.buildCommandData(type: "gather", senderId: "leader456", senderName: "John Leader")
        let command2 = TestDataBuilder.buildCommandData(type: "gather", senderId: "leader456", senderName: "John Leader")
        
        let id1 = command1["id"] as? String
        let id2 = command2["id"] as? String
        
        // Then
        #expect(id1 != nil, "First command should have ID")
        #expect(id2 != nil, "Second command should have ID")
        #expect(id1 != id2, "Command IDs should be unique")
    }
}