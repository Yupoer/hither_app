//
//  ActivityAttributes.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation
import ActivityKit
import UIKit

// MARK: - Activity Attributes (shared between App and Widget Extension)

struct HitherGroupAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // Location progress
        let currentDistance: Double? // Distance to destination in meters
        let totalDistance: Double? // Total distance when started
        let destinationName: String? // Name of current destination
        
        // Group status
        let groupStatus: String // "going", "stop", "rest", "waiting", "arrived"
        let memberCount: Int
        let leaderName: String
        
        // Countdown state (optional for timed activities)
        let isCountdownActive: Bool
        let countdownStartTime: Date?
        let countdownDuration: TimeInterval // in seconds (60 for 1 minute)
        
        // Optional message
        let message: String?
        
        // Computed properties for countdown
        var remainingTime: TimeInterval {
            guard isCountdownActive,
                  let startTime = countdownStartTime else {
                return 0
            }
            
            let elapsed = Date().timeIntervalSince(startTime)
            return max(0, countdownDuration - elapsed)
        }
        
        var isCountdownFinished: Bool {
            return isCountdownActive && remainingTime <= 0
        }
        
        var formattedRemainingTime: String {
            let minutes = Int(remainingTime) / 60
            let seconds = Int(remainingTime) % 60
            return String(format: "%02d:%02d", minutes, seconds)
        }
        
        var progressPercentage: Double {
            guard countdownDuration > 0 else { return 0 }
            let elapsed = countdownDuration - remainingTime
            return (elapsed / countdownDuration) * 100
        }
        
        // Location progress computed properties
        var locationProgressPercentage: Double {
            guard let current = currentDistance,
                  let total = totalDistance,
                  total > 0 else { return 0 }
            
            let traveled = total - current
            return max(0, min(100, (traveled / total) * 100))
        }
        
        var formattedCurrentDistance: String {
            guard let distance = currentDistance else { return "Unknown" }
            if distance < 1000 {
                return String(format: "%.0f m", distance)
            } else {
                return String(format: "%.1f km", distance / 1000)
            }
        }
        
        var statusColor: String {
            switch groupStatus {
            case "going": return "blue"
            case "stop": return "red"
            case "rest": return "orange"
            case "waiting": return "gray"
            case "arrived": return "green"
            default: return "gray"
            }
        }
    }

    // Fixed properties about the activity
    let groupName: String
    let groupId: String
    let userRole: String // "leader" or "follower"
    let activityType: String // "countdown", "navigation", etc.
}