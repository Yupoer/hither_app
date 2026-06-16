//
//  NavigationButtonUITests.swift
//  HitherUITests
//
//  UI tests for navigation button functionality (Story B-6)
//

import XCTest

final class NavigationButtonUITests: XCTestCase {
    
    var app: XCUIApplication!
    
    override func setUpWithError() throws {
        continueAfterFailure = false
        
        // Configure test environment
        var config = UITestConfiguration.setupTestUser(role: .leader)
        config.merge(UITestConfiguration.setupTestGroup()) { (_, new) in new }
        config.merge(UITestConfiguration.simulateLocationUpdate()) { (_, new) in new }
        
        app = UITestUtils.launchAppWithConfiguration(config)
    }

    override func tearDownWithError() throws {
        app = nil
    }
    
    // MARK: - Story B-6 Test Cases
    
    func testViewProfileNavigation() throws {
        // Setup: Create group with members
        XCTAssertTrue(UITestUtils.performLogin(in: app))
        XCTAssertTrue(UITestUtils.createGroup(named: "Profile Test Group", in: app))
        
        // Navigate to map to access member interactions
        let mapTab = app.tabBars.buttons["Map"]
        _ = waitForElement(mapTab)
        mapTab.tap()
        
        // Wait for map to load
        let mapView = app.otherElements["MapView"]
        XCTAssertTrue(mapView.waitForExistence(timeout: 10.0))
        
        // Look for member avatar/annotation on map
        let memberAnnotation = app.otherElements.matching(NSPredicate(format: "identifier CONTAINS 'member'")).firstMatch
        
        if memberAnnotation.waitForExistence(timeout: 5.0) {
            takeScreenshot(named: "Before Member Tap")
            
            // Test AC1: Member profile navigation
            memberAnnotation.tap()
            
            // Look for member interaction menu
            let memberInteractionMenu = app.otherElements["MemberInteractionMenu"]
            XCTAssertTrue(memberInteractionMenu.waitForExistence(timeout: 3.0), "Member interaction menu should appear")
            
            takeScreenshot(named: "Member Interaction Menu")
            
            // Test "View Profile" button
            let viewProfileButton = app.buttons["View Profile"]
            XCTAssertTrue(viewProfileButton.waitForExistence(timeout: 3.0), "View Profile button should exist")
            
            validateAccessibility(for: viewProfileButton)
            
            measureUIPerformance {
                viewProfileButton.tap()
            }
            
            // Verify MemberProfileSheet appears
            let memberProfileSheet = app.otherElements["MemberProfileSheet"]
            XCTAssertTrue(memberProfileSheet.waitForExistence(timeout: 5.0), "Member profile sheet should appear")
            
            takeScreenshot(named: "Member Profile Sheet")
            
            // Verify profile content is displayed
            let profileHeader = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Test Leader' OR label CONTAINS 'Leader'")).firstMatch
            XCTAssertTrue(profileHeader.exists, "Profile should display member information")
            
            // Test dismissal
            let doneButton = app.buttons["Done"]
            if doneButton.exists {
                doneButton.tap()
            } else {
                // Fallback: swipe down to dismiss sheet
                memberProfileSheet.swipeDown()
            }
            
            // Verify sheet is dismissed
            XCTAssertTrue(UITestConfiguration.waitForElementToDisappear(memberProfileSheet, timeout: 3.0), "Profile sheet should be dismissed")
        } else {
            XCTFail("No member annotation found on map for testing profile navigation")
        }
    }
    
    func testMoreCommandsNavigation() throws {
        // Setup: Create group as leader
        XCTAssertTrue(UITestUtils.performLogin(in: app))
        XCTAssertTrue(UITestUtils.createGroup(named: "Commands Test Group", in: app))
        
        // Should be on leader dashboard by default
        let leaderDashboard = app.otherElements["LeaderDashboardView"]
        XCTAssertTrue(leaderDashboard.waitForExistence(timeout: 5.0), "Should be on leader dashboard")
        
        takeScreenshot(named: "Leader Dashboard")
        
        // Test AC2: More Commands button functionality
        let moreCommandsButton = app.buttons["more_commands"]
        if !moreCommandsButton.exists {
            // Try alternative identifiers
            let alternativeButtons = [
                app.buttons["更多指令"],
                app.buttons["More Commands"],
                app.buttons.matching(NSPredicate(format: "label CONTAINS 'command' OR label CONTAINS '指令'")).firstMatch
            ]
            
            for button in alternativeButtons {
                if button.exists {
                    XCTAssertTrue(button.isHittable, "More commands button should be hittable")
                    
                    validateAccessibility(for: button)
                    
                    takeScreenshot(named: "Before More Commands Tap")
                    
                    measureUIPerformance {
                        button.tap()
                    }
                    break
                }
            }
        } else {
            validateAccessibility(for: moreCommandsButton)
            
            takeScreenshot(named: "Before More Commands Tap")
            
            measureUIPerformance {
                moreCommandsButton.tap()
            }
        }
        
        // Verify AllCommandsSheet appears
        let allCommandsSheet = app.otherElements["AllCommandsSheet"]
        XCTAssertTrue(allCommandsSheet.waitForExistence(timeout: 5.0), "All commands sheet should appear")
        
        takeScreenshot(named: "All Commands Sheet")
        
        // Verify sheet contains command options
        let commandButtons = app.buttons.matching(NSPredicate(format: "identifier CONTAINS 'command' OR label CONTAINS 'gather' OR label CONTAINS 'depart'"))
        XCTAssertGreaterThan(commandButtons.count, 0, "Commands sheet should contain command buttons")
        
        // Test sheet functionality - try to send a command
        let gatherButton = app.buttons.matching(NSPredicate(format: "label CONTAINS 'gather' OR label CONTAINS '集合'")).firstMatch
        if gatherButton.exists {
            gatherButton.tap()
            
            // Verify command sending (might show loading or success state)
            Thread.sleep(forTimeInterval: 1.0)
            takeScreenshot(named: "After Command Sent")
        }
        
        // Test dismissal
        let dismissButton = app.buttons["dismiss"]
        if dismissButton.exists {
            dismissButton.tap()
        } else {
            // Try swipe down to dismiss
            allCommandsSheet.swipeDown()
        }
        
        // Verify sheet is dismissed
        XCTAssertTrue(UITestConfiguration.waitForElementToDisappear(allCommandsSheet, timeout: 3.0), "All commands sheet should be dismissed")
    }
    
    func testNavigationButtonAccessibility() throws {
        // Setup
        XCTAssertTrue(UITestUtils.performLogin(in: app))
        XCTAssertTrue(UITestUtils.createGroup(named: "Accessibility Test Group", in: app))
        
        // Test dashboard buttons accessibility
        let leaderDashboard = app.otherElements["LeaderDashboardView"]
        XCTAssertTrue(leaderDashboard.waitForExistence(timeout: 5.0))
        
        // Validate accessibility for all interactive elements
        UITestConfiguration.validateAccessibilityForView(leaderDashboard, testCase: self)
        
        // Specifically test the more commands button
        let moreCommandsButtons = app.buttons.matching(NSPredicate(format: "label CONTAINS 'command' OR label CONTAINS '指令'"))
        if moreCommandsButtons.count > 0 {
            let button = moreCommandsButtons.element(boundBy: 0)
            validateAccessibility(for: button)
            
            XCTAssertNotNil(button.label, "More commands button should have accessibility label")
            XCTAssertTrue(button.isHittable, "More commands button should be hittable")
        }
        
        // Test map member interaction accessibility
        let mapTab = app.tabBars.buttons["Map"]
        _ = waitForElement(mapTab)
        mapTab.tap()
        
        let mapView = app.otherElements["MapView"]
        XCTAssertTrue(mapView.waitForExistence(timeout: 10.0))
        
        // Validate map view accessibility
        UITestConfiguration.validateAccessibilityForView(mapView, testCase: self)
    }
    
    func testNavigationButtonPerformance() throws {
        // Setup
        XCTAssertTrue(UITestUtils.performLogin(in: app))
        XCTAssertTrue(UITestUtils.createGroup(named: "Performance Test Group", in: app))
        
        // Performance test: Multiple rapid taps should not cause crashes
        let moreCommandsButtons = app.buttons.matching(NSPredicate(format: "label CONTAINS 'command' OR label CONTAINS '指令'"))
        
        if moreCommandsButtons.count > 0 {
            let button = moreCommandsButtons.element(boundBy: 0)
            
            measure(metrics: [XCTClockMetric(), XCTMemoryMetric()]) {
                // Test rapid button taps
                for _ in 0..<3 {
                    button.tap()
                    
                    // Wait for sheet and dismiss
                    let sheet = app.otherElements["AllCommandsSheet"]
                    if sheet.waitForExistence(timeout: 1.0) {
                        sheet.swipeDown()
                        _ = UITestConfiguration.waitForElementToDisappear(sheet, timeout: 1.0)
                    }
                    
                    Thread.sleep(forTimeInterval: 0.2)
                }
            }
            
            // Verify app remains responsive
            XCTAssertTrue(button.isHittable, "Button should remain responsive after performance test")
        }
    }
    
    func testErrorHandlingForNavigationButtons() throws {
        // Setup with network error simulation
        var config = UITestConfiguration.setupTestUser(role: .leader)
        config.merge(UITestConfiguration.setupTestGroup()) { (_, new) in new }
        config.merge(UITestConfiguration.simulateNetworkError()) { (_, new) in new }
        
        let errorApp = UITestUtils.launchAppWithConfiguration(config)
        
        // Test that buttons remain functional even with network issues
        XCTAssertTrue(UITestUtils.performLogin(in: errorApp))
        XCTAssertTrue(UITestUtils.createGroup(named: "Error Test Group", in: errorApp))
        
        // Try to use more commands button with network error
        let moreCommandsButtons = errorApp.buttons.matching(NSPredicate(format: "label CONTAINS 'command' OR label CONTAINS '指令'"))
        
        if moreCommandsButtons.count > 0 {
            let button = moreCommandsButtons.element(boundBy: 0)
            button.tap()
            
            // Sheet should still appear even with network issues (UI remains functional)
            let sheet = errorApp.otherElements["AllCommandsSheet"]
            XCTAssertTrue(sheet.waitForExistence(timeout: 5.0), "UI should remain functional despite network errors")
            
            takeScreenshot(named: "Commands Sheet With Network Error")
            
            sheet.swipeDown()
        }
    }
}

// MARK: - Test Data Setup Extension
extension NavigationButtonUITests {
    
    func setupTestGroupWithMembers() throws {
        // Create a group with multiple test members for interaction testing
        let memberConfig = [
            "UITEST_ADD_MEMBER_1": "Test Member 1",
            "UITEST_ADD_MEMBER_2": "Test Member 2",
            "UITEST_MEMBER_1_AVATAR": "👤",
            "UITEST_MEMBER_2_AVATAR": "👥"
        ]
        
        for (key, value) in memberConfig {
            app.launchEnvironment[key] = value
        }
    }
}