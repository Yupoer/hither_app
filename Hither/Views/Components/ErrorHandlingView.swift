//
//  ErrorHandlingView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct ErrorBanner: View {
    let message: String
    let onDismiss: () -> Void
    
    var body: some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.red)
            
            Text(message)
                .font(.caption)
                .foregroundColor(.red)
                .multilineTextAlignment(.leading)
            
            Spacer()
            
            Button(action: onDismiss) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.red.opacity(0.7))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.red.opacity(0.1))
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.red.opacity(0.3), lineWidth: 1)
        )
    }
}

struct ConnectionStatusView: View {
    @ObservedObject var locationService: LocationService
    @EnvironmentObject var notificationService: NotificationService
    
    var body: some View {
        VStack(spacing: 8) {
            // Status indicators in a box
            HStack(spacing: 12) {
                // Location status
                HStack(spacing: 4) {
                    Circle()
                        .fill(locationService.isTracking ? Color.green : Color.red)
                        .frame(width: 8, height: 8)
                    
                    Text("Location")
                        .font(.caption)
                        .foregroundColor(locationService.isTracking ? .green : .red)
                }
                
                // Notification status
                HStack(spacing: 4) {
                    Circle()
                        .fill(notificationService.isEnabled ? Color.green : Color.orange)
                        .frame(width: 8, height: 8)
                    
                    Text("Notifications")
                        .font(.caption)
                        .foregroundColor(notificationService.isEnabled ? .green : .orange)
                }
                
                Spacer()
                
                // Battery level
                batteryIndicator
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(.systemBackground))
            .cornerRadius(8)
            .shadow(color: Color.black.opacity(0.1), radius: 2)
            
            // Error messages
            if let locationError = locationService.errorMessage {
                ErrorBanner(message: locationError) {
                    locationService.errorMessage = nil
                }
            }
            
            if let notificationError = notificationService.errorMessage {
                ErrorBanner(message: notificationError) {
                    notificationService.errorMessage = nil
                }
            }
        }
        .padding(.horizontal)
    }
    
    @ViewBuilder
    private var batteryIndicator: some View {
        let batteryLevel = UIDevice.current.batteryLevel
        let batteryState = UIDevice.current.batteryState
        
        if batteryLevel >= 0 { // -1 means unknown
            HStack(spacing: 4) {
                Image(systemName: getBatteryIcon(level: batteryLevel, state: batteryState))
                    .foregroundColor(getBatteryColor(level: batteryLevel))
                    .font(.caption)
                
                Text("\(Int(batteryLevel * 100))%")
                    .font(.caption2)
                    .foregroundColor(getBatteryColor(level: batteryLevel))
            }
        }
    }
    
    private func getBatteryIcon(level: Float, state: UIDevice.BatteryState) -> String {
        if state == .charging {
            return "battery.100.bolt"
        }
        
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
    
    private func getBatteryColor(level: Float) -> Color {
        if level > 0.3 {
            return .green
        } else if level > 0.15 {
            return .orange
        } else {
            return .red
        }
    }
}

struct RetryButton: View {
    let title: String
    let action: () async -> Void
    @State private var isLoading = false
    
    var body: some View {
        Button(action: {
            Task {
                isLoading = true
                await action()
                isLoading = false
            }
        }) {
            HStack {
                if isLoading {
                    SheepLoadingView()
                        .scaleEffect(0.4)
                } else {
                    Image(systemName: "arrow.clockwise")
                }
                
                Text(title)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(Color.blue)
            .foregroundColor(.white)
            .cornerRadius(8)
        }
        .disabled(isLoading)
    }
}

struct PermissionRequestView: View {
    let title: String
    let message: String
    let icon: String
    let buttonTitle: String
    let action: () async -> Void
    
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: icon)
                .font(.system(size: 60))
                .foregroundColor(.blue)
            
            VStack(spacing: 8) {
                Text(title)
                    .font(.title2)
                    .fontWeight(.semibold)
                    .multilineTextAlignment(.center)
                
                Text(message)
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
            
            Button(action: {
                Task {
                    await action()
                }
            }) {
                Text(buttonTitle)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(8)
            }
            
            Button("Open Settings") {
                if let settingsUrl = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(settingsUrl)
                }
            }
            .foregroundColor(.blue)
        }
        .padding()
    }
}

struct LoadingStateView: View {
    let message: String
    
    var body: some View {
        VStack(spacing: 16) {
            SheepLoadingView(message: message)
                .scaleEffect(1.2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.gray.opacity(0.05))
    }
}

struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String
    let buttonTitle: String?
    let action: (() -> Void)?
    
    init(icon: String, title: String, message: String, buttonTitle: String? = nil, action: (() -> Void)? = nil) {
        self.icon = icon
        self.title = title
        self.message = message
        self.buttonTitle = buttonTitle
        self.action = action
    }
    
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: icon)
                .font(.system(size: 60))
                .foregroundColor(.gray)
            
            VStack(spacing: 8) {
                Text(title)
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)
                
                Text(message)
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
            
            if let buttonTitle = buttonTitle, let action = action {
                Button(action: action) {
                    Text(buttonTitle)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}