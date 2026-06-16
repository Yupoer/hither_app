//
//  AddWaypointSheet.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI
import MapKit
import CoreLocation

struct AddWaypointNavigationView: View {
    @ObservedObject var itineraryService: ItineraryService
    let groupId: String
    let userId: String
    let userName: String
    
    @Environment(\.presentationMode) var presentationMode
    @State private var selectedLocation: CLLocationCoordinate2D?
    @State private var selectedLocationName = ""
    @State private var showingWaypointDetails = false
    
    var body: some View {
        NavigationView {
            LocationSelectionView(
                selectedLocation: $selectedLocation,
                selectedLocationName: $selectedLocationName,
                itineraryService: itineraryService,
                groupId: groupId,
                userId: userId,
                onComplete: {
                    presentationMode.wrappedValue.dismiss()
                }
            )
        }
    }
}

struct AddWaypointSheet: View {
    @ObservedObject var itineraryService: ItineraryService
    let groupId: String
    let userId: String
    let userName: String
    
    @Environment(\.presentationMode) var presentationMode
    
    @State private var selectedLocation: CLLocationCoordinate2D?
    @State private var selectedLocationName = ""
    @State private var showingWaypointDetails = false
    
    var body: some View {
        LocationSelectionSheet(
            selectedLocation: $selectedLocation,
            selectedLocationName: $selectedLocationName,
            onLocationSelected: { location, name in
                Task { @MainActor in
                    selectedLocation = location
                    selectedLocationName = name
                    // Small delay to ensure smooth sheet transition
                    try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
                    showingWaypointDetails = true
                }
            },
            onDismiss: {
                // This will be called when "Use This Location" is pressed
                // But we don't want to dismiss the entire flow, just transition to next sheet
            }
        )
        .sheet(isPresented: $showingWaypointDetails) {
            if let location = selectedLocation {
                WaypointDetailsSheet(
                    selectedLocation: location,
                    locationName: selectedLocationName,
                    itineraryService: itineraryService,
                    groupId: groupId,
                    userId: userId,
                    onComplete: {
                        // When waypoint is successfully added, dismiss the entire flow
                        presentationMode.wrappedValue.dismiss()
                    }
                )
            }
        }
    }
    
}

struct LocationSelectionView: View {
    @Binding var selectedLocation: CLLocationCoordinate2D?
    @Binding var selectedLocationName: String
    @ObservedObject var itineraryService: ItineraryService
    let groupId: String
    let userId: String
    let onComplete: () -> Void
    
    @StateObject private var locationService = LocationService()
    @State private var region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
        span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
    )
    @State private var searchText = ""
    @State private var searchResults: [MKMapItem] = []
    @State private var isSearching = false
    @State private var selectedSearchResult: MKMapItem?
    @State private var navigateToDetails = false
    
    var body: some View {
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
                selectedLocation = region.center
                selectedLocationName = "selected_location".localized
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
                
                // Selected location info with NavigationLink
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
                        
                        NavigationLink(
                            destination: WaypointDetailsView(
                                selectedLocation: selectedLocation!,
                                locationName: selectedLocationName,
                                itineraryService: itineraryService,
                                groupId: groupId,
                                userId: userId,
                                onComplete: onComplete
                            ),
                            isActive: $navigateToDetails
                        ) {
                            Button("use_this_location".localized) {
                                navigateToDetails = true
                            }
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        .buttonStyle(PlainButtonStyle())
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
                // Dismiss the navigation view - this will go back to the previous view
                onComplete()
            }
        )
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
        
        if locationService.authorizationStatus == .authorizedWhenInUse || locationService.authorizationStatus == .authorizedAlways {
            locationService.startTracking(groupId: "temp", userId: "temp")
        }
        
        if let currentLocation = locationService.currentLocation {
            region = MKCoordinateRegion(
                center: currentLocation.coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
            )
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
            selectedLocationName = result.name ?? "selected_location".localized
            selectedSearchResult = result
            
            region = MKCoordinateRegion(
                center: result.placemark.coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
            )
            
            searchResults = []
            searchText = result.name ?? ""
        }
    }
}

struct WaypointDetailsView: View {
    let selectedLocation: CLLocationCoordinate2D
    let locationName: String
    @ObservedObject var itineraryService: ItineraryService
    let groupId: String
    let userId: String
    let onComplete: () -> Void
    
    @Environment(\.presentationMode) var presentationMode
    @State private var waypointName: String
    @State private var waypointDescription = ""
    @State private var selectedType = WaypointType.checkpoint
    
    init(selectedLocation: CLLocationCoordinate2D, locationName: String, itineraryService: ItineraryService, groupId: String, userId: String, onComplete: @escaping () -> Void) {
        self.selectedLocation = selectedLocation
        self.locationName = locationName
        self.itineraryService = itineraryService
        self.groupId = groupId
        self.userId = userId
        self.onComplete = onComplete
        self._waypointName = State(initialValue: locationName)
    }
    
    var body: some View {
        Form {
            Section(header: Text("location".localized)) {
                HStack {
                    Image(systemName: "location")
                        .foregroundColor(.blue)
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text(locationName)
                            .font(.headline)
                            .foregroundColor(.primary)
                        
                        Text("Lat: \(selectedLocation.latitude, specifier: "%.4f"), Lng: \(selectedLocation.longitude, specifier: "%.4f")")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                }
                .padding(.vertical, 4)
            }
            
            Section(header: Text("waypoint_type".localized)) {
                Picker("waypoint_type".localized, selection: $selectedType) {
                    ForEach(WaypointType.allCases, id: \.self) { type in
                        HStack {
                            Image(systemName: type.icon)
                                .foregroundColor(getTypeColor(type))
                            Text(type.displayName)
                        }
                        .tag(type)
                    }
                }
                .pickerStyle(WheelPickerStyle())
            }
            
            Section(header: Text("details".localized)) {
                TextField("waypoint_name".localized, text: $waypointName)
                
                TextField("description_optional".localized, text: $waypointDescription, axis: .vertical)
                    .lineLimit(3...6)
            }
            
            Section {
                HStack(spacing: 12) {
                    Image(systemName: selectedType.icon)
                        .foregroundColor(getTypeColor(selectedType))
                        .font(.title2)
                        .frame(width: 30)
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text(waypointName)
                            .font(.headline)
                            .foregroundColor(.primary)
                        
                        if !waypointDescription.isEmpty {
                            Text(waypointDescription)
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .lineLimit(2)
                        }
                        
                        Text(selectedType.displayName)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                }
                .padding(.vertical, 8)
            } header: {
                Text("preview".localized)
            }
        }
        .navigationTitle("waypoint_details".localized)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarItems(
            trailing: Button("add".localized) {
                addWaypoint()
            }
            .disabled(waypointName.isEmpty || itineraryService.isLoading)
        )
    }
    
    private func addWaypoint() {
        Task {
            await itineraryService.addWaypoint(
                name: waypointName,
                description: waypointDescription.isEmpty ? nil : waypointDescription,
                type: selectedType,
                location: selectedLocation,
                groupId: groupId,
                createdBy: userId
            )
            
            await MainActor.run {
                onComplete()
            }
        }
    }
    
    private func getTypeColor(_ type: WaypointType) -> Color {
        switch type.color {
        case "blue": return .blue
        case "green": return .green
        case "red": return .red
        case "orange": return .orange
        case "purple": return .purple
        case "gray": return .gray
        default: return .blue
        }
    }
}

struct WaypointDetailView: View {
    let waypoint: Waypoint
    @ObservedObject var itineraryService: ItineraryService
    let groupId: String
    let userId: String
    let userName: String
    let isLeader: Bool
    let groupName: String
    let leaderName: String
    let memberCount: Int
    
    @Environment(\.presentationMode) var presentationMode
    @State private var showingDeleteAlert = false
    
    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                // Waypoint info
                VStack(spacing: 16) {
                    HStack {
                        Image(systemName: waypoint.type.icon)
                            .foregroundColor(getTypeColor())
                            .font(.largeTitle)
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text(waypoint.name)
                                .font(.title2)
                                .fontWeight(.semibold)
                            
                            Text(waypoint.type.displayName)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                        
                        Spacer()
                        
                        if waypoint.isCompleted {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                                .font(.title)
                        }
                    }
                    
                    if let description = waypoint.description, !description.isEmpty {
                        Text(description)
                            .font(.body)
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding()
                .background(Color.gray.opacity(0.1))
                .cornerRadius(12)
                
                // Map
                Map(coordinateRegion: .constant(MKCoordinateRegion(
                    center: waypoint.location.coordinate,
                    span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
                )), annotationItems: [LocationAnnotationItem(coordinate: waypoint.location.coordinate)]) { item in
                    MapAnnotation(coordinate: item.coordinate) {
                        Image(systemName: waypoint.type.icon)
                            .foregroundColor(getTypeColor())
                            .font(.title)
                    }
                }
                .frame(height: 200)
                .cornerRadius(12)
                
                // Actions
                if isLeader {
                    VStack(spacing: 12) {
                        if waypoint.isActive && !waypoint.isCompleted {
                            if waypoint.isInProgress {
                                // Stop Going button
                                Button(action: {
                                    stopGoing()
                                }) {
                                    HStack {
                                        Image(systemName: "stop.circle")
                                        Text("stop_going".localized)
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding()
                                    .background(Color.orange)
                                    .foregroundColor(.white)
                                    .cornerRadius(8)
                                }
                                
                                // Mark Complete button
                                Button(action: {
                                    markCompleted()
                                }) {
                                    HStack {
                                        Image(systemName: "checkmark.circle")
                                        Text("mark_as_completed".localized)
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding()
                                    .background(Color.green)
                                    .foregroundColor(.white)
                                    .cornerRadius(8)
                                }
                            } else {
                                // Going button
                                Button(action: {
                                    startGoing()
                                }) {
                                    HStack {
                                        Image(systemName: "arrow.right.circle")
                                        Text("going".localized)
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding()
                                    .background(Color.blue)
                                    .foregroundColor(.white)
                                    .cornerRadius(8)
                                }
                            }
                        }
                        
                        Button(action: {
                            showingDeleteAlert = true
                        }) {
                            HStack {
                                Image(systemName: "trash")
                                Text("delete_waypoint".localized)
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.red)
                            .foregroundColor(.white)
                            .cornerRadius(8)
                        }
                    }
                }
                
                Spacer()
            }
            .padding()
            .navigationTitle("waypoint_details".localized)
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarItems(
                trailing: Button("done".localized) {
                    presentationMode.wrappedValue.dismiss()
                }
            )
            .alert("delete_waypoint".localized, isPresented: $showingDeleteAlert) {
                Button("cancel".localized, role: .cancel) { }
                Button("delete".localized, role: .destructive) {
                    deleteWaypoint()
                }
            } message: {
                Text("delete_confirmation".localized)
            }
        }
    }
    
    private func getTypeColor() -> Color {
        switch waypoint.type.color {
        case "blue": return .blue
        case "green": return .green
        case "red": return .red
        case "orange": return .orange
        case "purple": return .purple
        case "gray": return .gray
        default: return .blue
        }
    }
    
    private func startGoing() {
        Task {
            await itineraryService.startWaypointProgress(
                waypointId: waypoint.id,
                groupId: groupId,
                updatedBy: userId,
                groupName: groupName,
                userRole: isLeader ? "leader" : "follower",
                leaderName: leaderName,
                memberCount: memberCount
            )
            
            await MainActor.run {
                presentationMode.wrappedValue.dismiss()
            }
        }
    }
    
    private func stopGoing() {
        Task {
            await itineraryService.stopWaypointProgress(
                waypointId: waypoint.id,
                groupId: groupId,
                updatedBy: userId
            )
            
            await MainActor.run {
                presentationMode.wrappedValue.dismiss()
            }
        }
    }
    
    private func markCompleted() {
        Task {
            await itineraryService.markWaypointCompleted(
                waypointId: waypoint.id,
                groupId: groupId,
                updatedBy: userId
            )
            
            await MainActor.run {
                presentationMode.wrappedValue.dismiss()
            }
        }
    }
    
    private func deleteWaypoint() {
        Task {
            await itineraryService.removeWaypoint(
                waypointId: waypoint.id,
                groupId: groupId,
                updatedBy: userId
            )
            
            // Wait a moment for Firestore to update
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
            
            await MainActor.run {
                presentationMode.wrappedValue.dismiss()
            }
        }
    }
}
