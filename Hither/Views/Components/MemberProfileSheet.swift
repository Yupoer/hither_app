//
//  MemberProfileSheet.swift
//  Hither
//
//  Member profile view sheet
//

import SwiftUI

struct MemberProfileSheet: View {
    let member: GroupMember
    let isCurrentUser: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // Header Section
                    VStack(spacing: 16) {
                        // Avatar
                        if let emoji = member.avatarEmoji {
                            Text(emoji)
                                .font(.system(size: 80))
                                .frame(width: 120, height: 120)
                                .background(DarkBlueTheme(isDark: colorScheme == .dark).card)
                                .clipShape(Circle())
                                .overlay(
                                    Circle()
                                        .stroke(DarkBlueTheme(isDark: colorScheme == .dark).border, lineWidth: 2)
                                )
                                .shadow(color: DarkBlueTheme(isDark: colorScheme == .dark).shadowColor, radius: 8)
                        } else {
                            Image(systemName: "person.circle.fill")
                                .font(.system(size: 80))
                                .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).mutedForeground)
                                .frame(width: 120, height: 120)
                        }
                        
                        // Name and Role
                        VStack(spacing: 4) {
                            Text(member.nickname ?? member.displayName)
                                .font(.title2)
                                .fontWeight(.bold)
                                .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).foreground)
                            
                            HStack {
                                RoleIndicatorView(role: member.role)
                                if member.status != .normal {
                                    Text("•")
                                        .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).mutedForeground)
                                    Text(statusText(for: member.status))
                                        .font(.caption)
                                        .foregroundColor(statusColor(for: member.status))
                                }
                            }
                        }
                    }
                    .padding()
                    .background(DarkBlueTheme(isDark: colorScheme == .dark).card)
                    .cornerRadius(16)
                    .shadow(color: DarkBlueTheme(isDark: colorScheme == .dark).shadowColor, radius: 4)
                    
                    // Member Information
                    VStack(spacing: 16) {
                        // Display Name
                        if let nickname = member.nickname, nickname != member.displayName {
                            InfoRow(
                                icon: "person.text.rectangle",
                                title: "Display Name",
                                value: member.displayName
                            )
                        }
                        
                        // User ID (for debugging/admin purposes)
                        InfoRow(
                            icon: "number.circle",
                            title: "Member ID",
                            value: String(member.userId.prefix(8)) + "..."
                        )
                        
                        // Join Date
                        InfoRow(
                            icon: "calendar",
                            title: "Joined",
                            value: DateFormatter.memberProfile.string(from: member.joinedAt)
                        )
                        
                        // Last Location Update
                        if let lastUpdate = member.lastLocationUpdate {
                            InfoRow(
                                icon: "location.circle",
                                title: "Last Update",
                                value: RelativeDateTimeFormatter().localizedString(for: lastUpdate, relativeTo: Date())
                            )
                        }
                        
                        // Current Status
                        InfoRow(
                            icon: "info.circle",
                            title: "Status",
                            value: statusText(for: member.status)
                        )
                    }
                    .padding()
                    .background(DarkBlueTheme(isDark: colorScheme == .dark).card)
                    .cornerRadius(16)
                    .shadow(color: DarkBlueTheme(isDark: colorScheme == .dark).shadowColor, radius: 4)
                    
                    if isCurrentUser {
                        // Current User Options
                        VStack(spacing: 12) {
                            Text("Your Profile")
                                .font(.headline)
                                .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).foreground)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            
                            Text("Profile customization will be available in a future update.")
                                .font(.body)
                                .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).mutedForeground)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding()
                        .background(DarkBlueTheme(isDark: colorScheme == .dark).secondary)
                        .cornerRadius(16)
                    }
                }
                .padding()
            }
            .background(DarkBlueTheme(isDark: colorScheme == .dark).background)
            .navigationTitle(isCurrentUser ? "Your Profile" : "Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).primary)
                }
            }
        }
    }
    
    private func statusText(for status: MemberStatus) -> String {
        switch status {
        case .gathered:
            return "Ready"
        case .deviated:
            return "Off course"
        case .resting:
            return "Taking a break"
        case .help:
            return "Needs help"
        case .normal:
            return "Active"
        }
    }
    
    private func statusColor(for status: MemberStatus) -> Color {
        switch status {
        case .gathered:
            return .green
        case .deviated:
            return .orange
        case .resting:
            return .blue
        case .help:
            return .red
        case .normal:
            return .primary
        }
    }
}

struct InfoRow: View {
    let icon: String
    let title: String
    let value: String
    
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).primary)
                .frame(width: 24, height: 24)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).mutedForeground)
                Text(value)
                    .font(.body)
                    .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).foreground)
            }
            
            Spacer()
        }
    }
}

extension DateFormatter {
    static let memberProfile: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()
}