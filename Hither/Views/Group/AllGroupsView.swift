//
//  AllGroupsView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct AllGroupsView: View {
    @ObservedObject var groupService: GroupService
    @ObservedObject var authService: AuthenticationService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    @Environment(\.presentationMode) var presentationMode
    @State private var showingLeaveAlert = false
    @State private var groupToLeave: HitherGroup?
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    ForEach(groupService.allUserGroups) { group in
                        GroupCard(
                            group: group,
                            currentUser: authService.currentUser!,
                            isCurrentGroup: groupService.currentGroup?.id == group.id,
                            onJoin: {
                                groupService.switchToGroup(group)
                                presentationMode.wrappedValue.dismiss()
                            },
                            onLeave: {
                                groupToLeave = group
                                showingLeaveAlert = true
                            }
                        )
                    }
                    
                    if groupService.allUserGroups.isEmpty {
                        Text("not_in_any_groups".localized)
                            .foregroundColor(.secondary)
                            .padding()
                    }
                }
                .padding()
            }
            .navigationTitle("all_groups".localized)
            .navigationBarItems(
                trailing: Button("done".localized) {
                    presentationMode.wrappedValue.dismiss()
                }
            )
            .alert("leave_group_alert".localized, isPresented: $showingLeaveAlert) {
                Button("cancel".localized, role: .cancel) {
                    groupToLeave = nil
                }
                Button("leave".localized, role: .destructive) {
                    if let group = groupToLeave,
                       let user = authService.currentUser {
                        Task {
                            await groupService.leaveSpecificGroup(groupId: group.id, userId: user.id)
                        }
                    }
                    groupToLeave = nil
                }
            } message: {
                if let group = groupToLeave {
                    Text(String(format: "leave_specific_group_confirmation".localized, group.name))
                }
            }
        }
    }
}

struct GroupCard: View {
    let group: HitherGroup
    let currentUser: HitherUser
    let isCurrentGroup: Bool
    let onJoin: () -> Void
    let onLeave: () -> Void
    
    var userRole: MemberRole? {
        group.members.first { $0.userId == currentUser.id }?.role
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(group.name)
                        .font(.headline)
                    
                    Text(String(format: "members_count_simple".localized, group.members.count))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                if let role = userRole {
                    RoleIndicatorView(role: role, size: 24)
                }
            }
            
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(String(format: "leader_prefix".localized, group.leader?.displayName ?? "Unknown"))
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    Text(String(format: "created_date".localized, formattedDate(group.createdAt)))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                HStack(spacing: 8) {
                    if !isCurrentGroup {
                        Button("switch_to".localized) {
                            onJoin()
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(6)
                    } else {
                        Text("current_group_indicator".localized)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Color.green.opacity(0.2))
                            .foregroundColor(.green)
                            .cornerRadius(6)
                    }
                    
                    Button("leave".localized) {
                        onLeave()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.red)
                    .foregroundColor(.white)
                    .cornerRadius(6)
                }
            }
        }
        .padding()
        .darkBlueCard(cornerRadius: 16)
    }
    
    private func formattedDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}