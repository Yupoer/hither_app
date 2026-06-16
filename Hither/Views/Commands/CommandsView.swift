//
//  CommandsView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI
import CoreLocation
import UserNotifications

struct CommandsView: View {
    @EnvironmentObject private var groupService: GroupService
    @EnvironmentObject private var authService: AuthenticationService
    @StateObject private var commandService = CommandService()
    @StateObject private var locationService = LocationService()
    @State private var customMessage = ""
    @State private var showingCustomMessageSheet = false
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let group = groupService.currentGroup,
                   let user = authService.currentUser,
                   group.leader?.userId == user.id {
                    
                    // Leader interface
                    leaderCommandInterface(group: group, user: user)
                    
                } else {
                    // Follower interface
                    followerCommandInterface()
                }
                
                Divider()
                
                // Command history for both roles
                commandHistorySection()
            }
            .navigationTitle("commands".localized)
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                setupCommandService()
                setupNotifications()
            }
            .sheet(isPresented: $showingCustomMessageSheet) {
                customMessageSheet()
            }
        }
    }
    
    @ViewBuilder
    private func leaderCommandInterface(group: HitherGroup, user: HitherUser) -> some View {
        VStack(spacing: 24) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 2), spacing: 16) {
                ForEach(CommandType.leaderCommands.filter { $0 != .custom }, id: \.self) { commandType in
                    CommandButton(
                        type: commandType,
                        action: {
                            Task {
                                await sendQuickCommand(
                                    type: commandType,
                                    group: group,
                                    user: user
                                )
                            }
                        }
                    )
                }
                
                // Enhanced custom message button with claude design
                DarkBlueButton(variant: .secondary, action: {
                    showingCustomMessageSheet = true
                }) {
                    VStack(spacing: 8) {
                        Image(systemName: CommandType.custom.icon)
                            .font(.title2)
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [.purple, .pink],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )
                        
                        Text(CommandType.custom.displayName)
                            .font(.caption)
                            .fontWeight(.medium)
                    }
                    .frame(height: 60)
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 16)
            
            // Status indicators with liquid glass treatment
            if commandService.isLoading {
                VStack(spacing: 12) {
                    SheepLoadingView(message: "sending_command".localized)
                }
                .padding(16)
                .darkBlueCard(cornerRadius: 16)
                .padding(.horizontal, 16)
            }
            
            if let errorMessage = commandService.errorMessage {
                Text(errorMessage)
                    .foregroundColor(.red)
                    .font(.caption)
                    .fontWeight(.medium)
                    .multilineTextAlignment(.center)
                    .padding(12)
                    .darkBlueCard(cornerRadius: 12)
                    .padding(.horizontal, 16)
            }
        }
        .padding(.bottom, 20)
    }
    
    @ViewBuilder
    private func followerCommandInterface() -> some View {
        VStack(spacing: 24) {
            // Header with liquid glass treatment
            VStack(spacing: 8) {
                Text("send_requests_to_leader".localized)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.orange, .yellow],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                
                Text("communicate_needs_leader".localized)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            .padding(.top, 20)
            .darkBlueCard(cornerRadius: 16)
            .padding(.horizontal, 16)
            
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 2), spacing: 16) {
                ForEach(CommandType.followerRequests, id: \.self) { commandType in
                    CommandButton(
                        type: commandType,
                        action: {
                            Task {
                                guard let group = groupService.currentGroup,
                                      let user = authService.currentUser else { return }
                                await sendQuickCommand(
                                    type: commandType,
                                    group: group,
                                    user: user
                                )
                            }
                        }
                    )
                }
                
                // Enhanced custom request button with claude design
                DarkBlueButton(variant: .secondary, action: {
                    showingCustomMessageSheet = true
                }) {
                    VStack(spacing: 8) {
                        Image(systemName: CommandType.custom.icon)
                            .font(.title2)
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [.orange, .yellow],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )
                        
                        Text("custom_request".localized)
                            .font(.caption)
                            .fontWeight(.medium)
                    }
                    .frame(height: 60)
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 16)
            
            // Status indicators with liquid glass treatment
            if commandService.isLoading {
                VStack(spacing: 12) {
                    SheepLoadingView(message: "sending_request".localized)
                }
                .padding(16)
                .darkBlueCard(cornerRadius: 16)
                .padding(.horizontal, 16)
            }
            
            if let errorMessage = commandService.errorMessage {
                Text(errorMessage)
                    .foregroundColor(.red)
                    .font(.caption)
                    .fontWeight(.medium)
                    .multilineTextAlignment(.center)
                    .padding(12)
                    .darkBlueCard(cornerRadius: 12)
                    .padding(.horizontal, 16)
            }
        }
        .padding(.bottom, 20)
    }
    
    @ViewBuilder
    private func commandHistorySection() -> some View {
        VStack(alignment: .leading, spacing: 16) {
            // Enhanced header with liquid glass treatment
            HStack {
                Text("recent_commands".localized)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.primary, .secondary],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                
                Spacer()
                
                if !commandService.recentCommands.isEmpty {
                    Text("\(commandService.recentCommands.count)")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            LinearGradient(
                                colors: [.blue, .purple],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .cornerRadius(12)
                        .shadow(color: Color.blue.opacity(0.3), radius: 4, y: 2)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .darkBlueCard(cornerRadius: 16)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            
            if commandService.recentCommands.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "tray")
                        .font(.system(size: 50))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.gray.opacity(0.6), .gray.opacity(0.4)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                    
                    Text("no_commands_yet".localized)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
                .darkBlueCard(cornerRadius: 20)
                .padding(.horizontal, 16)
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(commandService.recentCommands) { command in
                            CommandHistoryCard(command: command)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .frame(minHeight: 200)
            }
        }
    }
    
    @ViewBuilder
    private func customMessageSheet() -> some View {
        let isLeader = groupService.currentGroup?.leader?.userId == authService.currentUser?.id
        
        NavigationView {
            VStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(isLeader ? "custom_command".localized : "custom_request".localized)
                        .font(.headline)
                    
                    Text(isLeader ? "send_custom_command_subtitle".localized : "send_custom_request_subtitle".localized)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                
                TextField(isLeader ? "enter_command_placeholder".localized : "enter_request_placeholder".localized, text: $customMessage, axis: .vertical)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .lineLimit(3...6)
                
                Spacer()
                
                Button(action: {
                    Task {
                        guard let group = groupService.currentGroup,
                              let user = authService.currentUser else { return }
                        
                        await commandService.sendCustomCommand(
                            message: customMessage,
                            groupId: group.id,
                            groupName: group.name,
                            senderId: user.id,
                            senderName: user.displayName,
                            currentLocation: getCurrentLocation()
                        )
                        
                        customMessage = ""
                        showingCustomMessageSheet = false
                    }
                }) {
                    Text(isLeader ? "send_command".localized : "send_request".localized)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(customMessage.isEmpty ? Color.gray : (isLeader ? Color.blue : Color.orange))
                        .foregroundColor(.white)
                        .cornerRadius(8)
                }
                .disabled(customMessage.isEmpty || commandService.isLoading)
            }
            .padding()
            .navigationTitle(isLeader ? "custom_command".localized : "custom_request".localized)
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarItems(
                leading: Button("cancel".localized) {
                    showingCustomMessageSheet = false
                    customMessage = ""
                }
            )
        }
    }
    
    private func setupCommandService() {
        guard let group = groupService.currentGroup,
              let user = authService.currentUser else { return }
        commandService.startListeningToCommands(groupId: group.id)
        commandService.startListeningToNotifications(groupId: group.id, userId: user.id)
    }
    
    private func setupNotifications() {
        commandService.setupNotificationCategories()
        Task {
            await commandService.requestNotificationPermission()
            
            // Debug: Check notification permission status
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            print("🔔 Notification permission status: \(settings.authorizationStatus)")
            
            if settings.authorizationStatus != .authorized {
                print("⚠️ Notifications not authorized - followers may not receive command notifications")
            }
        }
    }
    
    private func sendQuickCommand(type: CommandType, group: HitherGroup, user: HitherUser) async {
        await commandService.sendQuickCommand(
            type: type,
            groupId: group.id,
            groupName: group.name,
            senderId: user.id,
            senderName: user.displayName,
            currentLocation: getCurrentLocation()
        )
    }
    
    private func getCurrentLocation() -> GeoPoint? {
        guard let location = locationService.currentLocation else { return nil }
        return GeoPoint(from: location.coordinate)
    }
}

struct CommandButton: View {
    let type: CommandType
    let action: () -> Void
    
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        let theme = DarkBlueTheme(isDark: colorScheme == .dark)
        
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: type.icon)
                    .font(.title2)
                    .foregroundColor(theme.primary)
                    .shadow(color: theme.primary.opacity(0.3), radius: 4, y: 2)
                
                Text(type.displayName)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundColor(theme.foreground)
            }
            .frame(height: 60)
            .frame(maxWidth: .infinity)
            .background(theme.card)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(theme.border, lineWidth: 1)
            )
            .shadow(
                color: theme.shadowColor,
                radius: 4,
                y: 2
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
    
}

struct CommandHistoryCard: View {
    let command: GroupCommand
    @State private var currentTime = Date()
    
    var body: some View {
        HStack(spacing: 16) {
            // Enhanced icon with glass treatment
            VStack {
                ZStack {
                    Circle()
                        .fill(.ultraThinMaterial)
                        .frame(width: 40, height: 40)
                        .overlay(
                            Circle()
                                .stroke(
                                    LinearGradient(
                                        colors: [getIconColor().opacity(0.4), getIconColor().opacity(0.2)],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    ),
                                    lineWidth: 1.5
                                )
                        )
                        .shadow(color: getIconColor().opacity(0.2), radius: 6, y: 3)
                    
                    Image(systemName: command.type.icon)
                        .font(.title3)
                        .foregroundStyle(
                            LinearGradient(
                                colors: [getIconColor(), getIconColor().opacity(0.8)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                }
                
                Spacer()
            }
            
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(command.senderName)
                        .font(.headline)
                        .fontWeight(.semibold)
                        .foregroundColor(.primary)
                    
                    Spacer()
                    
                    Text(formatTimestamp(command.timestamp))
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.ultraThinMaterial)
                        .cornerRadius(8)
                }
                
                Text(command.message)
                    .font(.body)
                    .foregroundColor(.primary)
                    .multilineTextAlignment(.leading)
                
                if command.type != .custom {
                    Text(command.type.displayName)
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(
                            LinearGradient(
                                colors: [getIconColor(), getIconColor().opacity(0.8)],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .cornerRadius(8)
                        .shadow(color: getIconColor().opacity(0.3), radius: 4, y: 2)
                }
            }
            
            Spacer()
        }
        .padding(16)
        .darkBlueCard(cornerRadius: 16)
        .onAppear {
            currentTime = Date()
        }
        .onReceive(Timer.publish(every: 30, on: .main, in: .common).autoconnect()) { _ in
            currentTime = Date()
        }
    }
    
    private func getIconColor() -> Color {
        switch command.type {
        // Leader commands
        case .gather: return .blue
        case .depart: return .green
        case .rest: return .orange
        case .beCareful: return .red
        case .goLeft, .goRight: return .purple
        case .stop: return .red
        case .hurryUp: return .yellow
        case .custom: return .gray
        
        // Follower requests
        case .needRestroom: return .orange
        case .needBreak: return .yellow
        case .needHelp: return .red
        case .foundSomething: return .green
        }
    }
    
    private func formatTimestamp(_ timestamp: Date) -> String {
        let formatter = DateFormatter()
        let now = Date()
        let timeInterval = now.timeIntervalSince(timestamp)
        
        if timeInterval < 60 {
            return "now".localized
        } else if timeInterval < 3600 {
            return String(format: "minutes_ago_simple".localized, Int(timeInterval / 60))
        } else if Calendar.current.isDate(timestamp, inSameDayAs: now) {
            formatter.dateFormat = "HH:mm"
            return formatter.string(from: timestamp)
        } else {
            formatter.dateFormat = "MMM d, HH:mm"
            return formatter.string(from: timestamp)
        }
    }
}

