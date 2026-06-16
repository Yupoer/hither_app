import SwiftUI

struct TeamMember {
    let name: String
    let role: String
    let isOnline: Bool
    let distance: String?
    let avatar: String
}

struct DashboardView: View {
    @State private var teamMembers = [
        TeamMember(name: "Ethan Carter", role: "Leader", isOnline: true, distance: nil, avatar: "👨🏻‍💼"),
        TeamMember(name: "Sophia Clark", role: "Member", isOnline: true, distance: "200m", avatar: "👩🏼‍💼"),
        TeamMember(name: "Liam Walker", role: "Member", isOnline: true, distance: "350m", avatar: "👨🏻‍🦲"),
        TeamMember(name: "Olivia Turner", role: "Member", isOnline: false, distance: nil, avatar: "👩🏽‍💼")
    ]
    
    var body: some View {
        ScrollView {
            VStack(spacing: HitherDesignSystem.Spacing.lg) {
                // Current Destination Header
                VStack(spacing: HitherDesignSystem.Spacing.sm) {
                    Text("Current Destination")
                        .font(HitherDesignSystem.Typography.callout)
                        .foregroundColor(HitherDesignSystem.Colors.gray500)
                    
                    HStack(spacing: HitherDesignSystem.Spacing.sm) {
                        Image(systemName: "mappin")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundColor(HitherDesignSystem.Colors.primary)
                        
                        Text("Eiffel Tower")
                            .font(HitherDesignSystem.Typography.title1)
                            .foregroundColor(HitherDesignSystem.Colors.gray900)
                    }
                }
                .padding(.top, HitherDesignSystem.Spacing.md)
                
                // Team Status Section
                VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.md) {
                    HStack {
                        Text("TEAM STATUS")
                            .font(HitherDesignSystem.Typography.headline)
                            .foregroundColor(HitherDesignSystem.Colors.gray700)
                        
                        Spacer()
                    }
                    .padding(.horizontal, HitherDesignSystem.Spacing.lg)
                    
                    VStack(spacing: HitherDesignSystem.Spacing.md) {
                        ForEach(teamMembers.indices, id: \.self) { index in
                            TeamMemberCard(member: teamMembers[index])
                        }
                    }
                    .padding(.horizontal, HitherDesignSystem.Spacing.lg)
                }
                
                // Quick Commands Section
                VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.md) {
                    HStack {
                        Text("QUICK COMMANDS")
                            .font(HitherDesignSystem.Typography.headline)
                            .foregroundColor(HitherDesignSystem.Colors.gray700)
                        
                        Spacer()
                    }
                    .padding(.horizontal, HitherDesignSystem.Spacing.lg)
                    
                    HStack(spacing: HitherDesignSystem.Spacing.md) {
                        // Broadcast Button
                        QuickActionButton(
                            title: "Broadcast",
                            icon: "megaphone",
                            backgroundColor: HitherDesignSystem.Colors.primary,
                            isLarge: true
                        )
                        
                        VStack(spacing: HitherDesignSystem.Spacing.sm) {
                            // Regroup Button
                            QuickActionButton(
                                title: "Regroup",
                                icon: "person.3",
                                backgroundColor: HitherDesignSystem.Colors.gray100,
                                textColor: HitherDesignSystem.Colors.gray700,
                                isLarge: false
                            )
                            
                            // Emergency Button
                            QuickActionButton(
                                title: "Emergency",
                                icon: "sos",
                                backgroundColor: HitherDesignSystem.Colors.gray100,
                                textColor: HitherDesignSystem.Colors.gray700,
                                isLarge: false
                            )
                        }
                    }
                    .padding(.horizontal, HitherDesignSystem.Spacing.lg)
                }
                
                Spacer(minLength: 100)
            }
        }
        .background(HitherDesignSystem.Colors.background)
    }
}

struct TeamMemberCard: View {
    let member: TeamMember
    
    var body: some View {
        HStack(spacing: HitherDesignSystem.Spacing.md) {
            // Avatar with Status
            ZStack(alignment: .bottomTrailing) {
                Circle()
                    .fill(HitherDesignSystem.Colors.gray200)
                    .frame(width: 50, height: 50)
                    .overlay(
                        Text(member.avatar)
                            .font(.system(size: 24))
                    )
                
                // Online Status Indicator
                Circle()
                    .fill(member.isOnline ? HitherDesignSystem.Colors.onlineGreen : HitherDesignSystem.Colors.offlineGray)
                    .frame(width: 14, height: 14)
                    .overlay(
                        Circle()
                            .stroke(Color.white, lineWidth: 2)
                    )
            }
            
            // Member Info
            VStack(alignment: .leading, spacing: 2) {
                Text(member.name)
                    .font(HitherDesignSystem.Typography.headline)
                    .foregroundColor(HitherDesignSystem.Colors.gray900)
                
                Text(member.role)
                    .font(HitherDesignSystem.Typography.callout)
                    .foregroundColor(HitherDesignSystem.Colors.primary)
            }
            
            Spacer()
            
            // Distance or Status
            if let distance = member.distance {
                HStack(spacing: 4) {
                    Image(systemName: "location")
                        .font(.system(size: 12))
                        .foregroundColor(HitherDesignSystem.Colors.gray400)
                    
                    Text(distance)
                        .font(HitherDesignSystem.Typography.callout)
                        .foregroundColor(HitherDesignSystem.Colors.gray600)
                }
            } else if !member.isOnline {
                Text("Offline")
                    .font(HitherDesignSystem.Typography.callout)
                    .foregroundColor(HitherDesignSystem.Colors.offlineGray)
            }
        }
        .padding(HitherDesignSystem.Spacing.md)
        .background(Color.white)
        .cornerRadius(HitherDesignSystem.CornerRadius.medium)
        .hitherShadow(HitherDesignSystem.Shadow.small)
    }
}

struct QuickActionButton: View {
    let title: String
    let icon: String
    let backgroundColor: Color
    var textColor: Color = .white
    let isLarge: Bool
    
    var body: some View {
        Button(action: {}) {
            if isLarge {
                VStack(spacing: HitherDesignSystem.Spacing.sm) {
                    Image(systemName: icon)
                        .font(.system(size: 28, weight: .medium))
                        .foregroundColor(textColor)
                    
                    Text(title)
                        .font(HitherDesignSystem.Typography.headline)
                        .foregroundColor(textColor)
                }
                .frame(maxWidth: .infinity, minHeight: 120)
                .background(backgroundColor)
                .cornerRadius(HitherDesignSystem.CornerRadius.large)
                .hitherShadow(HitherDesignSystem.Shadow.small)
            } else {
                VStack(spacing: HitherDesignSystem.Spacing.xs) {
                    Image(systemName: icon)
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(textColor)
                    
                    Text(title)
                        .font(HitherDesignSystem.Typography.callout)
                        .foregroundColor(textColor)
                }
                .frame(maxWidth: .infinity, minHeight: 55)
                .background(backgroundColor)
                .cornerRadius(HitherDesignSystem.CornerRadius.medium)
                .hitherShadow(HitherDesignSystem.Shadow.small)
            }
        }
        .buttonStyle(PlainButtonStyle())
    }
}

#Preview("Dashboard View") {
    DashboardView()
}

#Preview("Team Member Card") {
    VStack(spacing: HitherDesignSystem.Spacing.md) {
        TeamMemberCard(member: TeamMember(name: "Ethan Carter", role: "Leader", isOnline: true, distance: nil, avatar: "👨🏻‍💼"))
        
        TeamMemberCard(member: TeamMember(name: "Sophia Clark", role: "Member", isOnline: true, distance: "200m", avatar: "👩🏼‍💼"))
        
        TeamMemberCard(member: TeamMember(name: "Olivia Turner", role: "Member", isOnline: false, distance: nil, avatar: "👩🏽‍💼"))
    }
    .padding()
    .background(HitherDesignSystem.Colors.background)
}