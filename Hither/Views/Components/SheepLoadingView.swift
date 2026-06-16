//
//  SheepLoadingView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct SheepLoadingView: View {
    @State private var isAnimating = false
    let message: String?
    
    init(message: String? = nil) {
        self.message = message
    }
    
    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                // Bouncing sheep emoji
                Text("🐑")
                    .font(.system(size: 40))
                    .offset(y: isAnimating ? -10 : 10)
                    .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: isAnimating)
                
                // Spinning circle behind sheep
                Circle()
                    .stroke(Color.blue.opacity(0.3), lineWidth: 3)
                    .frame(width: 60, height: 60)
                    .rotationEffect(.degrees(isAnimating ? 360 : 0))
                    .animation(.linear(duration: 2).repeatForever(autoreverses: false), value: isAnimating)
            }
            
            if let message = message {
                Text(message)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .onAppear {
            isAnimating = true
        }
        .onDisappear {
            isAnimating = false
        }
    }
}

struct SheepProgressView: View {
    let tint: Color?
    
    init(tint: Color? = nil) {
        self.tint = tint
    }
    
    var body: some View {
        SheepLoadingView()
            .foregroundColor(tint ?? .primary)
    }
}

#Preview {
    VStack(spacing: 40) {
        SheepLoadingView()
        SheepLoadingView(message: "Loading your group...")
        SheepProgressView(tint: .white)
            .background(Color.blue)
            .cornerRadius(8)
            .padding()
    }
}