//
//  NativeQRScannerView.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI

struct NativeQRScannerView: View {
    @ObservedObject var groupService: GroupService
    @ObservedObject var authService: AuthenticationService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    @Binding var isPresented: Bool
    @State private var scannedCode: String?
    @State private var showingJoinAlert = false
    @State private var errorMessage: String?
    @State private var showingNativeScannerTip = true
    
    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                if showingNativeScannerTip {
                    VStack(spacing: 20) {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.blue)
                        
                        Text("scan_qr_with_camera".localized)
                            .font(.title2)
                            .fontWeight(.semibold)
                        
                        Text("camera_instructions".localized)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                        
                        VStack(alignment: .leading, spacing: 12) {
                            Text("instructions_header".localized)
                                .font(.headline)
                                .foregroundColor(.primary)
                            
                            HStack(alignment: .top, spacing: 12) {
                                Text("step_1".localized)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.blue)
                                Text("open_camera_app".localized)
                                    .font(.subheadline)
                                Spacer()
                            }
                            
                            HStack(alignment: .top, spacing: 12) {
                                Text("step_2".localized)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.blue)
                                Text("point_camera_at_qr".localized)
                                    .font(.subheadline)
                                Spacer()
                            }
                            
                            HStack(alignment: .top, spacing: 12) {
                                Text("step_3".localized)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.blue)
                                Text("tap_notification".localized)
                                    .font(.subheadline)
                                Spacer()
                            }
                            
                            HStack(alignment: .top, spacing: 12) {
                                Text("step_4".localized)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.blue)
                                Text("select_open_in_hither".localized)
                                    .font(.subheadline)
                                Spacer()
                            }
                        }
                        .padding()
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(12)
                        .padding(.horizontal)
                        
                        Button("Open Camera App") {
                            openCameraApp()
                        }
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                        .padding(.horizontal)
                    }
                }
                
                if let errorMessage = errorMessage {
                    Text(errorMessage)
                        .foregroundColor(.red)
                        .font(.caption)
                        .padding()
                        .background(Color.red.opacity(0.1))
                        .cornerRadius(8)
                }
                
                Spacer()
            }
            .padding()
            .navigationTitle("Scan QR Code")
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarItems(
                trailing: Button("Done") {
                    isPresented = false
                }
            )
            .alert("Join Group", isPresented: $showingJoinAlert) {
                Button("Join") {
                    if let code = scannedCode,
                       let user = authService.currentUser {
                        Task {
                            await groupService.joinGroup(
                                inviteCode: code,
                                userId: user.id,
                                userName: user.displayName
                            )
                            isPresented = false
                        }
                    }
                }
                Button("Cancel", role: .cancel) {
                    scannedCode = nil
                }
            } message: {
                Text("join_group_question".localized)
            }
        }
    }
    
    private func openCameraApp() {
        print("🔍 Opening Camera App...")
        
        // Try to open the camera app
        if let cameraURL = URL(string: "camera://") {
            if UIApplication.shared.canOpenURL(cameraURL) {
                UIApplication.shared.open(cameraURL) { success in
                    print("📷 Camera app opened: \(success)")
                    if success {
                        // Close the scanner sheet as user is now using camera app
                        DispatchQueue.main.async {
                            isPresented = false
                        }
                    }
                }
            } else {
                print("❌ Cannot open camera app with URL scheme")
                // Fallback: just close the sheet and let user manually open camera
                isPresented = false
            }
        } else {
            print("❌ Invalid camera URL")
            // Fallback: just close the sheet
            isPresented = false
        }
    }
}