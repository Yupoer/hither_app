import SwiftUI

struct TravelGroup {
    let name: String
    let memberCount: Int
    let iconName: String
    let iconColor: Color
}

struct GroupSetupView: View {
    @State private var groupName = ""
    @State private var groupCode = ""
    
    var onCreateGroup: () -> Void = {}
    var onJoinGroup: () -> Void = {}
    
    let joinedGroups = [
        TravelGroup(name: "Family Trip", memberCount: 12, iconName: "figure.2.and.child.holdinghands", iconColor: .blue),
        TravelGroup(name: "Hiking Crew", memberCount: 5, iconName: "figure.hiking", iconColor: .blue),
        TravelGroup(name: "Weekend Getaway", memberCount: 3, iconName: "suitcase", iconColor: .blue)
    ]
    
    var body: some View {
        ScrollView {
            VStack(spacing: HitherDesignSystem.Spacing.xl) {
                Spacer(minLength: 60)
                
                // App Icon
                ZStack {
                    RoundedRectangle(cornerRadius: HitherDesignSystem.CornerRadius.extraLarge)
                        .fill(HitherDesignSystem.Colors.blue)
                        .frame(width: 120, height: 120)
                    
                    Image(systemName: "person.3")
                        .font(.system(size: 40, weight: .medium))
                        .foregroundColor(.white)
                }
                
                // App Title
                Text("Hither")
                    .font(HitherDesignSystem.Typography.largeTitle)
                    .foregroundColor(HitherDesignSystem.Colors.gray900)
                
                Spacer(minLength: 40)
                
                // Create Group Section
                VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.md) {
                    Text("Create Group")
                        .font(HitherDesignSystem.Typography.title2)
                        .foregroundColor(HitherDesignSystem.Colors.gray900)
                    
                    HStack(spacing: 0) {
                        TextField("Enter group name", text: $groupName)
                            .padding(.vertical, HitherDesignSystem.Spacing.md)
                            .padding(.horizontal, HitherDesignSystem.Spacing.md)
                            .background(Color.white)
                            .overlay(
                                RoundedRectangle(cornerRadius: HitherDesignSystem.CornerRadius.medium)
                                    .stroke(HitherDesignSystem.Colors.gray300, lineWidth: 1)
                            )
                            .cornerRadius(HitherDesignSystem.CornerRadius.medium)
                        
                        Button(action: {
                            onCreateGroup()
                        }) {
                            Image(systemName: "arrow.right")
                                .font(.system(size: 18, weight: .medium))
                                .foregroundColor(.white)
                                .frame(width: 50, height: 50)
                                .background(HitherDesignSystem.Colors.blue)
                                .cornerRadius(HitherDesignSystem.CornerRadius.medium)
                        }
                        .offset(x: -1)
                    }
                }
                
                // Join Group Section
                VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.md) {
                    Text("Join Group")
                        .font(HitherDesignSystem.Typography.title2)
                        .foregroundColor(HitherDesignSystem.Colors.gray900)
                    
                    HStack(spacing: 0) {
                        TextField("Enter group code", text: $groupCode)
                            .padding(.vertical, HitherDesignSystem.Spacing.md)
                            .padding(.horizontal, HitherDesignSystem.Spacing.md)
                            .background(Color.white)
                            .overlay(
                                RoundedRectangle(cornerRadius: HitherDesignSystem.CornerRadius.medium)
                                    .stroke(HitherDesignSystem.Colors.gray300, lineWidth: 1)
                            )
                            .cornerRadius(HitherDesignSystem.CornerRadius.medium)
                        
                        Button(action: {
                            onCreateGroup()
                        }) {
                            Image(systemName: "arrow.right")
                                .font(.system(size: 18, weight: .medium))
                                .foregroundColor(.white)
                                .frame(width: 50, height: 50)
                                .background(HitherDesignSystem.Colors.blue)
                                .cornerRadius(HitherDesignSystem.CornerRadius.medium)
                        }
                        .offset(x: -1)
                    }
                }
                
                Spacer(minLength: 40)
                
                // Joined Groups Section
                if !joinedGroups.isEmpty {
                    VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.md) {
                        Text("Joined Groups")
                            .font(HitherDesignSystem.Typography.title2)
                            .foregroundColor(HitherDesignSystem.Colors.gray900)
                        
                        VStack(spacing: HitherDesignSystem.Spacing.md) {
                            ForEach(joinedGroups.indices, id: \.self) { index in
                                GroupRowView(group: joinedGroups[index]) {
                                    onJoinGroup()
                                }
                            }
                        }
                    }
                }
                
                Spacer(minLength: 60)
            }
            .padding(.horizontal, HitherDesignSystem.Spacing.lg)
        }
        .background(Color.white)
    }
}

struct GroupRowView: View {
    let group: TravelGroup
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: HitherDesignSystem.Spacing.md) {
                // Group Icon
                ZStack {
                    RoundedRectangle(cornerRadius: HitherDesignSystem.CornerRadius.medium)
                        .fill(group.iconColor.opacity(0.2))
                        .frame(width: 50, height: 50)
                    
                    Image(systemName: group.iconName)
                        .font(.system(size: 22, weight: .medium))
                        .foregroundColor(group.iconColor)
                }
                
                // Group Info
                VStack(alignment: .leading, spacing: 2) {
                    Text(group.name)
                        .font(HitherDesignSystem.Typography.headline)
                        .foregroundColor(HitherDesignSystem.Colors.gray900)
                    
                    Text("\(group.memberCount) members")
                        .font(HitherDesignSystem.Typography.callout)
                        .foregroundColor(HitherDesignSystem.Colors.gray500)
                }
                
                Spacer()
                
                // Chevron
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(HitherDesignSystem.Colors.gray400)
            }
            .padding(.vertical, HitherDesignSystem.Spacing.sm)
            .padding(.horizontal, HitherDesignSystem.Spacing.md)
            .background(Color.white)
            .overlay(
                RoundedRectangle(cornerRadius: HitherDesignSystem.CornerRadius.medium)
                    .stroke(HitherDesignSystem.Colors.gray200, lineWidth: 1)
            )
            .cornerRadius(HitherDesignSystem.CornerRadius.medium)
        }
        .buttonStyle(PlainButtonStyle())
    }
}


#Preview("Group Setup View") {
    GroupSetupView()
}

#Preview("Group Setup - Success State") {
    GroupSetupView()
        .onAppear {
            // This would show success overlay in actual usage
        }
}