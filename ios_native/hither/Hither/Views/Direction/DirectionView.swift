//
//  DirectionView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI
import CoreLocation

struct DirectionView: View {
    @EnvironmentObject private var groupService: GroupService
    @EnvironmentObject private var authService: AuthenticationService
    @StateObject private var locationService = LocationService()
    @StateObject private var directionService: DirectionService
    @State private var isPrecisionFindingActive = false
    
    init() {
        let locationService = LocationService()
        self._locationService = StateObject(wrappedValue: locationService)
        self._directionService = StateObject(wrappedValue: DirectionService(locationService: locationService))
    }
    
    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                if let group = groupService.currentGroup,
                   let leader = group.leader,
                   let user = authService.currentUser,
                   user.id != leader.userId {
                    
                    // Follower view - show direction to leader
                    followerDirectionView(leader: leader)
                    
                } else if let group = groupService.currentGroup,
                          let user = authService.currentUser,
                          group.leader?.userId == user.id {
                    
                    // Leader view - show all followers
                    leaderDirectionView(group: group)
                    
                } else {
                    // No group or no leader
                    Text("join_group_to_see_directions".localized)
                        .foregroundColor(.secondary)
                        .font(.title2)
                }
            }
            .padding()
            .navigationTitle("direction".localized)
            .onAppear {
                setupLocationTracking()
                updateLeaderLocation()
            }
            .onChange(of: groupService.currentGroup) { _ in
                updateLeaderLocation()
            }
        }
    }
    
    @ViewBuilder
    private func followerDirectionView(leader: GroupMember) -> some View {
        VStack(spacing: 30) {
            // Main compass arrow with liquid glass treatment
            VStack(spacing: 16) {
                ZStack {
                    // Glass compass circle with enhanced material
                    Circle()
                        .fill(.ultraThinMaterial)
                        .frame(width: 220, height: 220)
                        .overlay(
                            Circle()
                                .stroke(
                                    LinearGradient(
                                        colors: [Color.blue.opacity(0.4), Color.purple.opacity(0.2)],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    ),
                                    lineWidth: 2
                                )
                        )
                        .shadow(color: Color.blue.opacity(0.2), radius: 20, y: 8)
                    
                    // Cardinal directions with glass styling
                    ForEach(0..<4) { index in
                        Text(["N", "E", "S", "W"][index])
                            .font(.headline)
                            .fontWeight(.semibold)
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [.primary, .secondary],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )
                            .offset(y: -100)
                            .rotationEffect(.degrees(Double(index) * 90))
                    }
                    
                    // Enhanced direction arrow with gradient
                    Image(systemName: "arrow.up")
                        .font(.system(size: 45, weight: .bold))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.blue, .purple],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .shadow(color: Color.blue.opacity(0.3), radius: 8, y: 4)
                        .rotationEffect(directionService.getDirectionArrowRotation())
                        .animation(.easeInOut(duration: 0.5), value: directionService.bearingToLeader)
                }
                
                // Distance display with liquid glass treatment
                VStack(spacing: 12) {
                    Text(directionService.getDistanceString())
                        .font(.largeTitle)
                        .fontWeight(.bold)
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.blue, .purple],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                    
                    Text(String(format: "to_leader".localized, leader.displayName))
                        .font(.headline)
                        .foregroundColor(.primary)
                    
                    Text(directionService.getDirectionDescription())
                        .font(.subheadline)
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.blue.opacity(0.8), .purple.opacity(0.8)],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                }
                .darkBlueCard(cornerRadius: 20)
                .padding(.horizontal, 24)
            }
            
            // Precision Finding section with liquid glass treatment
            if directionService.isNearbyInteractionAvailable {
                VStack(spacing: 16) {
                    Text("precision_finding".localized)
                        .font(.headline)
                        .fontWeight(.semibold)
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.primary, .secondary],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                    
                    Text("precision_finding_description".localized)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)
                    
                    DarkBlueButton(variant: isPrecisionFindingActive ? .destructive : .primary, action: {
                        togglePrecisionFinding()
                    }) {
                        HStack(spacing: 12) {
                            Image(systemName: isPrecisionFindingActive ? "dot.radiowaves.left.and.right" : "dot.radiowaves.forward")
                                .font(.title3)
                            Text(isPrecisionFindingActive ? "stop_precision_finding".localized : "start_precision_finding".localized)
                                .fontWeight(.medium)
                        }
                        .foregroundColor(.white)
                        .padding(.vertical, 12)
                        .padding(.horizontal, 20)
                    }
                }
                .padding(20)
                .darkBlueCard(cornerRadius: 18)
                .padding(.horizontal, 16)
            }
            
            // Status information with liquid glass treatment
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 16) {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(locationService.isTracking ? Color.green : Color.red)
                            .frame(width: 10, height: 10)
                            .overlay(
                                Circle()
                                    .stroke(Color.white.opacity(0.3), lineWidth: 0.5)
                            )
                        
                        Text(locationService.isTracking ? "location_active".localized : "location_inactive".localized)
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundColor(locationService.isTracking ? .green : .red)
                    }
                    
                    Spacer()
                    
                    if !directionService.nearbyObjects.isEmpty {
                        HStack(spacing: 8) {
                            Circle()
                                .fill(Color.blue)
                                .frame(width: 10, height: 10)
                                .overlay(
                                    Circle()
                                        .stroke(Color.white.opacity(0.3), lineWidth: 0.5)
                                )
                            
                            Text("precision_mode".localized)
                                .font(.caption)
                                .fontWeight(.medium)
                                .foregroundColor(.blue)
                        }
                    }
                }
                
                if let errorMessage = directionService.errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(.red)
                        .multilineTextAlignment(.leading)
                }
            }
            .padding(16)
            .darkBlueCard(cornerRadius: 16)
            .padding(.horizontal, 16)
        }
    }
    
    @ViewBuilder
    private func leaderDirectionView(group: HitherGroup) -> some View {
        VStack(spacing: 24) {
            // Header without card background
            VStack(spacing: 12) {
                Text("team_overview".localized)
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                
                Text("leader_monitor_message".localized)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 16)
            
            LazyVStack(spacing: 16) {
                ForEach(group.followers) { follower in
                    FollowerStatusCard(
                        follower: follower,
                        locationService: locationService,
                        directionService: directionService
                    )
                    .darkBlueCard(cornerRadius: 16)
                }
            }
            
            if group.followers.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "person.badge.plus")
                        .font(.system(size: 60))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.blue.opacity(0.6), .purple.opacity(0.6)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    
                    Text("no_followers_yet".localized)
                        .font(.headline)
                        .fontWeight(.semibold)
                        .foregroundColor(.primary)
                    
                    Text("share_invite_code_message".localized)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)
                }
                .padding(24)
                .darkBlueCard(cornerRadius: 20)
                .padding(.horizontal, 16)
            }
        }
    }
    
    private func setupLocationTracking() {
        guard let group = groupService.currentGroup,
              let user = authService.currentUser else { return }
        
        locationService.requestLocationPermission()
        locationService.startTracking(groupId: group.id, userId: user.id)
    }
    
    private func updateLeaderLocation() {
        guard let group = groupService.currentGroup,
              let leader = group.leader,
              let leaderLocation = leader.location else { return }
        
        directionService.setTargetLeader(location: leaderLocation.coordinate)
    }
    
    private func togglePrecisionFinding() {
        if isPrecisionFindingActive {
            directionService.stopNearbyInteraction()
            isPrecisionFindingActive = false
        } else {
            // In a real implementation, you'd exchange discovery tokens between devices
            // For now, we'll just simulate starting precision finding
            isPrecisionFindingActive = true
            
            // Request discovery token from leader (this would be done via Firestore)
            // directionService.startNearbyInteraction(with: leaderDiscoveryToken)
        }
    }
}

struct FollowerStatusCard: View {
    let follower: GroupMember
    let locationService: LocationService
    let directionService: DirectionService
    
    var body: some View {
        HStack(spacing: 16) {
            // Enhanced member icon with glass treatment
            ZStack {
                Circle()
                    .fill(.ultraThinMaterial)
                    .frame(width: 50, height: 50)
                    .overlay(
                        Circle()
                            .stroke(
                                LinearGradient(
                                    colors: [Color.blue.opacity(0.4), Color.purple.opacity(0.2)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 1.5
                            )
                    )
                    .shadow(color: Color.blue.opacity(0.2), radius: 8, y: 4)
                
                Image(systemName: "person.fill")
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .font(.system(size: 18, weight: .bold))
            }
            
            // Enhanced member info
            VStack(alignment: .leading, spacing: 6) {
                Text(follower.displayName)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)
                
                if let location = follower.location,
                   let distance = locationService.calculateDistance(to: location.coordinate) {
                    Text(String(format: "meters_away".localized, Int(distance)))
                        .font(.caption)
                        .foregroundColor(.secondary)
                } else {
                    Text("location_unknown".localized)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }
            
            Spacer()
            
            // Enhanced status indicator with glass treatment
            VStack(spacing: 6) {
                Circle()
                    .fill(getStatusColor())
                    .frame(width: 14, height: 14)
                    .overlay(
                        Circle()
                            .stroke(Color.white.opacity(0.4), lineWidth: 0.5)
                    )
                    .shadow(color: getStatusColor().opacity(0.3), radius: 4, y: 2)
                
                Text(getStatusText())
                    .font(.caption2)
                    .fontWeight(.medium)
                    .foregroundColor(getStatusColor())
            }
        }
        .padding(16)
    }
    
    private func getStatusColor() -> Color {
        guard let lastUpdate = follower.lastLocationUpdate else { return .red }
        let timeSinceUpdate = Date().timeIntervalSince(lastUpdate)
        
        if timeSinceUpdate < 60 { // Less than 1 minute
            return .green
        } else if timeSinceUpdate < 300 { // Less than 5 minutes
            return .yellow
        } else {
            return .red
        }
    }
    
    private func getStatusText() -> String {
        guard let lastUpdate = follower.lastLocationUpdate else { return "no_data".localized }
        let timeSinceUpdate = Date().timeIntervalSince(lastUpdate)
        
        if timeSinceUpdate < 60 {
            return "live_status".localized
        } else if timeSinceUpdate < 300 {
            return String(format: "minutes_ago".localized, Int(timeSinceUpdate / 60))
        } else {
            return "stale_status".localized
        }
    }
}

// MARK: - Preview Provider

struct DirectionView_Previews: PreviewProvider {
    static var previews: some View {
        DirectionView()
            .environmentObject(GroupService())
            .environmentObject(AuthenticationService())
    }
}