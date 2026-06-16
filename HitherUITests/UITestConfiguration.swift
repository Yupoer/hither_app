//
//  UITestConfiguration.swift
//  HitherUITests
//
//  Configuration and utilities for UI testing
//

import XCTest

class UITestConfiguration: NSObject {
    
    // MARK: - Test Configuration
    static func configureTestEnvironment() {
        // Disable animations for faster and more reliable tests
        UIApplication.shared.windows.first?.layer.speed = 100
    }
    
    // MARK: - Screenshot Utilities
    static func takeScreenshot(named name: String, in testCase: XCTestCase) {
        let screenshot = XCUIApplication().screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }
    
    static func takeScreenshotOnFailure(named name: String, in testCase: XCTestCase) {
        let screenshot = XCUIApplication().screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "\(name) - FAILURE"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }
    
    // MARK: - Test Data Setup
    static func setupTestUser(role: UserRole) -> [String: String] {
        switch role {
        case .leader:
            return [
                "UITEST_USER_ROLE": "LEADER",
                "UITEST_USER_ID": "test_leader_001",
                "UITEST_USER_NAME": "Test Leader",
                "UITEST_USER_EMAIL": "leader@test.com"
            ]
        case .follower:
            return [
                "UITEST_USER_ROLE": "FOLLOWER", 
                "UITEST_USER_ID": "test_follower_001",
                "UITEST_USER_NAME": "Test Follower",
                "UITEST_USER_EMAIL": "follower@test.com"
            ]
        }
    }
    
    static func setupTestGroup() -> [String: String] {
        return [
            "UITEST_GROUP_ID": "test_group_001",
            "UITEST_GROUP_NAME": "UI Test Group",
            "UITEST_GROUP_INVITE_CODE": "TEST123",
            "UITEST_GROUP_LEADER_ID": "test_leader_001"
        ]
    }
    
    // MARK: - Wait Helpers
    static func waitForElement(_ element: XCUIElement, timeout: TimeInterval = 5.0) -> Bool {
        return element.waitForExistence(timeout: timeout)
    }
    
    static func waitForElementToDisappear(_ element: XCUIElement, timeout: TimeInterval = 5.0) -> Bool {
        let predicate = NSPredicate(format: "exists == false")
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        let result = XCTWaiter().wait(for: [expectation], timeout: timeout)
        return result == .completed
    }
    
    // MARK: - Error Handling
    static func handleTestFailure(error: Error, in testCase: XCTestCase, file: StaticString = #file, line: UInt = #line) {
        takeScreenshotOnFailure(named: "Test Failure", in: testCase)
        XCTFail("Test failed with error: \(error.localizedDescription)", file: file, line: line)
    }
    
    // MARK: - Network Simulation
    static func simulateNetworkError() -> [String: String] {
        return [
            "UITEST_NETWORK_ERROR": "1",
            "UITEST_NETWORK_DELAY": "5.0"
        ]
    }
    
    static func simulateSlowNetwork() -> [String: String] {
        return [
            "UITEST_SLOW_NETWORK": "1",
            "UITEST_NETWORK_DELAY": "2.0"
        ]
    }
    
    // MARK: - Location Simulation
    static func simulateLocationUpdate() -> [String: String] {
        return [
            "UITEST_SIMULATE_LOCATION": "1",
            "UITEST_LOCATION_LAT": "37.7749",
            "UITEST_LOCATION_LNG": "-122.4194"
        ]
    }
    
    static func simulateMovement() -> [String: String] {
        return [
            "UITEST_SIMULATE_MOVEMENT": "1",
            "UITEST_MOVEMENT_DISTANCE": "100"
        ]
    }
    
    // MARK: - Command Simulation
    static func simulateIncomingCommand(type: CommandType) -> [String: String] {
        return [
            "UITEST_SIMULATE_COMMAND": type.rawValue,
            "UITEST_COMMAND_SENDER": "Test Leader",
            "UITEST_COMMAND_TIMESTAMP": "\(Date().timeIntervalSince1970)"
        ]
    }
    
    // MARK: - Find Request Simulation
    static func simulateFindRequest() -> [String: String] {
        return [
            "UITEST_SIMULATE_FIND_REQUEST": "1",
            "UITEST_FIND_REQUESTER": "Test Follower",
            "UITEST_FIND_TARGET": "Test Leader"
        ]
    }
    
    static func simulateApprovedFindRequest() -> [String: String] {
        return [
            "UITEST_FIND_REQUEST_APPROVED": "1",
            "UITEST_FIND_SESSION_ACTIVE": "1"
        ]
    }
    
    // MARK: - Performance Testing
    static func measureUIResponsiveness(testCase: XCTestCase, action: () -> Void) {
        testCase.measure(metrics: [XCTClockMetric(), XCTMemoryMetric()]) {
            action()
        }
    }
    
    // MARK: - Accessibility Testing
    static func validateAccessibility(for element: XCUIElement, testCase: XCTestCase) {
        XCTAssertNotNil(element.label, "Element should have accessibility label")
        XCTAssertTrue(element.isHittable, "Element should be hittable")
    }
    
    static func validateAccessibilityForView(_ view: XCUIElement, testCase: XCTestCase) {
        // Check that the view has proper accessibility traits
        XCTAssertTrue(view.exists, "View should exist")
        
        // Validate child elements have accessibility labels
        let buttons = view.buttons
        let textFields = view.textFields
        
        for i in 0..<buttons.count {
            let button = buttons.element(boundBy: i)
            if button.exists {
                XCTAssertNotNil(button.label, "Button \(i) should have accessibility label")
            }
        }
        
        for i in 0..<textFields.count {
            let textField = textFields.element(boundBy: i)
            if textField.exists {
                XCTAssertNotNil(textField.label, "Text field \(i) should have accessibility label")
            }
        }
    }
}

// MARK: - Enums
enum UserRole {
    case leader
    case follower
}

enum CommandType: String {
    case gather = "gather"
    case depart = "depart"
    case rest = "rest"
    case custom = "custom"
    case careful = "careful"
}

// MARK: - XCTestCase Extension
extension XCTestCase {
    
    func takeScreenshot(named name: String) {
        UITestConfiguration.takeScreenshot(named: name, in: self)
    }
    
    func waitForElement(_ element: XCUIElement, timeout: TimeInterval = 5.0, failTest: Bool = true) -> Bool {
        let exists = UITestConfiguration.waitForElement(element, timeout: timeout)
        if !exists && failTest {
            UITestConfiguration.takeScreenshotOnFailure(named: "Element Wait Failure", in: self)
            XCTFail("Element did not appear within \(timeout) seconds")
        }
        return exists
    }
    
    func validateAccessibility(for element: XCUIElement) {
        UITestConfiguration.validateAccessibility(for: element, testCase: self)
    }
    
    func measureUIPerformance(action: () -> Void) {
        UITestConfiguration.measureUIResponsiveness(testCase: self, action: action)
    }
}

// MARK: - Test Utilities
class UITestUtils {
    
    static func launchAppWithConfiguration(_ config: [String: String]) -> XCUIApplication {
        let app = XCUIApplication()
        
        // Set launch arguments
        app.launchArguments.append("--uitesting")
        app.launchArguments.append("--disable-animations")
        
        // Set launch environment
        for (key, value) in config {
            app.launchEnvironment[key] = value
        }
        
        app.launch()
        return app
    }
    
    static func performLogin(in app: XCUIApplication) -> Bool {
        let signInButton = app.buttons["Sign In with Apple"]
        if signInButton.exists {
            signInButton.tap()
        } else {
            let emailSignInButton = app.buttons["Email Sign In"]
            if emailSignInButton.exists {
                emailSignInButton.tap()
            } else {
                return false
            }
        }
        
        let groupSetupView = app.otherElements["GroupSetupView"]
        return groupSetupView.waitForExistence(timeout: 10.0)
    }
    
    static func createGroup(named name: String, in app: XCUIApplication) -> Bool {
        let createGroupButton = app.buttons["Create New Group"]
        guard createGroupButton.exists else { return false }
        
        createGroupButton.tap()
        
        let groupNameField = app.textFields["Group Name"]
        guard groupNameField.waitForExistence(timeout: 3.0) else { return false }
        
        groupNameField.tap()
        groupNameField.typeText(name)
        
        let confirmCreateButton = app.buttons["Create Group"]
        guard confirmCreateButton.exists else { return false }
        
        confirmCreateButton.tap()
        
        let leaderDashboard = app.otherElements["LeaderDashboardView"]
        return leaderDashboard.waitForExistence(timeout: 8.0)
    }
    
    static func joinGroup(withCode code: String, in app: XCUIApplication) -> Bool {
        let joinGroupButton = app.buttons["Join Existing Group"]
        guard joinGroupButton.exists else { return false }
        
        joinGroupButton.tap()
        
        let inviteCodeField = app.textFields["Invite Code"]
        guard inviteCodeField.waitForExistence(timeout: 3.0) else { return false }
        
        inviteCodeField.tap()
        inviteCodeField.typeText(code)
        
        let joinButton = app.buttons["Join Group"]
        guard joinButton.exists else { return false }
        
        joinButton.tap()
        
        let followerView = app.otherElements["FollowerDashboardView"]
        let mapView = app.otherElements["MapView"]
        
        return followerView.waitForExistence(timeout: 8.0) || mapView.waitForExistence(timeout: 8.0)
    }
}