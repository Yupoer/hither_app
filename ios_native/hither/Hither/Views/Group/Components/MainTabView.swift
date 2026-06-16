//
//  MainTabView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var authService: AuthenticationService
    @EnvironmentObject private var groupService: GroupService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    
    var body: some View {
        TabView(content: {
            DashboardView()
                .environmentObject(authService)
                .environmentObject(groupService)
                .environmentObject(languageService)
                .environmentObject(themeManager)
                .tabItem {
                    Image(systemName: "gauge.with.dots.needle.67percent")
                    Text("dashboard".localized)
                }
            
            MapView()
                .environmentObject(authService)
                .environmentObject(groupService)
                .environmentObject(languageService)
                .environmentObject(themeManager)
                .tabItem {
                    Image(systemName: "map")
                    Text("map".localized)
                }
            
            ItineraryView()
                .environmentObject(authService)
                .environmentObject(groupService)
                .environmentObject(languageService)
                .environmentObject(themeManager)
                .tabItem {
                    Image(systemName: "list.bullet")
                    Text("itinerary".localized)
                }
            
            SettingsView()
                .environmentObject(authService)
                .environmentObject(groupService)
                .environmentObject(languageService)
                .environmentObject(themeManager)
                .tabItem {
                    Image(systemName: "gearshape")
                    Text("settings".localized)
                }
        })
    }
}