//
//  StandardErrorView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

/// Standardized error display component
struct StandardErrorView: View {
    let message: String
    var icon: String = "exclamationmark.circle"
    var color: Color = .red
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundColor(color)
            
            Text(message)
                .font(.caption)
                .foregroundColor(color)
                .multilineTextAlignment(.leading)
        }
        .padding(12)
        .darkBlueCard(cornerRadius: 12)
    }
}

/// Standardized loading view with optional message
struct StandardLoadingView: View {
    let message: String
    
    var body: some View {
        SheepLoadingView(message: message)
            .padding()
    }
}

/// Conditional error display - only shows when error exists
struct ConditionalErrorView: View {
    let errorMessage: String?
    
    var body: some View {
        if let errorMessage = errorMessage {
            StandardErrorView(message: errorMessage)
                .padding(.horizontal, 16)
        }
    }
}

/// Conditional loading view - only shows when loading
struct ConditionalLoadingView: View {
    let isLoading: Bool
    let message: String
    
    var body: some View {
        if isLoading {
            StandardLoadingView(message: message)
        }
    }
}

#Preview {
    VStack(spacing: 20) {
        StandardErrorView(message: "Something went wrong. Please try again.")
        
        StandardErrorView(
            message: "Network connection failed",
            icon: "wifi.slash",
            color: .orange
        )
        
        StandardLoadingView(message: "Loading groups...")
        
        ConditionalErrorView(errorMessage: "Invalid invite code")
        ConditionalErrorView(errorMessage: nil)
        
        ConditionalLoadingView(isLoading: true, message: "Creating group...")
        ConditionalLoadingView(isLoading: false, message: "Creating group...")
    }
    .padding()
}