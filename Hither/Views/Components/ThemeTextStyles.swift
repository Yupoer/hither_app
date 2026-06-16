//
//  ThemeTextStyles.swift
//  Hither
//
//  Created by Claude on 2025/7/30.
//

import SwiftUI

// MARK: - Theme Text Styles
extension Text {
    func themeStyle(
        _ style: FontStyle,
        color: ThemeColorType = .textPrimary,
        weight: Font.Weight? = nil
    ) -> some View {
        ThemeStyledText(text: self, style: style, colorType: color, weight: weight)
    }
    
    func themePrimary() -> some View {
        themeStyle(.body, color: .textPrimary)
    }
    
    func themeSecondary() -> some View {
        themeStyle(.body, color: .textSecondary)
    }
    
    func themeTertiary() -> some View {
        themeStyle(.body, color: .textTertiary)
    }
    
    func themeTitle() -> some View {
        themeStyle(.title1, color: .textPrimary, weight: .bold)
    }
    
    func themeSubtitle() -> some View {
        themeStyle(.title3, color: .textSecondary, weight: .medium)
    }
    
    func themeHeadline() -> some View {
        themeStyle(.headline, color: .textPrimary, weight: .semibold)
    }
    
    func themeCaption() -> some View {
        themeStyle(.caption1, color: .textSecondary)
    }
    
    func themeFootnote() -> some View {
        themeStyle(.footnote, color: .textTertiary)
    }
}

// MARK: - Theme Styled Text
struct ThemeStyledText: View {
    let text: Text
    let style: FontStyle
    let colorType: ThemeColorType
    let weight: Font.Weight?
    
    @EnvironmentObject private var themeManager: ThemeManager
    
    init(text: Text, style: FontStyle, colorType: ThemeColorType, weight: Font.Weight?) {
        self.text = text
        self.style = style
        self.colorType = colorType
        self.weight = weight
    }
    
    var body: some View {
        text
            .font(themeManager.font(style: style))
            .fontWeight(weight)
            .foregroundColor(themeManager.color(colorType))
            .lineSpacing(themeManager.currentTheme.typography.lineSpacing)
    }
}

// MARK: - Theme Font Modifiers
extension View {
    func themeFont(
        _ style: FontStyle,
        size: FontSize? = nil,
        weight: Font.Weight? = nil
    ) -> some View {
        self.modifier(ThemeFontModifier(style: style, size: size, weight: weight))
    }
    
    func themeColor(_ colorType: ThemeColorType) -> some View {
        self.modifier(ThemeColorModifier(colorType: colorType))
    }
    
    func themeBackground(_ colorType: ThemeColorType) -> some View {
        self.modifier(ThemeBackgroundModifier(colorType: colorType))
    }
}

// MARK: - Theme Modifiers
struct ThemeFontModifier: ViewModifier {
    let style: FontStyle
    let size: FontSize?
    let weight: Font.Weight?
    
    @EnvironmentObject private var themeManager: ThemeManager
    
    func body(content: Content) -> some View {
        content
            .font(themeManager.font(style: style, size: size))
            .fontWeight(weight)
    }
}

struct ThemeColorModifier: ViewModifier {
    let colorType: ThemeColorType
    
    @EnvironmentObject private var themeManager: ThemeManager
    
    func body(content: Content) -> some View {
        content
            .foregroundColor(themeManager.color(colorType))
    }
}

struct ThemeBackgroundModifier: ViewModifier {
    let colorType: ThemeColorType
    
    @EnvironmentObject private var themeManager: ThemeManager
    
    func body(content: Content) -> some View {
        content
            .background(themeManager.color(colorType))
    }
}

// MARK: - Dynamic Type Scaling
struct ThemeDynamicText: View {
    let text: String
    let style: FontStyle
    let colorType: ThemeColorType
    let maxLines: Int?
    let alignment: TextAlignment
    
    @EnvironmentObject private var themeManager: ThemeManager
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    
    init(
        _ text: String,
        style: FontStyle = .body,
        color: ThemeColorType = .textPrimary,
        maxLines: Int? = nil,
        alignment: TextAlignment = .leading
    ) {
        self.text = text
        self.style = style
        self.colorType = color
        self.maxLines = maxLines
        self.alignment = alignment
    }
    
    var body: some View {
        Text(text)
            .font(scaledFont)
            .foregroundColor(themeManager.color(colorType))
            .lineLimit(maxLines)
            .multilineTextAlignment(alignment)
            .lineSpacing(themeManager.currentTheme.typography.lineSpacing)
    }
    
    private var scaledFont: Font {
        let baseSize = style.defaultSize(from: themeManager.currentTheme.typography.sizes)
        let scaledSize = scaleSize(baseSize)
        
        return Font.custom(
            themeManager.currentTheme.typography.fonts.primary,
            size: scaledSize
        )
    }
    
    private func scaleSize(_ size: Double) -> Double {
        let scaleFactor: Double
        
        switch dynamicTypeSize {
        case .xSmall: scaleFactor = 0.8
        case .small: scaleFactor = 0.9
        case .medium: scaleFactor = 1.0
        case .large: scaleFactor = 1.1
        case .xLarge: scaleFactor = 1.2
        case .xxLarge: scaleFactor = 1.3
        case .xxxLarge: scaleFactor = 1.4
        case .accessibility1: scaleFactor = 1.5
        case .accessibility2: scaleFactor = 1.6
        case .accessibility3: scaleFactor = 1.7
        case .accessibility4: scaleFactor = 1.8
        case .accessibility5: scaleFactor = 1.9
        @unknown default: scaleFactor = 1.0
        }
        
        return size * scaleFactor
    }
}

// MARK: - Theme Localized Text
struct ThemeLocalizedText: View {
    let key: String
    let style: FontStyle
    let colorType: ThemeColorType
    let weight: Font.Weight?
    
    @EnvironmentObject private var themeManager: ThemeManager
    
    init(
        _ key: String,
        style: FontStyle = .body,
        color: ThemeColorType = .textPrimary,
        weight: Font.Weight? = nil
    ) {
        self.key = key
        self.style = style
        self.colorType = color
        self.weight = weight
    }
    
    var body: some View {
        Text(key.localized)
            .font(themeManager.font(style: style))
            .fontWeight(weight)
            .foregroundColor(themeManager.color(colorType))
            .lineSpacing(themeManager.currentTheme.typography.lineSpacing)
    }
}

// MARK: - String Extension for Theming
extension String {
    func themeText(
        style: FontStyle = .body,
        color: ThemeColorType = .textPrimary,
        weight: Font.Weight? = nil
    ) -> ThemeText {
        return ThemeText(self, style: style, color: color, weight: weight)
    }
    
    func localizedThemeText(
        style: FontStyle = .body,
        color: ThemeColorType = .textPrimary,
        weight: Font.Weight? = nil
    ) -> ThemeLocalizedText {
        return ThemeLocalizedText(self, style: style, color: color, weight: weight)
    }
}