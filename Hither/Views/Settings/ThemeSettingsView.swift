//
//  ThemeSettingsView.swift
//  Hither
//
//  Created by Claude on 2025/7/30.
//

import SwiftUI

struct ThemeSettingsView: View {
    @EnvironmentObject private var themeManager: ThemeManager
    @Environment(\.presentationMode) var presentationMode
    
    @State private var selectedTheme: PredefinedThemeType = .default
    @State private var showingCustomization = false
    @State private var showingColorPicker = false
    @State private var selectedColorProperty: ColorProperty?
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    themeHeaderSection
                    
                    // Predefined Themes
                    predefinedThemesSection
                    
                    // Theme Preview
                    themePreviewSection
                    
                    // Customization Options
                    customizationSection
                    
                    // Reset Options
                    resetSection
                }
                .padding()
            }
            .navigationTitle("theme_settings".localized)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("done".localized) {
                        presentationMode.wrappedValue.dismiss()
                    }
                }
            }
            .sheet(isPresented: $showingCustomization) {
                CustomThemeView()
            }
            .sheet(item: $selectedColorProperty) { property in
                ColorPickerView(property: property)
            }
        }
    }
    
    // MARK: - Sections
    private var themeHeaderSection: some View {
        ThemeCard(style: .primary) {
            VStack(spacing: 16) {
                Image(systemName: "paintbrush.pointed.fill")
                    .font(.system(size: 50))
                    .themeColor(.primary)
                
                ThemeText("customize_appearance", style: .title2, weight: .bold)
                
                ThemeText("theme_description", style: .body, color: .textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
    }
    
    private var predefinedThemesSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            ThemeText("predefined_themes", style: .headline, weight: .semibold)
            
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 2), spacing: 12) {
                ForEach(PredefinedThemeType.allCases, id: \.self) { themeType in
                    ThemePreviewCard(
                        themeType: themeType,
                        isSelected: selectedTheme == themeType
                    ) {
                        selectedTheme = themeType
                        themeManager.applyPredefinedTheme(themeType)
                    }
                }
            }
        }
    }
    
    private var themePreviewSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            ThemeText("preview", style: .headline, weight: .semibold)
            
            ThemeCard {
                VStack(spacing: 16) {
                    HStack {
                        ThemeText("sample_title", style: .title3, weight: .bold)
                        Spacer()
                        ThemeButton("Action", style: .primary, size: .small) {
                            // Preview action
                        }
                    }
                    
                    ThemeText("sample_description", style: .body, color: .textSecondary)
                        .multilineTextAlignment(.leading)
                    
                    HStack(spacing: 12) {
                        ThemeButton("Primary", style: .primary, size: .small) {}
                        ThemeButton("Secondary", style: .secondary, size: .small) {}
                        ThemeButton("Outline", style: .outline, size: .small) {}
                    }
                }
            }
        }
    }
    
    private var customizationSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            ThemeText("customization", style: .headline, weight: .semibold)
            
            VStack(spacing: 12) {
                customizationRow("Colors", "palette.fill") {
                    showingCustomization = true
                }
                
                customizationRow("Typography", "textformat") {
                    showingCustomization = true
                }
                
                customizationRow("Components", "square.stack.3d.up") {
                    showingCustomization = true
                }
                
                customizationRow("Effects", "wand.and.rays") {
                    showingCustomization = true
                }
            }
        }
    }
    
    private var resetSection: some View {
        VStack(spacing: 12) {
            ThemeButton("reset_to_default", style: .outline, size: .fullWidth) {
                themeManager.resetToDefault()
                selectedTheme = .default
            }
            
            if themeManager.isCustomThemeEnabled {
                ThemeButton("disable_custom_theme", style: .ghost, size: .fullWidth) {
                    themeManager.isCustomThemeEnabled = false
                }
            }
        }
    }
    
    // MARK: - Helper Views
    private func customizationRow(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.title3)
                    .themeColor(.primary)
                    .frame(width: 24)
                
                ThemeText(title, style: .body)
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .themeColor(.textTertiary)
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(themeManager.color(.textTertiary).opacity(0.2), lineWidth: 1)
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - Theme Preview Card
struct ThemePreviewCard: View {
    let themeType: PredefinedThemeType
    let isSelected: Bool
    let action: () -> Void
    
    @EnvironmentObject private var themeManager: ThemeManager
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                // Mini preview
                HStack(spacing: 4) {
                    ForEach(0..<3) { _ in
                        Circle()
                            .fill(previewColors.randomElement() ?? .blue)
                            .frame(width: 8, height: 8)
                    }
                }
                
                ThemeText(themeType.displayName, style: .caption1, weight: .medium)
                
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.caption)
                        .themeColor(.primary)
                }
            }
            .padding()
            .frame(height: 80)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(themeManager.color(.surface))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(
                                isSelected ? themeManager.color(.primary) : themeManager.color(.textTertiary).opacity(0.2),
                                lineWidth: isSelected ? 2 : 1
                            )
                    )
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
    
    private var previewColors: [Color] {
        switch themeType {
        case .default: return [.blue, .purple, .cyan]
        case .dark: return [.white, .gray, .blue]
        case .ocean: return [.blue, .teal, .cyan]
        case .forest: return [.green, .mint, .brown]
        case .sunset: return [.orange, .red, .yellow]
        case .minimal: return [.black, .gray, .white]
        }
    }
}

// MARK: - Custom Theme View
struct CustomThemeView: View {
    @EnvironmentObject private var themeManager: ThemeManager
    @Environment(\.presentationMode) var presentationMode
    
    @State private var selectedSection: CustomizationSection = .colors
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Section picker
                Picker("Section", selection: $selectedSection) {
                    ForEach(CustomizationSection.allCases, id: \.self) { section in
                        Text(section.displayName).tag(section)
                    }
                }
                .pickerStyle(SegmentedPickerStyle())
                .padding()
                
                // Content
                ScrollView {
                    Group {
                        switch selectedSection {
                        case .colors:
                            ColorsCustomizationView()
                        case .typography:
                            TypographyCustomizationView()
                        case .components:
                            ComponentsCustomizationView()
                        case .effects:
                            EffectsCustomizationView()
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("custom_theme")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("done".localized) {
                        presentationMode.wrappedValue.dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - Customization Sections
enum CustomizationSection: CaseIterable {
    case colors, typography, components, effects
    
    var displayName: String {
        switch self {
        case .colors: return "Colors"
        case .typography: return "Typography"
        case .components: return "Components"
        case .effects: return "Effects"
        }
    }
}

// MARK: - Color Property
struct ColorProperty: Identifiable {
    let id = UUID()
    let name: String
    let keyPath: WritableKeyPath<ThemeConfiguration, ColorConfig>
}

// MARK: - Placeholder Customization Views
struct ColorsCustomizationView: View {
    var body: some View {
        VStack {
            ThemeText("Colors customization coming soon", style: .body, color: .textSecondary)
        }
    }
}

struct TypographyCustomizationView: View {
    var body: some View {
        VStack {
            ThemeText("Typography customization coming soon", style: .body, color: .textSecondary)
        }
    }
}

struct ComponentsCustomizationView: View {
    var body: some View {
        VStack {
            ThemeText("Components customization coming soon", style: .body, color: .textSecondary)
        }
    }
}

struct EffectsCustomizationView: View {
    var body: some View {
        VStack {
            ThemeText("Effects customization coming soon", style: .body, color: .textSecondary)
        }
    }
}

struct ColorPickerView: View {
    let property: ColorProperty
    @Environment(\.presentationMode) var presentationMode
    
    var body: some View {
        VStack {
            ThemeText("Color picker for \(property.name)", style: .body, color: .textSecondary)
            
            Button("Done") {
                presentationMode.wrappedValue.dismiss()
            }
        }
        .padding()
    }
}