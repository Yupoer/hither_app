//
//  OnboardingView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct OnboardingView: View {
    @Binding var isPresented: Bool
    @State private var currentPage = 0
    
    private let pages = [
        OnboardingPage(
            icon: "location.circle.fill",
            title: "Stay Connected",
            subtitle: "Keep track of your group members in real-time",
            description: "Never lose sight of your team with live location tracking and precise positioning.",
            color: .blue
        ),
        OnboardingPage(
            icon: "location.north.circle.fill",
            title: "Find Your Way",
            subtitle: "Get precise directions to your group leader",
            description: "Use our compass mode and precision finding to navigate back to your group with ease.",
            color: .green
        ),
        OnboardingPage(
            icon: "megaphone.fill",
            title: "Instant Communication",
            subtitle: "Send commands and messages to your entire group",
            description: "Leaders can broadcast quick commands like 'Gather' or 'Rest' to all members instantly.",
            color: .orange
        ),
        OnboardingPage(
            icon: "list.bullet.circle.fill",
            title: "Plan Your Journey",
            subtitle: "Create and manage waypoints for your adventure",
            description: "Set meeting points, rest stops, and destinations to keep your group organized.",
            color: .purple
        )
    ]
    
    var body: some View {
        VStack(spacing: 0) {
            // Page indicator
            HStack {
                Spacer()
                
                HStack(spacing: 8) {
                    ForEach(0..<pages.count, id: \.self) { index in
                        Circle()
                            .fill(index == currentPage ? Color.blue : Color.gray.opacity(0.3))
                            .frame(width: 8, height: 8)
                            .animation(.easeInOut, value: currentPage)
                    }
                }
                
                Spacer()
            }
            .padding(.top, 20)
            
            // Content
            TabView(selection: $currentPage) {
                ForEach(Array(pages.enumerated()), id: \.offset) { index, page in
                    OnboardingPageView(page: page)
                        .tag(index)
                }
            }
            .tabViewStyle(PageTabViewStyle(indexDisplayMode: .never))
            
            // Navigation buttons
            HStack {
                if currentPage > 0 {
                    Button("Previous") {
                        withAnimation {
                            currentPage -= 1
                        }
                    }
                    .foregroundColor(.blue)
                } else {
                    Spacer()
                }
                
                Spacer()
                
                if currentPage < pages.count - 1 {
                    Button("Next") {
                        withAnimation {
                            currentPage += 1
                        }
                    }
                    .foregroundColor(.blue)
                    .fontWeight(.semibold)
                } else {
                    Button("Get Started") {
                        isPresented = false
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(8)
                    .fontWeight(.semibold)
                }
            }
            .padding()
        }
        .background(Color.white)
    }
}

struct OnboardingPage {
    let icon: String
    let title: String
    let subtitle: String
    let description: String
    let color: Color
}

struct OnboardingPageView: View {
    let page: OnboardingPage
    
    var body: some View {
        VStack(spacing: 32) {
            Spacer()
            
            // Icon
            Image(systemName: page.icon)
                .font(.system(size: 80))
                .foregroundColor(page.color)
            
            // Content
            VStack(spacing: 16) {
                Text(page.title)
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .multilineTextAlignment(.center)
                
                Text(page.subtitle)
                    .font(.title3)
                    .fontWeight(.medium)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                
                Text(page.description)
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            
            Spacer()
        }
        .padding()
    }
}

#Preview {
    OnboardingView(isPresented: .constant(true))
}