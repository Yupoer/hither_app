//
//  MapTypes.swift
//  Hither
//
//  Shared types for map components
//

import SwiftUI
import CoreLocation

// MARK: - Map Annotation Types

struct MemberAnnotation: Identifiable {
    let id = UUID()
    let member: GroupMember
    let coordinate: CLLocationCoordinate2D
}

enum RouteEndpointType {
    case start
    case end
}

struct MapViewAnnotationItem: Identifiable {
    let id = UUID()
    let coordinate: CLLocationCoordinate2D
    let member: GroupMember?
    let waypoint: Waypoint?
    let isMember: Bool
    let isRouteEndpoint: Bool
    let routeEndpointType: RouteEndpointType?
    
    init(coordinate: CLLocationCoordinate2D, member: GroupMember?, waypoint: Waypoint?, isMember: Bool, isRouteEndpoint: Bool = false, routeEndpointType: RouteEndpointType? = nil) {
        self.coordinate = coordinate
        self.member = member
        self.waypoint = waypoint
        self.isMember = isMember
        self.isRouteEndpoint = isRouteEndpoint
        self.routeEndpointType = routeEndpointType
    }
}

// MARK: - Map Annotation Views

struct MemberAnnotationView: View {
    let member: GroupMember
    @State private var showIcon = false
    
    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                // Show emoji avatar if available
                if let emoji = member.avatarEmoji {
                    Text(emoji)
                        .font(.title)
                        .frame(width: 30, height: 30)
                        .background(Color.white.opacity(0.9))
                        .clipShape(Circle())
                        .shadow(color: Color.black.opacity(0.3), radius: 2)
                        .scaleEffect(showIcon ? 1.2 : 1.0)
                        .animation(.easeInOut(duration: 0.3), value: showIcon)
                }
                
                // Status indicator overlay
                if member.status != .normal {
                    VStack {
                        HStack {
                            Spacer()
                            Text(member.status.emoji)
                                .font(.caption)
                                .frame(width: 16, height: 16)
                                .background(Color.white.opacity(0.9))
                                .clipShape(Circle())
                                .overlay(
                                    Circle()
                                        .stroke(Color.gray.opacity(0.3), lineWidth: 0.5)
                                )
                                .shadow(color: Color.black.opacity(0.2), radius: 1)
                                .offset(x: 4, y: -4) // Position in top-right
                        }
                        Spacer()
                    }
                    .frame(width: 30, height: 30)
                }
            }
            
            Text(member.nickname ?? member.displayName)
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(.primary)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(Color(.systemBackground).opacity(0.9))
                .cornerRadius(6)
                .shadow(color: Color.black.opacity(0.3), radius: 2)
        }
    }
}

struct WaypointAnnotationView: View {
    let waypoint: Waypoint
    
    var body: some View {
        VStack(spacing: 2) {
            // Small invisible spacer to move text below the coordinate point
            Spacer()
                .frame(height: 10)
            
            Text(waypoint.name)
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(.primary)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(Color(.systemBackground).opacity(0.9))
                .cornerRadius(6)
                .shadow(color: Color.black.opacity(0.3), radius: 2)
        }
    }
}

struct RouteEndpointAnnotationView: View {
    let type: RouteEndpointType
    
    var body: some View {
        ZStack {
            Circle()
                .fill(type == .start ? Color.green : Color.red)
                .frame(width: 20, height: 20)
            
            Image(systemName: type == .start ? "play.fill" : "flag.fill")
                .foregroundColor(.white)
                .font(.system(size: 10, weight: .bold))
        }
        .shadow(color: .black.opacity(0.3), radius: 2)
    }
}