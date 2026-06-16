//
//  SettingsView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI
import FirebaseFirestore
import CoreLocation
import UserNotifications

struct SettingsView: View {
    @EnvironmentObject private var groupService: GroupService
    @EnvironmentObject private var authService: AuthenticationService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    @StateObject private var developmentService = DevelopmentService.shared
    @StateObject private var locationService = LocationService()
    @StateObject private var notificationService = NotificationService()
    @State private var showingInviteSheet = false
    @State private var showingLeaveAlert = false
    @State private var showingEditNameSheet = false
    @State private var showingLocationSpoofer = false
    @State private var showingDistanceThresholdPicker = false
    @State private var showingBadgeSystem = false
    
    // Settings toggles state
    @State private var isLocationEnabled = true
    @State private var isNotificationsEnabled = true
    @State private var isLiveActivityEnabled = false
    @State private var currentDistanceThreshold: Int = 100
    @State private var isOfflineMode = false
    @State private var isFreeRoamMode = false
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    if let group = groupService.currentGroup,
                       let user = authService.currentUser {
                        
                        // Group header
                        GroupHeaderView(group: group, currentUser: user)
                        
                        // Invite section (Leader only)
                        if group.leader?.userId == user.id {
                            leaderInviteSection(group: group)
                        }
                        
                        // Members section
                        membersSection(group: group, currentUser: user)
                        
                        // Quick actions for both leaders and followers
                        quickActionsSection(group: group, currentUser: user)
                        
                        // Settings toggles section
                        settingsTogglesSection()
                        
                        // Offline mode section
                        offlineModeSection()
                        
                        // Badge System section
                        badgeSystemSection()
                        
                        // Leader distance settings section
                        leaderDistanceSettingsSection(group: group, currentUser: user)
                        
                        Spacer(minLength: 20)
                        
                        // Group Setup button
                        Button(action: {
                            groupService.navigateToSetup()
                        }) {
                            Text("group_setup".localized)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.blue)
                                .foregroundColor(.white)
                                .cornerRadius(8)
                        }
                        
                        // Leave group button
                        Button(action: {
                            showingLeaveAlert = true
                        }) {
                            Text("leave_group".localized)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.red)
                                .foregroundColor(.white)
                                .cornerRadius(8)
                        }
                    } else {
                        Text("no_group_found".localized)
                            .foregroundColor(.secondary)
                    }
                }
                .padding()
            }
            .navigationTitle("settings".localized)
            .onAppear {
                loadGroupSettings()
            }
            .navigationBarItems(trailing: HStack(spacing: 16) {
                // Development mode button
                Button(action: {
                    developmentService.toggleDevelopmentMode()
                    if developmentService.isDevelopmentModeEnabled {
                        showingLocationSpoofer = true
                    }
                }) {
                    Image(systemName: developmentService.isDevelopmentModeEnabled ? "hammer.fill" : "hammer")
                        .font(.title2)
                        .foregroundColor(developmentService.isDevelopmentModeEnabled ? .orange : .gray)
                }
                
                LanguagePicker(languageService: languageService)
            })
            .refreshable {
                await refreshGroupData()
            }
            .onAppear {
                currentDistanceThreshold = getDistanceThreshold()
                isLocationEnabled = locationService.isTracking && (locationService.authorizationStatus == .authorizedAlways || locationService.authorizationStatus == .authorizedWhenInUse)
                isNotificationsEnabled = notificationService.isEnabled
                // Update offline mode if all services are disabled
                isOfflineMode = !isLocationEnabled && !isNotificationsEnabled && !isLiveActivityEnabled
            }
            .onChange(of: locationService.isTracking) { oldValue, newValue in
                isLocationEnabled = newValue && (locationService.authorizationStatus == .authorizedAlways || locationService.authorizationStatus == .authorizedWhenInUse)
            }
            .onChange(of: notificationService.isEnabled) { oldValue, newValue in
                isNotificationsEnabled = newValue
            }
            .sheet(isPresented: $showingInviteSheet) {
                if let group = groupService.currentGroup {
                    InviteSheet(group: group, groupService: groupService)
                        .environmentObject(languageService)
                        .environmentObject(themeManager)
                }
            }
            .alert("leave_group".localized, isPresented: $showingLeaveAlert) {
                Button("cancel".localized, role: .cancel) { }
                Button("leave".localized, role: .destructive) {
                    Task {
                        guard let user = authService.currentUser else { return }
                        await groupService.leaveGroup(userId: user.id)
                    }
                }
            } message: {
                Text("leave_group_confirmation".localized)
            }
            .sheet(isPresented: $showingEditNameSheet) {
                EditNameSheet(groupService: groupService, authService: authService)
                    .environmentObject(languageService)
                    .environmentObject(themeManager)
            }
            .sheet(isPresented: $showingLocationSpoofer) {
                DevelopmentLocationSheet(developmentService: developmentService)
                    .environmentObject(languageService)
                    .environmentObject(themeManager)
            }
            .sheet(isPresented: $showingBadgeSystem) {
                BadgeSystemView()
                    .environmentObject(languageService)
                    .environmentObject(themeManager)
            }
            .sheet(isPresented: $showingDistanceThresholdPicker) {
                DistanceThresholdPicker(currentThreshold: currentDistanceThreshold) { distance in
                    currentDistanceThreshold = distance
                    setDistanceThreshold(distance)
                }
                .environmentObject(languageService)
                .environmentObject(themeManager)
            }
        }
    }
    
    private func getDistanceThreshold() -> Int {
        return UserDefaults.standard.object(forKey: "LeaderDistanceThreshold") as? Int ?? 100
    }
    
    private func setDistanceThreshold(_ distance: Int) {
        UserDefaults.standard.set(distance, forKey: "LeaderDistanceThreshold")
    }
    
    private var distanceThresholdButtons: [ActionSheet.Button] {
        let distances = [50, 100, 200, 300, 500]
        
        return distances.map { distance in
            .default(Text("\(distance)m")) {
                setDistanceThreshold(distance)
            }
        }
    }
    
    @ViewBuilder
    private func leaderInviteSection(group: HitherGroup) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("invite_members".localized)
                .font(.headline)
            
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("invite_code".localized)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    
                    Text(group.inviteCode)
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundColor(.blue)
                }
                
                Spacer()
                
                Button("share".localized) {
                    showingInviteSheet = true
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Color.blue)
                .foregroundColor(.white)
                .cornerRadius(8)
            }
            .padding()
            .background(Color.blue.opacity(0.1))
            .cornerRadius(12)
        }
    }
    
    @ViewBuilder
    private func membersSection(group: HitherGroup, currentUser: HitherUser) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("members_count".localized.replacingOccurrences(of: "%d", with: "\(group.members.count)"))
                .font(.headline)
            
            LazyVStack(spacing: 8) {
                ForEach(sortedMembers(group.members, currentUserId: currentUser.id)) { member in
                    MemberRowView(
                        member: member, 
                        isCurrentUser: member.userId == currentUser.id,
                        groupService: groupService,
                        authService: authService
                    )
                }
            }
        }
    }
    
    @ViewBuilder
    private func settingsTogglesSection() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("app_settings".localized)
                .font(.headline)
            
            VStack(spacing: 8) {
                // Location toggle
                HStack {
                    Image(systemName: "location.fill")
                        .foregroundColor(.blue)
                        .frame(width: 20)
                    
                    Text("location_services".localized)
                        .font(.subheadline)
                    
                    Spacer()
                    
                    Toggle("", isOn: $isLocationEnabled)
                        .onChange(of: isLocationEnabled) { oldValue, newValue in
                            if newValue {
                                // Request location permission and start tracking if in group
                                locationService.requestLocationPermission()
                                if let group = groupService.currentGroup,
                                   let user = authService.currentUser {
                                    locationService.startTracking(groupId: group.id, userId: user.id)
                                }
                            } else {
                                // Stop location tracking completely
                                locationService.stopTracking()
                            }
                        }
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 12)
                .background(Color.gray.opacity(0.1))
                .cornerRadius(8)
                
                // Notifications toggle
                HStack {
                    Image(systemName: "bell.fill")
                        .foregroundColor(.orange)
                        .frame(width: 20)
                    
                    Text("notifications".localized)
                        .font(.subheadline)
                    
                    Spacer()
                    
                    Toggle("", isOn: $isNotificationsEnabled)
                        .onChange(of: isNotificationsEnabled) { oldValue, newValue in
                            if newValue {
                                // Request notification permission
                                Task {
                                    await notificationService.requestPermission()
                                }
                            } else {
                                // Disable notifications by clearing pending notifications
                                UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
                                UNUserNotificationCenter.current().removeAllDeliveredNotifications()
                            }
                        }
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 12)
                .background(Color.gray.opacity(0.1))
                .cornerRadius(8)
                
                // Live Activity toggle
                if #available(iOS 16.1, *) {
                    HStack {
                        Image(systemName: "tv.fill")
                            .foregroundColor(.purple)
                            .frame(width: 20)
                        
                        Text("live_activity".localized)
                            .font(.subheadline)
                        
                        Spacer()
                        
                        Toggle("", isOn: $isLiveActivityEnabled)
                    }
                    .padding(.vertical, 8)
                    .padding(.horizontal, 12)
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(8)
                }
            }
        }
    }
    
    @ViewBuilder
    private func offlineModeSection() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("offline_mode".localized)
                .font(.headline)
            
            HStack {
                Image(systemName: "airplane")
                    .foregroundColor(isOfflineMode ? .orange : .gray)
                    .frame(width: 20)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text("offline_mode".localized)
                        .font(.subheadline)
                        .foregroundColor(isOfflineMode ? .orange : .primary)
                    
                    Text("offline_mode_description".localized)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                Toggle("", isOn: $isOfflineMode)
                    .onChange(of: isOfflineMode) { oldValue, newValue in
                        if newValue {
                            // Enable offline mode - disable all services
                            isLocationEnabled = false
                            isNotificationsEnabled = false  
                            isLiveActivityEnabled = false
                            
                            // Stop location tracking
                            locationService.stopTracking()
                            
                            // Clear notifications
                            UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
                            UNUserNotificationCenter.current().removeAllDeliveredNotifications()
                        } else {
                            // Disable offline mode - restore services
                            isLocationEnabled = locationService.authorizationStatus == .authorizedAlways || locationService.authorizationStatus == .authorizedWhenInUse
                            isNotificationsEnabled = notificationService.isEnabled
                            isLiveActivityEnabled = false
                            
                            // Restart location tracking if in group
                            if let group = groupService.currentGroup,
                               let user = authService.currentUser {
                                locationService.startTracking(groupId: group.id, userId: user.id)
                            }
                        }
                    }
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 12)
            .background(isOfflineMode ? Color.orange.opacity(0.1) : Color.gray.opacity(0.1))
            .cornerRadius(8)
        }
    }
    
    @ViewBuilder
    private func badgeSystemSection() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("badge_system".localized)
                .font(.headline)
            
            Button(action: {
                showingBadgeSystem = true
            }) {
                HStack {
                    Image(systemName: "star.circle.fill")
                        .foregroundColor(.yellow)
                        .frame(width: 20)
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text("view_badges".localized)
                            .font(.subheadline)
                            .foregroundColor(.primary)
                        
                        Text("badge_system_description".localized)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    Image(systemName: "chevron.right")
                        .foregroundColor(.gray)
                        .font(.caption)
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 12)
                .background(Color.gray.opacity(0.1))
                .cornerRadius(8)
            }
        }
    }
    
    @ViewBuilder
    private func leaderDistanceSettingsSection(group: HitherGroup, currentUser: HitherUser) -> some View {
        let isLeader = group.leader?.userId == currentUser.id
        
        if isLeader {
            VStack(alignment: .leading, spacing: 12) {
                Text("leader_settings".localized)
                    .font(.headline)
                
                VStack(spacing: 8) {
                    // Free roam mode toggle
                    HStack {
                        Image(systemName: isFreeRoamMode ? "figure.walk.motion" : "figure.walk")
                            .foregroundColor(isFreeRoamMode ? .green : .blue)
                            .frame(width: 20)
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text("free_roam_mode".localized)
                                .font(.subheadline)
                            
                            Text("free_roam_mode_description".localized)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        
                        Spacer()
                        
                        Toggle("", isOn: $isFreeRoamMode)
                            .toggleStyle(SwitchToggleStyle())
                            .onChange(of: isFreeRoamMode) { newValue in
                                toggleFreeRoamMode(enabled: newValue)
                            }
                    }
                    .padding(.vertical, 8)
                    .padding(.horizontal, 12)
                    .background(isFreeRoamMode ? Color.green.opacity(0.1) : Color.gray.opacity(0.1))
                    .cornerRadius(8)
                    
                    // Distance threshold setting
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.red)
                            .frame(width: 20)
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text("distance_alert_threshold".localized)
                                .font(.subheadline)
                            
                            Text("distance_alert_description".localized)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        
                        Spacer()
                        
                        Button("\(currentDistanceThreshold)m") {
                            showingDistanceThresholdPicker = true
                        }
                        .foregroundColor(.blue)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(6)
                    }
                    .padding(.vertical, 8)
                    .padding(.horizontal, 12)
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(8)
                }
            }
        }
    }
    
    @ViewBuilder
    private func quickActionsSection(group: HitherGroup, currentUser: HitherUser) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("quick_actions".localized)
                .font(.headline)
            
            let quickActions = createQuickActionButtons(group: group, currentUser: currentUser)
            let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)
            
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(0..<quickActions.count, id: \.self) { index in
                    quickActions[index]
                }
            }
        }
    }
    
    private func createQuickActionButtons(group: HitherGroup, currentUser: HitherUser) -> [QuickActionButton] {
        var buttons: [QuickActionButton] = []
        let isLeader = group.leader?.userId == currentUser.id
        
        // Leader-only buttons
        if isLeader {
            buttons.append(QuickActionButton(
                icon: "arrow.clockwise",
                title: "new_invite_code".localized,
                color: .orange
            ) {
                Task {
                    await groupService.generateNewInviteCode()
                }
            })
        }
        
        
        
        // Live Activity controls - available for both roles
        if #available(iOS 16.1, *) {
            buttons.append(QuickActionButton(
                icon: "bell.badge",
                title: "Start Live Activity",
                color: .blue
            ) {
                Task {
                    let liveActivityService = LiveActivityService()
                    
                    await liveActivityService.startNavigationLiveActivity(
                        groupName: group.name,
                        groupId: group.id,
                        userId: currentUser.id,
                        userRole: isLeader ? "leader" : "follower",
                        leaderName: group.leader?.displayName ?? "Unknown",
                        memberCount: group.members.count,
                        groupStatus: "waiting",
                        message: "Ready for navigation"
                    )
                }
            })
            
        }
        
        // Debug buttons - leader only
        if isLeader {
            
            buttons.append(QuickActionButton(
                icon: "stethoscope",
                title: "Diagnose Data",
                color: .purple
            ) {
                Task {
                    await groupService.diagnoseGroupData(groupId: group.id)
                }
            })
        }
        
        return buttons
    }
    
    private func refreshGroupData() async {
        guard let _ = groupService.currentGroup,
              let user = authService.currentUser else { return }
        
        print("🔄 Refreshing group data...")
        
        // Refresh the current group data
        await groupService.refreshCurrentGroup()
        
        // Also refresh user's group list
        await groupService.loadUserGroups(userId: user.id)
    }
    
    private func sortedMembers(_ members: [GroupMember], currentUserId: String) -> [GroupMember] {
        return members.sorted { member1, member2 in
            // Current user always comes first
            if member1.userId == currentUserId && member2.userId != currentUserId {
                return true
            }
            if member2.userId == currentUserId && member1.userId != currentUserId {
                return false
            }
            
            // If neither or both are current user, sort by display name
            let name1 = member1.nickname ?? member1.displayName
            let name2 = member2.nickname ?? member2.displayName
            return name1.localizedCaseInsensitiveCompare(name2) == .orderedAscending
        }
    }
    
    private func toggleFreeRoamMode(enabled: Bool) {
        guard let group = groupService.currentGroup,
              let user = authService.currentUser,
              group.leader?.userId == user.id else { return }
        
        Task {
            await groupService.updateFreeRoamMode(groupId: group.id, enabled: enabled, enabledBy: user.id)
        }
        
        // Show confirmation message to user
        let message = enabled ? "free_roam_mode_enabled".localized : "free_roam_mode_disabled".localized
        print("🚶 Free roam mode \(enabled ? "enabled" : "disabled") for group: \(group.name)")
    }
    
    private func loadGroupSettings() {
        guard let group = groupService.currentGroup else { return }
        
        Task {
            let findRequestService = FindRequestService()
            let freeRoamEnabled = await findRequestService.getFreeRoamMode(groupId: group.id)
            await MainActor.run {
                isFreeRoamMode = freeRoamEnabled
            }
        }
    }
}