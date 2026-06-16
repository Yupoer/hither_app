//
//  DevelopmentLocationSheet.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI
import CoreLocation

struct DevelopmentLocationSheet: View {
    @ObservedObject var developmentService: DevelopmentService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    @Environment(\.presentationMode) var presentationMode
    @State private var selectedLocation: CLLocationCoordinate2D?
    @State private var selectedLocationName: String = ""
    @State private var showingSuccessMessage = false
    
    var body: some View {
        ZStack {
            LocationSelectionSheet(
                selectedLocation: $selectedLocation,
                selectedLocationName: $selectedLocationName,
                onLocationSelected: { coordinate, name in
                    let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
                    developmentService.setSpoofedLocation(location)
                    
                    // Show success feedback
                    showingSuccessMessage = true
                    
                    // Dismiss after showing success
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                        presentationMode.wrappedValue.dismiss()
                    }
                },
                onDismiss: {
                    presentationMode.wrappedValue.dismiss()
                }
            )
            
            // Success message overlay
            if showingSuccessMessage {
                VStack {
                    Spacer()
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("Location updated!")
                            .fontWeight(.medium)
                    }
                    .padding()
                    .background(Color(.systemBackground).opacity(0.9))
                    .cornerRadius(12)
                    .shadow(radius: 8)
                    .padding(.bottom, 100)
                }
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.3), value: showingSuccessMessage)
            }
        }
        .onAppear {
            // Pre-populate with current spoofed location if exists
            if let currentLocation = developmentService.spoofedLocation {
                selectedLocation = currentLocation.coordinate
                selectedLocationName = "Current Spoofed Location"
            }
        }
    }
}