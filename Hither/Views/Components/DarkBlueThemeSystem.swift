//
//  DarkBlueThemeSystem.swift
//  Hither
//
//  DarkBlue theme system with OKLCH color space support
//

import SwiftUI

// MARK: - Color System

struct DarkBlueColors {
    // Light Theme Colors
    static let lightBackground = Color.oklch(l: 0.9842, c: 0.0034, h: 247.8575)
    static let lightForeground = Color.oklch(l: 0.1363, c: 0.0364, h: 259.2010)
    static let lightCard = Color.oklch(l: 1.0000, c: 0, h: 0)
    static let lightCardForeground = Color.oklch(l: 0.1363, c: 0.0364, h: 259.2010)
    static let lightPopover = Color.oklch(l: 1.0000, c: 0, h: 0)
    static let lightPopoverForeground = Color.oklch(l: 0.1363, c: 0.0364, h: 259.2010)
    static let lightPrimary = Color.oklch(l: 0.5461, c: 0.2152, h: 262.8809)
    static let lightPrimaryForeground = Color.oklch(l: 1.0000, c: 0, h: 0)
    static let lightSecondary = Color.oklch(l: 0.9683, c: 0.0069, h: 247.8956)
    static let lightSecondaryForeground = Color.oklch(l: 0.2077, c: 0.0398, h: 265.7549)
    static let lightMuted = Color.oklch(l: 0.9683, c: 0.0069, h: 247.8956)
    static let lightMutedForeground = Color.oklch(l: 0.5544, c: 0.0407, h: 257.4166)
    static let lightAccent = Color.oklch(l: 0.9705, c: 0.0142, h: 254.6042)
    static let lightAccentForeground = Color.oklch(l: 0.3791, c: 0.1378, h: 265.5222)
    static let lightDestructive = Color.oklch(l: 0.6368, c: 0.2078, h: 25.3313)
    static let lightDestructiveForeground = Color.oklch(l: 1.0000, c: 0, h: 0)
    static let lightBorder = Color.oklch(l: 0.9288, c: 0.0126, h: 255.5078)
    static let lightInput = Color.oklch(l: 0.9288, c: 0.0126, h: 255.5078)
    static let lightRing = Color.oklch(l: 0.5461, c: 0.2152, h: 262.8809)
    
    // Dark Theme Colors
    static let darkBackground = Color.oklch(l: 0.1363, c: 0.0364, h: 259.2010)
    static let darkForeground = Color.oklch(l: 0.9842, c: 0.0034, h: 247.8575)
    static let darkCard = Color.oklch(l: 0.2077, c: 0.0398, h: 265.7549)
    static let darkCardForeground = Color.oklch(l: 0.9842, c: 0.0034, h: 247.8575)
    static let darkPopover = Color.oklch(l: 0.1363, c: 0.0364, h: 259.2010)
    static let darkPopoverForeground = Color.oklch(l: 0.9842, c: 0.0034, h: 247.8575)
    static let darkPrimary = Color.oklch(l: 0.6231, c: 0.1880, h: 259.8145)
    static let darkPrimaryForeground = Color.oklch(l: 1.0000, c: 0, h: 0)
    static let darkSecondary = Color.oklch(l: 0.2795, c: 0.0368, h: 260.0310)
    static let darkSecondaryForeground = Color.oklch(l: 0.9288, c: 0.0126, h: 255.5078)
    static let darkMuted = Color.oklch(l: 0.2795, c: 0.0368, h: 260.0310)
    static let darkMutedForeground = Color.oklch(l: 0.7107, c: 0.0351, h: 256.7878)
    static let darkAccent = Color.oklch(l: 0.2823, c: 0.0874, h: 267.9352)
    static let darkAccentForeground = Color.oklch(l: 0.9288, c: 0.0126, h: 255.5078)
    static let darkDestructive = Color.oklch(l: 0.3958, c: 0.1331, h: 25.7230)
    static let darkDestructiveForeground = Color.oklch(l: 0.9842, c: 0.0034, h: 247.8575)
    static let darkBorder = Color.oklch(l: 0.2795, c: 0.0368, h: 260.0310)
    static let darkInput = Color.oklch(l: 0.2795, c: 0.0368, h: 260.0310)
    static let darkRing = Color.oklch(l: 0.6231, c: 0.1880, h: 259.8145)
}

// MARK: - OKLCH Color Extension

extension Color {
    static func oklch(l: Double, c: Double, h: Double) -> Color {
        // Convert OKLCH to RGB (simplified conversion)
        // Note: This is a simplified implementation. For production, use a proper color space conversion library.
        let lightness = l
        let chroma = c
        let hue = h * .pi / 180.0
        
        let a = chroma * cos(hue)
        let b = chroma * sin(hue)
        
        // Simplified conversion to RGB
        let red = max(0, min(1, lightness + 0.3963377774 * a + 0.2158037573 * b))
        let green = max(0, min(1, lightness - 0.1055613458 * a - 0.0638541728 * b))
        let blue = max(0, min(1, lightness - 0.0894841775 * a - 1.2914855480 * b))
        
        return Color(red: red, green: green, blue: blue)
    }
}

// MARK: - Theme Configuration

struct DarkBlueTheme {
    let isDark: Bool
    
    var background: Color {
        isDark ? DarkBlueColors.darkBackground : DarkBlueColors.lightBackground
    }
    
    var foreground: Color {
        isDark ? DarkBlueColors.darkForeground : DarkBlueColors.lightForeground
    }
    
    var card: Color {
        isDark ? DarkBlueColors.darkCard : DarkBlueColors.lightCard
    }
    
    var cardForeground: Color {
        isDark ? DarkBlueColors.darkCardForeground : DarkBlueColors.lightCardForeground
    }
    
    var popover: Color {
        isDark ? DarkBlueColors.darkPopover : DarkBlueColors.lightPopover
    }
    
    var popoverForeground: Color {
        isDark ? DarkBlueColors.darkPopoverForeground : DarkBlueColors.lightPopoverForeground
    }
    
    var primary: Color {
        isDark ? DarkBlueColors.darkPrimary : DarkBlueColors.lightPrimary
    }
    
    var primaryForeground: Color {
        isDark ? DarkBlueColors.darkPrimaryForeground : DarkBlueColors.lightPrimaryForeground
    }
    
    var secondary: Color {
        isDark ? DarkBlueColors.darkSecondary : DarkBlueColors.lightSecondary
    }
    
    var secondaryForeground: Color {
        isDark ? DarkBlueColors.darkSecondaryForeground : DarkBlueColors.lightSecondaryForeground
    }
    
    var muted: Color {
        isDark ? DarkBlueColors.darkMuted : DarkBlueColors.lightMuted
    }
    
    var mutedForeground: Color {
        isDark ? DarkBlueColors.darkMutedForeground : DarkBlueColors.lightMutedForeground
    }
    
    var accent: Color {
        isDark ? DarkBlueColors.darkAccent : DarkBlueColors.lightAccent
    }
    
    var accentForeground: Color {
        isDark ? DarkBlueColors.darkAccentForeground : DarkBlueColors.lightAccentForeground
    }
    
    var destructive: Color {
        isDark ? DarkBlueColors.darkDestructive : DarkBlueColors.lightDestructive
    }
    
    var destructiveForeground: Color {
        isDark ? DarkBlueColors.darkDestructiveForeground : DarkBlueColors.lightDestructiveForeground
    }
    
    var border: Color {
        isDark ? DarkBlueColors.darkBorder : DarkBlueColors.lightBorder
    }
    
    var input: Color {
        isDark ? DarkBlueColors.darkInput : DarkBlueColors.lightInput
    }
    
    var ring: Color {
        isDark ? DarkBlueColors.darkRing : DarkBlueColors.lightRing
    }
    
    // Shadow configuration based on CSS
    var shadowColor: Color {
        isDark ? Color.black.opacity(0.25) : Color(hue: 215.0/360.0, saturation: 0.202, brightness: 0.651).opacity(0.1)
    }
    
    var shadowRadius: CGFloat { 8 }
    var shadowOffset: CGSize { CGSize(width: 0, height: 4) }
    
    // Corner radius from CSS
    var cornerRadius: CGFloat { 12 } // 0.75rem = 12px
}

// MARK: - DarkBlue Card Component

struct DarkBlueCard<Content: View>: View {
    let content: Content
    let cornerRadius: CGFloat
    
    @Environment(\.colorScheme) private var colorScheme
    
    init(
        cornerRadius: CGFloat = 12,
        @ViewBuilder content: () -> Content
    ) {
        self.content = content()
        self.cornerRadius = cornerRadius
    }
    
    var body: some View {
        let theme = DarkBlueTheme(isDark: colorScheme == .dark)
        
        content
            .background(theme.card)
            .foregroundColor(theme.cardForeground)
            .cornerRadius(cornerRadius)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(theme.border, lineWidth: 1)
            )
            .shadow(
                color: theme.shadowColor,
                radius: theme.shadowRadius,
                x: theme.shadowOffset.width,
                y: theme.shadowOffset.height
            )
    }
}

// MARK: - DarkBlue Button Component

struct DarkBlueButton<Content: View>: View {
    let action: () -> Void
    let content: Content
    let variant: DarkBlueButtonVariant
    
    @State private var isPressed = false
    @Environment(\.colorScheme) private var colorScheme
    
    init(
        variant: DarkBlueButtonVariant = .primary,
        action: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.action = action
        self.content = content()
        self.variant = variant
    }
    
    var body: some View {
        let theme = DarkBlueTheme(isDark: colorScheme == .dark)
        
        Button(action: action) {
            content
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(variant.backgroundColor(theme: theme))
                .foregroundColor(variant.foregroundColor(theme: theme))
                .cornerRadius(theme.cornerRadius)
                .scaleEffect(isPressed ? 0.96 : 1.0)
                .opacity(isPressed ? 0.8 : 1.0)
        }
        .buttonStyle(PlainButtonStyle())
        .onLongPressGesture(minimumDuration: 0, maximumDistance: .infinity, pressing: { pressing in
            withAnimation(.easeInOut(duration: 0.1)) {
                isPressed = pressing
            }
        }, perform: {})
    }
}

enum DarkBlueButtonVariant {
    case primary
    case secondary
    case accent
    case muted
    case destructive
    
    func backgroundColor(theme: DarkBlueTheme) -> Color {
        switch self {
        case .primary:
            return theme.primary
        case .secondary:
            return theme.secondary
        case .accent:
            return theme.accent
        case .muted:
            return theme.muted
        case .destructive:
            return theme.destructive
        }
    }
    
    func foregroundColor(theme: DarkBlueTheme) -> Color {
        switch self {
        case .primary:
            return theme.primaryForeground
        case .secondary:
            return theme.secondaryForeground
        case .accent:
            return theme.accentForeground
        case .muted:
            return theme.mutedForeground
        case .destructive:
            return theme.destructiveForeground
        }
    }
}

// MARK: - DarkBlue Section Header Component

struct DarkBlueSectionHeader: View {
    let text: String
    let colors: [Color]
    
    @Environment(\.colorScheme) private var colorScheme
    
    init(text: String, colors: [Color]) {
        self.text = text
        self.colors = colors
    }
    
    var body: some View {
        Text(text)
            .font(.headline)
            .fontWeight(.semibold)
            .foregroundStyle(
                LinearGradient(
                    colors: colors,
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
    }
}

// MARK: - DarkBlue Text Field Component

struct DarkBlueTextField: View {
    let placeholder: String
    @Binding var text: String
    let icon: String
    let iconColor: Color
    let textCase: Text.Case?
    
    @Environment(\.colorScheme) private var colorScheme
    
    init(
        placeholder: String,
        text: Binding<String>,
        icon: String,
        iconColor: Color,
        textCase: Text.Case? = nil
    ) {
        self.placeholder = placeholder
        self._text = text
        self.icon = icon
        self.iconColor = iconColor
        self.textCase = textCase
    }
    
    var body: some View {
        let theme = DarkBlueTheme(isDark: colorScheme == .dark)
        
        HStack {
            Image(systemName: icon)
                .foregroundColor(iconColor)
                .frame(width: 20)
            
            if let textCase = textCase {
                TextField(placeholder, text: $text)
                    .foregroundColor(theme.foreground)
                    .textCase(textCase)
            } else {
                TextField(placeholder, text: $text)
                    .foregroundColor(theme.foreground)
            }
        }
        .padding()
        .background(theme.muted)
        .cornerRadius(theme.cornerRadius)
        .overlay(
            RoundedRectangle(cornerRadius: theme.cornerRadius)
                .stroke(theme.border, lineWidth: 0.5)
        )
        .shadow(
            color: theme.shadowColor,
            radius: 4,
            y: 2
        )
    }
}

// MARK: - DarkBlue Toggle Component

struct DarkBlueToggle: View {
    @Binding var isOn: Bool
    let onChanged: ((Bool) -> Void)?
    
    @Environment(\.colorScheme) private var colorScheme
    
    init(isOn: Binding<Bool>, onChanged: ((Bool) -> Void)? = nil) {
        self._isOn = isOn
        self.onChanged = onChanged
    }
    
    var body: some View {
        let theme = DarkBlueTheme(isDark: colorScheme == .dark)
        
        Toggle("", isOn: $isOn)
            .tint(theme.primary)
            .onChange(of: isOn) { oldValue, newValue in
                onChanged?(newValue)
            }
    }
}

// MARK: - DarkBlue Standard Button Component

struct DarkBlueStandardButton<Content: View>: View {
    let action: () -> Void
    let content: Content
    let backgroundColor: Color?
    let foregroundColor: Color?
    
    @Environment(\.colorScheme) private var colorScheme
    
    init(
        backgroundColor: Color? = nil,
        foregroundColor: Color? = nil,
        action: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.action = action
        self.content = content()
        self.backgroundColor = backgroundColor
        self.foregroundColor = foregroundColor
    }
    
    var body: some View {
        let theme = DarkBlueTheme(isDark: colorScheme == .dark)
        
        Button(action: action) {
            content
                .foregroundColor(foregroundColor ?? .white)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(backgroundColor ?? theme.primary)
        .cornerRadius(theme.cornerRadius)
    }
}

// MARK: - View Extension for Easy Access

extension View {
    func darkBlueCard(cornerRadius: CGFloat = 12) -> some View {
        DarkBlueCard(cornerRadius: cornerRadius) {
            self
        }
    }
    
    // Keep backward compatibility for claudeCard
    func claudeCard(cornerRadius: CGFloat = 12) -> some View {
        DarkBlueCard(cornerRadius: cornerRadius) {
            self
        }
    }
    
    // MARK: - Environment Modifier for reducing injection duplication
    func withSharedEnvironment() -> some View {
        modifier(SharedEnvironmentModifier())
    }
}

// MARK: - Shared Environment Modifier
struct SharedEnvironmentModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
    }
}