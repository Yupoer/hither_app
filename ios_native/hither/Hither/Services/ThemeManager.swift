//
//  ThemeManager.swift
//  Hither
//
//  Created by Claude on 2025/7/30.
//

import SwiftUI
import Combine
import Foundation

// MARK: - Theme Manager
@MainActor
class ThemeManager: ObservableObject {
    static let shared = ThemeManager()
    
    @Published var currentTheme: ThemeConfiguration
    @Published var isDarkMode: Bool = false
    @Published var isCustomThemeEnabled: Bool = false
    
    private let userDefaults = UserDefaults.standard
    private let themeKey = "HitherCustomTheme"
    private let darkModeKey = "HitherDarkMode"
    private let customThemeEnabledKey = "HitherCustomThemeEnabled"
    
    private init() {
        // Load saved theme or use default
        if let savedThemeData = userDefaults.data(forKey: themeKey),
           let savedTheme = try? JSONDecoder().decode(ThemeConfiguration.self, from: savedThemeData) {
            self.currentTheme = savedTheme
        } else {
            self.currentTheme = .default
        }
        
        self.isDarkMode = userDefaults.bool(forKey: darkModeKey)
        self.isCustomThemeEnabled = userDefaults.bool(forKey: customThemeEnabledKey)
        
        // Adapt theme based on system appearance if custom theme is disabled
        if !isCustomThemeEnabled {
            updateThemeForSystemAppearance()
        }
    }
    
    // MARK: - Theme Management
    func updateTheme(_ theme: ThemeConfiguration) {
        currentTheme = theme
        isCustomThemeEnabled = true
        saveTheme()
    }
    
    func resetToDefault() {
        currentTheme = .default
        isCustomThemeEnabled = false
        saveTheme()
    }
    
    func toggleDarkMode() {
        isDarkMode.toggle()
        userDefaults.set(isDarkMode, forKey: darkModeKey)
        
        if !isCustomThemeEnabled {
            updateThemeForSystemAppearance()
        }
    }
    
    private func updateThemeForSystemAppearance() {
        if isDarkMode {
            currentTheme = createDarkTheme()
        } else {
            currentTheme = .default
        }
    }
    
    private func createDarkTheme() -> ThemeConfiguration {
        var darkTheme = ThemeConfiguration.default
        
        // Update colors for dark mode
        darkTheme.colors.background = ColorConfig(hex: "#000000", alpha: 1.0)
        darkTheme.colors.surface = ColorConfig(hex: "#1C1C1E", alpha: 1.0)
        darkTheme.colors.text.primary = ColorConfig(hex: "#FFFFFF", alpha: 1.0)
        darkTheme.colors.text.secondary = ColorConfig(hex: "#8E8E93", alpha: 1.0)
        darkTheme.colors.text.tertiary = ColorConfig(hex: "#48484A", alpha: 1.0)
        darkTheme.colors.card.background = ColorConfig(hex: "#1C1C1E", alpha: 0.8)
        darkTheme.colors.navigation.background = ColorConfig(hex: "#000000", alpha: 0.95)
        darkTheme.colors.navigation.text = ColorConfig(hex: "#FFFFFF", alpha: 1.0)
        
        return darkTheme
    }
    
    private func saveTheme() {
        if let themeData = try? JSONEncoder().encode(currentTheme) {
            userDefaults.set(themeData, forKey: themeKey)
        }
        userDefaults.set(isCustomThemeEnabled, forKey: customThemeEnabledKey)
    }
    
    // MARK: - Predefined Themes
    func applyPredefinedTheme(_ themeType: PredefinedThemeType) {
        switch themeType {
        case .default:
            currentTheme = .default
        case .dark:
            currentTheme = createDarkTheme()
        case .ocean:
            currentTheme = createOceanTheme()
        case .forest:
            currentTheme = createForestTheme()
        case .sunset:
            currentTheme = createSunsetTheme()
        case .minimal:
            currentTheme = createMinimalTheme()
        }
        
        isCustomThemeEnabled = true
        saveTheme()
    }
    
    private func createOceanTheme() -> ThemeConfiguration {
        var theme = ThemeConfiguration.default
        theme.colors.primary = ColorConfig(hex: "#006994", alpha: 1.0)
        theme.colors.secondary = ColorConfig(hex: "#4A90A4", alpha: 1.0)
        theme.colors.accent = ColorConfig(hex: "#00A9D4", alpha: 1.0)
        theme.colors.background = ColorConfig(hex: "#E8F4F8", alpha: 1.0)
        theme.colors.surface = ColorConfig(hex: "#FFFFFF", alpha: 0.9)
        theme.colors.button.primaryBackground = ColorConfig(hex: "#006994", alpha: 1.0)
        return theme
    }
    
    private func createForestTheme() -> ThemeConfiguration {
        var theme = ThemeConfiguration.default
        theme.colors.primary = ColorConfig(hex: "#2D5016", alpha: 1.0)
        theme.colors.secondary = ColorConfig(hex: "#6B8E23", alpha: 1.0)
        theme.colors.accent = ColorConfig(hex: "#9ACD32", alpha: 1.0)
        theme.colors.background = ColorConfig(hex: "#F0F8E8", alpha: 1.0)
        theme.colors.surface = ColorConfig(hex: "#FFFFFF", alpha: 0.9)
        theme.colors.button.primaryBackground = ColorConfig(hex: "#2D5016", alpha: 1.0)
        return theme
    }
    
    private func createSunsetTheme() -> ThemeConfiguration {
        var theme = ThemeConfiguration.default
        theme.colors.primary = ColorConfig(hex: "#FF6B35", alpha: 1.0)
        theme.colors.secondary = ColorConfig(hex: "#F7931E", alpha: 1.0)
        theme.colors.accent = ColorConfig(hex: "#FFD23F", alpha: 1.0)
        theme.colors.background = ColorConfig(hex: "#FFF8F0", alpha: 1.0)
        theme.colors.surface = ColorConfig(hex: "#FFFFFF", alpha: 0.9)
        theme.colors.button.primaryBackground = ColorConfig(hex: "#FF6B35", alpha: 1.0)
        return theme
    }
    
    private func createMinimalTheme() -> ThemeConfiguration {
        var theme = ThemeConfiguration.default
        theme.colors.primary = ColorConfig(hex: "#1A1A1A", alpha: 1.0)
        theme.colors.secondary = ColorConfig(hex: "#666666", alpha: 1.0)
        theme.colors.accent = ColorConfig(hex: "#333333", alpha: 1.0)
        theme.colors.background = ColorConfig(hex: "#FAFAFA", alpha: 1.0)
        theme.colors.surface = ColorConfig(hex: "#FFFFFF", alpha: 0.95)
        theme.colors.button.primaryBackground = ColorConfig(hex: "#1A1A1A", alpha: 1.0)
        theme.effects.blur.intensity = 0.3
        theme.components.cards.materialOpacity = 0.4
        return theme
    }
    
    // MARK: - Theme Property Helpers
    func font(style: FontStyle, size: FontSize? = nil) -> Font {
        let fontName = currentTheme.typography.fonts.primary
        let fontSize = size?.value(from: currentTheme.typography.sizes) ?? style.defaultSize(from: currentTheme.typography.sizes)
        
        return Font.custom(fontName, size: fontSize)
    }
    
    func color(_ colorType: ThemeColorType) -> Color {
        switch colorType {
        case .primary:
            return currentTheme.colors.primary.color
        case .secondary:
            return currentTheme.colors.secondary.color
        case .accent:
            return currentTheme.colors.accent.color
        case .background:
            return currentTheme.colors.background.color
        case .surface:
            return currentTheme.colors.surface.color
        case .textPrimary:
            return currentTheme.colors.text.primary.color
        case .textSecondary:
            return currentTheme.colors.text.secondary.color
        case .textTertiary:
            return currentTheme.colors.text.tertiary.color
        case .textInverse:
            return currentTheme.colors.text.inverse.color
        case .success:
            return currentTheme.colors.success.color
        case .warning:
            return currentTheme.colors.warning.color
        case .error:
            return currentTheme.colors.error.color
        case .info:
            return currentTheme.colors.info.color
        }
    }
    
    func animation() -> Animation? {
        guard currentTheme.effects.animations.enabled else { return nil }
        
        return .spring(
            response: currentTheme.effects.animations.springResponse,
            dampingFraction: currentTheme.effects.animations.springDampingFraction
        )
    }
}

// MARK: - Theme Types
enum PredefinedThemeType: String, CaseIterable {
    case `default` = "Default"
    case dark = "Dark"
    case ocean = "Ocean"
    case forest = "Forest"
    case sunset = "Sunset"
    case minimal = "Minimal"
    
    var displayName: String {
        switch self {
        case .default: return "Default"
        case .dark: return "Dark"
        case .ocean: return "Ocean Blue"
        case .forest: return "Forest Green"
        case .sunset: return "Sunset Orange"
        case .minimal: return "Minimal"
        }
    }
}

enum ThemeColorType {
    case primary, secondary, accent
    case background, surface
    case textPrimary, textSecondary, textTertiary, textInverse
    case success, warning, error, info
}

enum FontStyle {
    case largeTitle, title1, title2, title3
    case headline, body, callout, subheadline
    case footnote, caption1, caption2
    
    func defaultSize(from sizes: FontSizes) -> Double {
        switch self {
        case .largeTitle: return sizes.largeTitle
        case .title1: return sizes.title1
        case .title2: return sizes.title2
        case .title3: return sizes.title3
        case .headline: return sizes.headline
        case .body: return sizes.body
        case .callout: return sizes.callout
        case .subheadline: return sizes.subheadline
        case .footnote: return sizes.footnote
        case .caption1: return sizes.caption1
        case .caption2: return sizes.caption2
        }
    }
}

enum FontSize {
    case custom(Double)
    case small, medium, large
    
    func value(from sizes: FontSizes) -> Double {
        switch self {
        case .custom(let size): return size
        case .small: return sizes.caption1
        case .medium: return sizes.body
        case .large: return sizes.headline
        }
    }
}

// MARK: - Environment Key
struct ThemeManagerKey: EnvironmentKey {
    static let defaultValue = ThemeManager.shared
}

extension EnvironmentValues {
    var themeManager: ThemeManager {
        get { self[ThemeManagerKey.self] }
        set { self[ThemeManagerKey.self] = newValue }
    }
}