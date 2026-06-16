//
//  RouteMapView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI
import MapKit
import CoreLocation

struct RouteMapView: UIViewRepresentable {
    @Binding var region: MKCoordinateRegion
    let mapType: MKMapType
    let annotations: [MapViewAnnotationItem]
    let currentRoute: MKRoute?
    let userLocation: CLLocation?
    let onRegionChange: ((MKCoordinateRegion) -> Void)?
    let shouldUseTiltedCamera: Bool
    
    func makeUIView(context: Context) -> MKMapView {
        let mapView = MKMapView()
        mapView.delegate = context.coordinator
        mapView.showsUserLocation = true
        mapView.userTrackingMode = .none
        mapView.mapType = mapType
        
        // Configure tilted camera if requested
        if shouldUseTiltedCamera {
            configureTiltedCamera(for: mapView)
        }
        
        return mapView
    }
    
    func updateUIView(_ mapView: MKMapView, context: Context) {
        // Update map type
        mapView.mapType = mapType
        
        // Update region with camera configuration
        if !mapView.region.center.isEqual(to: region.center, tolerance: 0.0001) {
            if shouldUseTiltedCamera {
                updateRegionWithTiltedCamera(mapView: mapView, region: region)
            } else {
                mapView.setRegion(region, animated: true)
            }
        }
        
        // Update annotations with better comparison to avoid flashing
        let existingAnnotations = mapView.annotations.compactMap { $0 as? RouteMapAnnotation }
        let newAnnotationMap = Dictionary(uniqueKeysWithValues: annotations.map { ($0.id, $0) })
        let existingAnnotationMap = Dictionary(uniqueKeysWithValues: existingAnnotations.map { ($0.id, $0) })
        
        // Remove annotations that are no longer needed
        let annotationsToRemove = existingAnnotations.filter { !newAnnotationMap.keys.contains($0.id) }
        if !annotationsToRemove.isEmpty {
            mapView.removeAnnotations(annotationsToRemove)
        }
        
        // Add new annotations (only truly new ones)
        let annotationsToAdd = annotations.filter { !existingAnnotationMap.keys.contains($0.id) }
        if !annotationsToAdd.isEmpty {
            let mapAnnotations = annotationsToAdd.map { RouteMapAnnotation(from: $0) }
            mapView.addAnnotations(mapAnnotations)
        }
        
        // Update existing annotations with new data if their coordinates changed
        for existingAnnotation in existingAnnotations {
            if let newAnnotationItem = newAnnotationMap[existingAnnotation.id] {
                let newCoordinate = newAnnotationItem.coordinate
                let currentCoordinate = existingAnnotation.coordinate
                
                // Only update if coordinates have changed significantly
                if !currentCoordinate.isEqual(to: newCoordinate, tolerance: 0.00001) {
                    // Remove and re-add annotation with new coordinate for smooth update
                    mapView.removeAnnotation(existingAnnotation)
                    let updatedAnnotation = RouteMapAnnotation(from: newAnnotationItem)
                    mapView.addAnnotation(updatedAnnotation)
                }
            }
        }
        
        // Update route overlay
        context.coordinator.updateRoute(mapView: mapView, route: currentRoute)
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    // MARK: - Camera Configuration Methods
    
    private func configureTiltedCamera(for mapView: MKMapView) {
        let camera = MKMapCamera()
        camera.centerCoordinate = region.center
        camera.pitch = 70.0 // 70 degree tilt
        camera.altitude = 1000.0 // Appropriate altitude for the zoom level
        camera.heading = 0.0 // North-facing initially
        
        mapView.setCamera(camera, animated: false)
    }
    
    private func updateRegionWithTiltedCamera(mapView: MKMapView, region: MKCoordinateRegion) {
        let camera = MKMapCamera()
        camera.centerCoordinate = region.center
        camera.pitch = 70.0 // Maintain 70 degree tilt
        
        // Calculate altitude based on region span
        let spanInMeters = max(region.span.latitudeDelta, region.span.longitudeDelta) * 111000.0 // Convert degrees to meters
        camera.altitude = max(500.0, min(10000.0, spanInMeters * 2)) // Reasonable altitude range
        
        // Preserve existing heading if possible
        camera.heading = mapView.camera.heading
        
        mapView.setCamera(camera, animated: true)
    }
    
    class Coordinator: NSObject, MKMapViewDelegate {
        var parent: RouteMapView
        private var currentRouteOverlay: MKPolyline?
        
        init(_ parent: RouteMapView) {
            self.parent = parent
        }
        
        func updateRoute(mapView: MKMapView, route: MKRoute?) {
            // Remove existing route overlay
            if let existingOverlay = currentRouteOverlay {
                mapView.removeOverlay(existingOverlay)
                currentRouteOverlay = nil
            }
            
            // Add new route overlay
            if let route = route {
                let polyline = route.polyline
                mapView.addOverlay(polyline)
                currentRouteOverlay = polyline
            }
        }
        
        // MARK: - MKMapViewDelegate
        
        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard let mapAnnotation = annotation as? RouteMapAnnotation else {
                return nil
            }
            
            let identifier = mapAnnotation.isMember ? "MemberAnnotation" : "WaypointAnnotation"
            
            var annotationView = mapView.dequeueReusableAnnotationView(withIdentifier: identifier)
            if annotationView == nil {
                annotationView = MKAnnotationView(annotation: annotation, reuseIdentifier: identifier)
                annotationView?.canShowCallout = true
            } else {
                annotationView?.annotation = annotation
                // Clear previous subviews to avoid accumulation
                annotationView?.subviews.forEach { $0.removeFromSuperview() }
            }
            
            // Always create fresh content to ensure it's up to date
            if mapAnnotation.isRouteEndpoint {
                let endpointView = RouteEndpointAnnotationView(type: mapAnnotation.routeEndpointType ?? .start)
                let hostingController = UIHostingController(rootView: endpointView)
                hostingController.view.backgroundColor = UIColor.clear
                annotationView?.addSubview(hostingController.view)
                
                // Set frame
                hostingController.view.frame = CGRect(x: -15, y: -15, width: 30, height: 30)
            } else if mapAnnotation.isMember {
                if let member = mapAnnotation.member {
                    let memberView = MemberAnnotationView(member: member)
                    let hostingController = UIHostingController(rootView: memberView)
                    hostingController.view.backgroundColor = UIColor.clear
                    annotationView?.addSubview(hostingController.view)
                    
                    // Set frame for text annotation with spacer
                    hostingController.view.frame = CGRect(x: -30, y: -5, width: 60, height: 40)
                }
            } else {
                if let waypoint = mapAnnotation.waypoint {
                    let waypointView = WaypointAnnotationView(waypoint: waypoint)
                    let hostingController = UIHostingController(rootView: waypointView)
                    hostingController.view.backgroundColor = UIColor.clear
                    annotationView?.addSubview(hostingController.view)
                    
                    // Set frame for text annotation with spacer
                    hostingController.view.frame = CGRect(x: -40, y: -5, width: 80, height: 40)
                }
            }
            
            return annotationView
        }
        
        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let polyline = overlay as? MKPolyline {
                let renderer = MKPolylineRenderer(polyline: polyline)
                renderer.strokeColor = UIColor.systemBlue
                renderer.lineWidth = 5.0
                renderer.lineCap = .round
                renderer.lineJoin = .round
                renderer.alpha = 0.8
                return renderer
            }
            return MKOverlayRenderer()
        }
        
        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            // Notify parent about region changes so it can handle user interaction
            parent.onRegionChange?(mapView.region)
        }
    }
}

class RouteMapAnnotation: NSObject, MKAnnotation {
    let id: UUID
    let coordinate: CLLocationCoordinate2D
    let member: GroupMember?
    let waypoint: Waypoint?
    let isMember: Bool
    let isRouteEndpoint: Bool
    let routeEndpointType: RouteEndpointType?
    
    var title: String? {
        if isRouteEndpoint {
            return routeEndpointType == .start ? "Start" : "End"
        } else if isMember {
            return member?.displayName
        } else {
            return waypoint?.name
        }
    }
    
    init(from item: MapViewAnnotationItem) {
        self.id = item.id
        self.coordinate = item.coordinate
        self.member = item.member
        self.waypoint = item.waypoint
        self.isMember = item.isMember
        self.isRouteEndpoint = item.isRouteEndpoint
        self.routeEndpointType = item.routeEndpointType
        super.init()
    }
}

extension CLLocationCoordinate2D {
    func isEqual(to other: CLLocationCoordinate2D, tolerance: Double) -> Bool {
        return abs(self.latitude - other.latitude) < tolerance &&
               abs(self.longitude - other.longitude) < tolerance
    }
}