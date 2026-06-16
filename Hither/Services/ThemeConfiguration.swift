//
//  ThemeConfiguration.swift
//  Hither
//
//  Created by Claude on 2025/7/30.
//

import SwiftUI
import Foundation

// MARK: - Theme Configuration
struct ThemeConfiguration: Codable {
    // MARK: - Colors
    var colors: ColorScheme
    
    // MARK: - Typography
    var typography: Typography
    
    // MARK: - Components
    var components: ComponentStyles
    
    // MARK: - Effects
    var effects: VisualEffects
    
    // MARK: - Default Configuration
    static let `default` = ThemeConfiguration(
        colors: ColorScheme.default,
        typography: Typography.default,
        components: ComponentStyles.default,
        effects: VisualEffects.default
    )
}

// MARK: - Color Scheme
struct ColorScheme: Codable {
    // Primary Colors
    var primary: ColorConfig
    var secondary: ColorConfig
    var accent: ColorConfig
    
    // System Colors
    var background: ColorConfig
    var surface: ColorConfig
    var text: TextColors
    
    // Status Colors
    var success: ColorConfig
    var warning: ColorConfig
    var error: ColorConfig
    var info: ColorConfig
    
    // Component Specific
    var button: ButtonColors
    var card: CardColors
    var navigation: NavigationColors
    
    static let `default` = ColorScheme(
        primary: ColorConfig(hex: "#007AFF", alpha: 1.0),
        secondary: ColorConfig(hex: "#8E8E93", alpha: 1.0),
        accent: ColorConfig(hex: "#FF3B30", alpha: 1.0),
        background: ColorConfig(hex: "#F2F2F7", alpha: 1.0),
        surface: ColorConfig(hex: "#FFFFFF", alpha: 1.0),
        text: TextColors.default,
        success: ColorConfig(hex: "#34C759", alpha: 1.0),
        warning: ColorConfig(hex: "#FF9500", alpha: 1.0),
        error: ColorConfig(hex: "#FF3B30", alpha: 1.0),
        info: ColorConfig(hex: "#007AFF", alpha: 1.0),
        button: ButtonColors.default,
        card: CardColors.default,
        navigation: NavigationColors.default
    )
}

struct ColorConfig: Codable {
    var hex: String
    var alpha: Double
    
    var color: Color {
        Color(hex: hex).opacity(alpha)
    }
}

struct TextColors: Codable {
    var primary: ColorConfig
    var secondary: ColorConfig
    var tertiary: ColorConfig
    var inverse: ColorConfig
    
    static let `default` = TextColors(
        primary: ColorConfig(hex: "#000000", alpha: 1.0),
        secondary: ColorConfig(hex: "#8E8E93", alpha: 1.0),
        tertiary: ColorConfig(hex: "#C7C7CC", alpha: 1.0),
        inverse: ColorConfig(hex: "#FFFFFF", alpha: 1.0)
    )
}

struct ButtonColors: Codable {
    var primaryBackground: ColorConfig
    var primaryText: ColorConfig
    var secondaryBackground: ColorConfig
    var secondaryText: ColorConfig
    var destructiveBackground: ColorConfig
    var destructiveText: ColorConfig
    
    static let `default` = ButtonColors(
        primaryBackground: ColorConfig(hex: "#007AFF", alpha: 1.0),
        primaryText: ColorConfig(hex: "#FFFFFF", alpha: 1.0),
        secondaryBackground: ColorConfig(hex: "#8E8E93", alpha: 0.2),
        secondaryText: ColorConfig(hex: "#007AFF", alpha: 1.0),
        destructiveBackground: ColorConfig(hex: "#FF3B30", alpha: 1.0),
        destructiveText: ColorConfig(hex: "#FFFFFF", alpha: 1.0)
    )
}

struct CardColors: Codable {
    var background: ColorConfig
    var border: ColorConfig
    var shadow: ColorConfig
    
    static let `default` = CardColors(
        background: ColorConfig(hex: "#FFFFFF", alpha: 0.8),
        border: ColorConfig(hex: "#FFFFFF", alpha: 0.3),
        shadow: ColorConfig(hex: "#000000", alpha: 0.1)
    )
}

struct NavigationColors: Codable {
    var background: ColorConfig
    var text: ColorConfig
    var tint: ColorConfig
    
    static let `default` = NavigationColors(
        background: ColorConfig(hex: "#F2F2F7", alpha: 0.95),
        text: ColorConfig(hex: "#000000", alpha: 1.0),
        tint: ColorConfig(hex: "#007AFF", alpha: 1.0)
    )
}

// MARK: - Typography
struct Typography: Codable {
    var fonts: FontConfiguration
    var sizes: FontSizes
    var weights: FontWeights
    var lineSpacing: Double
    var letterSpacing: Double
    
    static let `default` = Typography(
        fonts: FontConfiguration.default,
        sizes: FontSizes.default,
        weights: FontWeights.default,
        lineSpacing: 1.2,
        letterSpacing: 0.0
    )
}

struct FontConfiguration: Codable {
    var primary: String
    var secondary: String
    var monospace: String
    
    static let `default` = FontConfiguration(
        primary: "SF Pro Display",
        secondary: "SF Pro Text",
        monospace: "SF Mono"
    )
}

struct FontSizes: Codable {
    var largeTitle: Double
    var title1: Double
    var title2: Double
    var title3: Double
    var headline: Double
    var body: Double
    var callout: Double
    var subheadline: Double
    var footnote: Double
    var caption1: Double
    var caption2: Double
    
    static let `default` = FontSizes(
        largeTitle: 34.0,
        title1: 28.0,
        title2: 22.0,
        title3: 20.0,
        headline: 17.0,
        body: 17.0,
        callout: 16.0,
        subheadline: 15.0,
        footnote: 13.0,
        caption1: 12.0,
        caption2: 11.0
    )
}

struct FontWeights: Codable {
    var ultraLight: String
    var thin: String
    var light: String
    var regular: String
    var medium: String
    var semibold: String
    var bold: String
    var heavy: String
    var black: String
    
    static let `default` = FontWeights(
        ultraLight: "ultraLight",
        thin: "thin",
        light: "light",
        regular: "regular",
        medium: "medium",
        semibold: "semibold",
        bold: "bold",
        heavy: "heavy",
        black: "black"
    )
}

// MARK: - Component Styles
struct ComponentStyles: Codable {
    var buttons: ButtonStyles
    var cards: CardStyles
    var textFields: TextFieldStyles
    var toggles: ToggleStyles
    
    static let `default` = ComponentStyles(
        buttons: ButtonStyles.default,
        cards: CardStyles.default,
        textFields: TextFieldStyles.default,
        toggles: ToggleStyles.default
    )
}

struct ButtonStyles: Codable {
    var cornerRadius: Double
    var borderWidth: Double
    var padding: EdgeInsetsConfig
    var minHeight: Double
    var shadowRadius: Double
    var shadowOffset: OffsetConfig
    
    static let `default` = ButtonStyles(
        cornerRadius: 12.0,
        borderWidth: 1.0,
        padding: EdgeInsetsConfig(top: 16, leading: 24, bottom: 16, trailing: 24),
        minHeight: 44.0,
        shadowRadius: 4.0,
        shadowOffset: OffsetConfig(x: 0, y: 2)
    )
}

struct CardStyles: Codable {
    var cornerRadius: Double
    var borderWidth: Double
    var padding: EdgeInsetsConfig
    var shadowRadius: Double
    var shadowOffset: OffsetConfig
    var materialOpacity: Double
    
    static let `default` = CardStyles(
        cornerRadius: 20.0,
        borderWidth: 0.5,
        padding: EdgeInsetsConfig(top: 20, leading: 20, bottom: 20, trailing: 20),
        shadowRadius: 10.0,
        shadowOffset: OffsetConfig(x: 0, y: 4),
        materialOpacity: 0.65
    )
}

struct TextFieldStyles: Codable {
    var cornerRadius: Double
    var borderWidth: Double
    var padding: EdgeInsetsConfig
    var minHeight: Double
    
    static let `default` = TextFieldStyles(
        cornerRadius: 8.0,
        borderWidth: 1.0,
        padding: EdgeInsetsConfig(top: 12, leading: 16, bottom: 12, trailing: 16),
        minHeight: 44.0
    )
}

struct ToggleStyles: Codable {
    var scale: Double
    var padding: EdgeInsetsConfig
    
    static let `default` = ToggleStyles(
        scale: 1.0,
        padding: EdgeInsetsConfig(top: 8, leading: 12, bottom: 8, trailing: 12)
    )
}

// MARK: - Visual Effects
struct VisualEffects: Codable {
    var animations: AnimationConfig
    var blur: BlurConfig
    var gradients: GradientConfig
    
    static let `default` = VisualEffects(
        animations: AnimationConfig.default,
        blur: BlurConfig.default,
        gradients: GradientConfig.default
    )
}

struct AnimationConfig: Codable {
    var duration: Double
    var springResponse: Double
    var springDampingFraction: Double
    var enabled: Bool
    
    static let `default` = AnimationConfig(
        duration: 0.3,
        springResponse: 0.5,
        springDampingFraction: 0.8,
        enabled: true
    )
}

struct BlurConfig: Codable {
    var radius: Double
    var intensity: Double
    var enabled: Bool
    
    static let `default` = BlurConfig(
        radius: 10.0,
        intensity: 0.6,
        enabled: true
    )
}

struct GradientConfig: Codable {
    var enabled: Bool
    var alpha: Double
    
    static let `default` = GradientConfig(
        enabled: true,
        alpha: 0.1
    )
}

// MARK: - Helper Structs
struct EdgeInsetsConfig: Codable {
    var top: Double
    var leading: Double
    var bottom: Double
    var trailing: Double
    
    var edgeInsets: EdgeInsets {
        EdgeInsets(top: top, leading: leading, bottom: bottom, trailing: trailing)
    }
}

struct OffsetConfig: Codable {
    var x: Double
    var y: Double
    
    var cgSize: CGSize {
        CGSize(width: x, height: y)
    }
}

// MARK: - Color Extension
extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}