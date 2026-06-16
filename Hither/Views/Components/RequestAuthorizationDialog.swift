//
//  RequestAuthorizationDialog.swift
//  Hither
//
//  Created by Development Agent on 2025/8/4.
//

import SwiftUI

struct RequestAuthorizationDialog: View {
    let request: FindRequest
    let requesterMember: GroupMember
    let targetMember: GroupMember
    let onApprove: () -> Void
    let onDeny: () -> Void
    let onDismiss: () -> Void
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 16) {
                // Title with icon
                HStack(spacing: 12) {
                    Image(systemName: "person.2.wave.2")
                        .font(.title2)
                        .foregroundColor(.blue)
                        .frame(width: 28, height: 28)
                    
                    Text("Find Request Authorization")
                        .font(.headline)
                        .foregroundColor(.primary)
                    
                    Spacer()
                }
                
                // Request details
                VStack(spacing: 12) {
                    // Requester info
                    HStack(spacing: 12) {
                        // Requester avatar
                        if let emoji = requesterMember.avatarEmoji {
                            Text(emoji)
                                .font(.title2)
                                .frame(width: 36, height: 36)
                                .background(Color.blue.opacity(0.1))
                                .clipShape(Circle())
                        } else {
                            Image(systemName: "person.circle.fill")
                                .font(.title2)
                                .foregroundColor(.blue)
                                .frame(width: 36, height: 36)
                        }
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text(requesterMember.nickname ?? requesterMember.displayName)
                                .font(.body)
                                .fontWeight(.medium)
                                .foregroundColor(.primary)
                            Text("wants to find")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        
                        // Arrow
                        Image(systemName: "arrow.right")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        // Target avatar
                        if let emoji = targetMember.avatarEmoji {
                            Text(emoji)
                                .font(.title2)
                                .frame(width: 36, height: 36)
                                .background(Color.green.opacity(0.1))
                                .clipShape(Circle())
                        } else {
                            Image(systemName: "person.circle.fill")
                                .font(.title2)
                                .foregroundColor(.green)
                                .frame(width: 36, height: 36)
                        }
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text(targetMember.nickname ?? targetMember.displayName)
                                .font(.body)
                                .fontWeight(.medium)
                                .foregroundColor(.primary)
                            Text("(target)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        
                        Spacer()
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 20)
            
            Divider()
            
            // Request metadata
            VStack(spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Request Time")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text(formatRequestTime(request.createdAt))
                            .font(.body)
                            .foregroundColor(.primary)
                    }
                    
                    Spacer()
                    
                    VStack(alignment: .trailing, spacing: 4) {
                        Text("Status")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        HStack(spacing: 4) {
                            Circle()
                                .fill(statusColor)
                                .frame(width: 8, height: 8)
                            Text(request.status.displayName)
                                .font(.body)
                                .foregroundColor(statusColor)
                        }
                    }
                }
                
                // Expiration warning
                if !request.isExpired {
                    HStack {
                        Image(systemName: "clock")
                            .font(.caption)
                            .foregroundColor(.orange)
                        Text("Expires in \(timeUntilExpiration)")
                            .font(.caption)
                            .foregroundColor(.orange)
                        Spacer()
                        Text("Request will expire automatically")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                } else {
                    HStack {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundColor(.red)
                        Text("Request has expired")
                            .font(.caption)
                            .foregroundColor(.red)
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
                        Image(systemName: "xmark.circle")
                            .font(.body)
                        Text("Deny")
                            .font(.body)
                            .fontWeight(.medium)
                    }
                    .foregroundColor(.red)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                }
                .buttonStyle(PlainButtonStyle())
                .disabled(request.isExpired || request.status != .pending)
                
                Rectangle()
                    .fill(Color.primary.opacity(0.2))
                    .frame(width: 1)
                
                // Approve button
                Button(action: onApprove) {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle")
                            .font(.body)
                        Text("Approve")
                            .font(.body)
                            .fontWeight(.medium)
                    }
                    .foregroundColor(request.isExpired || request.status != .pending ? .secondary : .blue)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                }
                .buttonStyle(PlainButtonStyle())
                .disabled(request.isExpired || request.status != .pending)
            }
        }
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: Color.black.opacity(0.15), radius: 10, x: 0, y: 5)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.primary.opacity(0.1), lineWidth: 1)
        )
    }
    
    private var statusColor: Color {
        switch request.status {
        case .pending:
            return .orange
        case .approved:
            return .green
        case .denied:
            return .red
        case .expired:
            return .secondary
        }
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
    
    private func formatRequestTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }
}

struct RequestAuthorizationOverlay: View {
    let request: FindRequest
    let requesterMember: GroupMember
    let targetMember: GroupMember
    let onApprove: () -> Void
    let onDeny: () -> Void
    @Binding var isPresented: Bool
    
    var body: some View {
        ZStack {
            // Background overlay
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation(.easeOut(duration: 0.25)) {
                        isPresented = false
                    }
                }
            
            // Dialog positioned in center
            RequestAuthorizationDialog(
                request: request,
                requesterMember: requesterMember,
                targetMember: targetMember,
                onApprove: {
                    onApprove()
                    withAnimation(.easeOut(duration: 0.25)) {
                        isPresented = false
                    }
                },
                onDeny: {
                    onDeny()
                    withAnimation(.easeOut(duration: 0.25)) {
                        isPresented = false
                    }
                },
                onDismiss: {
                    withAnimation(.easeOut(duration: 0.25)) {
                        isPresented = false
                    }
                }
            )
            .frame(maxWidth: 360)
            .padding(.horizontal, 24)
            .scaleEffect(isPresented ? 1.0 : 0.85)
            .opacity(isPresented ? 1.0 : 0.0)
            .animation(.spring(response: 0.4, dampingFraction: 0.75), value: isPresented)
        }
    }
}

// MARK: - Extensions

extension FindRequestStatus {
    var displayName: String {
        switch self {
        case .pending:
            return "Pending"
        case .approved:
            return "Approved"
        case .denied:
            return "Denied"
        case .expired:
            return "Expired"
        }
    }
}

// MARK: - Preview

struct RequestAuthorizationDialog_Previews: PreviewProvider {
    static var previews: some View {
        let sampleRequest = FindRequest(
            id: "sample-request",
            requesterId: "requester-id",
            targetId: "target-id",
            status: .pending,
            createdAt: Date().addingTimeInterval(-120), // 2 minutes ago
            expiresAt: Date().addingTimeInterval(180) // 3 minutes from now
        )
        
        let requesterMember = GroupMember(
            userId: "requester-id",
            displayName: "Alice Chen",
            role: .follower,
            nickname: "Alice",
            avatarEmoji: "🧭"
        )
        
        let targetMember = GroupMember(
            userId: "target-id",
            displayName: "Bob Smith", 
            role: .follower,
            nickname: "Bob",
            avatarEmoji: "🎯"
        )
        
        RequestAuthorizationDialog(
            request: sampleRequest,
            requesterMember: requesterMember,
            targetMember: targetMember,
            onApprove: { print("Approved") },
            onDeny: { print("Denied") },
            onDismiss: { print("Dismissed") }
        )
        .padding()
        .background(Color.gray.opacity(0.1))
        .previewLayout(.sizeThatFits)
        
        // Dark mode preview
        RequestAuthorizationDialog(
            request: sampleRequest,
            requesterMember: requesterMember,
            targetMember: targetMember,
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