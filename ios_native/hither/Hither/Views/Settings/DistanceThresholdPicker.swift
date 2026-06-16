//
//  DistanceThresholdPicker.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct DistanceThresholdPicker: View {
    let currentThreshold: Int
    let onThresholdSelected: (Int) -> Void
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    @Environment(\.presentationMode) var presentationMode
    
    private let distances = [25, 50, 100, 150, 200, 300, 500, 1000]
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    VStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 50))
                            .foregroundColor(.orange)
                        
                        Text("distance_alert_threshold".localized)
                            .font(.title2)
                            .fontWeight(.semibold)
                        
                        Text("select_distance_threshold".localized)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.bottom, 20)
                    
                    VStack(spacing: 12) {
                        ForEach(distances, id: \.self) { distance in
                            Button(action: {
                                onThresholdSelected(distance)
                                presentationMode.wrappedValue.dismiss()
                            }) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("\(distance)m")
                                            .font(.headline)
                                            .foregroundColor(.primary)
                                        
                                        Text(getDistanceDescription(distance))
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    
                                    Spacer()
                                    
                                    if distance == currentThreshold {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundColor(.blue)
                                    } else {
                                        Image(systemName: "circle")
                                            .foregroundColor(.gray)
                                    }
                                }
                                .padding()
                                .background(distance == currentThreshold ? Color.blue.opacity(0.1) : Color.gray.opacity(0.05))
                                .cornerRadius(12)
                            }
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Distance Alert")
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarItems(
                trailing: Button("Done") {
                    presentationMode.wrappedValue.dismiss()
                }
            )
        }
    }
    
    private func getDistanceDescription(_ distance: Int) -> String {
        switch distance {
        case 25: return "Very close - for tight groups"
        case 50: return "Close - good for crowded areas"
        case 100: return "Default - balanced setting"
        case 150: return "Medium - some freedom"
        case 200: return "Loose - open areas"
        case 300: return "Wide - large open spaces"
        case 500: return "Very wide - hiking trails"
        case 1000: return "Maximum - emergency only"
        default: return ""
        }
    }
}