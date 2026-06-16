//
//  LiquidGlassComponents.swift
//  Hither
//
//  iOS 18 Liquid Glass Design System
//

import SwiftUI

// MARK: - Liquid Glass Design System

/// Primary glass card container with enhanced material effects
struct LiquidGlassCard<Content: View>: View {
    let content: Content
    let cornerRadius: CGFloat
    let materialType: LiquidGlassMaterial
    let shadowIntensity: LiquidGlassShadow
    
    @EnvironmentObject private var themeManager: ThemeManager
    
    init(
        cornerRadius: CGFloat = 20,
        material: LiquidGlassMaterial = .primary,
        shadow: LiquidGlassShadow = .medium,
        @ViewBuilder content: () -> Content
    ) {
        self.content = content()
        self.cornerRadius = cornerRadius
        self.materialType = material
        self.shadowIntensity = shadow
    }
    
    var body: some View {
        content
            .background(
                ZStack {
                    // Base material layer with theme-aware opacity
                    Rectangle()
                        .fill(.regularMaterial)
                        .opacity(themeManager.currentTheme.components.cards.materialOpacity)
                    
                    // Theme-aware background
                    Rectangle()
                        .fill(themeManager.currentTheme.colors.card.background.color)
                    
                    // Subtle gradient overlay if enabled
                    if themeManager.currentTheme.effects.gradients.enabled {
                        LinearGradient(
                            colors: materialType.gradientColors,
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                        .opacity(themeManager.currentTheme.effects.gradients.alpha)
                    }
                    
                    // Theme-aware border
                    RoundedRectangle(cornerRadius: themeManager.currentTheme.components.cards.cornerRadius)
                        .stroke(
                            themeManager.currentTheme.colors.card.border.color,
                            lineWidth: themeManager.currentTheme.components.cards.borderWidth
                        )
                }
            )
            .cornerRadius(themeManager.currentTheme.components.cards.cornerRadius)
            .shadow(
                color: themeManager.currentTheme.colors.card.shadow.color,
                radius: themeManager.currentTheme.components.cards.shadowRadius,
                x: themeManager.currentTheme.components.cards.shadowOffset.x,
                y: themeManager.currentTheme.components.cards.shadowOffset.y
            )
    }
}

/// Interactive glass button with haptic feedback
struct LiquidGlassButton<Content: View>: View {
    let action: () -> Void
    let content: Content
    let style: LiquidGlassButtonStyle
    
    @State private var isPressed = false
    @EnvironmentObject private var themeManager: ThemeManager
    
    init(
        style: LiquidGlassButtonStyle = .primary,
        action: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.action = action
        self.content = content()
        self.style = style
    }
    
    var body: some View {
        Button(action: action) {
            content
                .scaleEffect(isPressed ? 0.96 : 1.0)
                .opacity(isPressed ? 0.8 : 1.0)
        }
        .buttonStyle(LiquidGlassButtonStyleImpl(style: style))
        .onLongPressGesture(minimumDuration: 0, maximumDistance: .infinity, pressing: { pressing in
            withAnimation(.easeInOut(duration: 0.1)) {
                isPressed = pressing
            }
        }, perform: {})
    }
}

/// Glass surface for elevated content areas
struct LiquidGlassSurface<Content: View>: View {
    let content: Content
    let elevation: LiquidGlassElevation
    
    init(
        elevation: LiquidGlassElevation = .medium,
        @ViewBuilder content: () -> Content
    ) {
        self.content = content()
        self.elevation = elevation
    }
    
    var body: some View {
        content
            .background(
                ZStack {
                    Rectangle()
                        .fill(.ultraThinMaterial)
                        .opacity(elevation.materialOpacity)
                    
                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.white.opacity(0.15),
                                    Color.white.opacity(0.05)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                }
            )
            .cornerRadius(elevation.cornerRadius)
            .shadow(
                color: elevation.shadowColor,
                radius: elevation.shadowRadius,
                x: 0,
                y: elevation.shadowOffset
            )
    }
}

/// Enhanced sheet presentation with backdrop blur
struct LiquidGlassSheet<Content: View>: View {
    @Binding var isPresented: Bool
    let content: Content
    
    init(
        isPresented: Binding<Bool>,
        @ViewBuilder content: () -> Content
    ) {
        self._isPresented = isPresented
        self.content = content()
    }
    
    var body: some View {
        ZStack {
            // Backdrop blur
            Color.black.opacity(0.1)
                .blur(radius: 10)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        isPresented = false
                    }
                }
            
            VStack {
                Spacer()
                
                VStack(spacing: 0) {
                    // Handle indicator
                    RoundedRectangle(cornerRadius: 2.5)
                        .fill(Color.secondary.opacity(0.5))
                        .frame(width: 36, height: 5)
                        .padding(.top, 12)
                        .padding(.bottom, 20)
                    
                    content
                }
                .background(
                    .ultraThinMaterial,
                    in: RoundedRectangle(cornerRadius: 28, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 28)
                        .stroke(
                            LinearGradient(
                                colors: [Color.white.opacity(0.2), Color.clear],
                                startPoint: .top,
                                endPoint: .bottom
                            ),
                            lineWidth: 0.5
                        )
                )
                .shadow(color: Color.black.opacity(0.1), radius: 20, y: 10)
            }
            .padding()
        }
        .transition(.asymmetric(
            insertion: .move(edge: .bottom).combined(with: .opacity),
            removal: .move(edge: .bottom).combined(with: .opacity)
        ))
    }
}

// MARK: - Design System Configuration

enum LiquidGlassMaterial {
    case primary, secondary, tertiary
    
    var materialAlpha: Double {
        switch self {
        case .primary: return 0.65
        case .secondary: return 0.55
        case .tertiary: return 0.45
        }
    }
    
    var gradientColors: [Color] {
        switch self {
        case .primary: return [Color.blue.opacity(0.1), Color.purple.opacity(0.05)]
        case .secondary: return [Color.white.opacity(0.1), Color.gray.opacity(0.05)]
        case .tertiary: return [Color.gray.opacity(0.05), Color.clear]
        }
    }
}

enum LiquidGlassShadow {
    case subtle, medium, prominent
    
    var color: Color {
        Color.black.opacity(0.1)
    }
    
    var radius: CGFloat {
        switch self {
        case .subtle: return 8
        case .medium: return 16
        case .prominent: return 24
        }
    }
    
    var offset: CGSize {
        switch self {
        case .subtle: return CGSize(width: 0, height: 2)
        case .medium: return CGSize(width: 0, height: 4)
        case .prominent: return CGSize(width: 0, height: 8)
        }
    }
}

enum LiquidGlassElevation {
    case low, medium, high
    
    var materialOpacity: Double {
        switch self {
        case .low: return 0.7
        case .medium: return 0.8
        case .high: return 0.9
        }
    }
    
    var cornerRadius: CGFloat {
        switch self {
        case .low: return 16
        case .medium: return 20
        case .high: return 24
        }
    }
    
    var shadowColor: Color {
        Color.black.opacity(0.08)
    }
    
    var shadowRadius: CGFloat {
        switch self {
        case .low: return 6
        case .medium: return 12
        case .high: return 20
        }
    }
    
    var shadowOffset: CGFloat {
        switch self {
        case .low: return 2
        case .medium: return 4
        case .high: return 8
        }
    }
}

enum LiquidGlassButtonStyle {
    case primary, secondary, destructive
    
    var materialOpacity: Double {
        switch self {
        case .primary: return 0.9
        case .secondary: return 0.7
        case .destructive: return 0.8
        }
    }
    
    var tintColor: Color {
        switch self {
        case .primary: return .blue
        case .secondary: return .gray
        case .destructive: return .red
        }
    }
}

struct LiquidGlassButtonStyleImpl: ButtonStyle {
    let style: LiquidGlassButtonStyle
    @EnvironmentObject private var themeManager: ThemeManager
    
    func makeBody(configuration: Configuration) -> some View {
        let theme = themeManager.currentTheme
        let buttonColors = getButtonColors()
        
        configuration.label
            .background(
                ZStack {
                    Rectangle()
                        .fill(.regularMaterial)
                        .opacity(theme.components.cards.materialOpacity)
                    
                    Rectangle()
                        .fill(buttonColors.background)
                    
                    if theme.effects.gradients.enabled {
                        Rectangle()
                            .fill(
                                LinearGradient(
                                    colors: [
                                        buttonColors.background.opacity(0.2),
                                        buttonColors.background.opacity(0.1)
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )
                    }
                }
            )
            .cornerRadius(theme.components.buttons.cornerRadius)
            .overlay(
                RoundedRectangle(cornerRadius: theme.components.buttons.cornerRadius)
                    .stroke(buttonColors.background.opacity(0.3), lineWidth: theme.components.buttons.borderWidth)
            )
            .scaleEffect(configuration.isPressed ? 0.96 : 1.0)
            .opacity(configuration.isPressed ? 0.8 : 1.0)
            .animation(theme.effects.animations.enabled ? 
                      .easeInOut(duration: theme.effects.animations.duration) : nil, 
                      value: configuration.isPressed)
            .shadow(
                color: theme.colors.card.shadow.color,
                radius: theme.components.buttons.shadowRadius,
                x: theme.components.buttons.shadowOffset.x,
                y: theme.components.buttons.shadowOffset.y
            )
    }
    
    private func getButtonColors() -> (background: Color, text: Color) {
        let colors = themeManager.currentTheme.colors.button
        
        switch style {
        case .primary:
            return (colors.primaryBackground.color, colors.primaryText.color)
        case .secondary:
            return (colors.secondaryBackground.color, colors.secondaryText.color)
        case .destructive:
            return (colors.destructiveBackground.color, colors.destructiveText.color)
        }
    }
}

// MARK: - View Modifiers

struct LiquidGlassBackground: ViewModifier {
    let material: Material
    let tint: Color?
    
    init(material: Material = .ultraThinMaterial, tint: Color? = nil) {
        self.material = material
        self.tint = tint
    }
    
    func body(content: Content) -> some View {
        content
            .background(
                ZStack {
                    Rectangle()
                        .fill(material)
                    
                    if let tint = tint {
                        Rectangle()
                            .fill(
                                LinearGradient(
                                    colors: [tint.opacity(0.1), tint.opacity(0.05)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                    }
                }
            )
    }
}

extension View {
    func liquidGlassBackground(material: Material = .ultraThinMaterial, tint: Color? = nil) -> some View {
        modifier(LiquidGlassBackground(material: material, tint: tint))
    }
    
    func liquidGlassCard(
        cornerRadius: CGFloat = 20,
        material: LiquidGlassMaterial = .primary,
        shadow: LiquidGlassShadow = .medium
    ) -> some View {
        LiquidGlassCard(cornerRadius: cornerRadius, material: material, shadow: shadow) {
            self
        }
    }
    
    func liquidGlassSurface(elevation: LiquidGlassElevation = .medium) -> some View {
        LiquidGlassSurface(elevation: elevation) {
            self
        }
    }
}