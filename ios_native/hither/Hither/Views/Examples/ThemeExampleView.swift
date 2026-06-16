//
//  ThemeExampleView.swift
//  Hither
//
//  Created by Claude on 2025/7/30.
//

import SwiftUI

struct ThemeExampleView: View {
    @EnvironmentObject private var themeManager: ThemeManager
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Header with theme-aware text
                    VStack(spacing: 8) {
                        ThemeText("Welcome to Hither", style: .largeTitle, weight: .bold)
                        ThemeText("Experience the power of theming", style: .body, color: .textSecondary)
                    }
                    
                    // Theme-aware cards
                    ThemeCard(style: .primary) {
                        VStack(alignment: .leading, spacing: 12) {
                            ThemeText("Primary Card", style: .headline, weight: .semibold)
                            ThemeText("This card uses the primary theme colors and adapts to any theme changes.", style: .body, color: .textSecondary)
                        }
                    }
                    
                    ThemeCard(style: .success) {
                        VStack(alignment: .leading, spacing: 12) {
                            ThemeText("Success Card", style: .headline, weight: .semibold)
                            ThemeText("This card uses success colors for positive messaging.", style: .body, color: .textSecondary)
                        }
                    }
                    
                    ThemeCard(style: .warning) {
                        VStack(alignment: .leading, spacing: 12) {
                            ThemeText("Warning Card", style: .headline, weight: .semibold)
                            ThemeText("This card uses warning colors for important notices.", style: .body, color: .textSecondary)
                        }
                    }
                    
                    // Theme-aware buttons
                    VStack(spacing: 16) {
                        ThemeText("Button Styles", style: .headline, weight: .semibold)
                        
                        VStack(spacing: 12) {
                            ThemeButton("Primary Button", style: .primary, size: .fullWidth) {
                                print("Primary button tapped")
                            }
                            
                            ThemeButton("Secondary Button", style: .secondary, size: .fullWidth) {
                                print("Secondary button tapped")
                            }
                            
                            ThemeButton("Outline Button", style: .outline, size: .fullWidth) {
                                print("Outline button tapped")
                            }
                            
                            ThemeButton("Ghost Button", style: .ghost, size: .fullWidth) {
                                print("Ghost button tapped")
                            }
                            
                            ThemeButton("Destructive Button", style: .destructive, size: .fullWidth) {
                                print("Destructive button tapped")
                            }
                        }
                    }
                    
                    // Theme-aware text field
                    VStack(alignment: .leading, spacing: 12) {
                        ThemeText("Text Input", style: .headline, weight: .semibold)
                        
                        ThemeTextField("Enter your message", text: .constant(""), style: .default)
                        ThemeTextField("Primary style input", text: .constant(""), style: .primary)
                        ThemeTextField("Ghost style input", text: .constant(""), style: .ghost)
                    }
                    
                    // Typography showcase
                    VStack(alignment: .leading, spacing: 8) {
                        ThemeText("Typography Scale", style: .headline, weight: .semibold)
                        
                        ThemeText("Large Title", style: .largeTitle, weight: .bold)
                        ThemeText("Title 1", style: .title1, weight: .bold)
                        ThemeText("Title 2", style: .title2, weight: .semibold)
                        ThemeText("Title 3", style: .title3, weight: .medium)
                        ThemeText("Headline", style: .headline, weight: .semibold)
                        ThemeText("Body text with proper line spacing and theme colors", style: .body)
                        ThemeText("Callout text", style: .callout)
                        ThemeText("Subheadline", style: .subheadline, color: .textSecondary)
                        ThemeText("Footnote", style: .footnote, color: .textTertiary)
                        ThemeText("Caption 1", style: .caption1, color: .textSecondary)
                        ThemeText("Caption 2", style: .caption2, color: .textTertiary)
                    }
                    
                    // Theme info card
                    ThemeCard {
                        VStack(alignment: .leading, spacing: 12) {
                            ThemeText("Current Theme", style: .headline, weight: .semibold)
                            ThemeText("Custom Theme: \(themeManager.isCustomThemeEnabled ? "Enabled" : "Disabled")", style: .body, color: .textSecondary)
                            ThemeText("Dark Mode: \(themeManager.isDarkMode ? "On" : "Off")", style: .body, color: .textSecondary)
                            
                            HStack(spacing: 12) {
                                ThemeButton("Toggle Dark", style: .outline, size: .medium) {
                                    themeManager.toggleDarkMode()
                                }
                                
                                ThemeButton("Ocean Theme", style: .primary, size: .medium) {
                                    themeManager.applyPredefinedTheme(.ocean)
                                }
                                
                                ThemeButton("Reset", style: .ghost, size: .medium) {
                                    themeManager.resetToDefault()
                                }
                            }
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Theme Example")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}