//
//  HitherApp.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI
import Foundation
import FirebaseCore
import GoogleSignIn
import GoogleMaps

@main
struct HitherApp: App {
    @StateObject private var authService = AuthenticationService()
    @StateObject private var notificationService = NotificationService()
    @StateObject private var languageService = LanguageService()
    @StateObject private var themeManager = ThemeManager.shared
    
    init() {
        FirebaseApp.configure()
        
        // Configure Google Maps SDK
        GMSServices.provideAPIKey("AIzaSyCx0cyeUy7O4HEdZcGSlElYJibPVT5ciZQ")
        
        // Configure Google Sign-In
        if let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
           let plist = NSDictionary(contentsOfFile: path),
           let clientId = plist["CLIENT_ID"] as? String,
           !clientId.contains("your-actual-client-id") {
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientId)
        } else {
            print("Warning: Google Sign-In not configured properly. CLIENT_ID missing or using placeholder value.")
        }
        
        // Note: The eligibility.plist warning is a known iOS Simulator issue
        // It doesn't affect app functionality and can be safely ignored
        #if targetEnvironment(simulator)
        print("ℹ️ Running in simulator - eligibility.plist warnings are expected and can be ignored")
        #endif
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authService)
                .environmentObject(notificationService)
                .environmentObject(languageService)
                .environmentObject(themeManager)
                .onAppear {
                    setupNotifications()
                    lockOrientation()
                }
                .onOpenURL { url in
                    // Handle Google Sign-In URLs
                    if GIDSignIn.sharedInstance.handle(url) {
                        return
                    }
                    
                    // Handle deep link URLs (including QR code scans)
                    print("🔗 HitherApp received URL: \(url.absoluteString)")
                    // The URL handling will be passed down to ContentView
                }
        }
    }
    
    private func setupNotifications() {
        Task {
            await notificationService.requestPermission()
            notificationService.setupNotificationCategories()
        }
    }
    
    private func lockOrientation() {
        // Lock app to portrait orientation
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
            let orientationManager = UIDevice.current
            orientationManager.setValue(UIInterfaceOrientation.portrait.rawValue, forKey: "orientation")
        }
        
        // Request portrait orientation lock
        UIDevice.current.setValue(UIInterfaceOrientation.portrait.rawValue, forKey: "orientation")
    }
}
