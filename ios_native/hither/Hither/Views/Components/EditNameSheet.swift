//
//  EditNameSheet.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import SwiftUI
import FirebaseFirestore

struct EditNameSheet: View {
    @ObservedObject var groupService: GroupService
    @ObservedObject var authService: AuthenticationService
    @EnvironmentObject private var languageService: LanguageService
    @EnvironmentObject private var themeManager: ThemeManager
    @Environment(\.presentationMode) var presentationMode
    @State private var newDisplayName = ""
    @State private var selectedEmoji: String?
    @State private var showingEmojiPicker = false
    @State private var isLoading = false
    @State private var errorMessage: String?
    
    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Text("edit_nickname_title".localized)
                        .font(.title2)
                        .fontWeight(.semibold)
                    
                    Text("update_nickname_subtitle".localized)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("nickname_label".localized)
                            .font(.headline)
                        
                        TextField("enter_nickname_placeholder".localized, text: $newDisplayName)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                    }
                    
                    VStack(alignment: .leading, spacing: 8) {
                        Text("avatar_emoji_label".localized)
                            .font(.headline)
                        
                        HStack {
                            Button(action: {
                                showingEmojiPicker = true
                            }) {
                                HStack {
                                    if let emoji = selectedEmoji {
                                        Text(emoji)
                                            .font(.title)
                                    } else {
                                        Image(systemName: "person.circle")
                                            .font(.title)
                                            .foregroundColor(.gray)
                                    }
                                    Text(selectedEmoji != nil ? "change_avatar".localized : "select_avatar".localized)
                                        .foregroundColor(.blue)
                                }
                                .padding()
                                .background(Color.gray.opacity(0.1))
                                .cornerRadius(8)
                            }
                            
                            if selectedEmoji != nil {
                                Button("remove_avatar".localized) {
                                    selectedEmoji = nil
                                }
                                .foregroundColor(.red)
                            }
                        }
                    }
                }
                .onAppear {
                    // Load current member's data
                    if let group = groupService.currentGroup,
                       let user = authService.currentUser,
                       let member = group.members.first(where: { $0.userId == user.id }) {
                        newDisplayName = member.nickname ?? member.displayName
                        selectedEmoji = member.avatarEmoji
                    }
                }
                
                if let errorMessage = errorMessage {
                    Text(errorMessage)
                        .foregroundColor(.red)
                        .font(.caption)
                        .multilineTextAlignment(.center)
                }
                
                Button(action: {
                    Task {
                        await updateDisplayName()
                    }
                }) {
                    if isLoading {
                        SheepProgressView(tint: .white)
                    } else {
                        Text("update_nickname_button".localized)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(newDisplayName.isEmpty ? Color.gray : Color.blue)
                .foregroundColor(.white)
                .cornerRadius(8)
                .disabled(newDisplayName.isEmpty || isLoading)
                
                Spacer()
            }
            .padding()
            .navigationTitle("edit_nickname_title".localized)
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarItems(
                trailing: Button("cancel".localized) {
                    presentationMode.wrappedValue.dismiss()
                }
            )
            .sheet(isPresented: $showingEmojiPicker) {
                EmojiAvatarPicker(currentEmoji: selectedEmoji) { emoji in
                    selectedEmoji = emoji
                }
            }
        }
    }
    
    private func updateDisplayName() async {
        guard let user = authService.currentUser,
              let group = groupService.currentGroup else { return }
        
        isLoading = true
        errorMessage = nil
        
        do {
            // Update Firebase using the correct subcollection structure
            // Update the specific user's data in the users subcollection
            var updateData: [String: Any] = [
                "nickname": newDisplayName,
                "displayName": newDisplayName  // Also update displayName for consistency
            ]
            
            // Add or remove avatar emoji
            if let emoji = selectedEmoji {
                updateData["avatarEmoji"] = emoji
            } else {
                updateData["avatarEmoji"] = FieldValue.delete()
            }
            
            // Update the user document in the users subcollection
            try await Firestore.firestore()
                .collection("groups")
                .document(group.id)
                .collection("users")
                .document(user.id)
                .updateData(updateData)
            
            print("✅ Successfully updated nickname to: \(newDisplayName) and avatar emoji to: \(selectedEmoji ?? "none") for user: \(user.id) in users subcollection")
            
            // Refresh group data to ensure UI updates immediately
            await groupService.refreshCurrentGroup()
            
            presentationMode.wrappedValue.dismiss()
            
        } catch {
            errorMessage = "Failed to update nickname: \(error.localizedDescription)"
            print("❌ Failed to update nickname: \(error.localizedDescription)")
        }
        
        isLoading = false
    }
}