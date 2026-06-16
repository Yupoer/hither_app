//
//  LiveActivityService.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation
import ActivityKit
import WidgetKit
import SwiftUI
import UIKit

@available(iOS 16.1, *)
@MainActor
class LiveActivityService: ObservableObject {
    @Published var currentActivity: Any?
    @Published var isSupported = ActivityAuthorizationInfo().areActivitiesEnabled
    @Published var errorMessage: String?
    
    private var groupId: String?
    private var userId: String?
    
    func startNavigationLiveActivity(
        groupName: String,
        groupId: String,
        userId: String,
        userRole: String,
        leaderName: String,
        memberCount: Int,
        destinationName: String? = nil,
        currentDistance: Double? = nil,
        totalDistance: Double? = nil,
        groupStatus: String = "waiting",
        message: String? = nil
    ) async {
        // Check permissions first
        await requestPermission()
        
        // Allow Live Activities for single user groups on real devices
        guard ActivityAuthorizationInfo().areActivitiesEnabled || isSimulator() else {
            errorMessage = "Live Activities are not enabled in Settings"
            print("Live Activities not enabled")
            return
        }
        
        // Skip Live Activity creation on simulator but log it
        if isSimulator() {
            print("⚠️ Skipping Live Activity creation on Simulator")
            print("📱 Live Activity would show countdown for \(groupName) (\(memberCount) member\(memberCount == 1 ? "" : "s"))")
            return
        }
        
        // Stop any existing activity first
        await stopLiveActivity()
        
        print("Starting Countdown Live Activity for group: \(groupName)")
        
        let attributes = HitherGroupAttributes(
            groupName: groupName,
            groupId: groupId,
            userRole: userRole,
            activityType: "navigation"
        )
        
        let initialState = HitherGroupAttributes.ContentState(
            currentDistance: currentDistance,
            totalDistance: totalDistance,
            destinationName: destinationName,
            groupStatus: groupStatus,
            memberCount: memberCount,
            leaderName: leaderName,
            isCountdownActive: false,
            countdownStartTime: nil,
            countdownDuration: 60.0, // 1 minute
            message: message
        )
        
        let content = ActivityContent(
            state: initialState,
            staleDate: Calendar.current.date(byAdding: .hour, value: 2, to: Date())
        )
        
        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
            
            self.currentActivity = activity
            print("✅ Successfully started Countdown Live Activity for: \(groupName)")
            print("Activity ID: \(activity.id)")
            
        } catch {
            errorMessage = "Failed to start waypoint Live Activity: \(error.localizedDescription)"
            print("❌ Live Activity error: \(error)")
            
            // Additional error details
            print("Error details: \(error)")
            print("Error type: \(type(of: error))")
            
            // Check common error conditions
            let errorDescription = error.localizedDescription
            if errorDescription.contains("not enabled") || errorDescription.contains("disabled") {
                print("Live Activities are disabled in Settings")
            } else if errorDescription.contains("limit") {
                print("Live Activity limit exceeded")
            } else if errorDescription.contains("permission") {
                print("Live Activity permission denied")
            }
        }
    }
    
    func updateLocationProgress(currentDistance: Double, totalDistance: Double? = nil, destinationName: String? = nil) async {
        guard let activity = currentActivity as? Activity<HitherGroupAttributes> else { 
            print("❌ No active Live Activity to update")
            return 
        }
        
        let currentState = activity.content.state
        let newState = HitherGroupAttributes.ContentState(
            currentDistance: currentDistance,
            totalDistance: totalDistance ?? currentState.totalDistance,
            destinationName: destinationName ?? currentState.destinationName,
            groupStatus: currentState.groupStatus,
            memberCount: currentState.memberCount,
            leaderName: currentState.leaderName,
            isCountdownActive: currentState.isCountdownActive,
            countdownStartTime: currentState.countdownStartTime,
            countdownDuration: currentState.countdownDuration,
            message: currentState.message
        )
        
        let content = ActivityContent(
            state: newState,
            staleDate: Calendar.current.date(byAdding: .minute, value: 2, to: Date())
        )
        
        do {
            await activity.update(content)
            print("✅ Successfully updated location progress: \(currentDistance)m")
        } catch {
            errorMessage = "Failed to update location progress: \(error.localizedDescription)"
            print("❌ Failed to update location progress: \(error)")
        }
    }
    
    func updateGroupStatus(_ status: String, message: String? = nil) async {
        guard let activity = currentActivity as? Activity<HitherGroupAttributes> else { 
            print("❌ No active Live Activity to update status")
            return 
        }
        
        let currentState = activity.content.state
        let newState = HitherGroupAttributes.ContentState(
            currentDistance: currentState.currentDistance,
            totalDistance: currentState.totalDistance,
            destinationName: currentState.destinationName,
            groupStatus: status,
            memberCount: currentState.memberCount,
            leaderName: currentState.leaderName,
            isCountdownActive: currentState.isCountdownActive,
            countdownStartTime: currentState.countdownStartTime,
            countdownDuration: currentState.countdownDuration,
            message: message ?? currentState.message
        )
        
        let content = ActivityContent(
            state: newState,
            staleDate: Calendar.current.date(byAdding: .minute, value: 2, to: Date())
        )
        
        do {
            await activity.update(content)
            print("✅ Successfully updated group status: \(status)")
        } catch {
            errorMessage = "Failed to update group status: \(error.localizedDescription)"
            print("❌ Failed to update group status: \(error)")
        }
    }
    
    func startCountdown() async {
        guard let activity = currentActivity as? Activity<HitherGroupAttributes> else { 
            print("❌ No active Live Activity to start countdown")
            return 
        }
        
        let currentState = activity.content.state
        let newState = HitherGroupAttributes.ContentState(
            currentDistance: currentState.currentDistance,
            totalDistance: currentState.totalDistance,
            destinationName: currentState.destinationName,
            groupStatus: currentState.groupStatus,
            memberCount: currentState.memberCount,
            leaderName: currentState.leaderName,
            isCountdownActive: true,
            countdownStartTime: Date(),
            countdownDuration: 60.0, // 1 minute
            message: "Countdown started!"
        )
        
        let content = ActivityContent(
            state: newState,
            staleDate: Calendar.current.date(byAdding: .minute, value: 2, to: Date())
        )
        
        do {
            await activity.update(content)
            print("✅ Successfully started 1-minute countdown")
            
            // Schedule countdown completion check
            Task {
                try await Task.sleep(nanoseconds: 61_000_000_000) // 61 seconds
                await finishCountdown()
            }
        } catch {
            errorMessage = "Failed to start countdown: \(error.localizedDescription)"
            print("❌ Failed to start countdown: \(error)")
        }
    }
    
    func finishCountdown() async {
        guard let activity = currentActivity as? Activity<HitherGroupAttributes> else { return }
        
        let currentState = activity.content.state
        let newState = HitherGroupAttributes.ContentState(
            currentDistance: currentState.currentDistance,
            totalDistance: currentState.totalDistance,
            destinationName: currentState.destinationName,
            groupStatus: currentState.groupStatus,
            memberCount: currentState.memberCount,
            leaderName: currentState.leaderName,
            isCountdownActive: false,
            countdownStartTime: currentState.countdownStartTime,
            countdownDuration: currentState.countdownDuration,
            message: "Countdown completed!"
        )
        
        let content = ActivityContent(
            state: newState,
            staleDate: Calendar.current.date(byAdding: .hour, value: 1, to: Date())
        )
        
        do {
            await activity.update(content)
            print("✅ Countdown finished")
        } catch {
            errorMessage = "Failed to finish countdown: \(error.localizedDescription)"
            print("❌ Failed to finish countdown: \(error)")
        }
    }
    
    func resetCountdown() async {
        guard let activity = currentActivity as? Activity<HitherGroupAttributes> else { return }
        
        let currentState = activity.content.state
        let newState = HitherGroupAttributes.ContentState(
            currentDistance: currentState.currentDistance,
            totalDistance: currentState.totalDistance,
            destinationName: currentState.destinationName,
            groupStatus: currentState.groupStatus,
            memberCount: currentState.memberCount,
            leaderName: currentState.leaderName,
            isCountdownActive: false,
            countdownStartTime: nil,
            countdownDuration: 60.0,
            message: "Ready to start countdown"
        )
        
        let content = ActivityContent(
            state: newState,
            staleDate: Calendar.current.date(byAdding: .hour, value: 2, to: Date())
        )
        
        do {
            await activity.update(content)
            print("✅ Countdown reset")
        } catch {
            errorMessage = "Failed to reset countdown: \(error.localizedDescription)"
            print("❌ Failed to reset countdown: \(error)")
        }
    }
    
    func stopLiveActivity() async {
        guard let activity = currentActivity else { 
            print("No Live Activity to stop")
            return 
        }
        
        do {
            if let hitherActivity = activity as? Activity<HitherGroupAttributes> {
                await hitherActivity.end(dismissalPolicy: .immediate)
                currentActivity = nil
                print("✅ Successfully stopped Live Activity")
            }
        } catch {
            errorMessage = "Failed to stop Live Activity: \(error.localizedDescription)"
            print("❌ Stop Live Activity error: \(error)")
        }
    }
    
    func endLiveActivity() async {
        guard let activity = currentActivity as? Activity<HitherGroupAttributes> else { return }
        
        let currentState = activity.content.state
        let finalState = HitherGroupAttributes.ContentState(
            currentDistance: currentState.currentDistance,
            totalDistance: currentState.totalDistance,
            destinationName: currentState.destinationName,
            groupStatus: "finished",
            memberCount: currentState.memberCount,
            leaderName: currentState.leaderName,
            isCountdownActive: false,
            countdownStartTime: currentState.countdownStartTime,
            countdownDuration: currentState.countdownDuration,
            message: "Group session ended"
        )
        
        do {
            await activity.end(.init(state: finalState, staleDate: nil), dismissalPolicy: .immediate)
            currentActivity = nil
        } catch {
            errorMessage = "Failed to end Live Activity: \(error.localizedDescription)"
        }
    }
    
    func requestPermission() async {
        // Check ActivityKit support and permissions
        let authInfo = ActivityAuthorizationInfo()
        isSupported = authInfo.areActivitiesEnabled
        
        print("🔍 Live Activity Permission Check:")
        print("- areActivitiesEnabled: \(authInfo.areActivitiesEnabled)")
        print("- iOS Version: \(UIDevice.current.systemVersion)")
        print("- Device Model: \(UIDevice.current.model)")
        print("- Is Simulator: \(isSimulator())")
        
        // On simulator, Live Activities are not supported
        if isSimulator() {
            errorMessage = "Live Activities are not supported on Simulator"
            print("⚠️ Live Activities not supported on Simulator - use physical device")
            isSupported = false
        } else if !isSupported {
            errorMessage = "Live Activities are disabled in Settings"
            print("❌ Live Activities not supported or disabled")
        } else {
            print("✅ Live Activities are supported and enabled")
        }
    }
    
    private func isSimulator() -> Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }
    
    // Simple test method to verify Live Activity works
    func startTestLiveActivity() async {
        await startNavigationLiveActivity(
            groupName: "Test Group",
            groupId: "test-group",
            userId: "test-user",
            userRole: "leader",
            leaderName: "Test Leader",
            memberCount: 1,
            destinationName: "Test Destination",
            currentDistance: 500.0,
            totalDistance: 1000.0,
            groupStatus: "going",
            message: "Test navigation activity"
        )
    }
    
    // Start Live Activity for single user (solo mode)
    func startSoloLiveActivity(
        groupName: String,
        groupId: String,
        userId: String,
        userName: String
    ) async {
        print("🚀 Starting Solo Navigation Live Activity for: \(userName)")
        
        await startNavigationLiveActivity(
            groupName: groupName,
            groupId: groupId,
            userId: userId,
            userRole: "leader",
            leaderName: userName,
            memberCount: 1,
            groupStatus: "waiting",
            message: "Solo navigation ready"
        )
    }
}


