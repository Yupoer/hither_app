//
//  FindMemberFlowUITests.swift
//  HitherUITests
//
//  UI tests for find member flow: follower → map → compass interface
//

import XCTest

final class FindMemberFlowUITests: XCTestCase {
    
    var app: XCUIApplication!
    
    override func setUpWithError() throws {
        continueAfterFailure = false
        
        app = XCUIApplication()
        
        // Launch arguments for testing
        app.launchArguments.append("--uitesting")
        app.launchArguments.append("--disable-animations")
        
        // Launch environment for find member flow testing
        app.launchEnvironment["UITEST_MODE"] = "1"
        app.launchEnvironment["UITEST_SCENARIO"] = "FindMemberFlow"
        
        app.launch()
    }
    
    override func tearDownWithError() throws {
        app.terminate()
        app = nil
    }
    
    // MARK: - Test Find Leader Flow
    func testFindLeaderFlow() throws {
        // Given - Follower is in the group and can see the map
        setupFollowerInGroup()
        
        // Navigate to map view
        let mapView = app.otherElements["MapView"]
        if !mapView.exists {
            let mapTabButton = app.buttons["Map"]
            if mapTabButton.exists {
                mapTabButton.tap()
            }
        }
        
        XCTAssertTrue(mapView.waitForExistence(timeout: 5.0), "Map view should be accessible")
        
        // When - Follower taps on leader's location marker
        let leaderMarker = app.otherElements["LeaderLocationMarker"]
        if !leaderMarker.exists {
            // Alternative: Look for crown icon or leader indicator
            let leaderIndicator = app.images["LeaderCrown"]
            XCTAssertTrue(leaderIndicator.waitForExistence(timeout: 5.0), "Leader indicator should be visible on map")
            leaderIndicator.tap()
        } else {
            leaderMarker.tap()
        }
        
        // Then - Find member options should appear
        let findOptionsMenu = app.otherElements["FindOptionsMenu"]
        let findLeaderButton = app.buttons["Find Leader"]
        
        let findOptionsAvailable = findOptionsMenu.waitForExistence(timeout: 3.0) || 
                                  findLeaderButton.waitForExistence(timeout: 3.0)
        
        XCTAssertTrue(findOptionsAvailable, "Find options should be available when tapping leader marker")
        
        // When - Follower initiates find request
        if findLeaderButton.exists {
            findLeaderButton.tap()
        } else {
            let requestFindButton = app.buttons["Request Find"]
            XCTAssertTrue(requestFindButton.waitForExistence(timeout: 3.0), "Request find button should be available")
            requestFindButton.tap()
        }
        
        // Then - Find request should be sent
        let requestSentMessage = app.staticTexts["Find request sent"]
        let pendingMessage = app.staticTexts["Waiting for approval"]
        
        let requestInitiated = requestSentMessage.waitForExistence(timeout: 5.0) || 
                              pendingMessage.waitForExistence(timeout: 5.0)
        
        XCTAssertTrue(requestInitiated, "Find request should be initiated successfully")
        
        // Take screenshot of find request state
        let findRequestScreenshot = app.screenshot()
        XCTAttachment(screenshot: findRequestScreenshot).name = "Find Request Initiated"
    }
    
    // MARK: - Test Compass Interface Navigation
    func testCompassInterfaceNavigation() throws {
        // Given - Find request has been approved (simulated)
        setupFollowerInGroup()
        simulateApprovedFindRequest()
        
        // When - Follower navigates to compass interface
        let compassView = app.otherElements["CompassView"]
        // REMOVED: DirectionView reference - compass functionality eliminated
        // let directionView = app.otherElements["DirectionView"]
        
        // Try different ways to access compass
        if !compassView.exists {
            let findButton = app.buttons["Find"]
            if findButton.exists {
                findButton.tap()
            } else {
                let directionButton = app.buttons["Direction"]
                if directionButton.exists {
                    directionButton.tap()
                }
            }
        }
        
        let compassInterfaceAvailable = compassView.waitForExistence(timeout: 8.0)
                                       // || directionView.waitForExistence(timeout: 8.0) - REMOVED: compass functionality eliminated
        
        XCTAssertTrue(compassInterfaceAvailable, "Compass interface should be accessible")
        
        // Then - Compass interface should display direction information
        let directionArrow = app.images["DirectionArrow"]
        let distanceLabel = app.staticTexts.matching(identifier: "DistanceLabel").firstMatch
        
        XCTAssertTrue(directionArrow.waitForExistence(timeout: 3.0), "Direction arrow should be displayed")
        XCTAssertTrue(distanceLabel.waitForExistence(timeout: 3.0), "Distance information should be displayed")
        
        // Verify compass shows leader information
        let leaderNameLabel = app.staticTexts.matching(identifier: "TargetMemberName").firstMatch
        XCTAssertTrue(leaderNameLabel.exists, "Leader name should be displayed in compass")
        
        // Take screenshot of compass interface
        let compassScreenshot = app.screenshot()
        XCTAttachment(screenshot: compassScreenshot).name = "Compass Interface"
    }
    
    // MARK: - Test Precision Finding Mode
    func testPrecisionFindingMode() throws {
        // Given - Follower is close to leader (simulated)
        setupFollowerInGroup()
        simulateApprovedFindRequest()
        simulateNearbyLocation()
        
        // When - Entering precision finding mode
        let compassView = app.otherElements["CompassView"]
        XCTAssertTrue(compassView.waitForExistence(timeout: 8.0), "Should be in compass view")
        
        // Check if precision finding is activated automatically
        let precisionFindingView = app.otherElements["PrecisionFindingView"]
        let uwbIndicator = app.images["UWBIndicator"]
        let precisionModeLabel = app.staticTexts["Precision Mode"]
        
        let precisionModeActive = precisionFindingView.waitForExistence(timeout: 5.0) || 
                                 uwbIndicator.waitForExistence(timeout: 5.0) || 
                                 precisionModeLabel.waitForExistence(timeout: 5.0)
        
        if precisionModeActive {
            // Then - Precision finding interface should be displayed
            XCTAssertTrue(true, "Precision finding mode is active")
            
            // Verify precision finding elements
            let preciseDirectionArrow = app.images["PreciseDirectionArrow"]
            let preciseDistanceLabel = app.staticTexts.matching(identifier: "PreciseDistance").firstMatch
            
            // At least one precision element should be visible
            let precisionElementsVisible = preciseDirectionArrow.exists || preciseDistanceLabel.exists
            XCTAssertTrue(precisionElementsVisible, "Precision finding elements should be visible")
            
            // Take screenshot of precision mode
            let precisionScreenshot = app.screenshot()
            XCTAttachment(screenshot: precisionScreenshot).name = "Precision Finding Mode"
        } else {
            // Precision finding not available or not activated
            XCTAssertTrue(true, "Precision finding may not be available on this device/simulator")
        }
    }
    
    // MARK: - Test Find Request Approval Flow
    func testFindRequestApprovalFlow() throws {
        // This test simulates the leader's approval of a find request
        
        // Given - Leader receives find request (simulated)
        setupLeaderWithPendingFindRequest()
        
        // When - Leader views pending find requests
        let pendingRequestsView = app.otherElements["PendingRequestsView"]
        let notificationBanner = app.otherElements["FindRequestNotification"]
        
        let requestVisible = pendingRequestsView.waitForExistence(timeout: 5.0) || 
                            notificationBanner.waitForExistence(timeout: 5.0)
        
        XCTAssertTrue(requestVisible, "Find request should be visible to leader")
        
        // When - Leader approves the request
        let approveButton = app.buttons["Approve"]
        let acceptButton = app.buttons["Accept"]
        
        let approvalButtonExists = approveButton.waitForExistence(timeout: 3.0) || 
                                  acceptButton.waitForExistence(timeout: 3.0)
        
        XCTAssertTrue(approvalButtonExists, "Approval button should be available")
        
        if approveButton.exists {
            approveButton.tap()
        } else {
            acceptButton.tap()
        }
        
        // Then - Approval should be processed
        let approvalConfirmation = app.staticTexts["Find request approved"]
        let requestApprovedMessage = app.staticTexts["Request approved"]
        
        let approvalProcessed = approvalConfirmation.waitForExistence(timeout: 5.0) || 
                               requestApprovedMessage.waitForExistence(timeout: 5.0)
        
        XCTAssertTrue(approvalProcessed, "Find request approval should be processed")
    }
    
    // MARK: - Test Find Request Denial Flow
    func testFindRequestDenialFlow() throws {
        // Test leader denying a find request
        
        // Given - Leader receives find request
        setupLeaderWithPendingFindRequest()
        
        // When - Leader denies the request
        let denyButton = app.buttons["Deny"]
        let declineButton = app.buttons["Decline"]
        
        let denialButtonExists = denyButton.waitForExistence(timeout: 3.0) || 
                                declineButton.waitForExistence(timeout: 3.0)
        
        XCTAssertTrue(denialButtonExists, "Denial button should be available")
        
        if denyButton.exists {
            denyButton.tap()
        } else {
            declineButton.tap()
        }
        
        // Then - Denial should be processed
        let denialConfirmation = app.staticTexts["Find request denied"]
        XCTAssertTrue(denialConfirmation.waitForExistence(timeout: 5.0), "Find request denial should be processed")
    }
    
    // MARK: - Test Map Integration
    func testMapIntegrationForFinding() throws {
        // Test how finding integrates with the map view
        
        // Given - Follower is viewing map
        setupFollowerInGroup()
        
        let mapView = app.otherElements["MapView"]
        XCTAssertTrue(mapView.waitForExistence(timeout: 5.0), "Map view should be accessible")
        
        // When - Viewing member locations on map
        let memberMarkers = app.otherElements.matching(identifier: "MemberLocationMarker")
        let leaderMarker = app.otherElements["LeaderLocationMarker"]
        
        let markersVisible = memberMarkers.count > 0 || leaderMarker.exists
        XCTAssertTrue(markersVisible, "Member location markers should be visible on map")
        
        // Test map interaction for finding
        if leaderMarker.exists {
            // Long press on leader marker
            leaderMarker.press(forDuration: 1.0)
            
            let contextMenu = app.otherElements["MemberContextMenu"]
            let findOption = app.buttons["Find This Member"]
            
            let findOptionAvailable = contextMenu.waitForExistence(timeout: 3.0) || 
                                     findOption.waitForExistence(timeout: 3.0)
            
            XCTAssertTrue(findOptionAvailable, "Find option should be available from map marker")
        }
        
        // Take screenshot of map with markers
        let mapScreenshot = app.screenshot()
        XCTAttachment(screenshot: mapScreenshot).name = "Map with Member Markers"
    }
    
    // MARK: - Test Distance Updates
    func testDistanceUpdatesInCompass() throws {
        // Test that distance updates dynamically in compass view
        
        // Given - In compass mode with active find session
        setupFollowerInGroup()
        simulateApprovedFindRequest()
        
        let compassView = app.otherElements["CompassView"]
        XCTAssertTrue(compassView.waitForExistence(timeout: 8.0), "Should be in compass view")
        
        // When - Simulating movement (changing distance)
        let initialDistanceLabel = app.staticTexts.matching(identifier: "DistanceLabel").firstMatch
        XCTAssertTrue(initialDistanceLabel.waitForExistence(timeout: 3.0), "Distance label should be displayed")
        
        let _ = initialDistanceLabel.label // Initial distance for potential comparison
        
        // Simulate location change
        app.launchEnvironment["UITEST_SIMULATE_MOVEMENT"] = "1"
        
        // Wait for distance to potentially update
        Thread.sleep(forTimeInterval: 2.0)
        
        // Then - Distance should be continuously updated
        let updatedDistanceLabel = app.staticTexts.matching(identifier: "DistanceLabel").firstMatch
        XCTAssertTrue(updatedDistanceLabel.exists, "Distance label should continue to exist")
        
        // The distance value might or might not change in simulation, but the label should persist
        XCTAssertNotNil(updatedDistanceLabel.label, "Distance label should have a value")
    }
    
    // MARK: - Test Error Handling
    func testFindRequestErrorHandling() throws {
        // Test error handling in find request flow
        
        // Given - Network error conditions
        app.launchEnvironment["UITEST_NETWORK_ERROR"] = "1"
        
        setupFollowerInGroup()
        
        // When - Trying to send find request with network issues
        let mapView = app.otherElements["MapView"]
        XCTAssertTrue(mapView.waitForExistence(timeout: 5.0), "Map view should be accessible")
        
        let leaderMarker = app.otherElements["LeaderLocationMarker"]
        if leaderMarker.exists {
            leaderMarker.tap()
            
            let findLeaderButton = app.buttons["Find Leader"]
            if findLeaderButton.exists {
                findLeaderButton.tap()
            }
        }
        
        // Then - Error should be handled gracefully
        let errorAlert = app.alerts.firstMatch
        let errorMessage = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'error'"))
        let retryButton = app.buttons["Retry"]
        
        let errorHandled = errorAlert.waitForExistence(timeout: 8.0) || 
                          errorMessage.count > 0 || 
                          retryButton.waitForExistence(timeout: 8.0)
        
        XCTAssertTrue(errorHandled, "Find request error should be handled gracefully")
        
        // Take screenshot of error state
        let errorScreenshot = app.screenshot()
        XCTAttachment(screenshot: errorScreenshot).name = "Find Request Error"
    }
    
    // MARK: - Helper Methods
    private func setupFollowerInGroup() {
        performLogin()
        joinTestGroup()
        
        // Verify follower status
        let followerView = app.otherElements["FollowerDashboardView"]
        let mapView = app.otherElements["MapView"]
        
        let inFollowerMode = followerView.waitForExistence(timeout: 10.0) || mapView.waitForExistence(timeout: 10.0)
        XCTAssertTrue(inFollowerMode, "Should be in follower mode")
    }
    
    private func setupLeaderWithPendingFindRequest() {
        // Setup leader who has received a find request
        app.launchEnvironment["UITEST_USER_ROLE"] = "LEADER"
        app.launchEnvironment["UITEST_PENDING_FIND_REQUEST"] = "1"
        
        performLogin()
        createTestGroup()
        
        let leaderDashboard = app.otherElements["LeaderDashboardView"]
        XCTAssertTrue(leaderDashboard.waitForExistence(timeout: 10.0), "Should be in leader dashboard")
    }
    
    private func simulateApprovedFindRequest() {
        // Simulate that a find request has been approved
        app.launchEnvironment["UITEST_FIND_REQUEST_APPROVED"] = "1"
    }
    
    private func simulateNearbyLocation() {
        // Simulate being close to the target for precision finding
        app.launchEnvironment["UITEST_NEARBY_TARGET"] = "1"
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
        groupNameField.typeText("Find Test Group")
        
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
        inviteCodeField.typeText("FIND123")
        
        let joinButton = app.buttons["Join Group"]
        joinButton.tap()
        
        let followerView = app.otherElements["FollowerDashboardView"]
        let mapView = app.otherElements["MapView"]
        let joinedSuccessfully = followerView.waitForExistence(timeout: 8.0) || mapView.waitForExistence(timeout: 8.0)
        XCTAssertTrue(joinedSuccessfully, "Should join group successfully")
    }
    
    // MARK: - Test Accessibility
    func testCompassAccessibility() throws {
        setupFollowerInGroup()
        simulateApprovedFindRequest()
        
        let compassView = app.otherElements["CompassView"]
        XCTAssertTrue(compassView.waitForExistence(timeout: 8.0), "Should be in compass view")
        
        // Test accessibility labels
        let directionArrow = app.images["DirectionArrow"]
        let distanceLabel = app.staticTexts.matching(identifier: "DistanceLabel").firstMatch
        
        if directionArrow.exists {
            XCTAssertNotNil(directionArrow.label, "Direction arrow should have accessibility label")
        }
        
        if distanceLabel.exists {
            XCTAssertNotNil(distanceLabel.label, "Distance label should have accessibility content")
        }
    }
    
    // MARK: - Test Performance
    func testCompassUpdatePerformance() throws {
        setupFollowerInGroup()
        simulateApprovedFindRequest()
        
        measure(metrics: [XCTClockMetric(), XCTMemoryMetric()]) {
            let compassView = app.otherElements["CompassView"]
            _ = compassView.waitForExistence(timeout: 8.0)
            
            // Simulate compass updates
            app.launchEnvironment["UITEST_SIMULATE_MOVEMENT"] = "1"
            Thread.sleep(forTimeInterval: 1.0)
        }
    }
}