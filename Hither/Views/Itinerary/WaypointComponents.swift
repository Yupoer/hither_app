//
//  WaypointComponents.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI
import CoreLocation
import MapKit

struct WaypointCard: View {
    let waypoint: Waypoint
    let locationService: LocationService
    let isLeader: Bool
    let onTap: () -> Void
    let onComplete: (() -> Void)?
    let onDelete: (() -> Void)?
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // Waypoint icon
                Image(systemName: waypoint.type.icon)
                    .foregroundColor(getTypeColor())
                    .font(.title2)
                    .frame(width: 30)
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(waypoint.name)
                        .font(.headline)
                        .foregroundColor(.primary)
                        .multilineTextAlignment(.leading)
                    
                    if let description = waypoint.description, !description.isEmpty {
                        Text(description)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }
                    
                    Text(waypoint.type.displayName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                VStack(alignment: .trailing, spacing: 4) {
                    if let userLocation = locationService.currentLocation {
                        let distance = userLocation.distance(from: CLLocation(latitude: waypoint.location.latitude, longitude: waypoint.location.longitude))
                        Text(LocationService.formatDistance(distance))
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(.primary)
                    }
                    
                    if waypoint.isCompleted {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                            .font(.caption)
                    } else if waypoint.isInProgress {
                        Image(systemName: "arrow.right.circle.fill")
                            .foregroundColor(.blue)
                            .font(.caption)
                    }
                }
                
                if isLeader && waypoint.isActive && !waypoint.isCompleted && onComplete != nil {
                    Button(action: { onComplete?() }) {
                        Image(systemName: "checkmark.circle")
                            .foregroundColor(.green)
                            .font(.title3)
                    }
                    .buttonStyle(PlainButtonStyle())
                }
            }
            .padding()
            .background(Color(.systemBackground))
            .cornerRadius(12)
            .shadow(color: .gray.opacity(0.2), radius: 2, x: 0, y: 1)
        }
        .buttonStyle(PlainButtonStyle())
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if isLeader, let onDelete = onDelete {
                Button(role: .destructive, action: onDelete) {
                    Label("Delete", systemImage: "trash")
                }
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
}

struct NextWaypointCard: View {
    let waypoint: Waypoint
    let locationService: LocationService
    @State private var showingDetail = false
    
    var body: some View {
        Button(action: {
            showingDetail = true
        }) {
            HStack(spacing: 16) {
                // Destination icon with enhanced styling
                ZStack {
                    Circle()
                        .fill(.thinMaterial)
                        .frame(width: 60, height: 60)
                        .overlay(
                            Circle()
                                .stroke(
                                    LinearGradient(
                                        colors: [Color.green.opacity(0.4), Color.blue.opacity(0.2)],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    ),
                                    lineWidth: 2
                                )
                        )
                        .shadow(color: Color.green.opacity(0.3), radius: 12, y: 6)
                    
                    Image(systemName: "location.fill")
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.green, .blue],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
                
                VStack(alignment: .leading, spacing: 6) {
                    Text("current_destination".localized)
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)
                    
                    Text(waypoint.name)
                        .font(.headline)
                        .fontWeight(.semibold)
                        .foregroundColor(.primary)
                        .lineLimit(2)
                    
                    if let userLocation = locationService.currentLocation {
                        let distance = userLocation.distance(from: CLLocation(latitude: waypoint.location.latitude, longitude: waypoint.location.longitude))
                        
                        HStack(spacing: 8) {
                            Image(systemName: "arrow.right.circle.fill")
                                .foregroundColor(.blue)
                                .font(.caption)
                            
                            Text(formatDistance(distance))
                                .font(.subheadline)
                                .fontWeight(.medium)
                                .foregroundColor(.blue)
                        }
                    }
                }
                
                Spacer()
                
                // Floating group card (top-right)
                VStack(spacing: 4) {
                    Image(systemName: "person.2.fill")
                        .font(.title3)
                        .foregroundColor(.orange)
                    
                    Text("group_info".localized)
                        .font(.caption2)
                        .fontWeight(.medium)
                        .foregroundColor(.orange)
                }
                .padding(8)
                .background(.regularMaterial)
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.orange.opacity(0.3), lineWidth: 1)
                )
            }
            .padding(20)
        }
        .buttonStyle(PlainButtonStyle())
        .background(
            // Less blurry background
            Rectangle()
                .fill(.regularMaterial)
                .opacity(0.6)
        )
        .cornerRadius(20)
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(
                    LinearGradient(
                        colors: [Color.white.opacity(0.2), Color.clear],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        .sheet(isPresented: $showingDetail) {
            WaypointDetailSheet(waypoint: waypoint, locationService: locationService)
        }
    }
    
    private func formatDistance(_ distance: CLLocationDistance) -> String {
        if distance < 1000 {
            return String(format: "%.0fm", distance)
        } else {
            return String(format: "%.1fkm", distance / 1000)
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
    
    private func getBearing(from: CLLocation, to: CLLocation) -> Double {
        let lat1 = from.coordinate.latitude * .pi / 180
        let lat2 = to.coordinate.latitude * .pi / 180
        let deltaLon = (to.coordinate.longitude - from.coordinate.longitude) * .pi / 180
        
        let y = sin(deltaLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(deltaLon)
        
        let bearing = atan2(y, x) * 180 / .pi
        return (bearing + 360).truncatingRemainder(dividingBy: 360)
    }
}


// MARK: - Waypoint Detail Sheet

struct WaypointDetailSheet: View {
    let waypoint: Waypoint
    let locationService: LocationService
    @Environment(\.presentationMode) var presentationMode
    
    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                // Header with waypoint info
                VStack(spacing: 12) {
                    Image(systemName: waypoint.type.icon)
                        .font(.system(size: 50))
                        .foregroundColor(.blue)
                    
                    Text(waypoint.name)
                        .font(.title2)
                        .fontWeight(.bold)
                        .multilineTextAlignment(.center)
                    
                    if let description = waypoint.description, !description.isEmpty {
                        Text(description)
                            .font(.body)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                }
                
                // Distance and navigation info
                if let userLocation = locationService.currentLocation {
                    let distance = userLocation.distance(from: CLLocation(latitude: waypoint.location.latitude, longitude: waypoint.location.longitude))
                    
                    VStack(spacing: 16) {
                        HStack {
                            VStack(alignment: .leading) {
                                Text("distance".localized)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                Text(formatDistance(distance))
                                    .font(.title3)
                                    .fontWeight(.semibold)
                            }
                            
                            Spacer()
                            
                            VStack(alignment: .trailing) {
                                Text("type".localized)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                Text(waypoint.type.displayName)
                                    .font(.title3)
                                    .fontWeight(.semibold)
                            }
                        }
                        
                        Button("open_in_maps".localized) {
                            openInMaps()
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .padding()
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(16)
                }
                
                Spacer()
            }
            .padding()
            .navigationTitle("destination_details".localized)
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarItems(
                trailing: Button("done".localized) {
                    presentationMode.wrappedValue.dismiss()
                }
            )
        }
    }
    
    private func formatDistance(_ distance: CLLocationDistance) -> String {
        if distance < 1000 {
            return String(format: "%.0fm", distance)
        } else {
            return String(format: "%.1fkm", distance / 1000)
        }
    }
    
    private func openInMaps() {
        let coordinate = waypoint.location
        let placemark = MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude))
        let mapItem = MKMapItem(placemark: placemark)
        mapItem.name = waypoint.name
        mapItem.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
    }
}

// MARK: - Preview Provider

struct WaypointCard_Previews: PreviewProvider {
    static var previews: some View {
        // Create a sample waypoint for preview
        let sampleWaypoint = Waypoint(
            groupId: "preview-group",
            name: "Sample Destination",
            description: "A sample waypoint for preview",
            type: .checkpoint,
            location: GeoPoint(latitude: 37.7749, longitude: -122.4194),
            createdBy: "preview-user",
            order: 0
        )
        
        WaypointCard(
            waypoint: sampleWaypoint,
            locationService: LocationService(),
            isLeader: true,
            onTap: {},
            onComplete: {},
            onDelete: {}
        )
        .padding()
        .previewLayout(.sizeThatFits)
    }
}