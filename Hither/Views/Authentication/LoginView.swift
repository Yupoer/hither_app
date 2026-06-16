//
//  LoginView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var authService: AuthenticationService
    @EnvironmentObject private var languageService: LanguageService
    @StateObject private var locationService = LocationService()
    @State private var email = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var isSignUp = false
    @State private var isButtonPressed = false
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 32) {
                    // Hero section with liquid glass treatment
                    VStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(.ultraThinMaterial)
                                .frame(width: 120, height: 120)
                                .overlay(
                                    Circle()
                                        .stroke(
                                            LinearGradient(
                                                colors: [Color.blue.opacity(0.4), Color.purple.opacity(0.2)],
                                                startPoint: .topLeading,
                                                endPoint: .bottomTrailing
                                            ),
                                            lineWidth: 2
                                        )
                                )
                                .shadow(color: Color.blue.opacity(0.2), radius: 20, y: 8)
                            
                            Image(systemName: "location.circle.fill")
                                .font(.system(size: 70))
                                .foregroundStyle(
                                    LinearGradient(
                                        colors: [.blue, .purple],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                        }
                        
                        VStack(spacing: 8) {
                            Text("app_name".localized)
                                .font(.largeTitle)
                                .fontWeight(.bold)
                                .foregroundStyle(
                                    LinearGradient(
                                        colors: [.primary, .secondary],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                            
                            Text("app_subtitle".localized)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                        }
                    }
                    //.liquidGlassCard(cornerRadius: 28, material: .primary, shadow: .prominent)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 32)
                
                // Authentication form with liquid glass treatment
                VStack(spacing: 20) {
                    if isSignUp {
                        HStack {
                            Image(systemName: "person")
                                .foregroundColor(.blue.opacity(0.7))
                                .frame(width: 20)
                            TextField("display_name".localized, text: $displayName)
                                .foregroundColor(.primary)
                        }
                        .padding()
                        .background(.ultraThinMaterial)
                        .cornerRadius(16)
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(
                                    LinearGradient(
                                        colors: [Color.white.opacity(0.3), Color.white.opacity(0.1)],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    ),
                                    lineWidth: 0.5
                                )
                        )
                        .shadow(color: Color.black.opacity(0.05), radius: 8, y: 4)
                        .onSubmit {
                            // Move focus to email field when Enter is pressed
                        }
                    }
                    
                    HStack {
                        Image(systemName: "envelope")
                            .foregroundColor(.blue.opacity(0.7))
                            .frame(width: 20)
                        TextField("email".localized, text: $email)
                            .foregroundColor(.primary)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                    }
                    .padding()
                    .background(.ultraThinMaterial)
                    .cornerRadius(16)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(
                                LinearGradient(
                                    colors: [Color.white.opacity(0.3), Color.white.opacity(0.1)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 0.5
                            )
                    )
                    .shadow(color: Color.black.opacity(0.05), radius: 8, y: 4)
                    .onSubmit {
                        // Move focus to password field when Enter is pressed
                    }
                    
                    HStack {
                        Image(systemName: "lock")
                            .foregroundColor(.blue.opacity(0.7))
                            .frame(width: 20)
                        SecureField("password".localized, text: $password)
                            .foregroundColor(.primary)
                    }
                    .padding()
                    .background(.ultraThinMaterial)
                    .cornerRadius(16)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(
                                LinearGradient(
                                    colors: [Color.white.opacity(0.3), Color.white.opacity(0.1)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 0.5
                            )
                    )
                    .shadow(color: Color.black.opacity(0.05), radius: 8, y: 4)
                    .onSubmit {
                        // Trigger sign in when Enter is pressed on password field
                        handleSignIn()
                    }
                    
                    DarkBlueButton(variant: .primary, action: {
                        // Immediate feedback
                        isButtonPressed = true
                        
                        // Provide haptic feedback
                        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                        impactFeedback.impactOccurred()
                        
                        Task {
                            if isSignUp {
                                await authService.signUpWithEmail(email, password: password, displayName: displayName)
                            } else {
                                await authService.signInWithEmail(email, password: password)
                            }
                            
                            // Reset button state
                            await MainActor.run {
                                isButtonPressed = false
                            }
                        }
                    }) {
                        HStack(spacing: 12) {
                            if isButtonPressed {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .scaleEffect(0.8)
                            } else {
                                Image(systemName: isSignUp ? "person.badge.plus" : "person.circle")
                                    .font(.title3)
                            }
                            
                            Text(isSignUp ? "sign_up".localized : "sign_in".localized)
                                .fontWeight(.semibold)
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                    }
                    .disabled(authService.isLoading || email.isEmpty || password.isEmpty || (isSignUp && displayName.isEmpty))
                    
                    Button(isSignUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up") {
                        withAnimation(.easeInOut(duration: 0.3)) {
                            isSignUp.toggle()
                            email = ""
                            password = ""
                            displayName = ""
                        }
                    }
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .fontWeight(.medium)
                }
                
                Divider()
                    .padding(.vertical)
                
                // Social login with liquid glass treatment
                VStack(spacing: 16) {
                    DarkBlueButton(variant: .secondary, action: {
                        Task {
                            await authService.signInWithApple()
                        }
                    }) {
                        HStack(spacing: 12) {
                            Image(systemName: "applelogo")
                                .font(.title3)
                            Text("Continue with Apple")
                                .fontWeight(.semibold)
                        }
                        .foregroundColor(.primary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                    }
                    
                    DarkBlueButton(variant: .secondary, action: {
                        Task {
                            await authService.signInWithGoogle()
                        }
                    }) {
                        HStack(spacing: 12) {
                            Image(systemName: "globe")
                                .font(.title3)
                                .foregroundColor(.red)
                            Text("Continue with Google")
                                .fontWeight(.semibold)
                        }
                        .foregroundColor(.primary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                    }
                }
                .padding(.horizontal, 20)
                
                // Loading and error states with liquid glass treatment
                if authService.isLoading {
                    VStack(spacing: 12) {
                        SheepLoadingView(message: "Signing you in...")
                    }
                    .padding(20)
                    .darkBlueCard(cornerRadius: 16)
                    .padding(.horizontal, 20)
                }
                
                if let errorMessage = authService.errorMessage {
                    Text(errorMessage)
                        .foregroundColor(.red)
                        .font(.caption)
                        .fontWeight(.medium)
                        .multilineTextAlignment(.center)
                        .padding(16)
                        .darkBlueCard(cornerRadius: 12)
                        .padding(.horizontal, 20)
                }
                
                Spacer(minLength: 32)
                }
                .padding(20)
            }
            .navigationTitle("")
            .navigationBarHidden(false)
            .navigationBarItems(trailing: LanguagePicker(languageService: languageService))
            .onAppear {
                // Preload location services for better map performance
                locationService.preloadLocationServices()
            }
        }
    }
    
    private func handleSignIn() {
        // Only trigger sign in if all required fields are filled
        guard !email.isEmpty && !password.isEmpty else { return }
        if isSignUp && displayName.isEmpty { return }
        
        Task {
            if isSignUp {
                await authService.signUpWithEmail(email, password: password, displayName: displayName)
            } else {
                await authService.signInWithEmail(email, password: password)
            }
        }
    }
}


