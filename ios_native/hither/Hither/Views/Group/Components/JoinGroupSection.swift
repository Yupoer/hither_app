//
//  JoinGroupSection.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct JoinGroupSection: View {
    @Binding var inviteCode: String
    @Binding var joinButtonPressed: Bool
    @Binding var showingQRScanner: Bool
    @ObservedObject var groupService: GroupService
    @ObservedObject var authService: AuthenticationService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Section title outside the card
            DarkBlueSectionHeader(text: "join_existing_group".localized, colors: [.green, .teal])
            
            // Card content
            VStack(alignment: .leading, spacing: 20) {
                // Glass text field
                DarkBlueTextField(
                    placeholder: "invite_code".localized,
                    text: $inviteCode,
                    icon: "key",
                    iconColor: .green.opacity(0.7),
                    textCase: .uppercase
                )
                
                HStack(spacing: 12) {
                    // Join button using DarkBlueButton
                    DarkBlueButton(variant: .secondary, action: {
                        // Immediate feedback
                        joinButtonPressed = true
                        
                        // Provide haptic feedback
                        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                        impactFeedback.impactOccurred()
                        
                        Task {
                            guard let user = authService.currentUser else { return }
                            await groupService.joinGroup(
                                inviteCode: inviteCode.uppercased(),
                                userId: user.id,
                                userName: user.displayName
                            )
                            
                            // Reset button state
                            await MainActor.run {
                                joinButtonPressed = false
                            }
                        }
                    }) {
                        HStack(spacing: 12) {
                            if joinButtonPressed {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .scaleEffect(0.8)
                            } else {
                                Image(systemName: "arrow.right.circle.fill")
                                    .font(.system(size: 20, weight: .semibold))
                            }
                            Text("join_group".localized)
                                .font(.headline)
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .foregroundStyle(
                            LinearGradient(
                                colors: inviteCode.isEmpty ? [.gray, .gray] : [.white, .white.opacity(0.9)],
                                startPoint: .leading,
                                endPoint: .trailing  
                            )
                        )
                    }
                    .disabled(inviteCode.isEmpty || joinButtonPressed)
                    .opacity(inviteCode.isEmpty ? 0.6 : 1.0)
                    .animation(.easeInOut(duration: 0.2), value: inviteCode.isEmpty)
                    
                    // QR Scanner button
                    Button(action: {
                        showingQRScanner = true
                    }) {
                        Image(systemName: "qrcode.viewfinder")
                            .font(.title2)
                            .foregroundColor(.white)
                            .frame(width: 56, height: 56)
                            .background(
                                LinearGradient(
                                    colors: [.blue, .cyan],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .cornerRadius(16)
                            .shadow(color: Color.blue.opacity(0.3), radius: 8, y: 4)
                    }
                    .scaleEffect(joinButtonPressed ? 0.95 : 1.0)
                    .animation(.easeInOut(duration: 0.1), value: joinButtonPressed)
                }
            }
            .padding(.horizontal, 20)
        }
    }
}