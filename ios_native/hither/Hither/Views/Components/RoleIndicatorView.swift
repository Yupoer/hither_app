//
//  RoleIndicatorView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct RoleIndicatorView: View {
    let role: MemberRole
    let size: CGFloat
    
    init(role: MemberRole, size: CGFloat = 24) {
        self.role = role
        self.size = size
    }
    
    var body: some View {
        ZStack {
            Circle()
                .fill(backgroundColor)
                .frame(width: size, height: size)
            
            Image(systemName: iconName)
                .foregroundColor(.white)
                .font(.system(size: size * 0.5, weight: .bold))
        }
        .overlay(
            Circle()
                .stroke(borderColor, lineWidth: 2)
        )
    }
    
    private var backgroundColor: Color {
        switch role {
        case .leader:
            return .yellow
        case .follower:
            return .blue
        }
    }
    
    private var borderColor: Color {
        switch role {
        case .leader:
            return .orange
        case .follower:
            return .blue.opacity(0.7)
        }
    }
    
    private var iconName: String {
        switch role {
        case .leader:
            return "crown.fill"
        case .follower:
            return "person.fill"
        }
    }
}

struct StatusIndicatorView: View {
    let isActive: Bool
    let title: String
    let size: CGFloat
    
    init(isActive: Bool, title: String, size: CGFloat = 8) {
        self.isActive = isActive
        self.title = title
        self.size = size
    }
    
    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(isActive ? Color.green : Color.red)
                .frame(width: size, height: size)
            
            Text(title)
                .font(.caption)
                .foregroundColor(isActive ? .green : .red)
        }
    }
}

struct QuickActionButton: View {
    let icon: String
    let title: String
    let color: Color
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundColor(.white)
                
                Text(title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            .frame(minWidth: 70, maxWidth: .infinity, minHeight: 70, maxHeight: 70)
            .background(color)
            .cornerRadius(12)
            .shadow(color: color.opacity(0.3), radius: 4, x: 0, y: 2)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

struct QuickActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

struct GroupHeaderView: View {
    let group: HitherGroup
    let currentUser: HitherUser
    @State private var showingEditGroupNameSheet = false
    
    var body: some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(group.name)
                            .font(.title2)
                            .fontWeight(.semibold)
                        
                        // Edit group name button (Leader only)
                        if group.leader?.userId == currentUser.id {
                            Button(action: {
                                showingEditGroupNameSheet = true
                            }) {
                                Image(systemName: "pencil.circle.fill")
                                    .font(.title2)
                                    .foregroundColor(.blue)
                            }
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                    
                    Text("\(group.members.count) members")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                RoleIndicatorView(
                    role: group.members.first { $0.userId == currentUser.id }?.role ?? .follower,
                    size: 32
                )
            }
            
            if let userRole = group.members.first(where: { $0.userId == currentUser.id })?.role {
                HStack {
                    Text("You are the \(userRole.rawValue.capitalized)")
                        .font(.caption)
                        .foregroundColor(userRole == .leader ? .orange : .blue)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background((userRole == .leader ? Color.orange : Color.blue).opacity(0.2))
                        .cornerRadius(4)
                    
                    Spacer()
                }
            }
        }
        .padding()
        .background(Color.gray.opacity(0.05))
        .cornerRadius(12)
        .sheet(isPresented: $showingEditGroupNameSheet) {
            EditGroupNameSheet(group: group)
        }
    }
}

struct EditGroupNameSheet: View {
    let group: HitherGroup
    @Environment(\.presentationMode) var presentationMode
    @State private var newGroupName = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    
    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Text("Edit Group Name")
                        .font(.title2)
                        .fontWeight(.semibold)
                    
                    Text("Update the name for this group")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                
                VStack(alignment: .leading, spacing: 8) {
                    Text("Group Name")
                        .font(.headline)
                    
                    TextField("Enter group name", text: $newGroupName)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .onAppear {
                            newGroupName = group.name
                        }
                }
                
                if let errorMessage = errorMessage {
                    Text(errorMessage)
                        .foregroundColor(.red)
                        .font(.caption)
                }
                
                Spacer()
            }
            .padding()
            .navigationTitle("Edit Group Name")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        presentationMode.wrappedValue.dismiss()
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        saveGroupName()
                    }
                    .disabled(newGroupName.isEmpty || isLoading)
                }
            }
        }
    }
    
    private func saveGroupName() {
        // TODO: Implement group name update functionality
        // This would require adding a method to GroupService
        presentationMode.wrappedValue.dismiss()
    }
}