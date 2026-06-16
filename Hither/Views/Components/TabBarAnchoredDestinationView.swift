//
//  TabBarAnchoredDestinationView.swift
//  Hither
//
//  Tab-bar-anchored wrapper for DestinationCarouselView with split expansion behavior
//

import SwiftUI
import CoreLocation

struct TabBarAnchoredDestinationView<ButtonContent: View>: View {
    let waypoints: [Waypoint]
    let locationService: LocationService
    @Binding var currentIndex: Int
    let onCardChange: (Int) -> Void
    let onNavigateToDestination: (() -> Void)?
    let onCenterMapOnDestination: ((Waypoint) -> Void)?
    let buttons: ButtonContent?
    
    @State private var tabBarHeight: CGFloat = 83
    
    var body: some View {
        GeometryReader { geometry in
            let calculatedTabBarHeight = calculateTabBarHeight(geometry: geometry)
            
            ZStack(alignment: .bottomTrailing) {
                // AGGRESSIVE FIX: Direct positioning approach
                DestinationCarouselView(
                    waypoints: waypoints,
                    locationService: locationService,
                    currentIndex: $currentIndex,
                    onCardChange: onCardChange,
                    onNavigateToDestination: onNavigateToDestination,
                    onCenterMapOnDestination: onCenterMapOnDestination
                )
                .frame(minHeight: 100)
                .padding(.bottom, calculatedTabBarHeight + 8)
                .zIndex(10)
                
                // Floating buttons that track with the sheet
                if let buttons = buttons {
                    VStack(spacing: 12) {
                        buttons
                    }
                    .padding(.trailing, 16)
                    .padding(.bottom, 16 + calculatedTabBarHeight)
                }
            }
            .onAppear {
                tabBarHeight = calculatedTabBarHeight
            }
        }
    }
    
    private func calculateTabBarHeight(geometry: GeometryProxy) -> CGFloat {
        let safeAreaBottom = geometry.safeAreaInsets.bottom
        let standardTabBarHeight: CGFloat = 49
        return standardTabBarHeight + safeAreaBottom
    }
}

// MARK: - Convenience Initializers

extension TabBarAnchoredDestinationView where ButtonContent == EmptyView {
    init(
        waypoints: [Waypoint],
        locationService: LocationService,
        currentIndex: Binding<Int>,
        onCardChange: @escaping (Int) -> Void,
        onNavigateToDestination: (() -> Void)? = nil,
        onCenterMapOnDestination: ((Waypoint) -> Void)? = nil
    ) {
        self.waypoints = waypoints
        self.locationService = locationService
        self._currentIndex = currentIndex
        self.onCardChange = onCardChange
        self.onNavigateToDestination = onNavigateToDestination
        self.onCenterMapOnDestination = onCenterMapOnDestination
        self.buttons = nil
    }
}