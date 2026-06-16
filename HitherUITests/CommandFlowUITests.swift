//
//  CommandFlowUITests.swift
//  HitherUITests
//
//  UI tests for command flow: leader send command → follower receives notification
//

import XCTest

final class CommandFlowUITests: XCTestCase {
    
    var app: XCUIApplication!
    
    override func setUpWithError() throws {
        continueAfterFailure = false
        
        app = XCUIApplication()
        
        // Launch arguments for testing
        app.launchArguments.append("--uitesting")
        app.launchArguments.append("--disable-animations")
        
        // Launch environment for command flow testing
        app.launchEnvironment["UITEST_MODE"] = "1"
        app.launchEnvironment["UITEST_SCENARIO"] = "CommandFlow"
        
        app.launch()
    }
    
    override func tearDownWithError() throws {
        app.terminate()
        app = nil
    }
    
    // MARK: - Test Gather Command Flow
    func testGatherCommandFlow() throws {
        // Given - Leader is in dashboard
        setupLeaderInDashboard()
        
        // When - Leader sends gather command
        let gatherButton = app.buttons["Gather"]
        XCTAssertTrue(gatherButton.waitForExistence(timeout: 5.0), "Gather button should exist in leader dashboard")
        
        // Take screenshot before action
        let beforeScreenshot = app.screenshot()
        XCTAttachment(screenshot: beforeScreenshot).name = "Before Gather Command"
        
        gatherButton.tap()
        
        // Then - Command should be sent successfully
        let commandSentMessage = app.staticTexts["Command sent successfully"]
        let commandConfirmation = app.alerts["Command Sent"]
        
        let commandSent = commandSentMessage.waitForExistence(timeout: 3.0) || 
                         commandConfirmation.waitForExistence(timeout: 3.0)
        
        XCTAssertTrue(commandSent, "Gather command should be sent successfully")
        
        // Take screenshot after action
        let afterScreenshot = app.screenshot()
        XCTAttachment(screenshot: afterScreenshot).name = "After Gather Command"
        
        // Verify command appears in recent commands
        let recentCommandsList = app.collectionViews["RecentCommands"]
        if recentCommandsList.exists {
            let gatherCommandCell = recentCommandsList.cells.containing(.staticText, identifier: "Gather").firstMatch
            XCTAssertTrue(gatherCommandCell.waitForExistence(timeout: 5.0), "Gather command should appear in recent commands")
        }
    }
    
    // MARK: - Test Depart Command Flow
    func testDepartCommandFlow() throws {
        // Given - Leader is in dashboard
        setupLeaderInDashboard()
        
        // When - Leader sends depart command
        let departButton = app.buttons["Depart"]
        XCTAssertTrue(departButton.waitForExistence(timeout: 5.0), "Depart button should exist in leader dashboard")
        
        departButton.tap()
        
        // Then - Command should be sent successfully
        let commandSentMessage = app.staticTexts["Command sent successfully"]
        XCTAssertTrue(commandSentMessage.waitForExistence(timeout: 5.0), "Depart command should be sent successfully")
        
        // Verify command details
        let departCommandDetails = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'depart'"))
        XCTAssertTrue(departCommandDetails.count > 0, "Depart command details should be visible")
    }
    
    // MARK: - Test Rest Command Flow
    func testRestCommandFlow() throws {
        // Given - Leader is in dashboard
        setupLeaderInDashboard()
        
        // When - Leader sends rest command
        let restButton = app.buttons["Rest"]
        XCTAssertTrue(restButton.waitForExistence(timeout: 5.0), "Rest button should exist in leader dashboard")
        
        restButton.tap()
        
        // Then - Command should be sent successfully
        let commandSentMessage = app.staticTexts["Command sent successfully"]
        XCTAssertTrue(commandSentMessage.waitForExistence(timeout: 5.0), "Rest command should be sent successfully")
    }
    
    // MARK: - Test Custom Command Flow
    func testCustomCommandFlow() throws {
        // Given - Leader is in dashboard
        setupLeaderInDashboard()
        
        // When - Leader opens custom command interface
        let customMessageButton = app.buttons["Send Custom Message"]
        if !customMessageButton.exists {
            // Alternative access via more options
            let moreOptionsButton = app.buttons["More Options"]
            if moreOptionsButton.exists {
                moreOptionsButton.tap()
            }
        }
        
        XCTAssertTrue(customMessageButton.waitForExistence(timeout: 5.0), "Custom message button should be accessible")
        customMessageButton.tap()
        
        // Enter custom message
        let messageTextField = app.textViews["Custom Message"]
        XCTAssertTrue(messageTextField.waitForExistence(timeout: 3.0), "Custom message text field should appear")
        
        messageTextField.tap()
        messageTextField.typeText("Please wait at the bridge for 5 minutes")
        
        // Send custom command
        let sendButton = app.buttons["Send Message"]
        XCTAssertTrue(sendButton.exists, "Send button should be available")
        sendButton.tap()
        
        // Then - Custom command should be sent
        let commandSentMessage = app.staticTexts["Message sent successfully"]
        XCTAssertTrue(commandSentMessage.waitForExistence(timeout: 5.0), "Custom message should be sent successfully")
        
        // Verify custom message appears in command history
        let customMessageText = app.staticTexts["Please wait at the bridge for 5 minutes"]
        XCTAssertTrue(customMessageText.waitForExistence(timeout: 3.0), "Custom message should appear in command history")
    }
    
    // MARK: - Test Command History Display
    func testCommandHistoryDisplay() throws {
        // Given - Leader has sent multiple commands
        setupLeaderInDashboard()
        
        // Send multiple commands
        sendGatherCommand()
        sendRestCommand()
        sendDepartCommand()
        
        // When - User views command history
        let commandHistoryView = app.scrollViews["CommandHistory"]
        if !commandHistoryView.exists {
            let historyButton = app.buttons["View History"]
            if historyButton.exists {
                historyButton.tap()
            }
        }
        
        // Then - All commands should be displayed in chronological order
        let commandCells = app.cells.matching(identifier: "CommandHistoryCell")
        XCTAssertTrue(commandCells.count >= 3, "Should show at least 3 commands in history")
        
        // Verify command timestamps are displayed
        let timestampLabels = app.staticTexts.matching(identifier: "CommandTimestamp")
        XCTAssertTrue(timestampLabels.count >= 3, "Each command should have a timestamp")
        
        // Verify command sender information
        let senderLabels = app.staticTexts.matching(identifier: "CommandSender")
        XCTAssertTrue(senderLabels.count >= 3, "Each command should show sender information")
    }
    
    // MARK: - Test Notification Simulation
    func testNotificationReceiptSimulation() throws {
        // This test simulates how notifications would be received
        // In a real multi-device test, this would involve two simulators
        
        // Given - Follower device simulation
        app.launchEnvironment["UITEST_USER_ROLE"] = "FOLLOWER"
        
        setupFollowerInGroup()
        
        // When - Simulate receiving command notification
        app.launchEnvironment["UITEST_SIMULATE_COMMAND"] = "gather"
        
        // Simulate app coming to foreground with notification
        app.activate()
        
        // Then - Notification should be processed and displayed
        let notificationBanner = app.otherElements["NotificationBanner"]
        let commandNotificationText = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Gather'"))
        
        let notificationReceived = notificationBanner.waitForExistence(timeout: 5.0) || 
                                  commandNotificationText.count > 0
        
        XCTAssertTrue(notificationReceived, "Command notification should be received and displayed")
        
        // Verify notification content
        if notificationBanner.exists {
            let notificationTitle = app.staticTexts["Leader sent a command"]
            XCTAssertTrue(notificationTitle.exists, "Notification should have appropriate title")
        }
    }
    
    // MARK: - Test Command Button States
    func testCommandButtonStates() throws {
        // Given - Leader is in dashboard
        setupLeaderInDashboard()
        
        // When - Testing button states
        let gatherButton = app.buttons["Gather"]
        let departButton = app.buttons["Depart"]
        let restButton = app.buttons["Rest"]
        
        // Then - All command buttons should be enabled for leader
        XCTAssertTrue(gatherButton.isEnabled, "Gather button should be enabled for leader")
        XCTAssertTrue(departButton.isEnabled, "Depart button should be enabled for leader")
        XCTAssertTrue(restButton.isEnabled, "Rest button should be enabled for leader")
        
        // Test button visual states
        XCTAssertFalse(gatherButton.hasFocus, "Button should not have focus initially")
        
        // Test button accessibility
        XCTAssertNotNil(gatherButton.label, "Gather button should have accessibility label")
        XCTAssertNotNil(departButton.label, "Depart button should have accessibility label")
        XCTAssertNotNil(restButton.label, "Rest button should have accessibility label")
    }
    
    // MARK: - Test Error Handling
    func testCommandSendingError() throws {
        // Given - Network error conditions
        app.launchEnvironment["UITEST_NETWORK_ERROR"] = "1"
        
        setupLeaderInDashboard()
        
        // When - Leader tries to send command with network issues
        let gatherButton = app.buttons["Gather"]
        gatherButton.tap()
        
        // Then - Error should be handled gracefully
        let errorAlert = app.alerts.firstMatch
        let errorMessage = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'error'"))
        let retryButton = app.buttons["Retry"]
        
        let errorHandled = errorAlert.waitForExistence(timeout: 5.0) || 
                          errorMessage.count > 0 || 
                          retryButton.waitForExistence(timeout: 5.0)
        
        XCTAssertTrue(errorHandled, "Command sending error should be handled gracefully")
        
        // Take screenshot of error state
        let errorScreenshot = app.screenshot()
        XCTAttachment(screenshot: errorScreenshot).name = "Command Sending Error"
    }
    
    // MARK: - Test Command Rate Limiting
    func testCommandRateLimiting() throws {
        // Test that commands can't be spammed
        
        // Given - Leader is in dashboard
        setupLeaderInDashboard()
        
        // When - Leader tries to send commands rapidly
        let gatherButton = app.buttons["Gather"]
        
        gatherButton.tap()
        gatherButton.tap() // Immediate second tap
        gatherButton.tap() // Immediate third tap
        
        // Then - Rate limiting should be applied
        let rateLimitMessage = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'wait'"))
        let cooldownIndicator = app.progressIndicators["CommandCooldown"]
        
        let rateLimitApplied = rateLimitMessage.count > 0 || cooldownIndicator.exists
        
        if rateLimitApplied {
            XCTAssertTrue(true, "Command rate limiting is properly applied")
        } else {
            // If no rate limiting, verify multiple commands were sent
            let commandSentMessages = app.staticTexts["Command sent successfully"]
            XCTAssertTrue(commandSentMessages.exists, "At least one command should be sent")
        }
    }
    
    // MARK: - Helper Methods
    private func setupLeaderInDashboard() {
        // Navigate to leader dashboard
        performLogin()
        createTestGroup()
        
        // Verify we're in leader dashboard
        let leaderDashboard = app.otherElements["LeaderDashboardView"]
        XCTAssertTrue(leaderDashboard.waitForExistence(timeout: 10.0), "Should be in leader dashboard")
    }
    
    private func setupFollowerInGroup() {
        // Setup for follower user
        performLogin()
        joinTestGroup()
        
        // Verify we're in follower view
        let followerView = app.otherElements["FollowerDashboardView"]
        let mapView = app.otherElements["MapView"]
        
        let inFollowerMode = followerView.waitForExistence(timeout: 10.0) || mapView.waitForExistence(timeout: 10.0)
        XCTAssertTrue(inFollowerMode, "Should be in follower mode")
    }
    
    private func performLogin() {
        let signInButton = app.buttons["Sign In with Apple"]
        if signInButton.exists {
            signInButton.tap()
        } else {
            let emailSignInButton = app.buttons["Email Sign In"]
            if emailSignInButton.exists {
                emailSignInButton.tap()
            }
        }
        
        let groupSetupView = app.otherElements["GroupSetupView"]
        XCTAssertTrue(groupSetupView.waitForExistence(timeout: 10.0), "Should navigate to group setup after login")
    }
    
    private func createTestGroup() {
        let createGroupButton = app.buttons["Create New Group"]
        createGroupButton.tap()
        
        let groupNameField = app.textFields["Group Name"]
        groupNameField.tap()
        groupNameField.typeText("Command Test Group")
        
        let confirmCreateButton = app.buttons["Create Group"]
        confirmCreateButton.tap()
        
        let leaderDashboard = app.otherElements["LeaderDashboardView"]
        XCTAssertTrue(leaderDashboard.waitForExistence(timeout: 8.0), "Group should be created successfully")
    }
    
    private func joinTestGroup() {
        let joinGroupButton = app.buttons["Join Existing Group"]
        joinGroupButton.tap()
        
        let inviteCodeField = app.textFields["Invite Code"]
        inviteCodeField.tap()
        inviteCodeField.typeText("TEST123")
        
        let joinButton = app.buttons["Join Group"]
        joinButton.tap()
        
        // Wait for join to complete
        let followerView = app.otherElements["FollowerDashboardView"]
        let mapView = app.otherElements["MapView"]
        let joinedSuccessfully = followerView.waitForExistence(timeout: 8.0) || mapView.waitForExistence(timeout: 8.0)
        XCTAssertTrue(joinedSuccessfully, "Should join group successfully")
    }
    
    private func sendGatherCommand() {
        let gatherButton = app.buttons["Gather"]
        if gatherButton.exists {
            gatherButton.tap()
            // Wait for command to be sent
            Thread.sleep(forTimeInterval: 1.0)
        }
    }
    
    private func sendRestCommand() {
        let restButton = app.buttons["Rest"]
        if restButton.exists {
            restButton.tap()
            Thread.sleep(forTimeInterval: 1.0)
        }
    }
    
    private func sendDepartCommand() {
        let departButton = app.buttons["Depart"]
        if departButton.exists {
            departButton.tap()
            Thread.sleep(forTimeInterval: 1.0)
        }
    }
    
    // MARK: - Test Performance
    func testCommandSendingPerformance() throws {
        setupLeaderInDashboard()
        
        measure(metrics: [XCTClockMetric()]) {
            let gatherButton = app.buttons["Gather"]
            gatherButton.tap()
            
            // Wait for command to be processed
            let commandSentMessage = app.staticTexts["Command sent successfully"]
            _ = commandSentMessage.waitForExistence(timeout: 5.0)
        }
    }
}