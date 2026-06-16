//
//  WidgetsLiveActivity.swift
//  Widgets
//
//  Created by Dillion on 2025/7/17.
//

import ActivityKit
import WidgetKit
import SwiftUI
import AppIntents

// MARK: - App Intent for Countdown Control

@available(iOS 16.0, *)
struct StartCountdownIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Start Countdown"
    static var description: LocalizedStringResource = "Start the 1-minute countdown timer"
    
    func perform() async throws -> some IntentResult {
        // This will be handled by the app when the Live Activity button is tapped
        // The actual countdown logic will be triggered via the URL scheme
        return .result()
    }
}

// MARK: - Helper Functions

func getStatusColor(status: String) -> Color {
    switch status {
    case "waiting":
        return .blue
    case "countdown":
        return .orange
    case "finished":
        return .green
    default:
        return .gray
    }
}

// MARK: - Activity Attributes (duplicated for Widget Extension)

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

// MARK: - Live Activity Widget

struct HitherGroupLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: HitherGroupAttributes.self) { context in
            // Lock screen/banner UI
            LockScreenActivityView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded UI regions
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Image(systemName: context.attributes.userRole == "leader" ? "crown.fill" : "person.fill")
                                .foregroundColor(context.attributes.userRole == "leader" ? .yellow : .blue)
                                .font(.caption)
                            
                            Text(context.attributes.groupName)
                                .font(.caption)
                                .fontWeight(.semibold)
                        }
                        
                        Text("\(context.state.memberCount) members")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
                
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        if let distance = context.state.currentDistance {
                            VStack(alignment: .trailing, spacing: 1) {
                                Text(context.state.formattedCurrentDistance)
                                    .font(.caption)
                                    .fontWeight(.bold)
                                    .foregroundColor(.blue)
                                
                                if let destination = context.state.destinationName {
                                    Text("to \(destination)")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                        .lineLimit(1)
                                } else {
                                    Text("distance")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                            }
                        } else {
                            VStack(alignment: .trailing, spacing: 1) {
                                Text(context.state.groupStatus.capitalized)
                                    .font(.caption)
                                    .fontWeight(.semibold)
                                    .foregroundColor(getStatusColor(status: context.state.groupStatus))
                                
                                Circle()
                                    .fill(getStatusColor(status: context.state.groupStatus))
                                    .frame(width: 6, height: 6)
                            }
                        }
                    }
                }
                
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        // Location progress if available
                        if let _ = context.state.currentDistance, let _ = context.state.totalDistance {
                            VStack(spacing: 4) {
                                HStack {
                                    Text("Progress to Destination")
                                        .font(.caption)
                                        .fontWeight(.semibold)
                                    
                                    Spacer()
                                    
                                    Text(context.state.formattedCurrentDistance)
                                        .font(.title3)
                                        .fontWeight(.bold)
                                        .foregroundColor(.blue)
                                }
                                
                                ProgressView(value: context.state.locationProgressPercentage / 100.0)
                                    .progressViewStyle(LinearProgressViewStyle(tint: .blue))
                            }
                        } else if context.state.isCountdownActive {
                            // Countdown progress
                            VStack(spacing: 4) {
                                HStack {
                                    Text("Countdown Timer")
                                        .font(.caption)
                                        .fontWeight(.semibold)
                                    
                                    Spacer()
                                    
                                    Text(context.state.formattedRemainingTime)
                                        .font(.title3)
                                        .fontWeight(.bold)
                                        .foregroundColor(.orange)
                                }
                                
                                ProgressView(value: context.state.progressPercentage / 100.0)
                                    .progressViewStyle(LinearProgressViewStyle(tint: .orange))
                            }
                        } else {
                            // Show group status and start button
                            VStack(spacing: 6) {
                                HStack {
                                    Text("Status: \(context.state.groupStatus.capitalized)")
                                        .font(.caption)
                                        .fontWeight(.semibold)
                                        .foregroundColor(getStatusColor(status: context.state.groupStatus))
                                    
                                    Spacer()
                                }
                                
                                Button(intent: StartCountdownIntent()) {
                                    HStack {
                                        Image(systemName: "timer")
                                            .font(.caption)
                                        
                                        Text("Start 1-Minute Timer")
                                            .font(.caption)
                                            .fontWeight(.semibold)
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 8)
                                    .background(Color.blue)
                                    .foregroundColor(.white)
                                    .cornerRadius(8)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        
                        if let message = context.state.message {
                            HStack {
                                Image(systemName: "info.circle")
                                    .foregroundColor(.blue)
                                    .font(.caption2)
                                
                                Text(message)
                                    .font(.caption2)
                                    .foregroundColor(.blue)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
                
            } compactLeading: {
                Image(systemName: context.attributes.userRole == "leader" ? "crown.fill" : "person.fill")
                    .foregroundColor(context.attributes.userRole == "leader" ? .yellow : .blue)
                    .font(.caption)
                
            } compactTrailing: {
                if let distance = context.state.currentDistance {
                    VStack(spacing: 1) {
                        Text(context.state.formattedCurrentDistance)
                            .font(.caption2)
                            .fontWeight(.bold)
                            .foregroundColor(.blue)
                        
                        Text("away")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                } else if context.state.isCountdownActive {
                    VStack(spacing: 1) {
                        Text(context.state.formattedRemainingTime)
                            .font(.caption2)
                            .fontWeight(.bold)
                            .foregroundColor(.orange)
                        
                        Text("timer")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                } else {
                    VStack(spacing: 1) {
                        Text(context.state.groupStatus)
                            .font(.caption2)
                            .fontWeight(.bold)
                            .foregroundColor(getStatusColor(status: context.state.groupStatus))
                        
                        Text("status")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
                
            } minimal: {
                Image(systemName: context.attributes.userRole == "leader" ? "crown.fill" : "person.fill")
                    .foregroundColor(context.attributes.userRole == "leader" ? .yellow : .blue)
            }
            .widgetURL(URL(string: "hither://group/\(context.attributes.groupId)"))
            .keylineTint(.blue)
        }
    }
    
    private func getBatteryIcon(level: Double) -> String {
        if level > 0.75 {
            return "battery.100"
        } else if level > 0.5 {
            return "battery.75"
        } else if level > 0.25 {
            return "battery.50"
        } else {
            return "battery.25"
        }
    }
    
    private func getBatteryColor(level: Double) -> Color {
        if level > 0.3 {
            return .green
        } else if level > 0.15 {
            return .orange
        } else {
            return .red
        }
    }
    
}

// MARK: - Lock Screen View

struct LockScreenActivityView: View {
    let context: ActivityViewContext<HitherGroupAttributes>
    
    var body: some View {
        HStack(spacing: 12) {
            // Left side - Group info
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Image(systemName: context.attributes.userRole == "leader" ? "crown.fill" : "person.fill")
                        .foregroundColor(context.attributes.userRole == "leader" ? .yellow : .blue)
                        .font(.subheadline)
                    
                    Text(context.attributes.groupName)
                        .font(.headline)
                        .fontWeight(.semibold)
                        .lineLimit(1)
                }
                
                Text("\(context.state.memberCount) members • \(context.state.leaderName)")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                
                if let message = context.state.message {
                    HStack(spacing: 4) {
                        Image(systemName: "info.circle.fill")
                            .foregroundColor(.blue)
                            .font(.caption2)
                        
                        Text(message)
                            .font(.caption)
                            .foregroundColor(.blue)
                            .lineLimit(1)
                    }
                }
            }
            
            Spacer()
            
            // Right side - Distance and status info
            VStack(alignment: .trailing, spacing: 4) {
                if let distance = context.state.currentDistance {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(context.state.formattedCurrentDistance)
                            .font(.title2)
                            .fontWeight(.bold)
                            .foregroundColor(.blue)
                        
                        if let destination = context.state.destinationName {
                            Text("to \(destination)")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                        } else {
                            Text("Distance")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                } else if context.state.isCountdownActive {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(context.state.formattedRemainingTime)
                            .font(.title2)
                            .fontWeight(.bold)
                            .foregroundColor(.orange)
                        
                        Text("Time Left")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                } else {
                    Button(intent: StartCountdownIntent()) {
                        VStack(alignment: .trailing, spacing: 2) {
                            Image(systemName: "timer")
                                .font(.title2)
                                .foregroundColor(.blue)
                            
                            Text("Start Timer")
                                .font(.caption)
                                .foregroundColor(.blue)
                        }
                    }
                    .buttonStyle(.plain)
                }
                
                // Status indicator
                HStack(spacing: 4) {
                    Circle()
                        .fill(getStatusColor(status: context.state.groupStatus))
                        .frame(width: 6, height: 6)
                    
                    Text(context.state.groupStatus.capitalized)
                        .font(.caption2)
                        .foregroundColor(getStatusColor(status: context.state.groupStatus))
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.black.opacity(0.05))
    }
}

// MARK: - Previews

extension HitherGroupAttributes {
    fileprivate static var preview: HitherGroupAttributes {
        HitherGroupAttributes(
            groupName: "Adventure Group",
            groupId: "preview-group-id",
            userRole: "follower",
            activityType: "countdown"
        )
    }
    
    fileprivate static var leaderPreview: HitherGroupAttributes {
        HitherGroupAttributes(
            groupName: "Team Alpha",
            groupId: "leader-group-id",
            userRole: "leader",
            activityType: "countdown"
        )
    }
}

extension HitherGroupAttributes.ContentState {
    fileprivate static var waiting: HitherGroupAttributes.ContentState {
        HitherGroupAttributes.ContentState(
            currentDistance: nil,
            totalDistance: nil,
            destinationName: nil,
            groupStatus: "waiting",
            memberCount: 3,
            leaderName: "Alex",
            isCountdownActive: false,
            countdownStartTime: nil,
            countdownDuration: 60.0,
            message: "Ready to start"
        )
    }
    
    fileprivate static var going: HitherGroupAttributes.ContentState {
        HitherGroupAttributes.ContentState(
            currentDistance: 750.0,
            totalDistance: 1500.0,
            destinationName: "Central Park",
            groupStatus: "going",
            memberCount: 3,
            leaderName: "Alex",
            isCountdownActive: false,
            countdownStartTime: nil,
            countdownDuration: 60.0,
            message: "On our way"
        )
    }
    
    fileprivate static var rest: HitherGroupAttributes.ContentState {
        HitherGroupAttributes.ContentState(
            currentDistance: 250.0,
            totalDistance: 1500.0,
            destinationName: "Museum",
            groupStatus: "rest",
            memberCount: 3,
            leaderName: "Alex",
            isCountdownActive: false,
            countdownStartTime: nil,
            countdownDuration: 60.0,
            message: "Taking a break"
        )
    }
    
    fileprivate static var countdown: HitherGroupAttributes.ContentState {
        HitherGroupAttributes.ContentState(
            currentDistance: 300.0,
            totalDistance: 1500.0,
            destinationName: "Restaurant",
            groupStatus: "going",
            memberCount: 3,
            leaderName: "Alex",
            isCountdownActive: true,
            countdownStartTime: Date().addingTimeInterval(-30), // 30 seconds ago
            countdownDuration: 60.0,
            message: "Timer is running"
        )
    }
}

#Preview("Navigation Activity", as: .content, using: HitherGroupAttributes.preview) {
   HitherGroupLiveActivity()
} contentStates: {
    HitherGroupAttributes.ContentState.waiting
    HitherGroupAttributes.ContentState.going
    HitherGroupAttributes.ContentState.rest
    HitherGroupAttributes.ContentState.countdown
}

#Preview("Leader Navigation", as: .content, using: HitherGroupAttributes.leaderPreview) {
   HitherGroupLiveActivity()
} contentStates: {
    HitherGroupAttributes.ContentState.waiting
    HitherGroupAttributes.ContentState.going
    HitherGroupAttributes.ContentState.countdown
}
