//
//  InviteSheet.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI
import CoreImage

struct InviteSheet: View {
    let group: HitherGroup
    @ObservedObject var groupService: GroupService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    @Environment(\.presentationMode) var presentationMode
    @State private var showingShareSheet = false
    @State private var qrCodeImage: UIImage?
    
    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                VStack(spacing: 16) {
                    Text(String(format: "invite_to_group".localized, group.name))
                        .font(.title2)
                        .fontWeight(.semibold)
                    
                    Text("share_code_message".localized)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                
                VStack(spacing: 16) {
                    Text(group.inviteCode)
                        .font(.largeTitle)
                        .fontWeight(.bold)
                        .foregroundColor(.blue)
                        .padding()
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(12)
                    
                    // QR Code display
                    if let qrCodeImage = qrCodeImage {
                        Image(uiImage: qrCodeImage)
                            .interpolation(.none)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 200, height: 200)
                            .background(Color.white)
                            .cornerRadius(12)
                    } else {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.gray.opacity(0.1))
                            .frame(width: 200, height: 200)
                            .overlay(
                                SheepLoadingView(message: "Generating QR Code...")
                            )
                    }
                }
                
                VStack(spacing: 12) {
                    Button("Share Invite Link") {
                        showingShareSheet = true
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(8)
                    
                    Button("Generate New Code") {
                        Task {
                            await groupService.generateNewInviteCode()
                            generateQRCode()
                        }
                    }
                    .foregroundColor(.blue)
                }
                
                Spacer()
            }
            .padding()
            .navigationTitle("Invite Members")
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarItems(
                trailing: Button("Done") {
                    presentationMode.wrappedValue.dismiss()
                }
            )
            .sheet(isPresented: $showingShareSheet) {
                ShareSheet(
                    activityItems: [shareURL, shareText]
                )
            }
            .onAppear {
                generateQRCode()
            }
        }
    }
    
    private var shareURL: URL {
        // Create deep link URL for the app
        let encodedName = group.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? group.name
        let urlString = "hither://join?code=\(group.inviteCode)&name=\(encodedName)"
        
        print("🔍 ShareURL Generation:")
        print("  - Group Name: '\(group.name)'")
        print("  - Encoded Name: '\(encodedName)'")
        print("  - Invite Code: '\(group.inviteCode)'")
        print("  - URL String: '\(urlString)'")
        
        if let primaryURL = URL(string: urlString) {
            print("  - Primary URL created successfully: \(primaryURL.absoluteString)")
            return primaryURL
        } else {
            print("  - ⚠️ Primary URL creation failed, using fallback")
            let fallbackString = "https://hither.app/join?code=\(group.inviteCode)"
            print("  - Fallback URL String: '\(fallbackString)'")
            return URL(string: fallbackString)!
        }
    }
    
    private var shareText: String {
        "Join my group '\(group.name)' on Hither! Use invite code: \(group.inviteCode) or click this link: \(shareURL.absoluteString)"
    }
    
    private func generateQRCode() {
        let urlString = shareURL.absoluteString
        print("🔍 QR Code Generation Process:")
        print("  - URL String: \(urlString)")
        print("  - URL String Length: \(urlString.count)")
        
        guard let qrCodeData = urlString.data(using: .utf8) else {
            print("❌ Failed to create QR code data from URL string")
            return
        }
        
        print("  - Data Size: \(qrCodeData.count) bytes")
        print("  - Data String: \(String(data: qrCodeData, encoding: .utf8) ?? "Unable to convert back")")
        
        guard let qrFilter = CIFilter(name: "CIQRCodeGenerator") else {
            print("❌ Failed to create QR filter - CIQRCodeGenerator not available")
            return
        }
        
        print("  - QR Filter created successfully")
        
        qrFilter.setValue(qrCodeData, forKey: "inputMessage")
        qrFilter.setValue("H", forKey: "inputCorrectionLevel")
        
        print("  - QR Filter configured with data and correction level H")
        
        guard let qrCodeCIImage = qrFilter.outputImage else {
            print("❌ Failed to generate QR code image from filter")
            print("  - Filter parameters: \(qrFilter.attributes)")
            return
        }
        
        print("  - QR Code CIImage generated successfully")
        print("  - Original extent: \(qrCodeCIImage.extent)")
        
        // Scale up the QR code
        let targetSize: CGFloat = 200
        let scaleX = targetSize / qrCodeCIImage.extent.size.width
        let scaleY = targetSize / qrCodeCIImage.extent.size.height
        
        print("  - Scale factors: X=\(scaleX), Y=\(scaleY)")
        
        let scaledQRImage = qrCodeCIImage.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
        
        print("  - Scaled extent: \(scaledQRImage.extent)")
        
        let context = CIContext()
        guard let cgImage = context.createCGImage(scaledQRImage, from: scaledQRImage.extent) else {
            print("❌ Failed to create CG image from scaled QR image")
            return
        }
        
        print("  - CGImage created successfully")
        
        let finalImage = UIImage(cgImage: cgImage)
        print("  - Final UIImage size: \(finalImage.size)")
        
        DispatchQueue.main.async {
            self.qrCodeImage = finalImage
            print("✅ QR Code generated and assigned successfully")
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]
    
    func makeUIViewController(context: Context) -> UIActivityViewController {
        let activityViewController = UIActivityViewController(
            activityItems: activityItems,
            applicationActivities: nil
        )
        return activityViewController
    }
    
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {
        // No update needed
    }
}