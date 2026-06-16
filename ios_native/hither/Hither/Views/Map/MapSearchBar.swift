//
//  MapSearchBar.swift
//  Hither
//
//  Search bar with Google Places autocomplete
//

import SwiftUI
import CoreLocation

struct MapSearchBar: View {
    @Binding var searchText: String
    @State private var searchResults: [PlaceResult] = []
    @State private var isSearching = false
    @State private var showingResults = false
    
    let onLocationSelected: (CLLocationCoordinate2D, String) -> Void
    
    @StateObject private var googleMapsService = GoogleMapsService.shared
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        VStack(spacing: 0) {
            // Search input field
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                    .font(.system(size: 16))
                
                TextField("search_location".localized, text: $searchText)
                    .textFieldStyle(PlainTextFieldStyle())
                    .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).foreground)
                    .onSubmit {
                        performSearch()
                    }
                    .onChange(of: searchText) { oldValue, newValue in
                        if newValue.isEmpty {
                            clearResults()
                        } else if newValue.count > 2 {
                            debounceSearch()
                        }
                    }
                
                if isSearching {
                    ProgressView()
                        .scaleEffect(0.8)
                } else if !searchText.isEmpty {
                    Button(action: clearSearch) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                            .font(.system(size: 16))
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(DarkBlueTheme(isDark: colorScheme == .dark).card)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(DarkBlueTheme(isDark: colorScheme == .dark).border, lineWidth: 1)
            )
            .shadow(
                color: DarkBlueTheme(isDark: colorScheme == .dark).shadowColor,
                radius: 4,
                y: 2
            )
            
            // Search results dropdown
            if showingResults && !searchResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(searchResults.prefix(5)) { result in
                        SearchResultRow(result: result) {
                            selectLocation(result)
                        }
                        
                        if result.id != searchResults.prefix(5).last?.id {
                            Divider()
                                .background(DarkBlueTheme(isDark: colorScheme == .dark).border)
                        }
                    }
                }
                .background(DarkBlueTheme(isDark: colorScheme == .dark).card)
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(DarkBlueTheme(isDark: colorScheme == .dark).border, lineWidth: 1)
                )
                .shadow(
                    color: DarkBlueTheme(isDark: colorScheme == .dark).shadowColor,
                    radius: 8,
                    y: 4
                )
                .padding(.top, 4)
            }
        }
    }
    
    private func debounceSearch() {
        // Simple debouncing - cancel previous search and start new one after delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            if !searchText.isEmpty {
                performSearch()
            }
        }
    }
    
    private func performSearch() {
        guard !searchText.isEmpty, !isSearching else { return }
        
        isSearching = true
        showingResults = false
        
        Task {
            do {
                let results = try await googleMapsService.searchPlaces(query: searchText)
                await MainActor.run {
                    self.searchResults = results
                    self.showingResults = true
                    self.isSearching = false
                }
            } catch {
                await MainActor.run {
                    self.isSearching = false
                    // Handle error silently for now
                    print("Search error: \(error)")
                }
            }
        }
    }
    
    private func selectLocation(_ result: PlaceResult) {
        Task {
            do {
                let details = try await googleMapsService.getPlaceDetails(placeId: result.place_id)
                await MainActor.run {
                    onLocationSelected(details.geometry.location.coordinate, details.name)
                    searchText = details.name
                    clearResults()
                }
            } catch {
                print("Error getting place details: \(error)")
            }
        }
    }
    
    private func clearSearch() {
        searchText = ""
        clearResults()
    }
    
    private func clearResults() {
        searchResults = []
        showingResults = false
        isSearching = false
    }
}

struct SearchResultRow: View {
    let result: PlaceResult
    let onTap: () -> Void
    
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Image(systemName: "location")
                    .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).primary)
                    .font(.system(size: 16))
                    .frame(width: 20)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(result.structured_formatting?.main_text ?? result.description)
                        .font(.body)
                        .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).foreground)
                        .lineLimit(1)
                    
                    if let secondaryText = result.structured_formatting?.secondary_text {
                        Text(secondaryText)
                            .font(.caption)
                            .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).mutedForeground)
                            .lineLimit(1)
                    }
                }
                
                Spacer()
                
                Image(systemName: "arrow.up.left")
                    .foregroundColor(.secondary)
                    .font(.caption)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

