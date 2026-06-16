//
//  MemberInteractionMenu.swift
//  Hither
//
//  Created by Development Agent on 2025/8/4.
//

import SwiftUI

struct MemberInteractionMenu: View {
    let member: GroupMember
    let currentUser: HitherUser
    let isLeader: Bool
    let freeRoamMode: Bool
    let hasActiveRequest: Bool
    let onRequestFind: () -> Void
    let onStartFinding: () -> Void
    let onDismiss: () -> Void
    
    var body: some View {
        VStack(spacing: 0) {
            // Header with member info
            VStack(spacing: 8) {
                // Avatar and name
                HStack(spacing: 12) {
                    if let emoji = member.avatarEmoji {
                        Text(emoji)
                            .font(.title)
                            .frame(width: 40, height: 40)
                            .background(Color.white.opacity(0.1))
                            .clipShape(Circle())
                    } else {
                        Image(systemName: "person.circle.fill")
                            .font(.title)
                            .frame(width: 40, height: 40)
                            .foregroundColor(.secondary)
                    }
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text(member.nickname ?? member.displayName)
                            .font(.headline)
                            .foregroundColor(.primary)
                        
                        Text(member.role == .leader ? "Leader" : "Follower")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                }
                
                // Status indicator
                if member.status != .normal {
                    HStack {
                        Text(member.status.emoji)
                            .font(.caption)
                        Text(statusText(for: member.status))
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Spacer()
                    }
                    .padding(.horizontal, 4)
                }
            }
            .padding(16)
            .background(Color.primary.opacity(0.05))
            
            Divider()
            
            // Action buttons
            VStack(spacing: 0) {
                // Show find request button for non-leader members and non-self
                if member.role != .leader && member.userId != currentUser.id {
                    if hasActiveRequest {
                        // Show "Start Finding" button if request is approved
                        actionButton(
                            icon: "location.viewfinder",
                            title: "Start Finding",
                            subtitle: "Begin compass navigation",
                            action: onStartFinding
                        )
                    } else {
                        // Show "Request Find" button
                        actionButton(
                            icon: "person.2.wave.2",
                            title: freeRoamMode ? "Find Member" : "Request Find",
                            subtitle: freeRoamMode ? "Start finding immediately" : "Ask for permission to find",
                            action: onRequestFind
                        )
                    }
                    
                    Divider()
                        .padding(.leading, 16)
                }
                
                // View profile/details (placeholder for future feature)
                actionButton(
                    icon: "person.circle",
                    title: "View Profile",
                    subtitle: "See member details",
                    action: {
                        // TODO: Implement profile view
                        onDismiss()
                    }
                )
                
                // Leader-only options
                if isLeader && member.userId != currentUser.id {
                    Divider()
                        .padding(.leading, 16)
                    
                    actionButton(
                        icon: "exclamationmark.triangle",
                        title: "Send Alert",
                        subtitle: "Notify this member",
                        action: {
                            // TODO: Implement alert sending
                            onDismiss()
                        }
                    )
                }
            }
        }
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: Color.black.opacity(0.2), radius: 8, x: 0, y: 4)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.primary.opacity(0.1), lineWidth: 1)
        )
    }
    
    @ViewBuilder
    private func actionButton(
        icon: String,
        title: String,
        subtitle: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundColor(.blue)
                    .frame(width: 24, height: 24)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.body)
                        .foregroundColor(.primary)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundColor(Color.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(InteractiveButtonStyle())
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
            return ""
        }
    }
}

// MARK: - Interactive Button Style

struct InteractiveButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .opacity(configuration.isPressed ? 0.8 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

struct MemberInteractionOverlay: View {
    let member: GroupMember
    let currentUser: HitherUser
    let isLeader: Bool
    let freeRoamMode: Bool
    let hasActiveRequest: Bool
    let onRequestFind: () -> Void
    let onStartFinding: () -> Void
    @Binding var isPresented: Bool
    
    var body: some View {
        ZStack {
            // Background overlay
            Color.black.opacity(0.3)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation(.easeOut(duration: 0.2)) {
                        isPresented = false
                    }
                }
            
            // Menu positioned at center
            MemberInteractionMenu(
                member: member,
                currentUser: currentUser,
                isLeader: isLeader,
                freeRoamMode: freeRoamMode,
                hasActiveRequest: hasActiveRequest,
                onRequestFind: {
                    onRequestFind()
                    withAnimation(.easeOut(duration: 0.2)) {
                        isPresented = false
                    }
                },
                onStartFinding: {
                    onStartFinding()
                    withAnimation(.easeOut(duration: 0.2)) {
                        isPresented = false
                    }
                },
                onDismiss: {
                    withAnimation(.easeOut(duration: 0.2)) {
                        isPresented = false
                    }
                }
            )
            .frame(maxWidth: 300)
            .padding(.horizontal, 20)
            .scaleEffect(isPresented ? 1.0 : 0.8)
            .opacity(isPresented ? 1.0 : 0.0)
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isPresented)
        }
    }
}