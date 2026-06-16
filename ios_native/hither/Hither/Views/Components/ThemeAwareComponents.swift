//
//  ThemeAwareComponents.swift
//  Hither
//
//  Created by Claude on 2025/7/30.
//

import SwiftUI

// MARK: - Theme-Aware Text
struct ThemeText: View {
    let text: String
    let style: FontStyle
    let colorType: ThemeColorType
    let size: FontSize?
    let weight: Font.Weight?
    
    @EnvironmentObject private var themeManager: ThemeManager
    
    init(
        _ text: String,
        style: FontStyle = .body,
        color: ThemeColorType = .textPrimary,
        size: FontSize? = nil,
        weight: Font.Weight? = nil
    ) {
        self.text = text
        self.style = style
        self.colorType = color
        self.size = size
        self.weight = weight
    }
    
    var body: some View {
        Text(text)
            .font(themeManager.font(style: style, size: size))
            .fontWeight(weight)
            .foregroundColor(themeManager.color(colorType))
            .lineSpacing(themeManager.currentTheme.typography.lineSpacing)
    }
}

// MARK: - Theme-Aware Button
struct ThemeButton<Content: View>: View {
    let action: () -> Void
    let content: Content
    let style: ThemeButtonStyle
    let size: ThemeButtonSize
    
    @EnvironmentObject private var themeManager: ThemeManager
    @State private var isPressed = false
    
    init(
        style: ThemeButtonStyle = .primary,
        size: ThemeButtonSize = .medium,
        action: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.action = action
        self.content = content()
        self.style = style
        self.size = size
    }
    
    var body: some View {
        let theme = themeManager.currentTheme
        let buttonColors = getButtonColors()
        let buttonSize = getButtonSize()
        
        Button(action: action) {
            content
                .padding(buttonSize.padding)
                .frame(minHeight: buttonSize.minHeight)
                .frame(maxWidth: buttonSize.maxWidth)
                .background(
                    ZStack {
                        RoundedRectangle(cornerRadius: theme.components.buttons.cornerRadius)
                            .fill(buttonColors.background)
                        
                        if theme.effects.gradients.enabled {
                            RoundedRectangle(cornerRadius: theme.components.buttons.cornerRadius)
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            buttonColors.background.opacity(0.8),
                                            buttonColors.background
                                        ],
                                        startPoint: .top,
                                        endPoint: .bottom
                                    )
                                )
                        }
                    }
                )
                .foregroundColor(buttonColors.text)
                .cornerRadius(theme.components.buttons.cornerRadius)
                .overlay(
                    RoundedRectangle(cornerRadius: theme.components.buttons.cornerRadius)
                        .stroke(buttonColors.border, lineWidth: theme.components.buttons.borderWidth)
                )
                .scaleEffect(isPressed ? 0.95 : 1.0)
                .opacity(isPressed ? 0.8 : 1.0)
                .shadow(
                    color: theme.colors.card.shadow.color,
                    radius: theme.components.buttons.shadowRadius,
                    x: theme.components.buttons.shadowOffset.x,
                    y: theme.components.buttons.shadowOffset.y
                )
                .animation(themeManager.animation(), value: isPressed)
        }
        .buttonStyle(PlainButtonStyle())
        .onLongPressGesture(minimumDuration: 0, maximumDistance: .infinity, pressing: { pressing in
            isPressed = pressing
        }, perform: {})
    }
    
    private func getButtonColors() -> (background: Color, text: Color, border: Color) {
        let colors = themeManager.currentTheme.colors
        
        switch style {
        case .primary:
            return (colors.button.primaryBackground.color, colors.button.primaryText.color, colors.primary.color.opacity(0.3))
        case .secondary:
            return (colors.button.secondaryBackground.color, colors.button.secondaryText.color, colors.secondary.color.opacity(0.3))
        case .destructive:
            return (colors.button.destructiveBackground.color, colors.button.destructiveText.color, colors.error.color.opacity(0.3))
        case .ghost:
            return (Color.clear, colors.primary.color, colors.primary.color.opacity(0.5))
        case .outline:
            return (Color.clear, colors.primary.color, colors.primary.color)
        }
    }
    
    private func getButtonSize() -> (padding: EdgeInsets, minHeight: CGFloat, maxWidth: CGFloat?) {
        let buttonStyles = themeManager.currentTheme.components.buttons
        
        switch size {
        case .small:
            return (
                EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16),
                32,
                nil
            )
        case .medium:
            return (
                buttonStyles.padding.edgeInsets,
                buttonStyles.minHeight,
                nil
            )
        case .large:
            return (
                EdgeInsets(top: 20, leading: 32, bottom: 20, trailing: 32),
                56,
                nil
            )
        case .fullWidth:
            return (
                buttonStyles.padding.edgeInsets,
                buttonStyles.minHeight,
                .infinity
            )
        }
    }
}

// MARK: - Theme-Aware Card
struct ThemeCard<Content: View>: View {
    let content: Content
    let style: ThemeCardStyle
    
    @EnvironmentObject private var themeManager: ThemeManager
    
    init(
        style: ThemeCardStyle = .default,
        @ViewBuilder content: () -> Content
    ) {
        self.content = content()
        self.style = style
    }
    
    var body: some View {
        let theme = themeManager.currentTheme
        let cardColors = getCardColors()
        
        content
            .padding(theme.components.cards.padding.edgeInsets)
            .background(
                ZStack {
                    RoundedRectangle(cornerRadius: theme.components.cards.cornerRadius)
                        .fill(.regularMaterial)
                        .opacity(theme.components.cards.materialOpacity)
                    
                    RoundedRectangle(cornerRadius: theme.components.cards.cornerRadius)
                        .fill(cardColors.background)
                    
                    if theme.effects.gradients.enabled {
                        RoundedRectangle(cornerRadius: theme.components.cards.cornerRadius)
                            .fill(
                                LinearGradient(
                                    colors: cardColors.gradient,
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .opacity(theme.effects.gradients.alpha)
                    }
                }
            )
            .cornerRadius(theme.components.cards.cornerRadius)
            .overlay(
                RoundedRectangle(cornerRadius: theme.components.cards.cornerRadius)
                    .stroke(cardColors.border, lineWidth: theme.components.cards.borderWidth)
            )
            .shadow(
                color: theme.colors.card.shadow.color,
                radius: theme.components.cards.shadowRadius,
                x: theme.components.cards.shadowOffset.x,
                y: theme.components.cards.shadowOffset.y
            )
    }
    
    private func getCardColors() -> (background: Color, border: Color, gradient: [Color]) {
        let colors = themeManager.currentTheme.colors
        
        switch style {
        case .default:
            return (
                colors.card.background.color,
                colors.card.border.color,
                [colors.surface.color.opacity(0.1), Color.clear]
            )
        case .primary:
            return (
                colors.primary.color.opacity(0.1),
                colors.primary.color.opacity(0.3),
                [colors.primary.color.opacity(0.1), Color.clear]
            )
        case .success:
            return (
                colors.success.color.opacity(0.1),
                colors.success.color.opacity(0.3),
                [colors.success.color.opacity(0.1), Color.clear]
            )
        case .warning:
            return (
                colors.warning.color.opacity(0.1),
                colors.warning.color.opacity(0.3),
                [colors.warning.color.opacity(0.1), Color.clear]
            )
        case .error:
            return (
                colors.error.color.opacity(0.1),
                colors.error.color.opacity(0.3),
                [colors.error.color.opacity(0.1), Color.clear]
            )
        }
    }
}

// MARK: - Theme-Aware TextField
struct ThemeTextField: View {
    let placeholder: String
    @Binding var text: String
    let style: ThemeTextFieldStyle
    
    @EnvironmentObject private var themeManager: ThemeManager
    @FocusState private var isFocused: Bool
    
    init(
        _ placeholder: String,
        text: Binding<String>,
        style: ThemeTextFieldStyle = .default
    ) {
        self.placeholder = placeholder
        self._text = text
        self.style = style
    }
    
    var body: some View {
        let theme = themeManager.currentTheme
        let colors = getTextFieldColors()
        
        TextField(placeholder, text: $text)
            .focused($isFocused)
            .padding(theme.components.textFields.padding.edgeInsets)
            .frame(minHeight: theme.components.textFields.minHeight)
            .background(colors.background)
            .foregroundColor(themeManager.color(.textPrimary))
            .cornerRadius(theme.components.textFields.cornerRadius)
            .overlay(
                RoundedRectangle(cornerRadius: theme.components.textFields.cornerRadius)
                    .stroke(isFocused ? colors.focusedBorder : colors.border, lineWidth: theme.components.textFields.borderWidth)
            )
            .animation(themeManager.animation(), value: isFocused)
    }
    
    private func getTextFieldColors() -> (background: Color, border: Color, focusedBorder: Color) {
        let colors = themeManager.currentTheme.colors
        
        switch style {
        case .default:
            return (
                colors.surface.color.opacity(0.8),
                colors.secondary.color.opacity(0.3),
                colors.primary.color
            )
        case .primary:
            return (
                colors.primary.color.opacity(0.1),
                colors.primary.color.opacity(0.3),
                colors.primary.color
            )
        case .ghost:
            return (
                Color.clear,
                colors.secondary.color.opacity(0.5),
                colors.primary.color
            )
        }
    }
}

// MARK: - Supporting Types
enum ThemeButtonStyle {
    case primary, secondary, destructive, ghost, outline
}

enum ThemeButtonSize {
    case small, medium, large, fullWidth
}

enum ThemeCardStyle {
    case `default`, primary, success, warning, error
}

enum ThemeTextFieldStyle {
    case `default`, primary, ghost
}

// MARK: - Convenience Extensions
extension ThemeText {
    static func title(_ text: String) -> ThemeText {
        ThemeText(text, style: .title1, color: .textPrimary, weight: .bold)
    }
    
    static func subtitle(_ text: String) -> ThemeText {
        ThemeText(text, style: .title3, color: .textSecondary, weight: .medium)
    }
    
    static func body(_ text: String) -> ThemeText {
        ThemeText(text, style: .body, color: .textPrimary)
    }
    
    static func caption(_ text: String) -> ThemeText {
        ThemeText(text, style: .caption1, color: .textSecondary)
    }
}

extension ThemeButton where Content == Text {
    init(
        _ title: String,
        style: ThemeButtonStyle = .primary,
        size: ThemeButtonSize = .medium,
        action: @escaping () -> Void
    ) {
        self.init(style: style, size: size, action: action) {
            Text(title)
        }
    }
}