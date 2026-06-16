//
//  MapInteractionUITests.swift
//  HitherUITests
//
//  UI tests for map interaction features (Story B-4)
//

import XCTest

final class MapInteractionUITests: XCTestCase {
    
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
    
    // MARK: - Story B-4 Test Cases
    
    func testMyLocationButtonInteraction() throws {
        // Setup: Navigate to map view
        XCTAssertTrue(UITestUtils.performLogin(in: app))
        XCTAssertTrue(UITestUtils.createGroup(named: "Test Map Group", in: app))
        
        // Navigate to map tab
        let mapTab = app.tabBars.buttons["Map"]
        _ = waitForElement(mapTab)
        mapTab.tap()
        
        // Wait for map view to load
        let mapView = app.otherElements["MapView"]
        XCTAssertTrue(mapView.waitForExistence(timeout: 10.0))
        
        // Test AC1: My Location button functionality with visual feedback
        let myLocationButton = app.buttons["location"]
        XCTAssertTrue(myLocationButton.waitForExistence(timeout: 5.0), "My Location button should exist")
        
        // Take screenshot before tap
        takeScreenshot(named: "Before My Location Button Tap")
        
        // Measure button response time
        measureUIPerformance {
            myLocationButton.tap()
        }
        
        // Take screenshot after tap to verify visual feedback
        takeScreenshot(named: "After My Location Button Tap")
        
        // Verify the button shows active state (filled location icon)
        let activeLocationButton = app.buttons["location.fill"]
        XCTAssertTrue(activeLocationButton.waitForExistence(timeout: 3.0), "Location button should show active state")
        
        // Validate accessibility
        validateAccessibility(for: myLocationButton)
    }
    
    func testDestinationButtonInteraction() throws {
        // Setup: Create group with waypoint
        XCTAssertTrue(UITestUtils.performLogin(in: app))
        XCTAssertTrue(UITestUtils.createGroup(named: "Test Destination Group", in: app))
        
        // Navigate to itinerary and add a waypoint first
        let itineraryTab = app.tabBars.buttons["Itinerary"]
        _ = waitForElement(itineraryTab)
        itineraryTab.tap()
        
        let addWaypointButton = app.buttons["Add Waypoint"]
        if addWaypointButton.waitForExistence(timeout: 5.0) {
            addWaypointButton.tap()
            
            // Add a test destination
            let searchField = app.textFields["Search for location"]
            if searchField.waitForExistence(timeout: 3.0) {
                searchField.tap()
                searchField.typeText("San Francisco")
                
                // Select first result
                let firstResult = app.tables.cells.element(boundBy: 0)
                if firstResult.waitForExistence(timeout: 5.0) {
                    firstResult.tap()
                    
                    let confirmButton = app.buttons["Add to Itinerary"]
                    if confirmButton.waitForExistence(timeout: 3.0) {
                        confirmButton.tap()
                    }
                }
            }
        }
        
        // Navigate to map tab
        let mapTab = app.tabBars.buttons["Map"]
        _ = waitForElement(mapTab)
        mapTab.tap()
        
        // Test AC2: Destination button functionality with smooth animation
        let destinationButton = app.buttons["location.north.circle"]
        XCTAssertTrue(destinationButton.waitForExistence(timeout: 5.0), "Destination button should exist when waypoint is present")
        
        takeScreenshot(named: "Before Destination Button Tap")
        
        // Test button interaction with visual feedback
        measureUIPerformance {
            destinationButton.tap()
        }
        
        takeScreenshot(named: "After Destination Button Tap")
        
        // Validate accessibility
        validateAccessibility(for: destinationButton)
    }
    
    func testDestinationCardSwipeInteraction() throws {
        // Setup: Create group with multiple waypoints
        XCTAssertTrue(UITestUtils.performLogin(in: app))
        XCTAssertTrue(UITestUtils.createGroup(named: "Test Swipe Group", in: app))
        
        // Add multiple waypoints via itinerary
        let itineraryTab = app.tabBars.buttons["Itinerary"]
        _ = waitForElement(itineraryTab)
        itineraryTab.tap()
        
        // Add first waypoint
        let addWaypointButton = app.buttons["Add Waypoint"]
        if addWaypointButton.waitForExistence(timeout: 5.0) {
            addWaypointButton.tap()
            
            let searchField = app.textFields["Search for location"]
            if searchField.waitForExistence(timeout: 3.0) {
                searchField.tap()
                searchField.typeText("Golden Gate Bridge")
                
                let firstResult = app.tables.cells.element(boundBy: 0)
                if firstResult.waitForExistence(timeout: 5.0) {
                    firstResult.tap()
                    
                    let confirmButton = app.buttons["Add to Itinerary"]
                    if confirmButton.waitForExistence(timeout: 3.0) {
                        confirmButton.tap()
                    }
                }
            }
        }
        
        // Add second waypoint
        if addWaypointButton.waitForExistence(timeout: 3.0) {
            addWaypointButton.tap()
            
            let searchField = app.textFields["Search for location"]
            if searchField.waitForExistence(timeout: 3.0) {
                searchField.tap()
                searchField.clearAndEnterText("Pier 39")
                
                let firstResult = app.tables.cells.element(boundBy: 0)
                if firstResult.waitForExistence(timeout: 5.0) {
                    firstResult.tap()
                    
                    let confirmButton = app.buttons["Add to Itinerary"]
                    if confirmButton.waitForExistence(timeout: 3.0) {
                        confirmButton.tap()
                    }
                }
            }
        }
        
        // Navigate to map
        let mapTab = app.tabBars.buttons["Map"]
        _ = waitForElement(mapTab)
        mapTab.tap()
        
        // Test AC3 & AC4: Card swipe functionality with route updates
        let destinationCard = app.otherElements["DestinationCard"]
        XCTAssertTrue(destinationCard.waitForExistence(timeout: 5.0), "Destination card should exist")
        
        takeScreenshot(named: "Before Card Swipe")
        
        // Test swipe gesture (AC3: Map should fit both start and end points)
        measureUIPerformance {
            destinationCard.swipeLeft()
        }
        
        // Wait for debounced route calculation (300ms)
        Thread.sleep(forTimeInterval: 0.5)
        
        takeScreenshot(named: "After Card Swipe Left")
        
        // Test swipe back
        destinationCard.swipeRight()
        Thread.sleep(forTimeInterval: 0.5)
        
        takeScreenshot(named: "After Card Swipe Right")
        
        // Verify navigation dots indicate multiple waypoints
        let navigationDots = app.otherElements.matching(identifier: "NavigationDot")
        XCTAssertGreaterThan(navigationDots.count, 1, "Should have multiple navigation dots for multiple waypoints")
    }
    
    func testButtonVisualFeedback() throws {
        // Setup
        XCTAssertTrue(UITestUtils.performLogin(in: app))
        XCTAssertTrue(UITestUtils.createGroup(named: "Test Feedback Group", in: app))
        
        let mapTab = app.tabBars.buttons["Map"]
        _ = waitForElement(mapTab)
        mapTab.tap()
        
        // Test AC5: Visual feedback for button interactions
        let myLocationButton = app.buttons["location"]
        XCTAssertTrue(myLocationButton.waitForExistence(timeout: 5.0))
        
        // Test that button provides immediate visual feedback (scale effect, shadow change)
        // This is implicit in the UI - we verify the button responds immediately
        let initialButtonState = myLocationButton.isSelected
        
        myLocationButton.tap()
        
        // Verify button state changes immediately (within animation duration)
        Thread.sleep(forTimeInterval: 0.15) // Allow for 0.1s animation + buffer
        
        // The button should show visual feedback by changing to active state
        let activeLocationButton = app.buttons["location.fill"]
        let buttonChangedState = activeLocationButton.exists
        
        XCTAssertNotEqual(initialButtonState, buttonChangedState, "Button should provide immediate visual feedback")
    }
    
    func testPerformanceOfMapInteractions() throws {
        // Setup
        XCTAssertTrue(UITestUtils.performLogin(in: app))
        XCTAssertTrue(UITestUtils.createGroup(named: "Performance Test Group", in: app))
        
        let mapTab = app.tabBars.buttons["Map"]
        _ = waitForElement(mapTab)
        mapTab.tap()
        
        // Performance test: Rapid button taps should not cause issues
        let myLocationButton = app.buttons["location"]
        XCTAssertTrue(myLocationButton.waitForExistence(timeout: 5.0))
        
        measure(metrics: [XCTClockMetric(), XCTMemoryMetric()]) {
            for _ in 0..<5 {
                myLocationButton.tap()
                Thread.sleep(forTimeInterval: 0.2)
            }
        }
        
        // Verify app remains responsive
        XCTAssertTrue(myLocationButton.isHittable, "Button should remain responsive after rapid taps")
    }
}

// MARK: - Helper Extensions
extension XCUIElement {
    func clearAndEnterText(_ text: String) {
        guard self.exists else { return }
        
        self.tap()
        self.press(forDuration: 1.2)
        
        let selectAllMenuItem = XCUIApplication().menuItems["Select All"]
        if selectAllMenuItem.waitForExistence(timeout: 0.5) {
            selectAllMenuItem.tap()
            self.typeText(text)
        } else {
            // Fallback: clear by selecting all and typing
            self.coordinate(withNormalizedOffset: CGVector(dx: 0.0, dy: 0.0)).tap()
            let selectAllKey = "a"
            XCUIApplication().keys[selectAllKey].tap()
            self.typeText(text)
        }
    }
}