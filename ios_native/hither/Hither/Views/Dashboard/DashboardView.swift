//
//  DashboardView.swift
//  Hither
//
//  Created by Dillion on 2025/8/4.
//

import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var authService: AuthenticationService
    @EnvironmentObject private var groupService: GroupService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    
    var body: some View {
        NavigationView {
            Group {
                if let currentGroup = groupService.currentGroup {
                    if currentGroup.leaderId == authService.currentUser?.id {
                        LeaderDashboardView()
                            .environmentObject(authService)
                            .environmentObject(groupService)
                            .environmentObject(languageService)
                            .environmentObject(themeManager)
                    } else {
                        FollowerDashboardView()
                            .environmentObject(authService)
                            .environmentObject(groupService)
                            .environmentObject(languageService)
                            .environmentObject(themeManager)
                    }
                } else {
                    NoDashboardView()
                        .environmentObject(authService)
                        .environmentObject(groupService)
                        .environmentObject(languageService)
                        .environmentObject(themeManager)
                }
            }
            .navigationTitle("dashboard".localized)
        }
    }
}

struct NoDashboardView: View {
    @EnvironmentObject private var groupService: GroupService
    
    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "gauge.with.dots.needle.67percent")
                .font(.system(size: 64))
                .foregroundColor(.secondary)
            
            Text("join_group_to_see_dashboard".localized)
                .font(.title2)
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)
        }
        .padding()
    }
}

struct FollowerDashboardView: View {
    @EnvironmentObject private var groupService: GroupService
    
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Text("follower_dashboard_coming_soon".localized)
                    .font(.title2)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
            }
            .padding()
        }
    }
}

#Preview {
    DashboardView()
        .environmentObject(AuthenticationService())
        .environmentObject(GroupService())
        .environmentObject(LanguageService())
        .environmentObject(ThemeManager.shared)
}