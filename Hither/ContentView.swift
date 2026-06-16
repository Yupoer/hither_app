//
//  ContentView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI
import FirebaseAuth

struct ContentView: View {
    @EnvironmentObject private var authService: AuthenticationService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    @State private var pendingInviteCode: String?
    @State private var pendingGroupName: String?
    @State private var showingJoinAlert = false
    @State private var showingNicknameSetup = false
    
    var body: some View {
        Group {
            if authService.isLoading {
                SheepLoadingView(message: "loading".localized)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if authService.isAuthenticated {
                if needsNicknameSetup {
                    NicknameSetupView()
                        .environmentObject(authService)
                        .environmentObject(languageService)
                        .environmentObject(themeManager)
                        .onAppear {
                            showingNicknameSetup = true
                        }
                } else {
                    GroupSetupView()
                        .environmentObject(authService)
                        .environmentObject(languageService)
                        .environmentObject(themeManager)
                        .onOpenURL { url in
                            handleDeepLink(url)
                        }
                        .alert("Join Group", isPresented: $showingJoinAlert) {
                            Button("Join") {
                                if let inviteCode = pendingInviteCode {
                                    joinGroupWithCode(inviteCode)
                                }
                            }
                            Button("Cancel", role: .cancel) {
                                pendingInviteCode = nil
                                pendingGroupName = nil
                            }
                        } message: {
                            Text("Do you want to join the group '\(pendingGroupName ?? "Unknown")'?")
                        }
                }
            } else {
                LoginView()
                    .environmentObject(authService)
                    .environmentObject(languageService)
                    .environmentObject(themeManager)
                    .onOpenURL { url in
                        handleDeepLink(url)
                    }
            }
        }
    }
    
    private func handleDeepLink(_ url: URL) {
        print("🔗 Handling deep link: \(url.absoluteString)")
        
        guard url.scheme == "hither",
              url.host == "join",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems else {
            print("❌ Invalid deep link format")
            return
        }
        
        let inviteCode = queryItems.first(where: { $0.name == "code" })?.value
        let groupName = queryItems.first(where: { $0.name == "name" })?.value
        
        guard let code = inviteCode, !code.isEmpty else {
            print("❌ No invite code found in deep link")
            return
        }
        
        pendingInviteCode = code
        pendingGroupName = groupName
        
        if authService.isAuthenticated {
            showingJoinAlert = true
        } else {
            // Store for later use after login
            UserDefaults.standard.set(code, forKey: "pendingInviteCode")
            UserDefaults.standard.set(groupName, forKey: "pendingGroupName")
            print("🔗 Stored pending invite code for after login")
        }
    }
    
    private func joinGroupWithCode(_ inviteCode: String) {
        guard let user = authService.currentUser else { return }
        
        let groupService = GroupService()
        Task {
            await groupService.joinGroup(
                inviteCode: inviteCode,
                userId: user.id,
                userName: user.displayName
            )
        }
        
        // Clear pending data
        pendingInviteCode = nil
        pendingGroupName = nil
        UserDefaults.standard.removeObject(forKey: "pendingInviteCode")
        UserDefaults.standard.removeObject(forKey: "pendingGroupName")
    }
    
    private var needsNicknameSetup: Bool {
        guard let user = authService.currentUser else { return false }
        return user.displayName.isEmpty || user.displayName == "Anonymous"
    }
}

struct NicknameSetupView: View {
    @EnvironmentObject private var authService: AuthenticationService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    @State private var nickname = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    
    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                VStack(spacing: 16) {
                    Image(systemName: "person.circle.fill")
                        .font(.system(size: 80))
                        .foregroundColor(.blue)
                    
                    Text("Welcome to Hither!")
                        .font(.title)
                        .fontWeight(.bold)
                    
                    Text("Please enter your display name to continue")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.bottom, 20)
                
                VStack(alignment: .leading, spacing: 8) {
                    Text("Display Name")
                        .font(.headline)
                    
                    TextField("Enter your name", text: $nickname)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .onAppear {
                            if let user = authService.currentUser {
                                nickname = user.displayName != "Anonymous" ? user.displayName : ""
                            }
                        }
                }
                
                if let errorMessage = errorMessage {
                    Text(errorMessage)
                        .foregroundColor(.red)
                        .font(.caption)
                        .multilineTextAlignment(.center)
                }
                
                Button(action: {
                    Task {
                        await updateDisplayName()
                    }
                }) {
                    if isLoading {
                        SheepProgressView(tint: .white)
                    } else {
                        Text("Continue")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(nickname.isEmpty ? Color.gray : Color.blue)
                .foregroundColor(.white)
                .cornerRadius(8)
                .disabled(nickname.isEmpty || isLoading)
                
                Spacer()
            }
            .padding()
            .navigationTitle("Setup Profile")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
    
    private func updateDisplayName() async {
        guard let user = authService.currentUser else { return }
        
        isLoading = true
        errorMessage = nil
        
        do {
            // Update Firebase Auth profile
            let changeRequest = Auth.auth().currentUser?.createProfileChangeRequest()
            changeRequest?.displayName = nickname
            try await changeRequest?.commitChanges()
            
            // Update local user object
            let updatedUser = HitherUser(
                id: user.id,
                email: user.email,
                displayName: nickname,
                photoURL: user.photoURL
            )
            
            authService.currentUser = updatedUser
            
            print("✅ Successfully updated display name to: \(nickname)")
            
        } catch {
            print("❌ Failed to update display name: \(error.localizedDescription)")
            errorMessage = "Failed to update name: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthenticationService())
        .environmentObject(LanguageService())
        .environmentObject(ThemeManager.shared)
}
