import SwiftUI
import CoreLocation

struct GoogleMapsBottomSheet<ButtonContent: View>: View {
    let waypoint: Waypoint
    let locationService: LocationService
    let isCurrentDestination: Bool
    let currentIndex: Int
    let totalCount: Int
    let previewableWaypoints: [Waypoint]
    let onToggleExpansion: () -> Void
    let onWaypointChange: (Int) -> Void
    let buttons: ButtonContent?
    
    @State private var dragOffset: CGFloat = 0
    @State private var cardHeight: CGFloat = 20 // Collapsed height
    @State private var tabBarHeight: CGFloat = 83
    @State private var sheetTopOffset: CGFloat = 0
    @Environment(\.colorScheme) private var colorScheme
    
    // Height states
    private let collapsedHeight: CGFloat = 20
    private let halfExpandedHeight: CGFloat = 180
    private let fullyExpandedHeight: CGFloat = 300
    
    private var currentHeight: CGFloat {
        cardHeight + max(0, dragOffset) // Only positive drag affects base height
    }
    
    var body: some View {
        GeometryReader { geometry in
            let calculatedTabBarHeight = calculateTabBarHeight(geometry: geometry)
            
            ZStack(alignment: .bottomTrailing) {
                // AGGRESSIVE FIX: Direct positioning for GoogleMapsBottomSheet
                VStack(alignment: .leading, spacing: 12) {
                    VStack() {
                        // Handle indicator
                        handleIndicator
                        
                        // Content based on current state
                        contentView
                    }
                    .frame(height: currentHeight)
                    .background(cardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: theme.cornerRadius))
                    .shadow(
                        color: theme.shadowColor,
                        radius: theme.shadowRadius,
                        x: theme.shadowOffset.width,
                        y: theme.shadowOffset.height
                    )
                    .offset(y: sheetTopOffset) // Split expansion offset
                    .gesture(splitExpansionGesture)
                    .animation(.spring(response: 0.5, dampingFraction: 0.8), value: cardHeight)
                    .animation(.spring(response: 0.3, dampingFraction: 0.8), value: sheetTopOffset)
                }
                .frame(minHeight: 100)
                .background(Color.red.opacity(0.8)) // DEBUG: Very visible background
                .offset(y: -120) // Force position from bottom
                .zIndex(999) // Ensure it's on top
                
                // Floating buttons that track with sheet expansion
                if let buttons = buttons {
                    VStack(spacing: 12) {
                        buttons
                    }
                    .padding(.trailing, 16)
                    .padding(.bottom, 16 + calculatedTabBarHeight + (currentHeight - collapsedHeight) * 0.1)
                    .animation(.spring(response: 0.5, dampingFraction: 0.8), value: currentHeight)
                }
            }
            .onAppear {
                tabBarHeight = calculatedTabBarHeight
            }
        }
    }
    
    private var handleIndicator: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 3)
                .fill(theme.mutedForeground.opacity(0.4))
                .frame(width: 36, height: 5)
                .padding(.top, 8)
                .padding(.bottom, 12)
        }
    }
    
    @ViewBuilder
    private var contentView: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                // Main content always visible
                mainContent
                
                // Additional content visible when expanded
                if cardHeight > collapsedHeight {
                    additionalContent
                }
                
                // Full details visible only when fully expanded
                if cardHeight >= fullyExpandedHeight {
                    fullDetailsContent
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollDisabled(cardHeight <= halfExpandedHeight)
    }
    
    private var mainContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Title and status
            HStack(alignment: .top) {
                Image(systemName: waypoint.type.icon)
                    .foregroundColor(.blue)
                    .font(.title2)
                    .frame(width: 28)
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(routeContextText)
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(isCurrentDestination ? .green : .blue)
                    
                    Text(waypoint.name)
                        .font(.title3)
                        .fontWeight(.semibold)
                        .foregroundColor(.primary)
                        .lineLimit(cardHeight <= collapsedHeight ? 1 : 2)
                }
                
                Spacer()
                
                // Distance
                if let distance = calculateDistanceToWaypoint() {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(Int(distance))m")
                            .font(.headline)
                            .fontWeight(.bold)
                            .foregroundColor(.blue)
                        
                        if cardHeight > collapsedHeight {
                            Text("away")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
            
            
        }
    }
    
    
    
    @ViewBuilder
    private var additionalContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Description
            if let description = waypoint.description, !description.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("About")
                        .font(.headline)
                        .foregroundColor(.primary)
                    
                    Text(description)
                        .font(.body)
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            
            // Address information
            VStack(alignment: .leading, spacing: 8) {
                Text("Location")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                HStack(spacing: 8) {
                    Image(systemName: "location.fill")
                        .foregroundColor(.blue)
                        .font(.caption)
                    
                    Text("Lat: \(waypoint.location.latitude, specifier: "%.6f"), Lon: \(waypoint.location.longitude, specifier: "%.6f")")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }
        }
    }
    
    @ViewBuilder
    private var fullDetailsContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Divider()
            
            // Additional information section
            VStack(alignment: .leading, spacing: 8) {
                Text("Details")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                VStack(alignment: .leading, spacing: 12) {
                    BottomSheetInfoRow(icon: "clock", title: "Added", value: formatDate(waypoint.createdAt))
                    BottomSheetInfoRow(icon: "person.fill", title: "Type", value: waypoint.type.rawValue.capitalized)
                    
                    if totalCount > 1 {
                        BottomSheetInfoRow(icon: "list.number", title: "Position", value: "\(currentIndex + 1) of \(totalCount)")
                    }
                }
            }
            
            // Route context if available
            if totalCount > 1 {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Route Context")
                        .font(.headline)
                        .foregroundColor(.primary)
                    
                    Text("This is \(routeContextText.lowercased()) in your planned itinerary.")
                        .font(.body)
                        .foregroundColor(.secondary)
                }
            }
        }
    }
    
    private func handleSplitExpansionDragEnd(_ value: DragGesture.Value) {
        let velocity = value.predictedEndLocation.y - value.location.y
        let translation = value.translation.height
        let threshold: CGFloat = 50
        
        // Split expansion logic
        if velocity < -threshold || translation < -threshold {
            // Expand upward
            if cardHeight <= collapsedHeight {
                cardHeight = halfExpandedHeight
            } else if cardHeight <= halfExpandedHeight {
                cardHeight = fullyExpandedHeight
            }
        } else if velocity > threshold || translation > threshold {
            // Collapse downward
            if cardHeight >= fullyExpandedHeight {
                cardHeight = halfExpandedHeight
            } else if cardHeight >= halfExpandedHeight {
                cardHeight = collapsedHeight
            }
        } else {
            // Snap to nearest state based on current position
            let currentPosition = cardHeight + max(0, dragOffset)
            
            if currentPosition < (collapsedHeight + halfExpandedHeight) / 2 {
                cardHeight = collapsedHeight
            } else if currentPosition < (halfExpandedHeight + fullyExpandedHeight) / 2 {
                cardHeight = halfExpandedHeight
            } else {
                cardHeight = fullyExpandedHeight
            }
        }
        
        // Reset offsets
        sheetTopOffset = 0
    }
    
    private func handleHorizontalDragEnd(_ value: DragGesture.Value) {
        guard totalCount > 1 else { return }
        
        let threshold: CGFloat = 50
        
        if value.translation.width > threshold {
            // Swipe right - go to previous waypoint
            let newIndex = max(0, currentIndex - 1)
            if newIndex != currentIndex {
                onWaypointChange(newIndex)
            }
        } else if value.translation.width < -threshold {
            // Swipe left - go to next waypoint
            let newIndex = min(totalCount - 1, currentIndex + 1)
            if newIndex != currentIndex {
                onWaypointChange(newIndex)
            }
        }
    }
    
    private var cardBackground: some View {
        theme.card
            .overlay(
                RoundedRectangle(cornerRadius: theme.cornerRadius)
                    .stroke(theme.border, lineWidth: 1)
            )
    }
    
    private var theme: DarkBlueTheme {
        DarkBlueTheme(isDark: colorScheme == .dark)
    }
    
    private func calculateTabBarHeight(geometry: GeometryProxy) -> CGFloat {
        let safeAreaBottom = geometry.safeAreaInsets.bottom
        let standardTabBarHeight: CGFloat = 49
        return standardTabBarHeight + safeAreaBottom
    }
    
    private var splitExpansionGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                if abs(value.translation.height) > abs(value.translation.width) {
                    withAnimation(.interactiveSpring(response: 0.3, dampingFraction: 0.8)) {
                        let translation = value.translation.height
                        
                        if translation < 0 {
                            // Upward drag: move top of sheet up (split behavior)
                            sheetTopOffset = translation
                            dragOffset = 0
                        } else {
                            // Downward drag: only collapse, don't move bottom
                            sheetTopOffset = 0
                            dragOffset = min(0, translation - (cardHeight - collapsedHeight))
                        }
                    }
                }
            }
            .onEnded { value in
                withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                    if abs(value.translation.height) > abs(value.translation.width) {
                        handleSplitExpansionDragEnd(value)
                    } else {
                        // Handle horizontal drag for waypoint navigation (only when expanded)
                        if cardHeight > collapsedHeight {
                            handleHorizontalDragEnd(value)
                        }
                    }
                    dragOffset = 0
                }
            }
    }
    
    private var routeContextText: String {
        if isCurrentDestination {
            return "Current Destination"
        } else if currentIndex == 0 {
            return "Next Destination"
        } else {
            return "Upcoming Stop"
        }
    }
    
    private func calculateDistanceToWaypoint() -> Double? {
        guard let userLocation = locationService.currentLocation else { return nil }
        
        let waypointLocation = CLLocation(
            latitude: waypoint.location.latitude,
            longitude: waypoint.location.longitude
        )
        
        return userLocation.distance(from: waypointLocation)
    }
    
    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// Helper view for info rows
struct BottomSheetInfoRow: View {
    let icon: String
    let title: String
    let value: String
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundColor(.blue)
                .font(.subheadline)
                .frame(width: 20)
            
            Text(title)
                .font(.subheadline)
                .foregroundColor(.secondary)
            
            Spacer()
            
            Text(value)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundColor(.primary)
        }
    }
}

// MARK: - Convenience Initializers

extension GoogleMapsBottomSheet where ButtonContent == EmptyView {
    init(
        waypoint: Waypoint,
        locationService: LocationService,
        isCurrentDestination: Bool,
        currentIndex: Int,
        totalCount: Int,
        previewableWaypoints: [Waypoint],
        onToggleExpansion: @escaping () -> Void,
        onWaypointChange: @escaping (Int) -> Void
    ) {
        self.waypoint = waypoint
        self.locationService = locationService
        self.isCurrentDestination = isCurrentDestination
        self.currentIndex = currentIndex
        self.totalCount = totalCount
        self.previewableWaypoints = previewableWaypoints
        self.onToggleExpansion = onToggleExpansion
        self.onWaypointChange = onWaypointChange
        self.buttons = nil
    }
}

#if DEBUG
struct GoogleMapsBottomSheet_Previews: PreviewProvider {
    static var previews: some View {
        let mockLocation = GeoPoint(latitude: 37.7749, longitude: -122.4194)
        let mockLocationService = LocationService()
        
        let mockWaypoint = Waypoint(
            groupId: "preview-group",
            name: "Golden Gate Bridge",
            description: "Iconic suspension bridge spanning the Golden Gate strait.",
            type: .destination,
            location: mockLocation,
            createdBy: "preview-user"
        )
        
        let mockRestStop = Waypoint(
            groupId: "preview-group", 
            name: "Visitor Center",
            description: "Rest stop with facilities and information.",
            type: .restStop,
            location: GeoPoint(latitude: 37.8199, longitude: -122.4786),
            createdBy: "preview-user",
            order: 1
        )
        
        let mockLunch = Waypoint(
            groupId: "preview-group",
            name: "Fisherman's Wharf",
            description: "Popular dining area with seafood restaurants and shops.",
            type: .lunch,
            location: GeoPoint(latitude: 37.8080, longitude: -122.4177),
            createdBy: "preview-user",
            order: 2
        )
        
        Group {
            // Current destination preview
            GoogleMapsBottomSheet(
                waypoint: mockWaypoint,
                locationService: mockLocationService,
                isCurrentDestination: true,
                currentIndex: 0,
                totalCount: 3,
                previewableWaypoints: [mockWaypoint, mockRestStop, mockLunch],
                onToggleExpansion: {},
                onWaypointChange: { _ in }
            )
            .previewDisplayName("Current Destination")
            
            // Upcoming stop preview
            GoogleMapsBottomSheet(
                waypoint: mockRestStop,
                locationService: mockLocationService,
                isCurrentDestination: false,
                currentIndex: 1,
                totalCount: 3,
                previewableWaypoints: [mockWaypoint, mockRestStop, mockLunch],
                onToggleExpansion: {},
                onWaypointChange: { _ in }
            )
            .previewDisplayName("Upcoming Stop")
            
            // With buttons preview
            GoogleMapsBottomSheet(
                waypoint: mockLunch,
                locationService: mockLocationService,
                isCurrentDestination: false,
                currentIndex: 2,
                totalCount: 3,
                previewableWaypoints: [mockWaypoint, mockRestStop, mockLunch],
                onToggleExpansion: {},
                onWaypointChange: { _ in },
                buttons: VStack(spacing: 8) {
                    Button(action: {}) {
                        Image(systemName: "location.fill")
                            .font(.title2)
                            .foregroundColor(.white)
                            .frame(width: 50, height: 50)
                            .background(.blue)
                            .clipShape(Circle())
                            .shadow(radius: 4)
                    }
                    
                    Button(action: {}) {
                        Image(systemName: "arrow.turn.up.right")
                            .font(.title2)
                            .foregroundColor(.white)
                            .frame(width: 50, height: 50)
                            .background(.green)
                            .clipShape(Circle())
                            .shadow(radius: 4)
                    }
                }
            )
            .previewDisplayName("With Action Buttons")
        }
    }
}
#endif
