//
//  BadgeSystemView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct BadgeSystemView: View {
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    @Environment(\.presentationMode) var presentationMode
    @State private var earnedBadges: [Badge] = []
    @State private var allBadges: [Badge] = []
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    VStack(spacing: 12) {
                        Image(systemName: "star.circle.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.yellow)
                        
                        Text("badge_system".localized)
                            .font(.title2)
                            .fontWeight(.semibold)
                        
                        Text("badge_system_description".localized)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.bottom, 20)
                    
                    // Earned badges section
                    if !earnedBadges.isEmpty {
                        VStack(alignment: .leading, spacing: 16) {
                            Text("earned_badges".localized)
                                .font(.headline)
                                .foregroundColor(.green)
                            
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .top), count: 2), spacing: 16) {
                                ForEach(earnedBadges) { badge in
                                    BadgeCard(badge: badge, isEarned: true)
                                }
                            }
                        }
                    }
                    
                    // All badges section
                    VStack(alignment: .leading, spacing: 16) {
                        Text(earnedBadges.isEmpty ? "available_badges".localized : "more_badges".localized)
                            .font(.headline)
                        
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .top), count: 2), spacing: 16) {
                            ForEach(allBadges) { badge in
                                BadgeCard(badge: badge, isEarned: earnedBadges.contains(where: { $0.id == badge.id }))
                            }
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Badges")
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarItems(
                trailing: Button("Done") {
                    presentationMode.wrappedValue.dismiss()
                }
            )
        }
        .onAppear {
            loadBadges()
        }
    }
    
    private func loadBadges() {
        // Sample badges - in real app, load from user data
        allBadges = [
            Badge(id: "punctual_sheep", name: "最準時小羊", emoji: "🐑", description: "badge_punctual_sheep".localized, isRare: false),
            Badge(id: "pathfinder", name: "探路者", emoji: "🧭", description: "badge_pathfinder".localized, isRare: false),
            Badge(id: "guardian", name: "守護者", emoji: "🐕", description: "badge_guardian".localized, isRare: false),
            Badge(id: "early_bird", name: "早起鳥", emoji: "🐦", description: "badge_early_bird".localized, isRare: false),
            Badge(id: "night_owl", name: "夜貓子", emoji: "🦉", description: "badge_night_owl".localized, isRare: false),
            Badge(id: "social_butterfly", name: "社交蝴蝶", emoji: "🦋", description: "badge_social_butterfly".localized, isRare: true),
            Badge(id: "adventure_seeker", name: "冒險家", emoji: "🗺️", description: "badge_adventure_seeker".localized, isRare: true),
            Badge(id: "helping_hand", name: "熱心助手", emoji: "🤝", description: "badge_helping_hand".localized, isRare: false)
        ]
        
        // Sample earned badges
        earnedBadges = [
            Badge(id: "punctual_sheep", name: "最準時小羊", emoji: "🐑", description: "badge_punctual_sheep".localized, isRare: false),
            Badge(id: "guardian", name: "守護者", emoji: "🐕", description: "badge_guardian".localized, isRare: false)
        ]
    }
}

struct Badge: Identifiable {
    let id: String
    let name: String
    let emoji: String
    let description: String
    let isRare: Bool
}

struct BadgeCard: View {
    let badge: Badge
    let isEarned: Bool
    
    var body: some View {
        VStack(spacing: 12) {
            Text(badge.emoji)
                .font(.system(size: 40))
                .opacity(isEarned ? 1.0 : 0.3)
            
            VStack(spacing: 4) {
                Text(badge.name)
                    .font(.headline)
                    .foregroundColor(isEarned ? .primary : .secondary)
                
                Text(badge.description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            
            if badge.isRare {
                HStack(spacing: 4) {
                    Image(systemName: "star.fill")
                        .foregroundColor(.yellow)
                        .font(.caption)
                    Text("Rare")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.yellow)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .frame(minHeight: 140)
        .background(isEarned ? Color.green.opacity(0.1) : Color.gray.opacity(0.05))
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(isEarned ? Color.green : Color.gray.opacity(0.3), lineWidth: isEarned ? 2 : 1)
        )
    }
}