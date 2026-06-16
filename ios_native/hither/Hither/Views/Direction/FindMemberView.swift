//
//  FindMemberView.swift
//  Hither
//
//  Created by Development Agent on 2025/8/4.
//

import SwiftUI
import CoreLocation

struct FindMemberView: View {
    let targetMember: GroupMember
    let findRequest: FindRequest
    
    @EnvironmentObject private var groupService: GroupService
    @EnvironmentObject private var authService: AuthenticationService
    @StateObject private var locationService = LocationService()
    @StateObject private var directionService: DirectionService
    @StateObject private var findRequestService = FindRequestService()
    
    @State private var isPrecisionFindingActive = false
    @State private var showingExitConfirmation = false
    @State private var isNetworkConnected = true
    @State private var showingNetworkError = false
    @Environment(\.dismiss) private var dismiss
    
    init(targetMember: GroupMember, findRequest: FindRequest) {
        self.targetMember = targetMember
        self.findRequest = findRequest
        
        let locationService = LocationService()
        self._locationService = StateObject(wrappedValue: locationService)
        self._directionService = StateObject(wrappedValue: DirectionService(locationService: locationService))
    }
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Full screen compass interface
                ZStack {
                    // Background gradient
                    LinearGradient(
                        colors: [
                            Color.black.opacity(0.9),
                            Color.black.opacity(0.7),
                            Color.black.opacity(0.9)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .ignoresSafeArea()
                    
                    VStack(spacing: 40) {
                        // Target member info header
                        targetMemberHeader
                        
                        // Main compass display
                        compassDisplay
                        
                        // Distance and direction info
                        distanceInfo
                        
                        Spacer()
                        
                        // Precision finding controls
                        if directionService.isNearbyInteractionAvailable {
                            precisionFindingControls
                        }
                        
                        // Status indicators
                        statusIndicators
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 20)
                }
            }
            .navigationBarHidden(true)
            .overlay(alignment: .topTrailing) {
                // Exit button
                Button(action: {
                    showingExitConfirmation = true
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundColor(.white.opacity(0.8))
                        .background(Color.black.opacity(0.3))
                        .clipShape(Circle())
                }
                .padding(.top, 50)
                .padding(.trailing, 24)
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .preferredColorScheme(.dark)
        .onAppear {
            setupFindSession()
            startNetworkMonitoring()
        }
        .onDisappear {
            cleanupFindSession()
        }
        .alert("exit_find_mode".localized, isPresented: $showingExitConfirmation) {
            Button("cancel".localized, role: .cancel) { }
            Button("exit".localized, role: .destructive) {
                dismiss()
            }
        } message: {
            Text("exit_find_mode_message".localized)
        }
        .alert("network_error".localized, isPresented: $showingNetworkError) {
            Button("retry".localized) {
                retryConnection()
            }
            Button("continue_offline".localized, role: .cancel) {
                showingNetworkError = false
            }
        } message: {
            Text("network_error_message".localized)
        }
    }
    
    @ViewBuilder
    private var targetMemberHeader: some View {
        VStack(spacing: 12) {
            // Target member avatar
            ZStack {
                Circle()
                    .fill(.ultraThinMaterial)
                    .frame(width: 80, height: 80)
                    .overlay(
                        Circle()
                            .stroke(
                                LinearGradient(
                                    colors: [Color.blue.opacity(0.6), Color.purple.opacity(0.4)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 3
                            )
                    )
                    .shadow(color: Color.blue.opacity(0.3), radius: 15, y: 8)
                
                Image(systemName: "person.fill")
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .font(.system(size: 28, weight: .bold))
            }
            
            VStack(spacing: 4) {
                Text("finding_member".localized)
                    .font(.headline)
                    .foregroundColor(.white.opacity(0.8))
                
                Text(targetMember.displayName)
                    .font(.title)
                    .fontWeight(.bold)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
            }
        }
    }
    
    @ViewBuilder
    private var compassDisplay: some View {
        ZStack {
            // Main compass circle
            Circle()
                .fill(.ultraThinMaterial)
                .frame(width: 280, height: 280)
                .overlay(
                    Circle()
                        .stroke(
                            LinearGradient(
                                colors: [Color.blue.opacity(0.6), Color.purple.opacity(0.3)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 3
                        )
                )
                .shadow(color: Color.blue.opacity(0.3), radius: 25, y: 10)
            
            // Cardinal directions
            ForEach(0..<4) { index in
                Text(["N", "E", "S", "W"][index])
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.white, .white.opacity(0.7)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .offset(y: -130)
                    .rotationEffect(.degrees(Double(index) * 90))
            }
            
            // Main direction arrow
            Image(systemName: "arrow.up")
                .font(.system(size: 60, weight: .bold))
                .foregroundStyle(
                    LinearGradient(
                        colors: [.blue, .purple],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .shadow(color: Color.blue.opacity(0.5), radius: 10, y: 5)
                .rotationEffect(directionService.getTargetDirectionArrowRotation())
                .animation(.easeInOut(duration: 0.5), value: directionService.bearingToTarget)
            
            // Center dot
            Circle()
                .fill(Color.white)
                .frame(width: 8, height: 8)
                .shadow(color: Color.black.opacity(0.3), radius: 2)
        }
    }
    
    @ViewBuilder
    private var distanceInfo: some View {
        VStack(spacing: 16) {
            // Distance display
            VStack(spacing: 8) {
                Text(directionService.getTargetDistanceString())
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                
                Text("to_target_member".localized)
                    .font(.headline)
                    .foregroundColor(.white.opacity(0.8))
            }
            
            // Direction description
            Text(directionService.getTargetDirectionDescription())
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(
                    LinearGradient(
                        colors: [.blue.opacity(0.9), .purple.opacity(0.9)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
        }
        .padding(.vertical, 20)
        .padding(.horizontal, 32)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(
                    LinearGradient(
                        colors: [Color.blue.opacity(0.4), Color.purple.opacity(0.2)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        .shadow(color: Color.blue.opacity(0.2), radius: 15, y: 8)
    }
    
    @ViewBuilder
    private var precisionFindingControls: some View {
        VStack(spacing: 16) {
            Text("precision_finding".localized)
                .font(.headline)
                .fontWeight(.semibold)
                .foregroundColor(.white.opacity(0.9))
            
            Text("precision_finding_member_description".localized)
                .font(.caption)
                .foregroundColor(.white.opacity(0.6))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 8)
            
            Button(action: {
                togglePrecisionFinding()
            }) {
                HStack(spacing: 12) {
                    Image(systemName: isPrecisionFindingActive ? "dot.radiowaves.left.and.right" : "dot.radiowaves.forward")
                        .font(.title3)
                    Text(isPrecisionFindingActive ? "stop_precision_finding".localized : "start_precision_finding".localized)
                        .fontWeight(.medium)
                }
                .foregroundColor(.white)
                .padding(.vertical, 16)
                .padding(.horizontal, 24)
                .background(
                    LinearGradient(
                        colors: isPrecisionFindingActive ? [.red, .red.opacity(0.8)] : [.blue, .purple],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .shadow(color: (isPrecisionFindingActive ? Color.red : Color.blue).opacity(0.3), radius: 10, y: 5)
            }
        }
        .padding(20)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(
                    LinearGradient(
                        colors: [Color.blue.opacity(0.3), Color.purple.opacity(0.2)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        .padding(.horizontal, 16)
    }
    
    @ViewBuilder
    private var statusIndicators: some View {
        HStack(spacing: 20) {
            // Location status
            HStack(spacing: 8) {
                Circle()
                    .fill(locationService.isTracking ? Color.green : Color.red)
                    .frame(width: 10, height: 10)
                    .overlay(
                        Circle()
                            .stroke(Color.white.opacity(0.4), lineWidth: 0.5)
                    )
                
                Text(locationService.isTracking ? "location_active".localized : "location_inactive".localized)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(locationService.isTracking ? .green : .red)
            }
            
            Spacer()
            
            // Precision mode status
            if !directionService.nearbyObjects.isEmpty {
                HStack(spacing: 8) {
                    Circle()
                        .fill(Color.blue)
                        .frame(width: 10, height: 10)
                        .overlay(
                            Circle()
                                .stroke(Color.white.opacity(0.4), lineWidth: 0.5)
                        )
                    
                    Text("precision_mode".localized)
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.blue)
                }
            }
            
            // Session time
            HStack(spacing: 8) {
                Circle()
                    .fill(Color.orange)
                    .frame(width: 10, height: 10)
                
                Text(getSessionTimeString())
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(.orange)
            }
        }
        .padding(16)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.white.opacity(0.1), lineWidth: 1)
        )
        .padding(.horizontal, 16)
        .padding(.bottom, 30)
        
        // Error message
        if let errorMessage = directionService.errorMessage {
            Text(errorMessage)
                .font(.caption)
                .foregroundColor(.red)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
        }
    }
    
    private func setupFindSession() {
        guard let group = groupService.currentGroup,
              let user = authService.currentUser,
              let targetLocation = targetMember.location else { return }
        
        // Start location tracking
        locationService.requestLocationPermission()
        locationService.startTracking(groupId: group.id, userId: user.id)
        
        // Set target member location for direction service
        directionService.setTargetMember(location: targetLocation.coordinate)
        
        print("✅ Started find session for member: \(targetMember.displayName)")
    }
    
    private func cleanupFindSession() {
        // Stop precision finding if active
        if isPrecisionFindingActive {
            directionService.stopNearbyInteraction()
        }
        
        // Clear target member
        directionService.clearTargetMember()
        
        print("✅ Cleaned up find session")
    }
    
    private func togglePrecisionFinding() {
        if isPrecisionFindingActive {
            directionService.stopNearbyInteraction()
            isPrecisionFindingActive = false
        } else {
            // In a real implementation, you'd exchange discovery tokens between devices
            // For now, we'll just simulate starting precision finding
            isPrecisionFindingActive = true
            
            // Request discovery token from target member (this would be done via Firestore)
            // directionService.startNearbyInteraction(with: targetDiscoveryToken)
        }
    }
    
    private func getSessionTimeString() -> String {
        let timeElapsed = Date().timeIntervalSince(findRequest.createdAt)
        let minutes = Int(timeElapsed / 60)
        let seconds = Int(timeElapsed.truncatingRemainder(dividingBy: 60))
        
        if minutes > 0 {
            return String(format: "%dm %ds", minutes, seconds)
        } else {
            return String(format: "%ds", seconds)
        }
    }
    
    // MARK: - Network Monitoring & Error Recovery
    
    private func startNetworkMonitoring() {
        // Monitor location service status as a proxy for network connectivity
        // In a real implementation, you would use Network framework
        Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            checkNetworkStatus()
        }
    }
    
    private func checkNetworkStatus() {
        // Check if location updates are recent as a network health indicator
        if let lastUpdate = targetMember.lastLocationUpdate,
           Date().timeIntervalSince(lastUpdate) > 120 { // 2 minutes
            if isNetworkConnected {
                isNetworkConnected = false
                showingNetworkError = true
            }
        } else {
            isNetworkConnected = true
        }
    }
    
    private func retryConnection() {
        showingNetworkError = false
        
        // Retry setup
        Task {
            setupFindSession()
            
            // Wait a moment and check if successful
            try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds
            
            await MainActor.run {
                if locationService.isTracking {
                    isNetworkConnected = true
                } else {
                    showingNetworkError = true
                }
            }
        }
    }
}

// MARK: - Preview Provider

struct FindMemberView_Previews: PreviewProvider {
    static var previews: some View {
        let sampleMember = GroupMember(
            id: "sample-member-id",
            userId: "sample-user",
            displayName: "John Doe",
            role: .follower,
            joinedAt: Date(),
            location: GeoPoint(latitude: 37.7749, longitude: -122.4194),
            lastLocationUpdate: Date()
        )
        
        let sampleRequest = FindRequest(
            requesterId: "requester-id",
            targetId: "target-id"
        )
        
        FindMemberView(targetMember: sampleMember, findRequest: sampleRequest)
            .environmentObject(GroupService())
            .environmentObject(AuthenticationService())
    }
}