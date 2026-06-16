//
//  FindRequestNotification.swift
//  Hither
//
//  Created by Development Agent on 2025/8/4.
//

import SwiftUI

struct FindRequestNotification: View {
    let request: FindRequest
    let requesterName: String
    let targetName: String
    let onApprove: () -> Void
    let onDeny: () -> Void
    let onDismiss: () -> Void
    
    var body: some View {
        VStack(spacing: 0) {
            // Header with notification icon and title
            VStack(spacing: 12) {
                // Icon
                Image(systemName: "person.2.wave.2.fill")
                    .font(.system(size: 40))
                    .foregroundColor(.blue)
                    .frame(width: 60, height: 60)
                    .background(Color.blue.opacity(0.1))
                    .clipShape(Circle())
                
                // Title and message
                VStack(spacing: 6) {
                    Text("Find Request")
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundColor(.primary)
                    
                    Text("\(requesterName) wants to find you")
                        .font(.body)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.vertical, 24)
            .padding(.horizontal, 20)
            
            Divider()
            
            // Request details
            VStack(spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("From")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text(requesterName)
                            .font(.body)
                            .fontWeight(.medium)
                            .foregroundColor(.primary)
                    }
                    
                    Spacer()
                    
                    VStack(alignment: .trailing, spacing: 4) {
                        Text("Target")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text(targetName)
                            .font(.body)
                            .fontWeight(.medium)
                            .foregroundColor(.primary)
                    }
                }
                
                // Expiration timer
                if !request.isExpired {
                    HStack {
                        Image(systemName: "clock")
                            .font(.caption)
                            .foregroundColor(.orange)
                        Text("Expires in \(timeUntilExpiration)")
                            .font(.caption)
                            .foregroundColor(.orange)
                        Spacer()
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            
            Divider()
            
            // Action buttons
            HStack(spacing: 0) {
                // Deny button
                Button(action: onDeny) {
                    HStack(spacing: 8) {
                        Image(systemName: "xmark")
                            .font(.body)
                        Text("Deny")
                            .font(.body)
                            .fontWeight(.medium)
                    }
                    .foregroundColor(.red)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                }
                .buttonStyle(PlainButtonStyle())
                
                Rectangle()
                    .fill(Color.primary.opacity(0.2))
                    .frame(width: 1)
                
                // Approve button
                Button(action: onApprove) {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark")
                            .font(.body)
                        Text("Allow")
                            .font(.body)
                            .fontWeight(.medium)
                    }
                    .foregroundColor(.blue)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                }
                .buttonStyle(PlainButtonStyle())
            }
        }
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: Color.black.opacity(0.2), radius: 12, x: 0, y: 6)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.primary.opacity(0.1), lineWidth: 1)
        )
    }
    
    private var timeUntilExpiration: String {
        let now = Date()
        let expirationTime = request.expiresAt
        let timeInterval = expirationTime.timeIntervalSince(now)
        
        if timeInterval <= 0 {
            return "Expired"
        }
        
        let minutes = Int(timeInterval / 60)
        let seconds = Int(timeInterval.truncatingRemainder(dividingBy: 60))
        
        if minutes > 0 {
            return "\(minutes)m \(seconds)s"
        } else {
            return "\(seconds)s"
        }
    }
}

struct FindRequestNotificationOverlay: View {
    let request: FindRequest
    let requesterName: String
    let targetName: String
    let onApprove: () -> Void
    let onDeny: () -> Void
    @Binding var isPresented: Bool
    
    var body: some View {
        ZStack {
            // Background overlay
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation(.easeOut(duration: 0.2)) {
                        isPresented = false
                    }
                }
            
            // Notification positioned at center
            FindRequestNotification(
                request: request,
                requesterName: requesterName,
                targetName: targetName,
                onApprove: {
                    onApprove()
                    withAnimation(.easeOut(duration: 0.2)) {
                        isPresented = false
                    }
                },
                onDeny: {
                    onDeny()
                    withAnimation(.easeOut(duration: 0.2)) {
                        isPresented = false
                    }
                },
                onDismiss: {
                    withAnimation(.easeOut(duration: 0.2)) {
                        isPresented = false
                    }
                }
            )
            .frame(maxWidth: 320)
            .padding(.horizontal, 20)
            .scaleEffect(isPresented ? 1.0 : 0.8)
            .opacity(isPresented ? 1.0 : 0.0)
            .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isPresented)
        }
    }
}

// MARK: - Preview

struct FindRequestNotification_Previews: PreviewProvider {
    static var previews: some View {
        let sampleRequest = FindRequest(
            id: "sample-request",
            requesterId: "requester-id",
            targetId: "target-id",
            status: .pending,
            createdAt: Date(),
            expiresAt: Date().addingTimeInterval(300) // 5 minutes from now
        )
        
        FindRequestNotification(
            request: sampleRequest,
            requesterName: "Alice Chen",
            targetName: "Bob Smith",
            onApprove: { print("Approved") },
            onDeny: { print("Denied") },
            onDismiss: { print("Dismissed") }
        )
        .padding()
        .background(Color.gray.opacity(0.1))
        .previewLayout(.sizeThatFits)
        
        // Dark mode preview
        FindRequestNotification(
            request: sampleRequest,
            requesterName: "Alice Chen",
            targetName: "Bob Smith",
            onApprove: { print("Approved") },
            onDeny: { print("Denied") },
            onDismiss: { print("Dismissed") }
        )
        .padding()
        .background(Color.gray.opacity(0.1))
        .previewLayout(.sizeThatFits)
        .preferredColorScheme(.dark)
    }
}