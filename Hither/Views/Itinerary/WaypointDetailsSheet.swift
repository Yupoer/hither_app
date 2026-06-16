//
//  WaypointDetailsSheet.swift
//  Hither
//
//  Created by Claude on 2025/7/29.
//

import SwiftUI
import CoreLocation

struct WaypointDetailsSheet: View {
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
        NavigationView {
            Form {
                Section(header: Text("Location")) {
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
                
                Section(header: Text("Waypoint Type")) {
                    Picker("Type", selection: $selectedType) {
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
                
                Section(header: Text("Details")) {
                    TextField("Waypoint Name", text: $waypointName)
                    
                    TextField("Description (Optional)", text: $waypointDescription, axis: .vertical)
                        .lineLimit(3...6)
                }
                
                Section {
                    // Preview of the waypoint
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
                    Text("Preview")
                }
            }
            .navigationTitle("Waypoint Details")
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarItems(
                leading: Button("Back") {
                    presentationMode.wrappedValue.dismiss()
                },
                trailing: Button("Add") {
                    addWaypoint()
                }
                .disabled(waypointName.isEmpty || itineraryService.isLoading)
            )
        }
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
                presentationMode.wrappedValue.dismiss()
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