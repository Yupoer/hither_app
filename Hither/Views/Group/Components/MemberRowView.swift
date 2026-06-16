//
//  MemberRowView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct MemberRowView: View {
    let member: GroupMember
    let isCurrentUser: Bool
    @ObservedObject var groupService: GroupService
    @ObservedObject var authService: AuthenticationService
    @State private var showingEditNameSheet = false
    
    var body: some View {
        HStack(spacing: 12) {
            // Show emoji avatar if available, otherwise show role indicator
            if let emoji = member.avatarEmoji {
                Text(emoji)
                    .font(.title2)
                    .frame(width: 32, height: 32)
            } else {
                RoleIndicatorView(role: member.role, size: 32)
            }
            
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(member.nickname ?? member.displayName)
                        .font(.headline)
                        .foregroundColor(.primary)
                    
                    if isCurrentUser {
                        Text("you_indicator".localized)
                            .font(.caption)
                            .foregroundColor(.blue)
                            .italic()
                        
                        // Rename circle button next to my name
                        Button(action: {
                            showingEditNameSheet = true
                        }) {
                            Image(systemName: "pencil.circle.fill")
                                .font(.title2)
                                .foregroundColor(.blue)
                        }
                        .buttonStyle(PlainButtonStyle())
                    }
                }
                
                Text(member.role.rawValue.capitalized)
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                if let lastUpdate = member.lastLocationUpdate {
                    let timeAgo = Date().timeIntervalSince(lastUpdate)
                    if timeAgo < 60 {
                        StatusIndicatorView(isActive: true, title: "location_live".localized)
                    } else if timeAgo < 300 {
                        StatusIndicatorView(isActive: false, title: String(format: "last_seen_minutes_ago".localized, Int(timeAgo/60)))
                    } else {
                        StatusIndicatorView(isActive: false, title: "location_stale".localized)
                    }
                }
            }
            
            Spacer()
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .background(isCurrentUser ? Color.blue.opacity(0.05) : Color.clear)
        .cornerRadius(8)
        .sheet(isPresented: $showingEditNameSheet) {
            EditNameSheet(groupService: groupService, authService: authService)
        }
    }
}