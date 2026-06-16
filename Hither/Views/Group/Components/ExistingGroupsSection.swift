//
//  ExistingGroupsSection.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct ExistingGroupsSection: View {
    @Binding var showingAllGroups: Bool
    @ObservedObject var groupService: GroupService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    
    @ViewBuilder
    var body: some View {
        if !groupService.allUserGroups.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                // Section title
                DarkBlueSectionHeader(
                    text: "your_groups_count".localized.replacingOccurrences(of: "%d", with: "\(groupService.allUserGroups.count)"),
                    colors: [.orange, .red]
                )
                
                // Groups list in card
                VStack(spacing: 12) {
                    LazyVStack(spacing: 8) {
                        ForEach(groupService.allUserGroups) { group in
                            Button(action: {
                                // Join the selected group
                                groupService.switchToGroup(group)
                            }) {
                                HStack(spacing: 12) {
                                    // Group icon
                                    ZStack {
                                        Circle()
                                            .fill(.ultraThinMaterial)
                                            .frame(width: 40, height: 40)
                                        
                                        Image(systemName: "person.2.fill")
                                            .font(.system(size: 18))
                                            .foregroundColor(.orange)
                                    }
                                    
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(group.name)
                                            .font(.headline)
                                            .foregroundColor(.primary)
                                        
                                        Text("\(group.members.count) members • \(group.leader?.displayName ?? "Unknown") leader")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    
                                    Spacer()
                                    
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundColor(.gray)
                                }
                                .padding()
                                .background(.ultraThinMaterial)
                                .cornerRadius(12)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(
                                            LinearGradient(
                                                colors: [Color.white.opacity(0.2), Color.white.opacity(0.05)],
                                                startPoint: .topLeading,
                                                endPoint: .bottomTrailing
                                            ),
                                            lineWidth: 0.5
                                        )
                                )
                            }
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                    
                    // Manage all groups button
                    DarkBlueButton(variant: .secondary, action: {
                        showingAllGroups = true
                    }) {
                        HStack(spacing: 12) {
                            Image(systemName: "gear")
                                .font(.system(size: 18, weight: .semibold))
                            Text("manage_all_groups".localized)
                                .font(.headline)
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.orange, .red],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
}