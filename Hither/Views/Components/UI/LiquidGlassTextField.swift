//
//  LiquidGlassTextField.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

/// A standardized text field with liquid glass design system
struct LiquidGlassTextField: View {
    let placeholder: String
    @Binding var text: String
    var icon: String? = nil
    var iconColor: Color = .secondary
    var textCase: Text.Case? = nil
    
    var body: some View {
        HStack {
            if let icon = icon {
                Image(systemName: icon)
                    .foregroundColor(iconColor)
            }
            TextField(placeholder, text: $text)
                .foregroundColor(.primary)
                .textCase(textCase)
        }
        .padding()
        .background(.ultraThinMaterial)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(
                    LinearGradient(
                        colors: [Color.white.opacity(0.3), Color.white.opacity(0.1)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 0.5
                )
        )
        .shadow(color: Color.black.opacity(0.05), radius: 8, y: 4)
    }
}

/// A standardized section header with gradient text
struct LiquidGlassSectionHeader: View {
    let text: String
    var colors: [Color] = [.blue, .purple]
    
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
            .padding(.horizontal, 20)
    }
}

#Preview {
    VStack(spacing: 20) {
        LiquidGlassSectionHeader(text: "Section Title", colors: [.green, .teal])
        
        LiquidGlassTextField(
            placeholder: "Enter code",
            text: .constant(""),
            icon: "key",
            iconColor: .green.opacity(0.7),
            textCase: .uppercase
        )
        
        LiquidGlassTextField(
            placeholder: "Group name",
            text: .constant("My Group"),
            icon: "person.2.fill",
            iconColor: .blue.opacity(0.7)
        )
    }
    .padding()
}