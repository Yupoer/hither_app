//
//  GoogleMapsNativeView.swift
//  Hither
//
//  Native Google Maps SDK for iOS implementation
//  Requires: Google Maps SDK for iOS dependency in Xcode project
//

import SwiftUI
import CoreLocation

// MARK: - Native Google Maps Integration
// Note: This implementation requires Google Maps SDK for iOS to be added as a dependency
// The SDK must be installed via Swift Package Manager or CocoaPods in Xcode

#if canImport(GoogleMaps)
import GoogleMaps

struct GoogleMapsNativeView: UIViewRepresentable {
    @Binding var region: CLLocationCoordinate2D
    @Binding var span: Double
    let mapType: GoogleMapType
    let annotations: [MapViewAnnotationItem]
    let currentRoute: GoogleRoute?
    let userLocation: CLLocation?
    let onRegionChange: ((CLLocationCoordinate2D) -> Void)?
    let shouldUseTiltedCamera: Bool
    let onMemberTap: ((GroupMember) -> Void)?
    
    func makeUIView(context: Context) -> GMSMapView {
        // Configure Google Maps with API key
        let camera = GMSCameraPosition.camera(
            withLatitude: region.latitude,
            longitude: region.longitude,
            zoom: zoomFromSpan(span),
            bearing: 0,
            viewingAngle: shouldUseTiltedCamera ? 45 : 0
        )
        
        let mapView = GMSMapView.map(withFrame: .zero, camera: camera)
        mapView.delegate = context.coordinator
        mapView.mapType = mapType.gmsMapType
        mapView.isMyLocationEnabled = true
        mapView.settings.myLocationButton = false // We have our own location button
        
        return mapView
    }
    
    func updateUIView(_ mapView: GMSMapView, context: Context) {
        // Update camera position
        let camera = GMSCameraPosition.camera(
            withLatitude: region.latitude,
            longitude: region.longitude,
            zoom: zoomFromSpan(span),
            bearing: mapView.camera.bearing,
            viewingAngle: shouldUseTiltedCamera ? 45 : 0
        )
        mapView.animate(to: camera)
        
        // Update map type
        mapView.mapType = mapType.gmsMapType
        
        // Update annotations
        context.coordinator.updateAnnotations(mapView: mapView, annotations: annotations)
        
        // Update route
        context.coordinator.updateRoute(mapView: mapView, route: currentRoute)
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    private func zoomFromSpan(_ span: Double) -> Float {
        // Convert span to Google Maps zoom level
        let zoom = max(1.0, min(20.0, log2(360.0 / span)))
        return Float(zoom)
    }
    
    class Coordinator: NSObject, GMSMapViewDelegate {
        var parent: GoogleMapsNativeView
        private var markers: [GMSMarker] = []
        private var routePolyline: GMSPolyline?
        
        init(_ parent: GoogleMapsNativeView) {
            self.parent = parent
        }
        
        func updateAnnotations(mapView: GMSMapView, annotations: [MapViewAnnotationItem]) {
            // Clear existing markers
            markers.forEach { $0.map = nil }
            markers.removeAll()
            
            // Add new markers
            for annotation in annotations {
                let marker = GMSMarker()
                marker.position = annotation.coordinate
                marker.title = annotation.member?.displayName ?? annotation.waypoint?.name ?? "Unknown"
                
                // Set custom icon based on annotation type
                if annotation.isMember {
                    // Member marker - blue with emoji if available
                    marker.icon = createMemberIcon(member: annotation.member)
                    // Store member data for tap handling
                    marker.userData = annotation.member
                } else if annotation.isRouteEndpoint {
                    // Route endpoint marker
                    marker.icon = createEndpointIcon(type: annotation.routeEndpointType)
                } else {
                    // Waypoint marker - purple
                    marker.icon = createWaypointIcon()
                }
                
                marker.map = mapView
                markers.append(marker)
            }
        }
        
        func updateRoute(mapView: GMSMapView, route: GoogleRoute?) {
            // Clear existing route
            routePolyline?.map = nil
            routePolyline = nil
            
            // Add new route
            if let route = route {
                let path = GMSMutablePath()
                for coordinate in route.polylineCoordinates {
                    path.add(coordinate)
                }
                
                routePolyline = GMSPolyline(path: path)
                routePolyline?.strokeColor = UIColor.systemBlue
                routePolyline?.strokeWidth = 5.0
                routePolyline?.map = mapView
            }
        }
        
        // MARK: - GMSMapViewDelegate
        
        func mapView(_ mapView: GMSMapView, didChange position: GMSCameraPosition) {
            parent.onRegionChange?(position.target)
        }
        
        func mapView(_ mapView: GMSMapView, didTap marker: GMSMarker) -> Bool {
            // Handle member marker taps
            if let member = marker.userData as? GroupMember {
                parent.onMemberTap?(member)
                return true // Prevent default info window
            }
            return false // Allow default behavior for other markers
        }
        
        // MARK: - Custom Icon Creation
        
        private func createMemberIcon(member: GroupMember?) -> UIImage {
            let size = CGSize(width: 30, height: 40)
            let renderer = UIGraphicsImageRenderer(size: size)
            
            return renderer.image { context in
                // Draw blue circle
                UIColor.systemBlue.setFill()
                let circle = CGRect(x: 5, y: 5, width: 20, height: 20)
                context.cgContext.fillEllipse(in: circle)
                
                // Draw white border
                UIColor.white.setStroke()
                context.cgContext.setLineWidth(2)
                context.cgContext.strokeEllipse(in: circle)
                
                // Draw emoji or default icon
                let emoji = member?.avatarEmoji ?? "👤"
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 12),
                    .foregroundColor: UIColor.white
                ]
                let textSize = emoji.size(withAttributes: attributes)
                let textRect = CGRect(
                    x: 15 - textSize.width/2,
                    y: 15 - textSize.height/2,
                    width: textSize.width,
                    height: textSize.height
                )
                emoji.draw(in: textRect, withAttributes: attributes)
            }
        }
        
        private func createEndpointIcon(type: RouteEndpointType?) -> UIImage {
            let size = CGSize(width: 20, height: 20)
            let renderer = UIGraphicsImageRenderer(size: size)
            
            return renderer.image { context in
                let color = (type == .start) ? UIColor.systemGreen : UIColor.systemRed
                color.setFill()
                
                let circle = CGRect(x: 0, y: 0, width: 20, height: 20)
                context.cgContext.fillEllipse(in: circle)
                
                // Draw white border
                UIColor.white.setStroke()
                context.cgContext.setLineWidth(2)
                context.cgContext.strokeEllipse(in: circle)
                
                // Draw icon
                let symbol = (type == .start) ? "▶" : "🏁"
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 10),
                    .foregroundColor: UIColor.white
                ]
                let textSize = symbol.size(withAttributes: attributes)
                let textRect = CGRect(
                    x: 10 - textSize.width/2,
                    y: 10 - textSize.height/2,
                    width: textSize.width,
                    height: textSize.height
                )
                symbol.draw(in: textRect, withAttributes: attributes)
            }
        }
        
        private func createWaypointIcon() -> UIImage {
            let size = CGSize(width: 30, height: 40)
            let renderer = UIGraphicsImageRenderer(size: size)
            
            return renderer.image { context in
                // Draw purple circle
                UIColor.systemPurple.setFill()
                let circle = CGRect(x: 5, y: 5, width: 20, height: 20)
                context.cgContext.fillEllipse(in: circle)
                
                // Draw white border
                UIColor.white.setStroke()
                context.cgContext.setLineWidth(2)
                context.cgContext.strokeEllipse(in: circle)
                
                // Draw waypoint icon
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 12),
                    .foregroundColor: UIColor.white
                ]
                let textSize = "📍".size(withAttributes: attributes)
                let textRect = CGRect(
                    x: 15 - textSize.width/2,
                    y: 15 - textSize.height/2,
                    width: textSize.width,
                    height: textSize.height
                )
                "📍".draw(in: textRect, withAttributes: attributes)
            }
        }
    }
}

extension GoogleMapType {
    var gmsMapType: GMSMapViewType {
        switch self {
        case .roadmap: return .normal
        case .satellite: return .satellite
        case .hybrid: return .hybrid
        case .terrain: return .terrain
        }
    }
}

#else
// Fallback implementation when Google Maps SDK is not available
struct GoogleMapsNativeView: View {
    @Binding var region: CLLocationCoordinate2D
    @Binding var span: Double
    let mapType: GoogleMapType
    let annotations: [MapViewAnnotationItem]
    let currentRoute: GoogleRoute?
    let userLocation: CLLocation?
    let onRegionChange: ((CLLocationCoordinate2D) -> Void)?
    let shouldUseTiltedCamera: Bool
    
    var body: some View {
        VStack {
            Image(systemName: "map")
                .font(.system(size: 60))
                .foregroundColor(.gray)
            Text("Google Maps SDK Required")
                .font(.headline)
                .foregroundColor(.gray)
            Text("Please add Google Maps SDK for iOS as a dependency")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.gray.opacity(0.1))
    }
}
#endif