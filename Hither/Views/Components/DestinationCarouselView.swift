//
//  DestinationCarouselView.swift
//  Hither
//
//  Collapsible card carousel for destination information
//

import SwiftUI
import CoreLocation

struct DestinationCarouselView: View {
    let waypoints: [Waypoint]
    let locationService: LocationService
    @Binding var currentIndex: Int
    let onCardChange: (Int) -> Void
    let onNavigateToDestination: (() -> Void)?
    let onCenterMapOnDestination: ((Waypoint) -> Void)?
    
    // Array index-based state management for TabView compatibility
    @State private var selectedIndex: Int = 0
    
    // Computed property for sorted waypoints by order
    private var sortedWaypoints: [Waypoint] {
        waypoints.sorted { $0.order < $1.order }
    }
    
    // Get currently selected waypoint by array index
    private var currentWaypoint: Waypoint? {
        guard selectedIndex < sortedWaypoints.count else { return nil }
        return sortedWaypoints[selectedIndex]
    }
    
    @State private var isExpanded = false
    @GestureState private var dragOffset: CGFloat = 0
    
    // PERFORMANCE: Cache distance calculations to avoid repeated computations
    @State private var cachedDistance: Double?
    @State private var lastLocationUpdate: Date?
    @State private var lastWaypointId: String?
    
    // PERFORMANCE: Centralized distance calculation manager (replaces individual timers)
    @StateObject private var distanceManager = DistanceCalculationManager.shared
    
    private let collapsedHeight: CGFloat = 50
    private let expandedHeight: CGFloat = 260  // Increased from 220 to 260 for better content visibility
    private let cornerRadius: CGFloat = 16
    
    private var panelOffset: CGFloat {
        // Match BottomSheetView's offset calculation for consistent positioning
        return dragOffset
    }
    
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottom) {
                // MARK: - Main Panel Container
                VStack(spacing: 0) {
                    // MARK: - Grabber Handle & Collapsed Content
                    collapsedHeader
                        .frame(height: collapsedHeight)
                    
                    // MARK: - Expanded Content
                    if isExpanded {
                        expandedContent
                            .frame(height: expandedHeight - collapsedHeight)
                    }
                }
                .frame(width: geometry.size.width)
                .frame(height: isExpanded ? expandedHeight : collapsedHeight)
                .background(Color(.systemBackground))
                .cornerRadius(cornerRadius, corners: [.topLeft, .topRight])
                .shadow(color: Color.black.opacity(0.15), radius: 12, x: 0, y: -4)
                .offset(y: geometry.size.height - (isExpanded ? expandedHeight : collapsedHeight) + panelOffset)
                .gesture(verticalDragGesture)
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isExpanded)
                .onAppear {
                    // PERFORMANCE: Use centralized distance manager instead of individual timers
                    startDistanceMonitoring()
                }
                .onDisappear {
                    stopDistanceMonitoring()
                }
                .onChange(of: currentIndex) { _, newIndex in
                    // Sync with array index changes from MapView
                    if newIndex < sortedWaypoints.count {
                        selectedIndex = newIndex
                    }
                    // PERFORMANCE: Request distance update through centralized manager
                    requestDistanceUpdate()
                }
                .onChange(of: locationService.currentLocation) { _, newLocation in
                    if newLocation != nil {
                        // PERFORMANCE: Request distance update through centralized manager
                        requestDistanceUpdate()
                    }
                }
                .onChange(of: waypoints) { _, newWaypoints in
                    // Reset to index 0 (current destination) when waypoints change
                    selectedIndex = 0
                    if !sortedWaypoints.isEmpty {
                        onCardChange(0)
                    }
                    // PERFORMANCE: Request distance update through centralized manager
                    requestDistanceUpdate()
                }
                .onAppear {
                    // Initialize to index 0 (current destination)
                    selectedIndex = 0
                }
            }
        }
    }
    
    // MARK: - Collapsed Header Layout
    private var collapsedHeader: some View {
        VStack(spacing: 0) {
            // Grabber handle
            RoundedRectangle(cornerRadius: 2.5)
                .fill(Color.secondary.opacity(0.5))
                .frame(width: 36, height: 5)
                .padding(.top, 6)
            
            // Single-line content layout (only show when not expanded)
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
                .padding(.init(top: 2, leading: 16, bottom: 6, trailing: 16))
            }
        }
    }
    
    // MARK: - Expanded Content Layout
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
                                onCenterMapOnDestination?(waypoint)
                            }
                        )
                        .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .onChange(of: selectedIndex) { _, newIndex in
                    // Notify MapView of index change
                    onCardChange(newIndex)
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
                
                // No global navigation button - each card has its own center map button
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
    
    // MARK: - Drag Gesture Handler
    private var verticalDragGesture: some Gesture {
        DragGesture()
            .updating($dragOffset) { value, state, _ in
                // Constrain drag offset to prevent over-dragging
                let translation = value.translation.height
                if isExpanded {
                    state = max(translation, -(expandedHeight - collapsedHeight))
                } else {
                    state = min(translation, 0)
                }
            }
            .onEnded { value in
                let threshold: CGFloat = 25
                let velocity = value.predictedEndTranslation.height - value.translation.height
                
                withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                    if velocity < -100 || (!isExpanded && value.translation.height < -threshold) {
                        // Expand
                        isExpanded = true
                    } else if velocity > 100 || (isExpanded && value.translation.height > threshold) {
                        // Collapse
                        isExpanded = false
                    }
                }
            }
    }
    
    // MARK: - Helper Properties and Functions    
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
    
    // MARK: - Distance Management (Optimized)
    
    private func startDistanceMonitoring() {
        // PERFORMANCE: Register with centralized distance manager instead of creating individual timers
        guard let waypoint = currentWaypoint else { return }
        
        let targetId = "carousel-\(waypoint.id)"
        distanceManager.startMonitoring(
            targetId: targetId,
            coordinate: waypoint.location.coordinate,
            onDistanceUpdate: { distance in
                Task { @MainActor in
                    self.cachedDistance = distance
                }
            }
        )
        
        // Request immediate distance calculation
        requestDistanceUpdate()
    }
    
    private func stopDistanceMonitoring() {
        // PERFORMANCE: Unregister from centralized distance manager
        guard let waypoint = currentWaypoint else { return }
        let targetId = "carousel-\(waypoint.id)"
        distanceManager.stopMonitoring(targetId: targetId)
    }
    
    private func requestDistanceUpdate() {
        // PERFORMANCE: Request distance calculation through centralized, debounced system
        guard let waypoint = currentWaypoint,
              let userLocation = locationService.currentLocation else {
            cachedDistance = nil
            lastWaypointId = nil
            return
        }
        
        let targetId = "carousel-\(waypoint.id)"
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
    
    // PERFORMANCE: Read-only distance accessor - no state modifications
    private var currentDistance: Double? {
        return cachedDistance
    }
}

// MARK: - Compact Destination Card
struct CompactDestinationCard: View {
    let waypoint: Waypoint
    let locationService: LocationService
    let isCurrentDestination: Bool
    let totalCount: Int
    let currentIndex: Int
    let onCenterMap: ((Waypoint) -> Void)?
    
    @Environment(\.colorScheme) private var colorScheme
    
    private var theme: DarkBlueTheme {
        DarkBlueTheme(isDark: colorScheme == .dark)
    }
    
    // PERFORMANCE: Cache computed values to avoid recalculation
    @State private var cachedDistance: Double?
    @State private var cachedRouteContext: String?
    @State private var lastComputationHash: String?
    
    // PERFORMANCE: Use centralized distance manager instead of individual timers
    @StateObject private var distanceManager = DistanceCalculationManager.shared
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // MARK: - Location Title with Icon and Category
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: waypoint.type.icon)
                    .foregroundColor(theme.primary)
                    .font(.title3)
                    .frame(width: 22)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(waypoint.name)
                        .font(.callout)
                        .fontWeight(.bold)
                        .foregroundColor(theme.foreground)
                        .lineLimit(2)
                        .truncationMode(.tail)
                    
                }
                
                Spacer()
            }
            
            // MARK: - Travel Information Grid (Improved Layout)
            VStack(alignment: .leading, spacing: 8) {
                // Travel Times Row
                HStack(spacing: 16) {
                    // Driving time
                    HStack(spacing: 6) {
                        Text("🚗")
                            .font(.body)
                    }
                    
                    // Walking time
                    HStack(spacing: 6) {
                        Text("🚶")
                            .font(.body)
                    }
                    
                    Spacer()
                }
                
                // Distance Row
                HStack(spacing: 6) {
                    Image(systemName: "location.circle")
                        .foregroundColor(theme.primary)
                        .font(.callout)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("直線距離")
                            .font(.caption2)
                            .foregroundColor(theme.mutedForeground)
                        if let distance = cachedDistance {
                            Text(formatDistance(distance))
                                .font(.caption)
                                .fontWeight(.semibold)
                                .foregroundColor(theme.primary)
                        } else {
                            HStack(spacing: 4) {
                                ProgressView()
                                    .scaleEffect(0.7)
                                    .progressViewStyle(CircularProgressViewStyle(tint: theme.mutedForeground))
                                Text("計算中")
                                    .font(.caption)
                                    .foregroundColor(theme.mutedForeground)
                            }
                        }
                    }
                    Spacer()
                }
            }
            .padding(.horizontal, 4)
            
            // MARK: - Main Action Button (Full Width)
            DarkBlueButton(variant: .primary, action: {
                onCenterMap?(waypoint)
            }) {
                HStack(spacing: 8) {
                    Image(systemName: "scope")
                        .font(.callout)
                    Text("顯示在地圖中心")
                        .font(.callout)
                        .fontWeight(.medium)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.init(top: 14, leading: 16, bottom: 14, trailing: 16))
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            // PERFORMANCE: Use centralized distance manager
            startDistanceMonitoring()
        }
        .onDisappear {
            stopDistanceMonitoring()
        }
        .onChange(of: locationService.currentLocation) { _, newLocation in
            if newLocation != nil {
                // PERFORMANCE: Request update through centralized manager
                requestDistanceUpdate()
            }
        }
    }
    
    // MARK: - Helper Functions
    
    private func formatDistance(_ distance: Double) -> String {
        if distance >= 1000 {
            return String(format: "%.1f公里", distance / 1000)
        } else {
            return "\(Int(distance))公尺"
        }
    }
    
    // PERFORMANCE: Cache route context computation
    private func getCachedRouteContext() -> String {
        let contextHash = "\(isCurrentDestination)-\(waypoint.order)"
        
        if let cached = cachedRouteContext, lastComputationHash == contextHash {
            return cached
        }
        
        let context: String
        if isCurrentDestination {
            context = "current_destination".localized
        } else {
            context = "next_stop".localized
        }
        
        cachedRouteContext = context
        lastComputationHash = contextHash
        return context
    }
    
    // MARK: - Distance Management (Optimized)
    
    private func startDistanceMonitoring() {
        // PERFORMANCE: Register with centralized distance manager
        let targetId = "card-\(waypoint.id)"
        distanceManager.startMonitoring(
            targetId: targetId,
            coordinate: waypoint.location.coordinate,
            onDistanceUpdate: { distance in
                Task { @MainActor in
                    self.cachedDistance = distance
                }
            }
        )
        
        // Request immediate calculation
        requestDistanceUpdate()
    }
    
    private func stopDistanceMonitoring() {
        // PERFORMANCE: Unregister from centralized distance manager
        let targetId = "card-\(waypoint.id)"
        distanceManager.stopMonitoring(targetId: targetId)
    }
    
    private func requestDistanceUpdate() {
        // PERFORMANCE: Request through centralized, debounced system
        guard let userLocation = locationService.currentLocation else {
            cachedDistance = nil
            return
        }
        
        let targetId = "card-\(waypoint.id)"
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
}