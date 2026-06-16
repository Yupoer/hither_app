//
//  LocationSelectionSheet.swift
//  Hither
//
//  Created by Claude on 2025/7/29.
//

import SwiftUI
import MapKit
import CoreLocation

struct LocationSelectionSheet: View {
    @Binding var selectedLocation: CLLocationCoordinate2D?
    @Binding var selectedLocationName: String
    @Environment(\.presentationMode) var presentationMode
    @StateObject private var locationService = LocationService()
    
    @State private var region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194), // Fallback location
        span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
    )
    @State private var searchText = ""
    @State private var searchResults: [MKMapItem] = []
    @State private var isSearching = false
    @State private var selectedSearchResult: MKMapItem?
    
    let onLocationSelected: (CLLocationCoordinate2D, String) -> Void
    let onDismiss: (() -> Void)?
    
    var body: some View {
        NavigationView {
            ZStack {
                // Map
                Map(coordinateRegion: $region, annotationItems: mapAnnotations) { item in
                    MapAnnotation(coordinate: item.coordinate) {
                        Image(systemName: "mappin.circle.fill")
                            .foregroundColor(.red)
                            .font(.title)
                            .background(Color.white.clipShape(Circle()))
                    }
                }
                .onTapGesture { location in
                    // Convert tap location to coordinate (simplified)
                    selectedLocation = region.center
                    selectedLocationName = "Selected Location"
                    selectedSearchResult = nil
                }
                
                // Search bar overlay
                VStack {
                    HStack {
                        HStack {
                            Image(systemName: "magnifyingglass")
                                .foregroundColor(.gray)
                            
                            TextField("search_for_place".localized, text: $searchText)
                                .onSubmit {
                                    performSearch()
                                }
                            
                            if isSearching {
                                ProgressView()
                                    .scaleEffect(0.8)
                            } else if !searchText.isEmpty {
                                Button("clear".localized) {
                                    searchText = ""
                                    searchResults = []
                                }
                                .font(.caption)
                            }
                        }
                        .padding(8)
                        .background(Color(.systemBackground))
                        .cornerRadius(10)
                        .shadow(radius: 2)
                        
                        Button(action: {
                            useCurrentLocation()
                        }) {
                            Image(systemName: "location.fill")
                                .foregroundColor(.blue)
                                .padding(8)
                                .background(Color(.systemBackground))
                                .clipShape(Circle())
                                .shadow(radius: 2)
                        }
                        .disabled(locationService.currentLocation == nil)
                    }
                    .padding()
                    
                    // Search results
                    if !searchResults.isEmpty {
                        ScrollView {
                            LazyVStack(spacing: 6) {
                                ForEach(searchResults, id: \.self) { result in
                                    Button(action: {
                                        selectSearchResult(result)
                                    }) {
                                        HStack {
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(result.name ?? "Unknown Place")
                                                    .font(.subheadline)
                                                    .fontWeight(.medium)
                                                    .foregroundColor(.primary)
                                                
                                                if let address = result.placemark.title {
                                                    Text(address)
                                                        .font(.caption2)
                                                        .foregroundColor(.secondary)
                                                        .lineLimit(1)
                                                }
                                            }
                                            
                                            Spacer()
                                            
                                            Image(systemName: "chevron.right")
                                                .foregroundColor(.gray)
                                                .font(.caption2)
                                        }
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 8)
                                        .background(.ultraThinMaterial)
                                        .cornerRadius(8)
                                    }
                                    .buttonStyle(PlainButtonStyle())
                                }
                            }
                            .padding(.horizontal)
                        }
                        .frame(maxHeight: 250)
                        .background(.ultraThinMaterial)
                    }
                    
                    Spacer()
                    
                    // Selected location info
                    if selectedLocation != nil {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("selected_location".localized)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                
                                Text(selectedLocationName)
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .foregroundColor(.primary)
                            }
                            
                            Spacer()
                            
                            Button("use_this_location".localized) {
                                if let location = selectedLocation {
                                    onLocationSelected(location, selectedLocationName)
                                    onDismiss?()
                                }
                            }
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        .padding()
                        .background(.regularMaterial)
                        .cornerRadius(12)
                        .shadow(color: .black.opacity(0.1), radius: 4)
                        .padding()
                    }
                }
            }
            .navigationTitle("select_location".localized)
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarItems(
                leading: Button("back".localized) {
                    presentationMode.wrappedValue.dismiss()
                }
            )
        }
        .onAppear {
            setupLocation()
        }
        .onChange(of: searchText) { text in
            Task { @MainActor in
                if !text.isEmpty && text.count > 2 {
                    performSearch()
                } else {
                    searchResults = []
                }
            }
        }
    }
    
    private var mapAnnotations: [LocationAnnotationItem] {
        guard let location = selectedLocation else { return [] }
        return [LocationAnnotationItem(coordinate: location)]
    }
    
    private func setupLocation() {
        locationService.requestLocationPermission()
        
        // Start location updates to get current location
        if locationService.authorizationStatus == .authorizedWhenInUse || locationService.authorizationStatus == .authorizedAlways {
            // Use temporary IDs since we just need location, not tracking
            locationService.startTracking(groupId: "temp", userId: "temp")
        }
        
        // Immediately use current location if available
        if let currentLocation = locationService.currentLocation {
            region = MKCoordinateRegion(
                center: currentLocation.coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
            )
            
            // Also auto-select current location as default
            selectedLocation = currentLocation.coordinate
            selectedLocationName = "current_location".localized
        }
        
        // Set up observer for location updates to center map when location becomes available
        Task {
            while locationService.currentLocation == nil && (locationService.authorizationStatus == .authorizedWhenInUse || locationService.authorizationStatus == .authorizedAlways) {
                try? await Task.sleep(nanoseconds: 500_000_000) // Check every 0.5 seconds
                
                if let currentLocation = locationService.currentLocation {
                    await MainActor.run {
                        region = MKCoordinateRegion(
                            center: currentLocation.coordinate,
                            span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
                        )
                        
                        // Auto-select current location if no location is selected yet
                        if selectedLocation == nil {
                            selectedLocation = currentLocation.coordinate
                            selectedLocationName = "current_location".localized
                        }
                    }
                    break
                }
            }
        }
    }
    
    private func useCurrentLocation() {
        guard let currentLocation = locationService.currentLocation else { return }
        
        selectedLocation = currentLocation.coordinate
        selectedLocationName = "current_location".localized
        selectedSearchResult = nil
        
        region = MKCoordinateRegion(
            center: currentLocation.coordinate,
            span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
        )
    }
    
    private func performSearch() {
        guard !searchText.isEmpty else { return }
        
        isSearching = true
        
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = searchText
        
        // Use current location for more relevant results
        if let currentLocation = locationService.currentLocation {
            request.region = MKCoordinateRegion(
                center: currentLocation.coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.1, longitudeDelta: 0.1)
            )
        }
        
        let search = MKLocalSearch(request: request)
        search.start { response, error in
            Task { @MainActor in
                isSearching = false
                
                if let error = error {
                    print("Search error: \(error.localizedDescription)")
                    return
                }
                
                searchResults = response?.mapItems ?? []
            }
        }
    }
    
    private func selectSearchResult(_ result: MKMapItem) {
        Task { @MainActor in
            selectedLocation = result.placemark.coordinate
            selectedLocationName = result.name ?? "Selected Location"
            selectedSearchResult = result
            
            // Update region to center on selected location
            region = MKCoordinateRegion(
                center: result.placemark.coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
            )
            
            // Clear search results
            searchResults = []
            searchText = result.name ?? ""
        }
    }
}

struct LocationAnnotationItem: Identifiable {
    let id = UUID()
    let coordinate: CLLocationCoordinate2D
}