//
//  GroupSetupView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct GroupSetupView: View {
    @StateObject private var groupService = GroupService()
    @EnvironmentObject private var authService: AuthenticationService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    @StateObject private var locationService = LocationService()
    @State private var groupName = ""
    @State private var inviteCode = ""
    @State private var showingJoinGroup = false
    @State private var showingOnboarding = false
    @State private var showingAllGroups = false
    @State private var showingEditNameSheet = false
    @State private var showingQRScanner = false
    @State private var createButtonPressed = false
    @State private var joinButtonPressed = false
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    heroSection
                    createGroupSection
                    
                    JoinGroupSection(
                        inviteCode: $inviteCode,
                        joinButtonPressed: $joinButtonPressed,
                        showingQRScanner: $showingQRScanner,
                        groupService: groupService,
                        authService: authService
                    )
                    
                    ConditionalLoadingView(
                        isLoading: groupService.isLoading,
                        message: "setting_up_group".localized
                    )
                    
                    ConditionalErrorView(errorMessage: groupService.errorMessage)
                    
                    ExistingGroupsSection(
                        showingAllGroups: $showingAllGroups,
                        groupService: groupService
                    )
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 20)
            }
            .onTapGesture {
                // Dismiss keyboard when tapping blank space
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
            .navigationTitle("group_setup".localized)
            .navigationBarItems(
                leading: Button("help".localized) {
                    showingOnboarding = true
                },
                trailing: HStack(spacing: 16) {
                    LanguagePicker(languageService: languageService)
                    Button("sign_out".localized) {
                        authService.signOut()
                    }
                }
            )
            .sheet(isPresented: $showingOnboarding) {
                OnboardingView(isPresented: $showingOnboarding)
            }
            .sheet(isPresented: $showingAllGroups) {
                AllGroupsView(groupService: groupService, authService: authService)
                    .environmentObject(languageService)
                    .environmentObject(themeManager)
            }
            .sheet(isPresented: $showingQRScanner) {
                NativeQRScannerView(
                    groupService: groupService,
                    authService: authService,
                    isPresented: $showingQRScanner
                )
                .environmentObject(languageService)
                .environmentObject(themeManager)
            }
            .onAppear {
                setupGroupLoading()
                // Preload location services for better map performance
                locationService.preloadLocationServices()
            }
            .onChange(of: authService.currentUser) { oldValue, newValue in
                if newValue != nil {
                    setupGroupLoading()
                }
            }
            .onChange(of: groupService.currentGroup) { oldValue, newValue in
                if newValue == nil {
                    // Clear input fields when returning from group page
                    groupName = ""
                    inviteCode = ""
                }
            }
            .onDisappear {
                groupService.stopListeningToUserGroups()
            }
            .fullScreenCover(item: .constant(groupService.currentGroup)) { _ in
                MainTabView()
                    .environmentObject(authService)
                    .environmentObject(groupService)
                    .environmentObject(languageService)
                    .environmentObject(themeManager)
            }
        }
    }
    
    private func setupGroupLoading() {
        // Clear input fields when returning to setup
        groupName = ""
        inviteCode = ""
        
        if let user = authService.currentUser {
            Task {
                print("🔄 Loading user groups for: \(user.displayName)")
                await groupService.loadUserGroups(userId: user.id)
                groupService.startListeningToUserGroups(userId: user.id)
                
                // Check for pending invite code after login
                if let pendingCode = UserDefaults.standard.string(forKey: "pendingInviteCode") {
                    print("🔗 Processing pending invite code: \(pendingCode)")
                    await groupService.joinGroup(
                        inviteCode: pendingCode,
                        userId: user.id,
                        userName: user.displayName
                    )
                    
                    // Clear the pending data
                    UserDefaults.standard.removeObject(forKey: "pendingInviteCode")
                    UserDefaults.standard.removeObject(forKey: "pendingGroupName")
                }
            }
        }
    }
    
    private var heroSection: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(.ultraThinMaterial)
                    .frame(width: 120, height: 120)
                    .overlay(
                        Circle()
                            .stroke(
                                LinearGradient(
                                    colors: [Color.blue.opacity(0.3), Color.purple.opacity(0.1)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 1
                            )
                    )
                    .shadow(color: Color.blue.opacity(0.2), radius: 20, y: 8)
                
                Image(systemName: "person.2.circle.fill")
                    .font(.system(size: 60))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            }
            
            VStack(spacing: 8) {
                Text("create_or_join_group".localized)
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.primary, .secondary],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                
                Text("start_group_adventure".localized)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 24)
    }
    
    private var createGroupSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Section title outside the card
            DarkBlueSectionHeader(text: "create_new_group".localized, colors: [.blue, .purple])
            
            // Card content
            VStack(alignment: .leading, spacing: 20) {
                // Glass text field
                DarkBlueTextField(
                    placeholder: "group_name_placeholder".localized,
                    text: $groupName,
                    icon: "textformat",
                    iconColor: .blue.opacity(0.7)
                )
            }
            
            DarkBlueButton(variant: .primary, action: {
                // Immediate feedback
                createButtonPressed = true
                
                // Provide haptic feedback
                let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                impactFeedback.impactOccurred()
                
                Task {
                    guard let user = authService.currentUser else { return }
                    await groupService.createGroup(
                        name: groupName,
                        leaderId: user.id,
                        leaderName: user.displayName
                    )
                    
                    // Reset button state
                    await MainActor.run {
                        createButtonPressed = false
                    }
                }
            }) {
                HStack(spacing: 12) {
                    if createButtonPressed {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .scaleEffect(0.8)
                    } else {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 20, weight: .semibold))
                    }
                    Text("create_group".localized)
                        .font(.headline)
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .foregroundStyle(
                    LinearGradient(
                        colors: groupName.isEmpty ? [.gray, .gray] : [.white, .white.opacity(0.9)],
                        startPoint: .leading,
                        endPoint: .trailing  
                    )
                )
            }
            .disabled(groupName.isEmpty || createButtonPressed)
            .opacity(groupName.isEmpty ? 0.6 : 1.0)
            .animation(.easeInOut(duration: 0.2), value: groupName.isEmpty)
        }
    }
}