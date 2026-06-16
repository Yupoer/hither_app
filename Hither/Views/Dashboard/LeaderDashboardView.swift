//
//  LeaderDashboardView.swift
//  Hither
//
//  Created by Dillion on 2025/8/4.
//

import SwiftUI

struct LeaderDashboardView: View {
    @EnvironmentObject private var authService: AuthenticationService
    @EnvironmentObject private var groupService: GroupService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    @StateObject private var commandService = CommandService()
    
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Group Status Section
                GroupStatusSection()
                    .environmentObject(groupService)
                
                // Quick Commands Section  
                QuickCommandsSection(commandService: commandService)
                    .environmentObject(authService)
                    .environmentObject(groupService)
                
                // Quick Actions Section
                QuickActionsSection()
                    .environmentObject(authService)
                    .environmentObject(groupService)
            }
            .padding()
        }
        .onAppear {
            // Ensure the command service is listening to the current group
            if let currentGroup = groupService.currentGroup {
                commandService.startListeningToCommands(groupId: currentGroup.id)
            }
        }
    }
}

struct GroupStatusSection: View {
    @EnvironmentObject private var groupService: GroupService
    @State private var lastUpdateTime = Date()
    
    var body: some View {
        VStack(spacing: 16) {
            if let currentGroup = groupService.currentGroup {
                // Group Name and Member Count
                VStack(spacing: 8) {
                    Text(currentGroup.name)
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundColor(.primary)
                    
                    let onlineCount = calculateOnlineMembers(currentGroup.members)
                    let totalCount = currentGroup.members.count
                    Text(String(format: "members_online".localized, onlineCount, totalCount))
                        .font(.subheadline)
                        .foregroundColor(onlineCount == totalCount ? .green : .orange)
                        .id("member-status-\(currentGroup.id)-\(lastUpdateTime.timeIntervalSince1970)")
                        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
                            lastUpdateTime = Date()
                        }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .darkBlueCard(cornerRadius: 16)
            }
        }
    }
    
    private func calculateOnlineMembers(_ members: [GroupMember]) -> Int {
        let now = Date()
        let onlineThreshold: TimeInterval = 5 * 60 // 5 minutes
        
        return members.filter { member in
            guard let lastUpdate = member.lastLocationUpdate else {
                return false
            }
            return now.timeIntervalSince(lastUpdate) <= onlineThreshold
        }.count
    }
}

struct QuickCommandsSection: View {
    @EnvironmentObject private var authService: AuthenticationService
    @EnvironmentObject private var groupService: GroupService
    let commandService: CommandService
    
    var body: some View {
        VStack(spacing: 16) {
            HStack {
                Text("core_commands".localized)
                    .font(.headline)
                    .fontWeight(.semibold)
                Spacer()
            }
            
            HStack(spacing: 16) {
                // Gather Command Button
                DarkBlueButton(variant: .primary, action: {
                    sendQuickCommand(.gather)
                }) {
                    VStack(spacing: 8) {
                        Image(systemName: "person.3.fill")
                            .font(.system(size: 32))
                        Text("gather".localized)
                            .font(.title3)
                            .fontWeight(.medium)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 80)
                }
                
                // Rest Command Button
                DarkBlueButton(variant: .accent, action: {
                    sendQuickCommand(.rest)
                }) {
                    VStack(spacing: 8) {
                        Image(systemName: "moon.fill")
                            .font(.system(size: 32))
                        Text("rest".localized)
                            .font(.title3)
                            .fontWeight(.medium)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 80)
                }
            }
        }
    }
    
    private func sendQuickCommand(_ type: CommandType) {
        guard let currentGroup = groupService.currentGroup,
              let currentUser = authService.currentUser else {
            return
        }
        
        Task {
            await commandService.sendQuickCommand(
                type: type,
                groupId: currentGroup.id,
                groupName: currentGroup.name,
                senderId: currentUser.id,
                senderName: currentUser.displayName
            )
        }
    }
}

struct QuickActionsSection: View {
    @EnvironmentObject private var authService: AuthenticationService
    @EnvironmentObject private var groupService: GroupService
    @State private var showingInviteSheet = false
    
    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Text("quick_actions".localized)
                    .font(.headline)
                    .fontWeight(.semibold)
                Spacer()
            }
            
            VStack(spacing: 12) {
                // View Full Map Button
                DarkBlueButton(variant: .secondary, action: {
                    navigateToMapTab()
                }) {
                    HStack {
                        Image(systemName: "map")
                        Text("view_full_map".localized)
                        Spacer()
                        Image(systemName: "chevron.right")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                
                // Invite New Members Button
                DarkBlueButton(variant: .secondary, action: {
                    showingInviteSheet = true
                }) {
                    HStack {
                        Image(systemName: "person.badge.plus")
                        Text("invite_new_members".localized)
                        Spacer()
                        Image(systemName: "chevron.right")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                
                // More Commands Button
                DarkBlueButton(variant: .secondary, action: {
                    // TODO: Navigate to commands view
                }) {
                    HStack {
                        Image(systemName: "ellipsis.circle")
                        Text("more_commands".localized)
                        Spacer()
                        Image(systemName: "chevron.right")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .sheet(isPresented: $showingInviteSheet) {
            if let currentGroup = groupService.currentGroup {
                InviteSheet(group: currentGroup, groupService: groupService)
            }
        }
    }
    
    private func navigateToMapTab() {
        // Use TabView's programmatic selection
        // This will be handled by the parent TabView controller
        NotificationCenter.default.post(name: NSNotification.Name("SwitchToMapTab"), object: nil)
    }
}

#Preview {
    LeaderDashboardView()
        .environmentObject(AuthenticationService())
        .environmentObject(GroupService())
        .environmentObject(LanguageService())
        .environmentObject(ThemeManager.shared)
}