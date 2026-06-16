//
//  PlaceholderBottomSheetContent.swift
//  Hither
//
//  Placeholder content for bottom sheet when no waypoints exist
//

import SwiftUI

struct PlaceholderBottomSheetContent: View {
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
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
    
    private var collapsedContent: some View {
        HStack(spacing: 12) {
            Image(systemName: "location.circle")
                .foregroundColor(.blue)
                .font(.title2)
                .frame(width: 28)
            
            VStack(alignment: .leading, spacing: 2) {
                Text("No destinations set")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)
            }
            
            Spacer()
        }
    }
    
    private var halfExpandedContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Image(systemName: "location.circle")
                    .foregroundColor(.blue)
                    .font(.title2)
                    .frame(width: 28)
                
                VStack(alignment: .leading, spacing: 4) {
                    Text("Ready to explore")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.blue)
                    
                    Text("No destinations set")
                        .font(.title3)
                        .fontWeight(.semibold)
                        .foregroundColor(.primary)
                }
                
                Spacer()
            }
            
            Text("Add waypoints to your itinerary to see directions and navigation options here.")
                .font(.body)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            
            // Action buttons
            HStack(spacing: 12) {
                Button(action: {
                    // Navigate to itinerary view
                }) {
                    HStack(spacing: 8) {
                        Image(systemName: "plus")
                        Text("Add Destination")
                            .fontWeight(.medium)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Color.blue)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                
                Spacer()
            }
        }
    }
    
    private var fullyExpandedContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Divider()
            
            VStack(alignment: .leading, spacing: 8) {
                Text("Getting Started")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                Text("To start navigating with your group, add destinations to your itinerary. You can:")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            
            VStack(alignment: .leading, spacing: 12) {
                FeatureRow(
                    icon: "plus.circle.fill",
                    title: "Add destinations",
                    description: "Set waypoints for your group journey"
                )
                
                FeatureRow(
                    icon: "location.fill",
                    title: "Real-time tracking",
                    description: "See everyone's location on the map"
                )
                
                FeatureRow(
                    icon: "arrow.triangle.turn.up.right.diamond.fill",
                    title: "Get directions",
                    description: "Navigate to each destination with turn-by-turn guidance"
                )
                
                FeatureRow(
                    icon: "bell.fill",
                    title: "Stay connected",
                    description: "Receive notifications and updates from your group leader"
                )
            }
            
            Spacer(minLength: 20)
        }
    }
}

struct FeatureRow: View {
    let icon: String
    let title: String
    let description: String
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundColor(.blue)
                .font(.title3)
                .frame(width: 24)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)
                
                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            
            Spacer()
        }
    }
}