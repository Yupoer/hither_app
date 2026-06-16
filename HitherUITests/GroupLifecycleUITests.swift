//
//  GroupLifecycleUITests.swift
//  HitherUITests
//
//  UI tests for group lifecycle flow: login → create group → invite → join
//

import XCTest

final class GroupLifecycleUITests: XCTestCase {
    
    var app: XCUIApplication!
    
    override func setUpWithError() throws {
        continueAfterFailure = false
        
        app = XCUIApplication()
        
        // Launch arguments for testing
        app.launchArguments.append("--uitesting")
        app.launchArguments.append("--disable-animations")
        
        // Launch environment for testing
        app.launchEnvironment["UITEST_MODE"] = "1"
        app.launchEnvironment["UITEST_SCENARIO"] = "GroupLifecycle"
        
        app.launch()
    }
    
    override func tearDownWithError() throws {
        app.terminate()
        app = nil
    }
    
    // MARK: - Test Group Creation Flow
    func testCreateGroupFlow() throws {
        // Given - User is on the login screen
        let loginView = app.otherElements["LoginView"]
        XCTAssertTrue(loginView.waitForExistence(timeout: 5.0), "Login view should be displayed")
        
        // When - User performs login (simulated)
        let signInButton = app.buttons["Sign In with Apple"]
        if signInButton.exists {
            signInButton.tap()
        } else {
            // Alternative login method
            let emailSignInButton = app.buttons["Email Sign In"]
            if emailSignInButton.exists {
                emailSignInButton.tap()
            }
        }
        
        // Then - User should reach group setup screen
        let groupSetupView = app.otherElements["GroupSetupView"]
        XCTAssertTrue(groupSetupView.waitForExistence(timeout: 10.0), "Group setup view should be displayed after login")
        
        // When - User creates a new group
        let createGroupButton = app.buttons["Create New Group"]
        XCTAssertTrue(createGroupButton.exists, "Create group button should exist")
        createGroupButton.tap()
        
        // Enter group name
        let groupNameField = app.textFields["Group Name"]
        XCTAssertTrue(groupNameField.waitForExistence(timeout: 3.0), "Group name field should be available")
        groupNameField.tap()
        groupNameField.typeText("Test Hiking Group")
        
        // Confirm group creation
        let confirmCreateButton = app.buttons["Create Group"]
        XCTAssertTrue(confirmCreateButton.exists, "Confirm create button should exist")
        confirmCreateButton.tap()
        
        // Then - User should see the leader dashboard
        let leaderDashboard = app.otherElements["LeaderDashboardView"]
        XCTAssertTrue(leaderDashboard.waitForExistence(timeout: 8.0), "Leader dashboard should be displayed after group creation")
        
        // Verify group info is displayed
        let groupNameLabel = app.staticTexts["Test Hiking Group"]
        XCTAssertTrue(groupNameLabel.exists, "Group name should be displayed in dashboard")
        
        // Verify invite code is displayed
        let inviteCodeLabel = app.staticTexts.matching(identifier: "InviteCode").firstMatch
        XCTAssertTrue(inviteCodeLabel.exists, "Invite code should be displayed")
    }
    
    // MARK: - Test Group Joining Flow
    func testJoinGroupFlow() throws {
        // This test simulates a follower joining an existing group
        
        // Given - User is on the login screen
        let loginView = app.otherElements["LoginView"]
        XCTAssertTrue(loginView.waitForExistence(timeout: 5.0), "Login view should be displayed")
        
        // When - User performs login
        performLogin()
        
        // Navigate to join group flow
        let groupSetupView = app.otherElements["GroupSetupView"]
        XCTAssertTrue(groupSetupView.waitForExistence(timeout: 10.0), "Group setup view should be displayed")
        
        let joinGroupButton = app.buttons["Join Existing Group"]
        XCTAssertTrue(joinGroupButton.exists, "Join group button should exist")
        joinGroupButton.tap()
        
        // Enter invite code
        let inviteCodeField = app.textFields["Invite Code"]
        XCTAssertTrue(inviteCodeField.waitForExistence(timeout: 3.0), "Invite code field should be available")
        inviteCodeField.tap()
        inviteCodeField.typeText("TEST123") // Mock invite code
        
        // Confirm join
        let joinButton = app.buttons["Join Group"]
        XCTAssertTrue(joinButton.exists, "Join button should exist")
        joinButton.tap()
        
        // Then - User should see the follower dashboard or map view
        let followerView = app.otherElements["FollowerDashboardView"].firstMatch
        let mapView = app.otherElements["MapView"].firstMatch
        
        let joinedSuccessfully = followerView.waitForExistence(timeout: 8.0) || mapView.waitForExistence(timeout: 8.0)
        XCTAssertTrue(joinedSuccessfully, "Should show follower dashboard or map view after joining")
    }
    
    // MARK: - Test QR Code Invitation Flow
    func testQRCodeInvitationFlow() throws {
        // Test the QR code sharing and scanning flow
        
        // Given - Leader has created a group
        performLogin()
        createTestGroup()
        
        // When - Leader opens QR code sharing
        let shareButton = app.buttons["Share Group"]
        XCTAssertTrue(shareButton.waitForExistence(timeout: 5.0), "Share button should exist")
        shareButton.tap()
        
        // Verify QR code is displayed
        let qrCodeView = app.images["QRCodeView"]
        XCTAssertTrue(qrCodeView.waitForExistence(timeout: 3.0), "QR code should be displayed")
        
        // Verify share options are available
        let shareSheet = app.otherElements["ShareSheet"]
        let copyLinkButton = app.buttons["Copy Link"]
        
        let shareOptionsAvailable = shareSheet.waitForExistence(timeout: 3.0) || copyLinkButton.waitForExistence(timeout: 3.0)
        XCTAssertTrue(shareOptionsAvailable, "Share options should be available")
    }
    
    // MARK: - Test Group Information Display
    func testGroupInformationDisplay() throws {
        // Test that group information is correctly displayed
        
        // Given - User creates a group
        performLogin()
        createTestGroup()
        
        // Then - Verify all group information is displayed
        let groupNameLabel = app.staticTexts["Test Hiking Group"]
        XCTAssertTrue(groupNameLabel.exists, "Group name should be displayed")
        
        let memberCountLabel = app.staticTexts.matching(identifier: "MemberCount").firstMatch
        XCTAssertTrue(memberCountLabel.exists, "Member count should be displayed")
        
        let leaderIndicator = app.images["LeaderCrown"]
        XCTAssertTrue(leaderIndicator.exists, "Leader indicator should be displayed")
        
        // Verify action buttons are present
        let commandButtons = app.buttons.matching(identifier: "CommandButton")
        XCTAssertTrue(commandButtons.count > 0, "Command buttons should be available for leader")
    }
    
    // MARK: - Test Error Handling
    func testInvalidInviteCodeError() throws {
        // Test error handling for invalid invite codes
        
        // Given - User tries to join with invalid code
        performLogin()
        
        let groupSetupView = app.otherElements["GroupSetupView"]
        XCTAssertTrue(groupSetupView.waitForExistence(timeout: 10.0), "Group setup view should be displayed")
        
        let joinGroupButton = app.buttons["Join Existing Group"]
        joinGroupButton.tap()
        
        // When - User enters invalid invite code
        let inviteCodeField = app.textFields["Invite Code"]
        inviteCodeField.tap()
        inviteCodeField.typeText("INVALID")
        
        let joinButton = app.buttons["Join Group"]
        joinButton.tap()
        
        // Then - Error message should be displayed
        let errorAlert = app.alerts.firstMatch
        let errorMessage = app.staticTexts["Invalid invite code"]
        
        let errorDisplayed = errorAlert.waitForExistence(timeout: 5.0) || errorMessage.waitForExistence(timeout: 5.0)
        XCTAssertTrue(errorDisplayed, "Error message should be displayed for invalid invite code")
    }
    
    // MARK: - Test Network Error Handling
    func testNetworkErrorHandling() throws {
        // Test handling of network errors during group operations
        
        // Given - Simulate network issues
        app.launchEnvironment["UITEST_NETWORK_ERROR"] = "1"
        
        performLogin()
        
        // When - User tries to create group with network issues
        let groupSetupView = app.otherElements["GroupSetupView"]
        XCTAssertTrue(groupSetupView.waitForExistence(timeout: 10.0), "Group setup view should be displayed")
        
        let createGroupButton = app.buttons["Create New Group"]
        createGroupButton.tap()
        
        let groupNameField = app.textFields["Group Name"]
        groupNameField.tap()
        groupNameField.typeText("Network Test Group")
        
        let confirmCreateButton = app.buttons["Create Group"]
        confirmCreateButton.tap()
        
        // Then - Network error should be handled gracefully
        let networkErrorMessage = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'network'"))
        let retryButton = app.buttons["Retry"]
        
        let errorHandled = networkErrorMessage.firstMatch.waitForExistence(timeout: 8.0) || 
                          retryButton.waitForExistence(timeout: 8.0)
        
        XCTAssertTrue(errorHandled, "Network error should be handled gracefully")
    }
    
    // MARK: - Helper Methods
    private func performLogin() {
        let signInButton = app.buttons["Sign In with Apple"]
        if signInButton.exists {
            signInButton.tap()
        } else {
            // Fallback login method
            let emailSignInButton = app.buttons["Email Sign In"]
            if emailSignInButton.exists {
                emailSignInButton.tap()
            }
        }
        
        // Wait for login to complete
        let groupSetupView = app.otherElements["GroupSetupView"]
        XCTAssertTrue(groupSetupView.waitForExistence(timeout: 10.0), "Should navigate to group setup after login")
    }
    
    private func createTestGroup() {
        let createGroupButton = app.buttons["Create New Group"]
        createGroupButton.tap()
        
        let groupNameField = app.textFields["Group Name"]
        groupNameField.tap()
        groupNameField.typeText("Test Hiking Group")
        
        let confirmCreateButton = app.buttons["Create Group"]
        confirmCreateButton.tap()
        
        // Wait for group creation to complete
        let leaderDashboard = app.otherElements["LeaderDashboardView"]
        XCTAssertTrue(leaderDashboard.waitForExistence(timeout: 8.0), "Group should be created successfully")
    }
    
    // MARK: - Test Accessibility
    func testAccessibilityLabels() throws {
        // Test that all UI elements have proper accessibility labels
        
        performLogin()
        
        let groupSetupView = app.otherElements["GroupSetupView"]
        XCTAssertTrue(groupSetupView.waitForExistence(timeout: 10.0), "Group setup view should be displayed")
        
        // Verify accessibility labels exist
        let createGroupButton = app.buttons["Create New Group"]
        XCTAssertTrue(createGroupButton.exists, "Create group button should have accessibility label")
        
        let joinGroupButton = app.buttons["Join Existing Group"]
        XCTAssertTrue(joinGroupButton.exists, "Join group button should have accessibility label")
        
        // Test navigation accessibility
        XCTAssertNotNil(createGroupButton.label, "Create group button should have accessible label")
        XCTAssertNotNil(joinGroupButton.label, "Join group button should have accessible label")
    }
    
    // MARK: - Test Performance
    func testGroupCreationPerformance() throws {
        // Test the performance of group creation flow
        
        performLogin()
        
        measure(metrics: [XCTClockMetric(), XCTMemoryMetric()]) {
            let createGroupButton = app.buttons["Create New Group"]
            createGroupButton.tap()
            
            let groupNameField = app.textFields["Group Name"]
            groupNameField.tap()
            groupNameField.typeText("Performance Test Group")
            
            let confirmCreateButton = app.buttons["Create Group"]
            confirmCreateButton.tap()
            
            // Wait for creation to complete
            let leaderDashboard = app.otherElements["LeaderDashboardView"]
            _ = leaderDashboard.waitForExistence(timeout: 10.0)
        }
    }
}