import SwiftUI
import os.log

@main
struct HitherUIApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var navigationPath = NavigationPath()
    @State private var isLoggedIn = false
    @State private var hasCompletedGroupSetup = false
    
    var body: some View {
        NavigationStack(path: $navigationPath) {
            if !isLoggedIn {
                LoginView {
                    // Handle sign in - navigate to group setup
                    let impactFeedback = UIImpactFeedbackGenerator(style: .heavy)
                    impactFeedback.impactOccurred()
                    print("🔥 HITHER: Sign in button tapped!")
                    isLoggedIn = true
                }
            } else if !hasCompletedGroupSetup {
                GroupSetupView(
                    onCreateGroup: {
                        // Handle group creation - navigate to main app
                        print("🔥 Create group tapped!")
                        hasCompletedGroupSetup = true
                    },
                    onJoinGroup: {
                        // Handle group join - navigate to main app  
                        print("🔥 Join group tapped!")
                        hasCompletedGroupSetup = true
                    }
                )
            } else {
                MainTabView()
            }
        }
        .navigationDestination(for: String.self) { destination in
            switch destination {
            case "GroupSetup":
                GroupSetupView(
                    onCreateGroup: {
                        print("🔥 NavDest Create group tapped!")
                        hasCompletedGroupSetup = true
                    },
                    onJoinGroup: {
                        print("🔥 NavDest Join group tapped!")
                        hasCompletedGroupSetup = true
                    }
                )
            case "MainApp":
                MainTabView()
            default:
                EmptyView()
            }
        }
    }
}

struct MainTabView: View {
    @State private var selectedTab = 0
    
    var body: some View {
        TabBarContainer(items: TabBarItem.defaultItems) { selectedTab in
            switch selectedTab {
            case 0:
                DashboardView()
            case 1:
                MapView()
            case 2:
                ItineraryView()
            case 3:
                SettingsView()
            default:
                DashboardView()
            }
        }
    }
}

#Preview("Content View - Login") {
    ContentView()
}

#Preview("Content View - Main App") {
    ContentView()
        .onAppear {
            // This would show the main app state in a real implementation
        }
}

#Preview("Main Tab View") {
    MainTabView()
}