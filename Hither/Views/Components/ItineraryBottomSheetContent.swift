//
//  ItineraryBottomSheetContent.swift
//  Hither
//
//  Bottom sheet content for displaying waypoint information
//

import SwiftUI
import CoreLocation
import MapKit

struct ItineraryBottomSheetContent: View {
    let waypoint: Waypoint
    let locationService: LocationService
    let isCurrentDestination: Bool
    let currentIndex: Int
    let totalCount: Int
    let previewableWaypoints: [Waypoint]
    let onWaypointChange: (Int) -> Void
    
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                // Collapsed state content
                collapsedContent
                
                // Half-expanded content
                halfExpandedContent
                
                // Fully expanded content
                fullyExpandedContent
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
    }
    
    private var collapsedContent: some View {
        HStack(spacing: 12) {
            Image(systemName: waypoint.type.icon)
                .foregroundColor(.blue)
                .font(.title2)
                .frame(width: 28)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(waypoint.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)
                    .lineLimit(1)
            }
            
            Spacer()
            
            if let distance = calculateDistanceToWaypoint() {
                Text("\(Int(distance))m")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.blue)
            }
        }
    }
    
    private var halfExpandedContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Route context
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
                        .lineLimit(2)
                }
                
                Spacer()
                
                if let distance = calculateDistanceToWaypoint() {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(Int(distance))m")
                            .font(.headline)
                            .fontWeight(.bold)
                            .foregroundColor(.blue)
                        
                        Text("away")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            
            // Quick action buttons
            HStack(spacing: 12) {
                Button(action: {
                    openInMaps()
                }) {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.triangle.turn.up.right.diamond.fill")
                            .font(.system(size: 14))
                        Text("Directions")
                            .font(.system(size: 14))
                            .fontWeight(.medium)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(Color.blue)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                
                Button(action: {}) {
                    HStack(spacing: 8) {
                        Image(systemName: "phone.fill")
                        Text("Call")
                            .fontWeight(.medium)
                    }
                    .foregroundColor(.blue)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Color.blue.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                
                Spacer()
            }
            
            // Waypoint navigation
            if totalCount > 1 {
                HStack(spacing: 16) {
                    Button(action: {
                        if currentIndex > 0 {
                            onWaypointChange(currentIndex - 1)
                        }
                    }) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16))
                            .foregroundColor(currentIndex > 0 ? .primary : .secondary)
                    }
                    .disabled(currentIndex <= 0)
                    
                    HStack(spacing: 6) {
                        ForEach(0..<totalCount, id: \.self) { index in
                            Circle()
                                .fill(index == currentIndex ? Color.blue : Color.gray.opacity(0.3))
                                .frame(width: 8, height: 8)
                        }
                    }
                    
                    Button(action: {
                        if currentIndex < totalCount - 1 {
                            onWaypointChange(currentIndex + 1)
                        }
                    }) {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 16))
                            .foregroundColor(currentIndex < totalCount - 1 ? .primary : .secondary)
                    }
                    .disabled(currentIndex >= totalCount - 1)
                    
                    Spacer()
                }
            }
        }
    }
    
    private var fullyExpandedContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Divider()
            
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
            
            // Location information
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
            
            // Additional details
            VStack(alignment: .leading, spacing: 8) {
                Text("Details")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                VStack(alignment: .leading, spacing: 12) {
                    DetailRow(icon: "clock", title: "Added", value: formatDate(waypoint.createdAt))
                    DetailRow(icon: "person.fill", title: "Type", value: waypoint.type.rawValue.capitalized)
                    
                    if totalCount > 1 {
                        DetailRow(icon: "list.number", title: "Position", value: "\(currentIndex + 1) of \(totalCount)")
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
    
    private func openInMaps() {
        let coordinate = waypoint.location
        let placemark = MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude))
        let mapItem = MKMapItem(placemark: placemark)
        mapItem.name = waypoint.name
        mapItem.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
    }
}

struct DetailRow: View {
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