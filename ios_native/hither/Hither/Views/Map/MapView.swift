//
//  MapView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI
import CoreLocation
import Combine

struct MapView: View {
    // MARK: - Dependencies & Services
    @EnvironmentObject private var groupService: GroupService
    @EnvironmentObject private var authService: AuthenticationService
    @EnvironmentObject private var languageService: LanguageService
    @StateObject private var locationService = LocationService()
    @StateObject private var itineraryService = ItineraryService()
    @StateObject private var findRequestService = FindRequestService()
    
    // MARK: - Distance Calculation State
    @StateObject private var distanceManager = DistanceCalculationManager.shared
    @State private var selectedIndex: Int = 0
    @State private var cachedDistance: Double?
    @State private var isExpanded = false
    
    // MARK: - Map State Properties
    @State private var region = CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194)
    @State private var span: Double = 0.01
    @State private var mapType: GoogleMapType = .roadmap
    @State private var searchText = ""
    @State private var isFollowingUser = false
    @State private var hasInitializedLocation = false
    
    // MARK: - Route & Navigation State
    @State private var currentRoute: GoogleRoute?
    @State private var previewWaypointIndex = 0
    @State private var routeCache: [String: GoogleRoute] = [:]
    @State private var routeDebounceTimer: Timer?
    @State private var currentRouteTask: Task<Void, Never>?
    private let cardSwipePublisher = PassthroughSubject<Int, Never>()
    
    // MARK: - UI Interaction States
    @State private var isCardExpanded = false
    @State private var cardHeight: CGFloat = 80
    @State private var isBottomSheetExpanded = false
    
    // MARK: - Camera & User Interaction States
    @State private var shouldFitBounds = false
    @State private var boundingCoordinates: [CLLocationCoordinate2D] = []
    @State private var userIsInteracting = false
    @State private var lastUserInteraction = Date()
    @State private var interactionCooldownTimer: Timer?
    
    // MARK: - Member Interaction States
    @State private var selectedMember: GroupMember?
    @State private var showMemberInteraction = false
    
    // MARK: - Find Request States
    @State private var pendingFindRequest: FindRequest?
    @State private var showFindRequestNotification = false
    @State private var showRequestAuthorizationDialog = false
    @State private var selectedFindRequest: FindRequest?
    @State private var requestingMember: GroupMember?
    @State private var targetMember: GroupMember?
    @State private var showFindMemberView = false
    @State private var findTargetMember: GroupMember?
    @State private var activeFindRequest: FindRequest?
    
    // MARK: - Computed Properties
    private var previewableWaypoints: [Waypoint] {
        guard let itinerary = itineraryService.currentItinerary else { return [] }
        // FIXED: Use upcomingWaypoints directly since it now includes current destination
        // This prevents duplicates and maintains consistency with ItineraryView
        return itinerary.upcomingWaypoints
    }
    
    private var displayedWaypoint: Waypoint? {
        guard !previewableWaypoints.isEmpty, previewWaypointIndex < previewableWaypoints.count else { return nil }
        return previewableWaypoints[previewWaypointIndex]
    }
    
    // MARK: - Main Body View
    var body: some View {
        NavigationStack {
            ZStack {
                // Layer 1: Full-screen map
                mapContentView
                
                // Layer 2: Search bar overlay only
                VStack {
                    // Search bar at top
                    MapSearchBar(
                        searchText: $searchText,
                        onLocationSelected: { coordinate, locationName in
                            region = coordinate
                            isFollowingUser = false
                        }
                    )
                    .padding(.horizontal, 16)
                    .padding(.top, 8) // Small padding from Dynamic Island
                    
                    Spacer()
                }
                
                // Layer 3: Map controls (right side)
                mapControls
                
                // Layer 4: Bottom sheet with itinerary content
                bottomSheetContent
                
                // Layer 5: Modal overlays (highest z-index)
                modalOverlays
            }
            .onAppear {
                setupMapView()
                setupLocationTracking()
                setupItineraryTracking()
                setupDevelopmentModeListener()
                setupNavigationListener()
                setupFindRequestService()
                setupFindRequestListeners()
            }
            .onChange(of: itineraryService.currentItinerary?.updatedAt) { _, newUpdatedAt in
                LocalizedLogger.debug("🔄 MapView: Itinerary updated at \(newUpdatedAt?.description ?? "nil")")
            }
            .onChange(of: itineraryService.currentItinerary?.currentWaypoint?.id) { _, newWaypointId in
                syncPreviewIndexWithCurrentDestination()
            }
        }
    }
    
    // MARK: - View Builders
    
    @ViewBuilder
    private var mapContentView: some View {
        // Full-screen Google Maps extending to status bar area
        GoogleMapsNativeView(
            region: $region,
            span: $span,
            mapType: mapType,
            annotations: buildAnnotations(),
            currentRoute: currentRoute,
            userLocation: locationService.currentLocation,
            onRegionChange: { newRegion in
                region = newRegion
                isFollowingUser = false
                markUserInteraction()
            },
            shouldUseTiltedCamera: false,
            onMemberTap: { member in
                // Only show interaction menu for non-self members
                if member.userId != authService.currentUser?.id {
                    selectedMember = member
                    showMemberInteraction = true
                }
            }
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea(.container, edges: .top) // Extend map to status bar area
        .onTapGesture {
            isFollowingUser = false
        }
    }
    
    @ViewBuilder
    private var mapControls: some View {
        GeometryReader { geometry in
            // Map controls on the right side and destination card
            VStack {
                HStack {
                    Spacer()
                    VStack(spacing: 8) {
                        // Satellite/Map Type Button
                        Button(action: {
                            cycleMapType()
                        }) {
                            Image(systemName: mapTypeIcon)
                                .foregroundColor(mapTypeColor)
                                .padding(12)
                                .background(Color.white)
                                .clipShape(Circle())
                                .shadow(radius: 4)
                        }
                        
                        // Center on User Button - Reusing LocationSelectionSheet pattern
                        Button(action: {
                            centerOnUser()
                        }) {
                            Image(systemName: isFollowingUser ? "location.fill" : "location")
                                .foregroundColor(isFollowingUser ? .blue : .gray)
                                .padding(12)
                                .background(Color.white)
                                .clipShape(Circle())
                                .shadow(radius: 4)
                        }
                        
                        // Navigate to Destination Button - Reusing LocationSelectionSheet pattern
                        if displayedWaypoint != nil {
                            Button(action: {
                                navigateToDestination()
                            }) {
                                Image(systemName: "location.north.circle")
                                    .foregroundColor(.green)
                                    .padding(12)
                                    .background(Color.white)
                                    .clipShape(Circle())
                                    .shadow(radius: 4)
                            }
                        }
                    }
                }
                .padding(.top, 48) // Adjusted from 64 to 48 to move buttons up
                .padding(.horizontal, 16)
                Spacer()
            }
        }
    }
    
    @ViewBuilder
    private var bottomSheetContent: some View {
        BottomSheetView(onStateChange: { expanded in
            isBottomSheetExpanded = expanded
            isExpanded = expanded
        }) {
            VStack(spacing: 0) {
                if !previewableWaypoints.isEmpty && previewWaypointIndex < previewableWaypoints.count {
                    
                    // MARK: - Collapsed Header Layout (Always Visible)
                    collapsedHeader
                    
                    // MARK: - Expanded Content (Only When Expanded)
                    if isExpanded {
                        expandedContent
                            .frame(height: 110) // 160 - 50 = 110px for expanded content
                    }
                } else {
                    // Placeholder when no waypoints
                    placeholderContent
                    }
                }
            }
            .onAppear {
                startDistanceMonitoring()
                selectedIndex = previewWaypointIndex
            }
            .onDisappear {
                stopDistanceMonitoring()
            }
            .onChange(of: previewWaypointIndex) { _, newIndex in
                selectedIndex = newIndex
                requestDistanceUpdate()
            }
            .onChange(of: locationService.currentLocation) { _, newLocation in
                if newLocation != nil {
                    requestDistanceUpdate()
                }
            }
            .onChange(of: previewableWaypoints) { _, newWaypoints in
                selectedIndex = 0
                previewWaypointIndex = 0
                requestDistanceUpdate()
            }
        }
    
    @ViewBuilder
    private var modalOverlays: some View {
        // Member interaction overlay
        if showMemberInteraction, let selectedMember = selectedMember {
            MemberInteractionOverlay(
                member: selectedMember,
                currentUser: authService.currentUser ?? HitherUser(id: "", email: "", displayName: "Unknown"),
                isLeader: groupService.currentGroup?.leaderId == authService.currentUser?.id,
                freeRoamMode: false, // Free roam functionality removed
                hasActiveRequest: findRequestService.getActiveRequestForTarget(targetId: selectedMember.userId) != nil,
                onRequestFind: {
                    handleRequestFind(for: selectedMember)
                },
                onStartFinding: {
                    handleStartFinding(for: selectedMember)
                },
                isPresented: $showMemberInteraction
            )
            .zIndex(1000)
        }
        
        // Find request notification overlay
        if showFindRequestNotification, 
           let request = pendingFindRequest,
           let requesterName = requestingMember?.displayName,
           let targetName = targetMember?.displayName {
            FindRequestNotificationOverlay(
                request: request,
                requesterName: requesterName,
                targetName: targetName,
                onApprove: {
                    handleApproveFindRequest(request: request)
                },
                onDeny: {
                    handleDenyFindRequest(request: request)
                },
                isPresented: $showFindRequestNotification
            )
            .zIndex(1001)
        }
        
        // Request authorization dialog overlay (for leaders)
        if showRequestAuthorizationDialog,
           let request = selectedFindRequest,
           let requesterMember = requestingMember,
           let targetMember = targetMember {
            RequestAuthorizationOverlay(
                request: request,
                requesterMember: requesterMember,
                targetMember: targetMember,
                onApprove: {
                    handleApproveFindRequest(request: request)
                },
                onDeny: {
                    handleDenyFindRequest(request: request)
                },
                isPresented: $showRequestAuthorizationDialog
            )
            .zIndex(1002)
        }
    }
    
    // MARK: - Bottom Sheet Helper Properties
    
    // Computed property for sorted waypoints by order
    private var sortedWaypoints: [Waypoint] {
        previewableWaypoints.sorted { $0.order < $1.order }
    }
    
    // Get currently selected waypoint by array index
    private var currentWaypoint: Waypoint? {
        guard selectedIndex < sortedWaypoints.count else { return nil }
        return sortedWaypoints[selectedIndex]
    }
    
    private var collapsedTitle: String {
        guard let waypoint = currentWaypoint else { return "no_destination".localized }
        
        // Show current destination (index 0) with arrow
        if selectedIndex == 0 {
            return "→ \(waypoint.name)"
        } else if selectedIndex > 0 {
            // Find previous waypoint in array sequence
            let previousWaypoint = sortedWaypoints[selectedIndex - 1]
            return "\(previousWaypoint.name) → \(waypoint.name)"
        } else {
            return waypoint.name
        }
    }
    
    // MARK: - Bottom Sheet ViewBuilder Methods
    
    @ViewBuilder
    private var collapsedHeader: some View {
        VStack(spacing: 0) {
            // Only show single-line content when not expanded
            if !isExpanded {
                HStack(spacing: 8) {
                    if !sortedWaypoints.isEmpty {
                        // Icon
                        Image(systemName: currentWaypoint?.type.icon ?? "location.circle")
                            .foregroundColor(.blue)
                            .font(.caption)
                            .frame(width: 14, height: 14)
                        
                        // Title
                        Text(collapsedTitle)
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundColor(.primary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        
                        Spacer(minLength: 4)
                        
                        // Distance
                        if let distance = cachedDistance {
                            Text("\(Int(distance))m")
                                .font(.caption2)
                                .fontWeight(.semibold)
                                .foregroundColor(.blue)
                        }
                    } else {
                        Text("no_destination".localized)
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        Spacer()
                    }
                }
                .padding(.init(top: 6, leading: 16, bottom: 6, trailing: 16))
            }
        }
    }
    
    @ViewBuilder
    private var expandedContent: some View {
        VStack(spacing: 0) {
            if !sortedWaypoints.isEmpty {
                // Card carousel using array indices as tags for proper ordering
                TabView(selection: $selectedIndex) {
                    ForEach(Array(sortedWaypoints.enumerated()), id: \.element.id) { index, waypoint in
                        CompactDestinationCard(
                            waypoint: waypoint,
                            locationService: locationService,
                            isCurrentDestination: waypoint.order == 1,
                            totalCount: sortedWaypoints.count,
                            currentIndex: selectedIndex,
                            onCenterMap: { waypoint in
                                // Center map on the selected waypoint
                                region = waypoint.location.coordinate
                                isFollowingUser = false
                            }
                        )
                        .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .onChange(of: selectedIndex) { _, newIndex in
                    previewWaypointIndex = newIndex
                    handleCardSwipeRouteUpdate()
                }
                
                // Centered page indicators without navigation arrows
                if sortedWaypoints.count > 1 {
                    HStack(spacing: 6) {
                        ForEach(0..<sortedWaypoints.count, id: \.self) { index in
                            Circle()
                                .fill(index == selectedIndex ? Color.blue : Color.gray.opacity(0.3))
                                .frame(width: 8, height: 8)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                }
            } else {
                // Placeholder content
                VStack(spacing: 4) {
                    Image(systemName: "location.circle")
                        .font(.title3)
                        .foregroundColor(.blue)
                    
                    Text("no_destination_set".localized)
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)
                    
                    Text("add_waypoint_to_see_navigation".localized)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
    
    @ViewBuilder
    private var placeholderContent: some View {
        VStack(spacing: isExpanded ? 12 : 6) {
            Image(systemName: "location.circle")
                .font(isExpanded ? .title2 : .title3)
                .foregroundColor(.secondary)
            
            Text("No destinations set")
                .font(isExpanded ? .headline : .subheadline)
                .foregroundColor(.primary)
            
            if isExpanded {
                Text("Add waypoints to your itinerary to see navigation options")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)
            }
        }
        .padding(.vertical, isExpanded ? 20 : 12)
        .transition(.opacity.combined(with: .scale(scale: 0.95)))
    }
    
    @ViewBuilder
    private var alertButtons: some View {
        Button("settings".localized) {
            if let settingsUrl = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(settingsUrl)
            }
        }
        Button("cancel".localized, role: .cancel) {
            locationService.errorMessage = nil
        }
    }
    
    // MARK: - Distance Management (MapView Level)
    
    private func startDistanceMonitoring() {
        guard let waypoint = currentWaypoint else { return }
        
        let targetId = "mapview-\(waypoint.id)"
        distanceManager.startMonitoring(
            targetId: targetId,
            coordinate: waypoint.location.coordinate,
            onDistanceUpdate: { distance in
                Task { @MainActor in
                    self.cachedDistance = distance
                }
            }
        )
        
        requestDistanceUpdate()
    }
    
    private func stopDistanceMonitoring() {
        guard let waypoint = currentWaypoint else { return }
        let targetId = "mapview-\(waypoint.id)"
        distanceManager.stopMonitoring(targetId: targetId)
    }
    
    private func requestDistanceUpdate() {
        guard let waypoint = currentWaypoint,
              let userLocation = locationService.currentLocation else {
            cachedDistance = nil
            return
        }
        
        let targetId = "mapview-\(waypoint.id)"
        distanceManager.requestDistanceCalculation(
            targetId: targetId,
            userLocation: userLocation.coordinate,
            targetLocation: waypoint.location.coordinate
        ) { distance in
            Task { @MainActor in
                self.cachedDistance = distance
            }
        }
    }
    
    // MARK: - Location & Navigation Event Handlers
    
    private func handleLocationChange(oldValue: CLLocation?, newValue: CLLocation?) {
        Task { @MainActor in
            if let location = newValue {
                // Auto-center on first location update
                if !hasInitializedLocation {
                    updateRegionToCurrentLocation(location)
                    hasInitializedLocation = true
                    isFollowingUser = true
                } else if isFollowingUser {
                    updateRegionToCurrentLocation(location)
                }
            }
            updateRouteIfNeeded()
        }
    }
    
    private func handleWaypointChange() {
        updateRouteIfNeeded()
        // Reset preview index when waypoint changes
        previewWaypointIndex = 0
    }
    
    private func handlePreviewIndexChange() {
        updateRouteIfNeeded()
        // Removed: fitRouteToScreen() - preserve user's zoom level
    }
    
    private func handleCardSwipeRouteUpdate() {
        // Send new index to Combine publisher for debounced processing
        cardSwipePublisher.send(previewWaypointIndex)
    }
    
    // MARK: - Map Controls & Actions
    
    private func centerOnUser() {
        guard let location = locationService.currentLocation else { return }
        
        isFollowingUser = true
        region = location.coordinate
    }
    
    private func navigateToDestination() {
        guard let waypoint = displayedWaypoint else { return }
        
        isFollowingUser = false
        region = waypoint.location.coordinate
    }
    
    // Overloaded version for dashboard navigation
    private func navigateToDestination(coordinate: CLLocationCoordinate2D) {
        isFollowingUser = false
        
        // Only update region center, preserve user's zoom level
        region = coordinate
    }
    
    private func fitMapToContent() {
        isFollowingUser = false
        
        var coordinates: [CLLocationCoordinate2D] = []
        
        // Add user location if available
        if let userLocation = locationService.currentLocation {
            coordinates.append(userLocation.coordinate)
        }
        
        // Add current waypoint if available
        if let currentWaypoint = itineraryService.currentItinerary?.currentWaypoint {
            coordinates.append(currentWaypoint.location.coordinate)
        }
        
        // Add group member locations
        if let group = groupService.currentGroup {
            for member in group.members {
                if let location = member.location {
                    coordinates.append(location.coordinate)
                }
            }
        }
        
        // If we have coordinates, center on them (no zoom change)
        if !coordinates.isEmpty {
            let minLat = coordinates.map(\.latitude).min() ?? 0
            let maxLat = coordinates.map(\.latitude).max() ?? 0
            let minLon = coordinates.map(\.longitude).min() ?? 0
            let maxLon = coordinates.map(\.longitude).max() ?? 0
            
            let center = CLLocationCoordinate2D(
                latitude: (minLat + maxLat) / 2,
                longitude: (minLon + maxLon) / 2
            )
            
            // Validate coordinates are within valid ranges
            guard isValidCoordinate(center.latitude, center.longitude) else {
                centerOnUser()
                return
            }
            
            region = center
            // Removed: span calculation and setting - preserve user's zoom level
        } else {
            // Fallback to user location if no other coordinates
            centerOnUser()
        }
    }
    
    private func cycleMapType() {
        switch mapType {
        case .roadmap:
            mapType = .satellite
        case .satellite:
            mapType = .hybrid
        case .hybrid:
            mapType = .terrain
        case .terrain:
            mapType = .roadmap
        }
    }
    
    private func updateRegionToCurrentLocation(_ location: CLLocation) {
        withAnimation(.easeInOut(duration: 1.0)) {
            region = location.coordinate
            // Removed: span = 0.01 - preserve user's zoom level
        }
    }
    
    // MARK: - Member Interaction Handlers
    
    private func handleMemberTap(_ member: GroupMember) {
        selectedMember = member
        withAnimation(.easeIn(duration: 0.2)) {
            showMemberInteraction = true
        }
    }
    
    private func handleRequestFind(for member: GroupMember) {
        guard let currentUser = authService.currentUser,
              let group = groupService.currentGroup else { return }
        
        Task {
            await findRequestService.createFindRequest(
                groupId: group.id,
                requesterId: currentUser.id,
                targetId: member.userId,
                requesterName: currentUser.displayName,
                targetName: member.displayName
            )
        }
    }
    
    private func handleStartFinding(for member: GroupMember) {
        guard let currentUser = authService.currentUser,
              let activeRequest = findRequestService.getActiveRequestForTarget(targetId: member.userId),
              activeRequest.status == .approved else {
            return
        }
        
        // Set up the find member view navigation
        findTargetMember = member
        activeFindRequest = activeRequest
        showFindMemberView = true
    }
    
    // MARK: - Find Request Handlers
    
    private func handleIncomingFindRequest(_ request: FindRequest) {
        guard let group = groupService.currentGroup else { return }
        
        // Find the requesting and target members
        let requesterMember = group.members.first { $0.userId == request.requesterId }
        let targetMember = group.members.first { $0.userId == request.targetId }
        
        // Update state
        pendingFindRequest = request
        requestingMember = requesterMember
        self.targetMember = targetMember
        
        // Show appropriate UI based on user role
        if groupService.currentGroup?.leaderId == authService.currentUser?.id {
            // Leader sees authorization dialog
            selectedFindRequest = request
            withAnimation(.easeIn(duration: 0.3)) {
                showRequestAuthorizationDialog = true
            }
        } else if request.targetId == authService.currentUser?.id {
            // Target user sees notification
            withAnimation(.easeIn(duration: 0.3)) {
                showFindRequestNotification = true
            }
        }
    }
    
    private func handleFindRequestUpdate(_ request: FindRequest) {
        // Update pending request state
        if pendingFindRequest?.id == request.id {
            pendingFindRequest = request
            selectedFindRequest = request
            
            // Dismiss UI if request is no longer pending
            if request.status != .pending {
                withAnimation(.easeOut(duration: 0.2)) {
                    showFindRequestNotification = false
                    showRequestAuthorizationDialog = false
                }
            }
        }
    }
    
    private func handleApproveFindRequest(request: FindRequest) {
        guard let group = groupService.currentGroup else { return }
        
        Task {
            do {
                try await findRequestService.approveRequest(
                    groupId: group.id,
                    requestId: request.id,
                    targetId: request.targetId
                )
            } catch {
                // Handle error silently or show user-friendly message
            }
        }
    }
    
    private func handleDenyFindRequest(request: FindRequest) {
        guard let group = groupService.currentGroup else { return }
        
        Task {
            do {
                try await findRequestService.denyRequest(
                    groupId: group.id,
                    requestId: request.id
                )
            } catch {
                // Handle error silently or show user-friendly message
            }
        }
    }
    
    private func handleStartFindingFromNotification(requestId: String) {
        // Navigate to finding mode with the approved request
        // TODO: Navigate to DirectionView with approved find request
    }
    
    // MARK: - Route Calculation & Management
    
    private func updateRouteIfNeeded() {
        guard let userLocation = locationService.currentLocation else {
            currentRoute = nil
            return
        }
        
        // Cancel previous timer and task
        routeDebounceTimer?.invalidate()
        currentRouteTask?.cancel()
        
        // Debounce route calculation
        routeDebounceTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: false) { _ in
            self.currentRouteTask = Task {
                await self.calculateProgressiveRoute(from: userLocation.coordinate)
            }
        }
    }
    
    private func calculateProgressiveRoute(from userLocation: CLLocationCoordinate2D) async {
        guard let itinerary = itineraryService.currentItinerary else {
            await MainActor.run {
                self.currentRoute = nil
            }
            return
        }
        
        // Check if we have waypoints to preview
        guard !previewableWaypoints.isEmpty, previewWaypointIndex < previewableWaypoints.count else {
            await MainActor.run {
                self.currentRoute = nil
            }
            return
        }
        
        let currentPreviewWaypoint = previewableWaypoints[previewWaypointIndex]
        
        if previewWaypointIndex == 0 {
            // Viewing current destination: show route from user to current waypoint
            await calculateSingleRoute(from: userLocation, to: currentPreviewWaypoint.location.coordinate)
        } else {
            // Viewing upcoming destination: show route from previous waypoint to current preview
            let previousWaypoint = previewableWaypoints[previewWaypointIndex - 1]
            await calculateSingleRoute(from: previousWaypoint.location.coordinate, to: currentPreviewWaypoint.location.coordinate)
        }
    }
    
    private func calculateSingleRoute(from startCoordinate: CLLocationCoordinate2D, to endCoordinate: CLLocationCoordinate2D) async {
        let cacheKey = routeCacheKey(from: startCoordinate, to: endCoordinate)
        
        // Check cache first
        if let cachedRoute = routeCache[cacheKey] {
            await MainActor.run {
                self.currentRoute = cachedRoute
            }
            return
        }
        
        do {
            let response = try await GoogleMapsService.shared.getDirections(from: startCoordinate, to: endCoordinate)
            if let route = response.routes.first {
                await MainActor.run {
                    // Cache the route
                    self.routeCache[cacheKey] = route
                    
                    // Limit cache size to prevent memory issues
                    if self.routeCache.count > 20 {
                        // Remove oldest entries (simple approach)
                        let keysToRemove = Array(self.routeCache.keys.prefix(5))
                        for key in keysToRemove {
                            self.routeCache.removeValue(forKey: key)
                        }
                    }
                    
                    self.currentRoute = route
                }
            } else {
                await MainActor.run {
                    self.currentRoute = nil
                }
            }
        } catch {
            LocalizedLogger.debug("Error calculating route: \(error)")
        }
    }
    
    private func updateRouteForItinerary(_ itinerary: GroupItinerary?) async {
        guard let itinerary = itinerary,
              let userLocation = locationService.currentLocation else {
            currentRoute = nil
            return
        }
        
        // Calculate route through all waypoints
        var waypoints: [CLLocationCoordinate2D] = []
        
        // Start from user location
        waypoints.append(userLocation.coordinate)
        
        // Add current waypoint if exists
        if let currentWaypoint = itinerary.currentWaypoint {
            waypoints.append(currentWaypoint.location.coordinate)
        }
        
        // Add upcoming waypoints
        for waypoint in itinerary.upcomingWaypoints {
            waypoints.append(waypoint.location.coordinate)
        }
        
        // Calculate route if we have at least 2 points
        if waypoints.count >= 2 {
            do {
                let googleMapsService = GoogleMapsService.shared
                let routeResponse = try await googleMapsService.getDirections(
                    from: waypoints[0],
                    to: waypoints.last!
                )
                
                await MainActor.run {
                    if let firstRoute = routeResponse.routes.first {
                        currentRoute = firstRoute
                    }
                }
            } catch {
                await MainActor.run {
                    currentRoute = nil
                }
            }
        }
    }
    
    private func fitRouteToScreen(forceUpdate: Bool = false) {
        guard !previewableWaypoints.isEmpty,
              previewWaypointIndex < previewableWaypoints.count else { return }
        
        // Skip automatic camera adjustments if user is actively interacting (unless forced)
        if !forceUpdate && isUserRecentlyInteracting() {
            return
        }
        
        let currentWaypoint = previewableWaypoints[previewWaypointIndex]
        var coordinates: [CLLocationCoordinate2D] = []
        
        // Add start coordinate based on preview index
        if previewWaypointIndex == 0 {
            // Current destination - start from user location
            guard let userLocation = locationService.currentLocation else { return }
            coordinates.append(userLocation.coordinate)
        } else if previewWaypointIndex > 0 {
            // Future destination - start from previous waypoint
            let previousWaypoint = previewableWaypoints[previewWaypointIndex - 1]
            coordinates.append(previousWaypoint.location.coordinate)
        } else {
            return
        }
        
        // Add destination coordinate
        coordinates.append(currentWaypoint.location.coordinate)
        
        // Only adjust if we have both start and end points
        guard coordinates.count >= 2 else { return }
        
        isFollowingUser = false
        
        // Direct single-step camera animation - no delays or clearing
        boundingCoordinates = coordinates
        shouldFitBounds = true
    }
    
    private func updateCameraForCardSwipe(_ newIndex: Int) {
        guard !previewableWaypoints.isEmpty, newIndex < previewableWaypoints.count else { return }
        
        // Update route for new waypoint
        updateRouteIfNeeded()
        
        // Removed: Camera adjustment - preserve user's zoom level
        // The route will still be updated and displayed, but camera position remains unchanged
    }
    
    // MARK: - User Interaction Management
    
    private func markUserInteraction() {
        userIsInteracting = true
        lastUserInteraction = Date()
        
        // Cancel previous timer
        interactionCooldownTimer?.invalidate()
        
        // Set cooldown period - map adjustments are blocked for 3 seconds after user interaction
        interactionCooldownTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: false) { _ in
            self.userIsInteracting = false
        }
    }
    
    private func isUserRecentlyInteracting() -> Bool {
        return userIsInteracting || Date().timeIntervalSince(lastUserInteraction) < 3.0
    }
    
    // MARK: - Annotations & Map Data
    
    private var memberAnnotations: [MemberAnnotation] {
        guard let group = groupService.currentGroup else { return [] }
        
        return group.members.compactMap { member in
            guard let location = member.location else { return nil }
            return MemberAnnotation(member: member, coordinate: location.coordinate)
        }
    }
    
    private var allAnnotations: [MapViewAnnotationItem] {
        var annotations: [MapViewAnnotationItem] = []
        var usedCoordinates: Set<String> = []
        
        // Helper function to create coordinate key
        func coordinateKey(_ coord: CLLocationCoordinate2D) -> String {
            return "\(String(format: "%.6f", coord.latitude)),\(String(format: "%.6f", coord.longitude))"
        }
        
        // Add member annotations (highest priority)
        for memberAnnotation in memberAnnotations {
            let key = coordinateKey(memberAnnotation.coordinate)
            if !usedCoordinates.contains(key) {
                annotations.append(MapViewAnnotationItem(
                    coordinate: memberAnnotation.coordinate,
                    member: memberAnnotation.member,
                    waypoint: nil,
                    isMember: true,
                    isRouteEndpoint: false
                ))
                usedCoordinates.insert(key)
            }
        }
        
        // Add current waypoint annotation (medium priority, but skip if overlaps with member)
        if let currentWaypoint = itineraryService.currentItinerary?.currentWaypoint {
            let key = coordinateKey(currentWaypoint.location.coordinate)
            if !usedCoordinates.contains(key) {
                annotations.append(MapViewAnnotationItem(
                    coordinate: currentWaypoint.location.coordinate,
                    member: nil,
                    waypoint: currentWaypoint,
                    isMember: false,
                    isRouteEndpoint: false
                ))
                usedCoordinates.insert(key)
            }
        }
        
        // Add route endpoint annotations (always show, even if overlapping)
        if let route = currentRoute {
            // Start point - always add
            if previewWaypointIndex == 0, let userLocation = locationService.currentLocation {
                annotations.append(MapViewAnnotationItem(
                    coordinate: userLocation.coordinate,
                    member: nil,
                    waypoint: nil,
                    isMember: false,
                    isRouteEndpoint: true,
                    routeEndpointType: .start
                ))
            } else if previewWaypointIndex > 0 {
                let previousWaypoint = previewableWaypoints[previewWaypointIndex - 1]
                annotations.append(MapViewAnnotationItem(
                    coordinate: previousWaypoint.location.coordinate,
                    member: nil,
                    waypoint: previousWaypoint,
                    isMember: false,
                    isRouteEndpoint: true,
                    routeEndpointType: .start
                ))
            }
            
            // End point - always add
            if !previewableWaypoints.isEmpty, previewWaypointIndex < previewableWaypoints.count {
                let endWaypoint = previewableWaypoints[previewWaypointIndex]
                annotations.append(MapViewAnnotationItem(
                    coordinate: endWaypoint.location.coordinate,
                    member: nil,
                    waypoint: endWaypoint,
                    isMember: false,
                    isRouteEndpoint: true,
                    routeEndpointType: .end
                ))
            }
        }
        
        return annotations
    }
    
    private func buildAnnotations() -> [MapViewAnnotationItem] {
        var annotations: [MapViewAnnotationItem] = []
        
        // Add group member annotations
        if let currentGroup = groupService.currentGroup {
            for member in currentGroup.members {
                if let location = member.location {
                    let coordinate = CLLocationCoordinate2D(latitude: location.latitude, longitude: location.longitude)
                    annotations.append(MapViewAnnotationItem(
                        coordinate: coordinate,
                        member: member,
                        waypoint: nil,
                        isMember: true
                    ))
                }
            }
        }
        
        // Add waypoint annotations
        if let currentItinerary = itineraryService.currentItinerary {
            // Add current waypoint
            if let currentWaypoint = currentItinerary.currentWaypoint {
                annotations.append(MapViewAnnotationItem(
                    coordinate: currentWaypoint.location.coordinate,
                    member: nil,
                    waypoint: currentWaypoint,
                    isMember: false
                ))
            }
            
            // Add upcoming waypoints
            for waypoint in currentItinerary.upcomingWaypoints {
                annotations.append(MapViewAnnotationItem(
                    coordinate: waypoint.location.coordinate,
                    member: nil,
                    waypoint: waypoint,
                    isMember: false
                ))
            }
        }
        
        return annotations
    }
    
    // MARK: - Map Type & Appearance
    
    private var mapTypeIcon: String {
        switch mapType {
        case .roadmap:
            return "map"
        case .satellite:
            return "globe.americas"
        case .hybrid:
            return "globe.americas.fill"
        case .terrain:
            return "mountain.2"
        }
    }
    
    private var mapTypeColor: Color {
        switch mapType {
        case .roadmap:
            return .blue
        case .satellite:
            return .green
        case .hybrid:
            return .purple
        case .terrain:
            return .orange
        }
    }
    
    // MARK: - Setup & Lifecycle Methods
    
    private func setupMapView() {
        locationService.requestLocationPermission()
        if let group = groupService.currentGroup, let user = authService.currentUser {
            locationService.startTracking(groupId: group.id, userId: user.id)
        }
        setupFindRequestService()
        
        // Initialize location if needed
        if !hasInitializedLocation, let currentLocation = locationService.currentLocation {
            region = currentLocation.coordinate
            hasInitializedLocation = true
        }
        
        // Calculate initial route if itinerary exists
        Task {
            await updateRouteForItinerary(itineraryService.currentItinerary)
        }
    }
    
    private func setupLocationTracking() {
        guard let group = groupService.currentGroup,
              let user = authService.currentUser else { return }
        
        locationService.requestLocationPermission()
        locationService.startTracking(groupId: group.id, userId: user.id)
    }
    
    private func setupItineraryTracking() {
        guard let group = groupService.currentGroup,
              let user = authService.currentUser else { return }
        
        // Connect location service to itinerary service for automatic Live Activity management
        itineraryService.setLocationService(locationService)
        
        let isLeader = group.leader?.userId == user.id
        itineraryService.startListeningToItinerary(
            groupId: group.id,
            userId: user.id,
            groupName: group.name,
            userRole: isLeader ? "leader" : "follower",
            leaderName: group.leader?.displayName ?? "",
            memberCount: group.members.count
        )
    }
    
    private func setupDevelopmentModeListener() {
        // Listen for development mode location changes
        NotificationCenter.default.addObserver(
            forName: NSNotification.Name("DevelopmentLocationChanged"),
            object: nil,
            queue: .main
        ) { _ in
            // Force immediate map region update when development location changes
            if let newLocation = locationService.currentLocation {
                // Update region to show the new location
                updateRegionToCurrentLocation(newLocation)
                
                // Force route recalculation
                updateRouteIfNeeded()
            }
        }
    }
    
    private func setupNavigationListener() {
        // Listen for navigation requests from dashboard
        NotificationCenter.default.addObserver(
            forName: NSNotification.Name("NavigateToDestination"),
            object: nil,
            queue: .main
        ) { notification in
            if let coordinate = notification.object as? CLLocationCoordinate2D {
                navigateToDestination(coordinate: coordinate)
            }
        }
    }
    
    private func setupFindRequestService() {
        guard let currentUser = authService.currentUser,
              let group = groupService.currentGroup else { return }
        
        findRequestService.startListening(groupId: group.id, userId: currentUser.id)
    }
    
    private func setupFindRequestListeners() {
        // TODO: Implement proper listener setup with ObservableObject pattern
        // Current struct-based approach doesn't support mutable closures properly
        // This functionality would be better implemented in the FindRequestService 
        // as published properties that the view can observe
    }
    
    // MARK: - Helper Functions
    
    private func syncPreviewIndexWithCurrentDestination() {
        guard let currentWaypoint = itineraryService.currentItinerary?.currentWaypoint else { return }
        
        // Find the index of the current waypoint in previewableWaypoints
        if let index = previewableWaypoints.firstIndex(where: { $0.id == currentWaypoint.id }) {
            previewWaypointIndex = index
        }
    }
    
    private func routeCacheKey(from start: CLLocationCoordinate2D, to end: CLLocationCoordinate2D) -> String {
        return "\(String(format: "%.4f", start.latitude)),\(String(format: "%.4f", start.longitude))-\(String(format: "%.4f", end.latitude)),\(String(format: "%.4f", end.longitude))"
    }
    
    private func isValidCoordinate(_ latitude: Double, _ longitude: Double) -> Bool {
        return latitude >= -90.0 && latitude <= 90.0 && longitude >= -180.0 && longitude <= 180.0
    }
}

// MARK: - Supporting Structures & Views


struct GroupStatusIndicator: View {
    let group: HitherGroup
    let locationService: LocationService
    @EnvironmentObject private var notificationService: NotificationService
    @State private var pulseAnimation = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Group name with gradient
            Text(group.name)
                .font(.caption)
                .fontWeight(.bold)
                .foregroundStyle(
                    LinearGradient(
                        colors: [.primary, .secondary],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
            
            // Glass status indicators with enhanced design
            HStack(spacing: 10) {
                // Location status with pulse
                HStack(spacing: 4) {
                    ZStack {
                        Circle()
                            .fill(locationService.isTracking ? Color.green : Color.red)
                            .frame(width: 8, height: 8)
                        
                        if locationService.isTracking {
                            Circle()
                                .stroke(Color.green.opacity(0.3), lineWidth: 2)
                                .frame(width: 12, height: 12)
                                .scaleEffect(pulseAnimation ? 1.2 : 1.0)
                                .opacity(pulseAnimation ? 0 : 1)
                        }
                    }
                    Text("LOC")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(locationService.isTracking ? .green : .red)
                }
                
                // Notification status with glass effect
                HStack(spacing: 4) {
                    Circle()
                        .fill(notificationService.isEnabled ? Color.blue : Color.orange)
                        .frame(width: 8, height: 8)
                        .overlay(
                            Circle()
                                .stroke(Color.white.opacity(0.3), lineWidth: 0.5)
                        )
                    Text("PUSH")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(notificationService.isEnabled ? .blue : .orange)
                }
                
                // Live Activity status (iOS 16.1+)
                if #available(iOS 16.1, *) {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [Color.purple, Color.pink], 
                                    startPoint: .topLeading, 
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 8, height: 8)
                            .overlay(
                                Circle()
                                    .stroke(Color.white.opacity(0.4), lineWidth: 0.5)
                            )
                        Text("LIVE")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [.purple, .pink],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            ZStack {
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .opacity(0.9)
                
                LinearGradient(
                    colors: [Color.white.opacity(0.2), Color.white.opacity(0.05)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }
        )
        .cornerRadius(18)
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(
                    LinearGradient(
                        colors: [Color.white.opacity(0.4), Color.white.opacity(0.1)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 0.5
                )
        )
        .shadow(color: Color.black.opacity(0.1), radius: 8, y: 4)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.5).repeatForever()) {
                pulseAnimation = true
            }
        }
    }
}

struct DestinationDistanceCard: View {
    let waypoint: Waypoint
    let locationService: LocationService
    let isCurrentDestination: Bool
    let currentIndex: Int
    let totalCount: Int
    let previewableWaypoints: [Waypoint]
    let isExpanded: Bool
    let onToggleExpansion: () -> Void
    @EnvironmentObject private var notificationService: NotificationService
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        VStack(alignment: .leading, spacing: isExpanded ? 8 : 4) {
            if isExpanded {
                // Expanded state - full content
                expandedContent()
            } else {
                // Collapsed state - compact content
                collapsedContent()
            }
        }
        .padding(isExpanded ? 16 : 12)
        .background(cardBackground())
        .cornerRadius(isExpanded ? 16 : 12)
        .overlay(
            RoundedRectangle(cornerRadius: isExpanded ? 16 : 12)
                .stroke(Color.gray.opacity(0.2), lineWidth: 1)
        )
        .shadow(
            color: Color.black.opacity(colorScheme == .dark ? 0.25 : 0.1),
            radius: 8,
            y: 4
        )
        .onTapGesture {
            if !isExpanded {
                onToggleExpansion()
            }
        }
    }
    
    @ViewBuilder
    private func collapsedContent() -> some View {
        HStack(spacing: 12) {
            // Waypoint icon
            Image(systemName: waypoint.type.icon)
                .foregroundColor(.blue)
                .font(.title3)
                .frame(width: 24)
            
            // Waypoint name
            VStack(alignment: .leading, spacing: 2) {
                Text(waypoint.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)
                    .lineLimit(1)
            }
            
            Spacer()
            
            // Distance display
            if let distance = calculateDistanceToWaypoint() {
                Text("\(Int(distance))m")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.blue)
            } else {
                Text("--")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.secondary)
            }
            
            // Upward chevron indicating expansion capability
            Image(systemName: "chevron.up")
                .foregroundColor(.secondary)
                .font(.caption)
                .frame(width: 20)
        }
    }
    
    @ViewBuilder
    private func expandedContent() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: waypoint.type.icon)
                    .foregroundColor(.blue)
                    .font(.title3)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(routeContextText)
                        .font(.caption)
                        .foregroundColor(isCurrentDestination ? Color.green : .blue)
                    
                    Text(waypoint.name)
                        .font(.headline)
                        .foregroundColor(.primary)
                }
                
                Spacer()
                
                if let distance = calculateDistanceToWaypoint() {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(Int(distance))m")
                            .font(.title2)
                            .fontWeight(.semibold)
                            .foregroundColor(.blue)
                        
                        Text("away".localized)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                } else {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("--")
                            .font(.title2)
                            .fontWeight(.semibold)
                            .foregroundColor(.secondary)
                        
                        Text("no_location".localized)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            
            // Navigation indicators and progress
            VStack(spacing: 8) {
                // Progress indicator if waypoint is in progress
                if waypoint.isInProgress {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(Color.green)
                            .frame(width: 6, height: 6)
                        
                        Text("in_progress".localized)
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                }
                
                // Navigation arrows and dots layout
                HStack {
                    // Left arrow
                    if totalCount > 1 {
                        Rectangle()
                            .fill(Color.clear)
                            .frame(width: 20)
                            .overlay(
                                Image(systemName: "chevron.left")
                                    .font(.title3)
                                    .foregroundColor(.secondary)
                            )
                    } else {
                        Spacer()
                            .frame(width: 20)
                    }
                    
                    Spacer()
                    
                    // Navigation dots
                    if totalCount > 1 {
                        HStack(spacing: 6) {
                            ForEach(0..<totalCount, id: \.self) { index in
                                Circle()
                                    .fill(index == currentIndex ? Color.blue : Color.gray.opacity(0.3))
                                    .frame(width: 6, height: 6)
                            }
                        }
                    }
                    
                    Spacer()
                    
                    // Right arrow
                    if totalCount > 1 {
                        Rectangle()
                            .fill(Color.clear)
                            .frame(width: 20)
                            .overlay(
                                Image(systemName: "chevron.right")
                                    .font(.title3)
                                    .foregroundColor(.secondary)
                            )
                    } else {
                        Spacer()
                            .frame(width: 20)
                    }
                }
                .frame(height: 24)
            }
        }
    }
    
    @ViewBuilder
    private func cardBackground() -> some View {
        ZStack {
            // Base card background
            Rectangle()
                .fill(colorScheme == .dark ? Color.black.opacity(0.8) : Color.white)
            
            // Enhanced gradient overlay
            LinearGradient(
                colors: [
                    Color.blue.opacity(colorScheme == .dark ? 0.2 : 0.1),
                    Color.clear
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }
    
    private var routeContextText: String {
        if currentIndex == 0 {
            return "from_current_location".localized
        } else if currentIndex > 0 && currentIndex - 1 < previewableWaypoints.count {
            let previousWaypoint = previewableWaypoints[currentIndex - 1]
            return String(format: "from_waypoint".localized, previousWaypoint.name)
        } else {
            return isCurrentDestination ? "current_destination".localized : "upcoming_destination".localized
        }
    }
    
    private func calculateDistanceToWaypoint() -> Double? {
        guard let userLocation = locationService.currentLocation else { return nil }
        let waypointLocation = CLLocation(latitude: waypoint.location.latitude, longitude: waypoint.location.longitude)
        return userLocation.distance(from: waypointLocation)
    }
}

// MARK: - Preview Provider

struct MapView_Previews: PreviewProvider {
    static var previews: some View {
        MapView()
            .environmentObject(GroupService())
            .environmentObject(AuthenticationService())
            .environmentObject(LanguageService())
            .environmentObject(ThemeManager.shared)
    }
}