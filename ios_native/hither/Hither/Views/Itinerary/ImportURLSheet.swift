//
//  ImportURLSheet.swift
//  Hither
//
//  Created by Claude on 2025/7/29.
//

import SwiftUI
import CoreLocation

struct ImportURLSheet: View {
    @Environment(\.presentationMode) var presentationMode
    @State private var urlText = ""
    @State private var parsedLocation: GoogleMapsParser.ParsedLocation?
    @State private var showingError = false
    @State private var errorMessage = ""
    @State private var isLoading = false
    
    let onImport: (CLLocationCoordinate2D, String) -> Void
    
    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Paste Google Maps URL")
                        .font(.headline)
                    
                    Text("Paste a Google Maps link to automatically import location as a waypoint")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    TextField("https://maps.google.com/...", text: $urlText)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .onChange(of: urlText) { newValue in
                            parseURL(newValue)
                        }
                }
                
                if let location = parsedLocation {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Location Found!")
                                .font(.headline)
                                .foregroundColor(.green)
                        }
                        
                        VStack(alignment: .leading, spacing: 4) {
                            if let name = location.name {
                                Text("Name: \(name)")
                                    .font(.subheadline)
                            }
                            
                            Text("Coordinates: \(String(format: "%.6f", location.coordinate.latitude)), \(String(format: "%.6f", location.coordinate.longitude))")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        
                        Button(action: importLocation) {
                            HStack {
                                Image(systemName: "plus.circle.fill")
                                Text("Import as Waypoint")
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(8)
                        }
                        .disabled(isLoading)
                    }
                    .padding()
                    .background(Color.green.opacity(0.1))
                    .cornerRadius(12)
                }
                
                if showingError {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.orange)
                            Text("Unable to Parse URL")
                                .font(.headline)
                                .foregroundColor(.orange)
                        }
                        
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        Text("Supported formats:")
                            .font(.caption)
                            .fontWeight(.medium)
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text("• https://maps.google.com/maps?q=lat,lng")
                            Text("• https://www.google.com/maps/@lat,lng,zoom")
                            Text("• https://maps.google.com/maps/place/Name/@lat,lng,zoom")
                        }
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    }
                    .padding()
                    .background(Color.orange.opacity(0.1))
                    .cornerRadius(12)
                }
                
                Spacer()
            }
            .padding()
            .navigationTitle("Import from Google Maps")
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarItems(
                leading: Button("Cancel") {
                    presentationMode.wrappedValue.dismiss()
                }
            )
        }
    }
    
    private func parseURL(_ urlString: String) {
        guard !urlString.isEmpty else {
            parsedLocation = nil
            showingError = false
            return
        }
        
        // Add slight delay to avoid parsing while user is still typing
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            if urlString == urlText { // Only parse if URL hasn't changed
                performParsing(urlString)
            }
        }
    }
    
    private func performParsing(_ urlString: String) {
        if let location = GoogleMapsParser.parseGoogleMapsURL(urlString) {
            if GoogleMapsParser.isValidCoordinate(location.coordinate) {
                parsedLocation = location
                showingError = false
            } else {
                showParsingError("Invalid coordinates found in URL")
            }
        } else {
            showParsingError("Could not extract location from this URL. Please check the format and try again.")
        }
    }
    
    private func showParsingError(_ message: String) {
        parsedLocation = nil
        errorMessage = message
        showingError = true
    }
    
    private func importLocation() {
        guard let location = parsedLocation else { return }
        
        isLoading = true
        
        let locationName = location.name ?? "Imported Location"
        onImport(location.coordinate, locationName)
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            presentationMode.wrappedValue.dismiss()
        }
    }
}

struct ImportURLSheet_Previews: PreviewProvider {
    static var previews: some View {
        ImportURLSheet { coordinate, name in
            print("Imported: \(name) at \(coordinate)")
        }
    }
}