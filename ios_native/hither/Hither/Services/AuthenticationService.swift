//
//  AuthenticationService.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation
import UIKit
import FirebaseAuth
import AuthenticationServices
import GoogleSignIn

@MainActor
class AuthenticationService: ObservableObject {
    @Published var currentUser: HitherUser?
    @Published var isAuthenticated = false
    @Published var isLoading = true
    @Published var errorMessage: String?
    
    private var authStateListenerHandle: AuthStateDidChangeListenerHandle?
    
    init() {
        setupAuthStateListener()
    }
    
    deinit {
        if let handle = authStateListenerHandle {
            Auth.auth().removeStateDidChangeListener(handle)
        }
    }
    
    private func setupAuthStateListener() {
        let startTime = Date()
        
        authStateListenerHandle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor in
                // Ensure minimum loading time of 1.5 seconds for smooth UX
                let elapsedTime = Date().timeIntervalSince(startTime)
                let minimumLoadingTime: TimeInterval = 1.5
                
                if elapsedTime < minimumLoadingTime {
                    try? await Task.sleep(nanoseconds: UInt64((minimumLoadingTime - elapsedTime) * 1_000_000_000))
                }
                
                if let user = user {
                    let hitherUser = HitherUser(from: user)
                    self?.currentUser = hitherUser
                    self?.isAuthenticated = true
                } else {
                    self?.currentUser = nil
                    self?.isAuthenticated = false
                }
                self?.isLoading = false
            }
        }
    }
    
    func signInWithApple() async {
        isLoading = true
        errorMessage = nil
        
        do {
            let appleIDProvider = ASAuthorizationAppleIDProvider()
            let request = appleIDProvider.createRequest()
            request.requestedScopes = [.fullName, .email]
            
            let authorizationController = ASAuthorizationController(authorizationRequests: [request])
            // Note: In a real implementation, you'd need to implement ASAuthorizationControllerDelegate
            // and handle the sign-in flow properly
            
        } catch {
            errorMessage = "Apple Sign-In failed: \(error.localizedDescription)"
            isLoading = false
        }
    }
    
    func signInWithGoogle() async {
        isLoading = true
        errorMessage = nil
        
        print("🔍 Starting Google Sign-In...")
        
        // Check if Google Sign-In is configured
        guard GIDSignIn.sharedInstance.configuration != nil else {
            errorMessage = "Google Sign-In not configured"
            print("❌ Google Sign-In configuration is nil")
            isLoading = false
            return
        }
        
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let presentingViewController = windowScene.windows.first?.rootViewController else {
            errorMessage = "Unable to get presenting view controller"
            print("❌ Unable to get presenting view controller")
            isLoading = false
            return
        }
        
        print("🔍 Found presenting view controller: \(presentingViewController)")
        
        do {
            print("🔍 Attempting Google Sign-In...")
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presentingViewController)
            print("🔍 Google Sign-In result received")
            
            guard let idToken = result.user.idToken?.tokenString else {
                errorMessage = "Failed to get Google ID token"
                print("❌ Failed to get Google ID token")
                isLoading = false
                return
            }
            
            print("🔍 Got Google ID token")
            
            let accessToken = result.user.accessToken.tokenString
            let credential = GoogleAuthProvider.credential(withIDToken: idToken, accessToken: accessToken)
            
            print("🔍 Attempting Firebase authentication...")
            let authResult = try await Auth.auth().signIn(with: credential)
            print("✅ Firebase authentication successful")
            
            currentUser = HitherUser(from: authResult.user)
            isAuthenticated = true
            
        } catch {
            print("❌ Google Sign-In error: \(error)")
            errorMessage = "Google Sign-In failed: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    func signInWithEmail(_ email: String, password: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let result = try await Auth.auth().signIn(withEmail: email, password: password)
            currentUser = HitherUser(from: result.user)
            isAuthenticated = true
        } catch {
            errorMessage = "Email sign-in failed: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    func signUpWithEmail(_ email: String, password: String, displayName: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let result = try await Auth.auth().createUser(withEmail: email, password: password)
            
            let changeRequest = result.user.createProfileChangeRequest()
            changeRequest.displayName = displayName
            try await changeRequest.commitChanges()
            
            currentUser = HitherUser(from: result.user)
            isAuthenticated = true
        } catch {
            errorMessage = "Email sign-up failed: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    func signOut() {
        do {
            try Auth.auth().signOut()
            currentUser = nil
            isAuthenticated = false
        } catch {
            errorMessage = "Sign-out failed: \(error.localizedDescription)"
        }
    }
}
