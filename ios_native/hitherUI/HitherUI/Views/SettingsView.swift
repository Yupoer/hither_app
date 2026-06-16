import SwiftUI

struct SettingsView: View {
    @State private var stealthMode = false
    @State private var notifications = true
    @State private var liveActivities = true
    @State private var locationServices = true
    @State private var showEditNickname = false
    @State private var nickname = "The Navigator"
    
    var body: some View {
        ScrollView {
            VStack(spacing: HitherDesignSystem.Spacing.xl) {
                // Group Name
                Text("The Globetrotters")
                    .font(HitherDesignSystem.Typography.largeTitle)
                    .foregroundColor(HitherDesignSystem.Colors.gray900)
                    .padding(.top, HitherDesignSystem.Spacing.lg)
                
                // User Profile Section
                VStack(spacing: HitherDesignSystem.Spacing.md) {
                    // Avatar with Edit Button
                    ZStack(alignment: .bottomTrailing) {
                        Circle()
                            .fill(Color(red: 0.85, green: 0.75, blue: 0.65))
                            .frame(width: 120, height: 120)
                            .overlay(
                                Text("👨🏻‍💼")
                                    .font(.system(size: 60))
                            )
                        
                        Button(action: {}) {
                            Image(systemName: "pencil")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.white)
                                .frame(width: 32, height: 32)
                                .background(HitherDesignSystem.Colors.primary)
                                .clipShape(Circle())
                                .overlay(
                                    Circle()
                                        .stroke(Color.white, lineWidth: 2)
                                )
                        }
                        .offset(x: -8, y: -8)
                    }
                    
                    // Name and Nickname
                    VStack(spacing: HitherDesignSystem.Spacing.xs) {
                        Text("Alex '\(nickname)'")
                            .font(HitherDesignSystem.Typography.title2)
                            .foregroundColor(HitherDesignSystem.Colors.gray900)
                        
                        Button("Edit Nickname") {
                            showEditNickname = true
                        }
                        .font(HitherDesignSystem.Typography.callout)
                        .foregroundColor(HitherDesignSystem.Colors.primary)
                    }
                }
                
                // Privacy & Notifications Section
                VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.lg) {
                    HStack {
                        Text("Privacy & Notifications")
                            .font(HitherDesignSystem.Typography.title2)
                            .foregroundColor(HitherDesignSystem.Colors.gray900)
                        
                        Spacer()
                    }
                    .padding(.horizontal, HitherDesignSystem.Spacing.lg)
                    
                    VStack(spacing: HitherDesignSystem.Spacing.sm) {
                        SettingsToggleRow(
                            icon: "eye.slash",
                            iconColor: HitherDesignSystem.Colors.primary,
                            title: "Stealth Mode",
                            subtitle: "Temporarily hide your location",
                            isOn: $stealthMode
                        )
                        
                        SettingsToggleRow(
                            icon: "bell",
                            iconColor: HitherDesignSystem.Colors.primary,
                            title: "Notifications",
                            subtitle: "For important updates",
                            isOn: $notifications
                        )
                        
                        SettingsToggleRow(
                            icon: "rectangle.stack",
                            iconColor: HitherDesignSystem.Colors.primary,
                            title: "Live Activities",
                            subtitle: "Real-time tracking on lock screen",
                            isOn: $liveActivities
                        )
                        
                        SettingsToggleRow(
                            icon: "location.circle",
                            iconColor: HitherDesignSystem.Colors.primary,
                            title: "Location Services",
                            subtitle: "Allow Hither to use your location",
                            isOn: $locationServices
                        )
                    }
                    .padding(.horizontal, HitherDesignSystem.Spacing.lg)
                }
                
                Spacer(minLength: 100)
            }
        }
        .background(HitherDesignSystem.Colors.background)
        .sheet(isPresented: $showEditNickname) {
            EditNicknameView(nickname: $nickname)
        }
    }
}

struct SettingsToggleRow: View {
    let icon: String
    let iconColor: Color
    let title: String
    let subtitle: String
    @Binding var isOn: Bool
    
    var body: some View {
        HStack(spacing: HitherDesignSystem.Spacing.md) {
            // Icon
            ZStack {
                Circle()
                    .fill(iconColor)
                    .frame(width: 50, height: 50)
                
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(.white)
            }
            
            // Text Content
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(HitherDesignSystem.Typography.headline)
                    .foregroundColor(HitherDesignSystem.Colors.gray900)
                
                Text(subtitle)
                    .font(HitherDesignSystem.Typography.callout)
                    .foregroundColor(HitherDesignSystem.Colors.gray500)
                    .lineLimit(2)
            }
            
            Spacer()
            
            // Toggle
            Toggle("", isOn: $isOn)
                .toggleStyle(HitherToggleStyle())
        }
        .padding(HitherDesignSystem.Spacing.md)
        .background(Color.white)
        .cornerRadius(HitherDesignSystem.CornerRadius.medium)
        .hitherShadow(HitherDesignSystem.Shadow.small)
    }
}

struct HitherToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack {
            configuration.label
            
            Button(action: {
                configuration.isOn.toggle()
            }) {
                RoundedRectangle(cornerRadius: 16)
                    .fill(configuration.isOn ? HitherDesignSystem.Colors.primary : HitherDesignSystem.Colors.gray300)
                    .frame(width: 50, height: 30)
                    .overlay(
                        Circle()
                            .fill(Color.white)
                            .frame(width: 26, height: 26)
                            .offset(x: configuration.isOn ? 10 : -10)
                            .animation(.easeInOut(duration: 0.2), value: configuration.isOn)
                    )
            }
            .buttonStyle(PlainButtonStyle())
        }
    }
}

struct EditNicknameView: View {
    @Binding var nickname: String
    @State private var tempNickname: String = ""
    @Environment(\.dismiss) var dismiss
    
    var body: some View {
        NavigationView {
            VStack(spacing: HitherDesignSystem.Spacing.lg) {
                Text("Edit Nickname")
                    .font(HitherDesignSystem.Typography.title2)
                    .foregroundColor(HitherDesignSystem.Colors.gray900)
                    .padding(.top, HitherDesignSystem.Spacing.lg)
                
                VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.sm) {
                    Text("Nickname")
                        .font(HitherDesignSystem.Typography.body)
                        .foregroundColor(HitherDesignSystem.Colors.gray700)
                    
                    TextField("Enter nickname", text: $tempNickname)
                        .textFieldStyle(HitherTextFieldStyle())
                }
                .padding(.horizontal, HitherDesignSystem.Spacing.lg)
                
                Spacer()
            }
            .background(HitherDesignSystem.Colors.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .foregroundColor(HitherDesignSystem.Colors.gray600)
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        nickname = tempNickname
                        dismiss()
                    }
                    .foregroundColor(HitherDesignSystem.Colors.primary)
                    .fontWeight(.semibold)
                }
            }
        }
        .onAppear {
            tempNickname = nickname
        }
    }
}

#Preview("Settings View") {
    SettingsView()
}

#Preview("Settings Toggle Row") {
    VStack(spacing: HitherDesignSystem.Spacing.md) {
        SettingsToggleRow(
            icon: "eye.slash",
            iconColor: HitherDesignSystem.Colors.primary,
            title: "Stealth Mode",
            subtitle: "Temporarily hide your location",
            isOn: .constant(false)
        )
        
        SettingsToggleRow(
            icon: "bell",
            iconColor: HitherDesignSystem.Colors.primary,
            title: "Notifications",
            subtitle: "For important updates",
            isOn: .constant(true)
        )
    }
    .padding()
    .background(HitherDesignSystem.Colors.background)
}

#Preview("Edit Nickname Modal") {
    EditNicknameView(nickname: .constant("The Navigator"))
}