//
//  GroupService.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation
import FirebaseFirestore
import UserNotifications

@MainActor
class GroupService: ObservableObject {
    @Published var currentGroup: HitherGroup?
    @Published var allUserGroups: [HitherGroup] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let db = Firestore.firestore()
    private var groupListener: ListenerRegistration?
    private var membersListener: ListenerRegistration?
    private var allGroupsListener: ListenerRegistration?
    
    init() {
        // Pre-warm Firebase connection for better performance
        initializeFirebaseConnection()
    }
    
    deinit {
        groupListener?.remove()
        membersListener?.remove()
        allGroupsListener?.remove()
    }
    
    // MARK: - Performance Optimization
    private func executeBatchOperation<T>(_ operation: @escaping () async throws -> T) async -> T? {
        return try? await operation()
    }
    
    // Pre-warm Firebase connection
    private func initializeFirebaseConnection() {
        Task {
            // Ping Firestore to establish connection
            _ = try? await db.collection("groups").limit(to: 1).getDocuments()
        }
    }
    
    
    func createGroup(name: String, leaderId: String, leaderName: String) async {
        isLoading = true
        errorMessage = nil
        
        let group = HitherGroup(name: name, leaderId: leaderId, leaderName: leaderName)
        
        do {
            // Create the group document with basic info only
            try await db.collection("groups").document(group.id).setData([
                "name": group.name,
                "leaderId": group.leaderId,
                "createdAt": Timestamp(date: group.createdAt),
                "inviteCode": group.inviteCode,
                "inviteExpiresAt": Timestamp(date: group.inviteExpiresAt),
                "isActive": group.isActive
            ])
            
            // Add leader to the subcollection with location data
            for member in group.members {
                try await db.collection("groups").document(group.id)
                    .collection("members").document(member.userId).setData([
                        "displayName": member.displayName,
                        "nickname": member.displayName, // Set nickname = displayName by default
                        "role": member.role.rawValue,
                        "joinedAt": Timestamp(date: member.joinedAt),
                        "lastLocationUpdate": Timestamp(date: Date()),
                        "location": [
                            "latitude": 0.0,
                            "longitude": 0.0
                        ]
                    ])
            }
            
            currentGroup = group
            startListeningToGroup(groupId: group.id)
        } catch {
            errorMessage = "Failed to create group: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    func joinGroup(inviteCode: String, userId: String, userName: String) async {
        isLoading = true
        errorMessage = nil
        
        print("🔍 Attempting to join group with invite code: \(inviteCode)")
        print("🔍 User ID: \(userId)")
        print("🔍 User Name: \(userName)")
        
        do {
            let query = db.collection("groups")
                .whereField("inviteCode", isEqualTo: inviteCode)
                .whereField("isActive", isEqualTo: true)
            
            let snapshot = try await query.getDocuments()
            
            print("🔍 Query returned \(snapshot.documents.count) documents")
            
            guard let document = snapshot.documents.first else {
                errorMessage = "Invalid invite code"
                print("❌ No matching group found for invite code: \(inviteCode)")
                isLoading = false
                return
            }
            
            let data = document.data()
            let inviteExpiresAt = (data["inviteExpiresAt"] as? Timestamp)?.dateValue() ?? Date()
            
            print("🔍 Found group: \(data["name"] as? String ?? "Unknown")")
            print("🔍 Invite expires at: \(inviteExpiresAt)")
            print("🔍 Current time: \(Date())")
            
            if inviteExpiresAt < Date() {
                errorMessage = "Invite code has expired"
                print("❌ Invite code has expired")
                isLoading = false
                return
            }
            
            // Check if user is already in the group's members subcollection
            let existingUserDoc = try await document.reference.collection("members").document(userId).getDocument()
            if existingUserDoc.exists {
                errorMessage = "You are already a member of this group"
                print("❌ User already in group")
                isLoading = false
                return
            }
            
            let newMember = GroupMember(userId: userId, displayName: userName, role: .follower)
            
            print("🔍 Creating new member: \(newMember.displayName)")
            
            // Add the new member to members subcollection
            try await document.reference.collection("members").document(userId).setData([
                "displayName": newMember.displayName,
                "nickname": newMember.displayName, // Set nickname = displayName by default
                "role": newMember.role.rawValue,
                "joinedAt": Timestamp(date: newMember.joinedAt),
                "lastLocationUpdate": Timestamp(date: Date()),
                "location": [
                    "latitude": 0.0,
                    "longitude": 0.0
                ]
            ])
            
            print("🔍 Added member to members subcollection: \(userId)")
            
            print("✅ Successfully added member to group")
            
            startListeningToGroup(groupId: document.documentID)
            
            // Start listening for command notifications for this user
            // Note: This should ideally be handled by a shared CommandService instance
            print("🔔 Starting notification listener for user: \(userId)")
        } catch {
            print("❌ Failed to join group: \(error.localizedDescription)")
            errorMessage = "Failed to join group: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    func leaveGroup(userId: String) async {
        guard let group = currentGroup else { return }
        
        isLoading = true
        errorMessage = nil
        
        do {
            let memberToRemove = group.members.first { $0.userId == userId }
            guard let member = memberToRemove else {
                errorMessage = "Member not found in group"
                isLoading = false
                return
            }
            
            print("🔍 Removing member: \(member.displayName) from group: \(group.name)")
            
            // Remove the member from the subcollection
            try await db.collection("groups").document(group.id)
                .collection("members").document(userId).delete()
            
            // Check remaining members count
            let remainingMembersSnapshot = try await db.collection("groups").document(group.id)
                .collection("members").getDocuments()
            
            print("🔍 Remaining members count: \(remainingMembersSnapshot.documents.count)")
            
            if remainingMembersSnapshot.documents.isEmpty {
                // If this was the last member, delete the group
                print("🔍 Last member leaving, deleting group")
                try await db.collection("groups").document(group.id).delete()
                print("✅ Group deleted successfully")
            } else if member.role == .leader {
                // If the leader is leaving, promote the first follower to leader
                if let firstMemberDoc = remainingMembersSnapshot.documents.first {
                    let newLeaderId = firstMemberDoc.documentID
                    print("🔍 Promoting \(newLeaderId) to leader")
                    
                    // Update the member's role to leader in subcollection
                    try await db.collection("groups").document(group.id)
                        .collection("members").document(newLeaderId).updateData([
                            "role": MemberRole.leader.rawValue
                        ])
                    
                    // Update the group's leaderId
                    try await db.collection("groups").document(group.id).updateData([
                        "leaderId": newLeaderId
                    ])
                    
                    print("✅ Successfully promoted \(newLeaderId) to leader")
                }
            }
            
            stopListeningToGroup()
            currentGroup = nil
        } catch {
            print("❌ Failed to leave group: \(error.localizedDescription)")
            errorMessage = "Failed to leave group: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    private func startListeningToGroup(groupId: String) {
        // Listen to group basic info
        groupListener = db.collection("groups").document(groupId)
            .addSnapshotListener { [weak self] documentSnapshot, error in
                Task { @MainActor in
                    if let error = error {
                        self?.errorMessage = "Failed to sync group: \(error.localizedDescription)"
                        return
                    }
                    
                    guard let document = documentSnapshot,
                          document.exists,
                          let data = document.data() else {
                        self?.currentGroup = nil
                        return
                    }
                    
                    // Parse group data and load members from subcollection
                    await self?.parseGroupFromDataWithSubcollections(groupId: groupId, data: data)
                }
            }
        
        // Listen to members subcollection for real-time updates
        membersListener = db.collection("groups").document(groupId)
            .collection("members").addSnapshotListener { [weak self] querySnapshot, error in
                Task { @MainActor in
                    if let error = error {
                        print("❌ Failed to sync members: \(error.localizedDescription)")
                        return
                    }
                    
                    // Reload group data when members change
                    if let group = self?.currentGroup {
                        let groupDoc = try? await self?.db.collection("groups").document(groupId).getDocument()
                        if let data = groupDoc?.data() {
                            await self?.parseGroupFromDataWithSubcollections(groupId: groupId, data: data)
                        }
                    }
                }
            }
    }
    
    private func stopListeningToGroup() {
        groupListener?.remove()
        groupListener = nil
        membersListener?.remove()
        membersListener = nil
    }
    
    private func parseGroupFromDataWithSubcollections(groupId: String, data: [String: Any]) async {
        print("🔍 parseGroupFromDataWithSubcollections called for groupId: \(groupId)")
        
        guard let name = data["name"] as? String else {
            print("❌ Missing or invalid 'name' field")
            return
        }
        
        guard let createdAtTimestamp = data["createdAt"] as? Timestamp else {
            print("❌ Missing or invalid 'createdAt' field")
            return
        }
        
        guard let inviteCode = data["inviteCode"] as? String else {
            print("❌ Missing or invalid 'inviteCode' field")
            return
        }
        
        guard let inviteExpiresAtTimestamp = data["inviteExpiresAt"] as? Timestamp else {
            print("❌ Missing or invalid 'inviteExpiresAt' field")
            return
        }
        
        let isActive = data["isActive"] as? Bool ?? true
        
        // Load members from subcollection to determine leader
        do {
            let membersSnapshot = try await db.collection("groups").document(groupId)
                .collection("members").getDocuments()
            
            var members: [GroupMember] = []
            let leaderId: String? = data["leaderId"] as? String
            
            for memberDoc in membersSnapshot.documents {
                let userId = memberDoc.documentID
                let memberData = memberDoc.data()
                
                guard let displayName = memberData["displayName"] as? String,
                      let roleString = memberData["role"] as? String,
                      let role = MemberRole(rawValue: roleString),
                      let joinedAtTimestamp = memberData["joinedAt"] as? Timestamp else {
                    continue
                }
                
                var location: GeoPoint? = nil
                var lastLocationUpdate: Date? = nil
                
                if let locationData = memberData["location"] as? [String: Any],
                   let lat = locationData["latitude"] as? Double,
                   let lng = locationData["longitude"] as? Double {
                    location = GeoPoint(latitude: lat, longitude: lng)
                }
                
                if let lastUpdateTimestamp = memberData["lastLocationUpdate"] as? Timestamp {
                    lastLocationUpdate = lastUpdateTimestamp.dateValue()
                }
                
                // Parse nickname and avatarEmoji from Firebase data
                let nickname = memberData["nickname"] as? String
                let avatarEmoji = memberData["avatarEmoji"] as? String
                
                let member = GroupMember(
                    id: UUID().uuidString,
                    userId: userId,
                    displayName: displayName,
                    nickname: nickname,
                    avatarEmoji: avatarEmoji,
                    role: role,
                    joinedAt: joinedAtTimestamp.dateValue(),
                    location: location,
                    lastLocationUpdate: lastLocationUpdate
                )
                
                members.append(member)
            }
            
            guard let validLeaderId = leaderId else {
                print("❌ No leader found in members subcollection")
                return
            }
            
            print("✅ Parsing group with \(members.count) members from subcollection")
            
            // Summary of parsing results
            print("✅ Parsing complete:")
            print("  - Total unique members: \(members.count)")
            print("  - Leaders: \(members.filter { $0.role == .leader }.count)")
            print("  - Followers: \(members.filter { $0.role == .follower }.count)")
            print("  - Member details:")
            for member in members {
                print("    - \(member.displayName) (ID: \(member.userId), Role: \(member.role.rawValue))")
            }
            
            // Create a properly parsed group with all the data
            let leaderName = members.first(where: { $0.role == .leader })?.displayName ?? 
                            members.first(where: { $0.userId == validLeaderId })?.displayName ?? 
                            "Unknown Leader"
            
            print("🔍 Creating HitherGroup with leaderName: '\(leaderName)'")
            
            let parsedGroup = HitherGroup(
                id: groupId,
                name: name,
                leaderId: validLeaderId,
                leaderName: leaderName,
                createdAt: createdAtTimestamp.dateValue(),
                inviteCode: inviteCode,
                inviteExpiresAt: inviteExpiresAtTimestamp.dateValue(),
                members: members,
                isActive: isActive
            )
            
            currentGroup = parsedGroup
            print("✅ Successfully created and assigned HitherGroup")
            
        } catch {
            print("❌ Failed to parse group from subcollections: \(error)")
        }
    }
    
    
    func generateNewInviteCode() async {
        guard let group = currentGroup else { return }
        
        isLoading = true
        errorMessage = nil
        
        let newInviteCode = String.generateInviteCode()
        let newExpirationDate = Date().addingTimeInterval(24 * 60 * 60)
        
        do {
            try await db.collection("groups").document(group.id).updateData([
                "inviteCode": newInviteCode,
                "inviteExpiresAt": Timestamp(date: newExpirationDate)
            ])
        } catch {
            errorMessage = "Failed to generate new invite code: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    
    func loadUserGroups(userId: String) async {
        print("🔍 Loading groups for userId: '\(userId)'")
        do {
            let query = db.collection("groups")
                .whereField("isActive", isEqualTo: true)
            
            let snapshot = try await query.getDocuments()
            print("🔍 Total active groups found: \(snapshot.documents.count)")
            
            var userGroups: [HitherGroup] = []
            
            for document in snapshot.documents {
                let data = document.data()
                let groupId = document.documentID
                let groupName = data["name"] as? String ?? "Unknown"
                
                print("🔍 Checking group '\(groupName)' (ID: \(groupId))")
                
                // Check if user exists in the members subcollection
                do {
                    let userDoc = try await db.collection("groups").document(groupId)
                        .collection("members").document(userId).getDocument()
                    
                    if userDoc.exists {
                        print("✅ Found user in group '\(groupName)'")
                        
                        if let group = await parseGroupWithSubcollections(groupId: groupId, groupData: data) {
                            userGroups.append(group)
                            print("✅ Added group '\(groupName)' to user groups")
                        } else {
                            print("❌ Failed to parse group '\(groupName)'")
                        }
                    } else {
                        print("❌ User '\(userId)' not found in group '\(groupName)'")
                    }
                } catch {
                    print("❌ Error checking user in group '\(groupName)': \(error)")
                }
            }
            
            allUserGroups = userGroups
            print("🔍 Final result: Found \(userGroups.count) groups for user '\(userId)'")
            
        } catch {
            print("❌ Failed to load user groups: \(error.localizedDescription)")
            errorMessage = "Failed to load groups: \(error.localizedDescription)"
        }
    }
    
    func startListeningToUserGroups(userId: String) {
        allGroupsListener = db.collection("groups")
            .whereField("isActive", isEqualTo: true)
            .addSnapshotListener { [weak self] querySnapshot, error in
                Task { @MainActor in
                    if let error = error {
                        self?.errorMessage = "Failed to sync groups: \(error.localizedDescription)"
                        return
                    }
                    
                    guard let documents = querySnapshot?.documents else { return }
                    
                    var userGroups: [HitherGroup] = []
                    
                    // Process groups asynchronously to check users subcollection
                    for document in documents {
                        let data = document.data()
                        let groupId = document.documentID
                        let groupName = data["name"] as? String ?? "Unknown Group"
                        
                        print("🔍 Listener checking group '\(groupName)' for user '\(userId)'")
                        
                        // Check if user exists in the members subcollection
                        do {
                            let userDoc = try await self?.db.collection("groups").document(groupId)
                                .collection("members").document(userId).getDocument()
                            
                            if userDoc?.exists == true {
                                print("✅ Found user in group '\(groupName)'")
                                
                                if let group = await self?.parseGroupWithSubcollections(groupId: groupId, groupData: data) {
                                    userGroups.append(group)
                                    print("✅   Added group '\(groupName)' to listener results")
                                } else {
                                    print("❌   Failed to parse group '\(groupName)'")
                                }
                            } else {
                                print("❌   User not found in group '\(groupName)'")
                            }
                        } catch {
                            print("❌   Error checking user in group '\(groupName)': \(error)")
                        }
                    }
                    
                    print("🔍 Listener final result: Found \(userGroups.count) groups for user '\(userId)'")
                    self?.allUserGroups = userGroups
                }
            }
    }
    
    func stopListeningToUserGroups() {
        allGroupsListener?.remove()
        allGroupsListener = nil
    }
    
    func switchToGroup(_ group: HitherGroup) {
        stopListeningToGroup()
        currentGroup = group
        startListeningToGroup(groupId: group.id)
        
        // Note: Notification listener should remain active when switching groups
        // since it's user-based, not group-based
        print("🔔 Switched to group: \(group.name) - notification listener should remain active")
    }
    
    func navigateToSetup() {
        print("🔄 Navigating to Group Setup (without leaving group)")
        // Temporarily clear currentGroup to show GroupSetupView
        // The user can rejoin their existing groups from the list
        stopListeningToGroup()
        currentGroup = nil
    }
    
    func updateMemberNickname(groupId: String, userId: String, nickname: String) async {
        do {
            // Update the member's nickname in the subcollection
            try await db.collection("groups").document(groupId)
                .collection("members").document(userId).updateData([
                    "nickname": nickname
                ])
            
            print("✅ Successfully updated nickname to: \(nickname) for user: \(userId)")
            
        } catch {
            print("❌ Failed to update nickname: \(error.localizedDescription)")
            errorMessage = "Failed to update nickname: \(error.localizedDescription)"
        }
    }
    
    func refreshCurrentGroup() async {
        guard let group = currentGroup else { return }
        
        do {
            let document = try await db.collection("groups").document(group.id).getDocument()
            guard let data = document.data() else { return }
            
            // Store the current group temporarily in case parsing fails
            let previousGroup = currentGroup
            
            // Parse the updated group data using new subcollection approach
            if let updatedGroup = await parseGroupWithSubcollections(groupId: group.id, groupData: data) {
                currentGroup = updatedGroup
            } else {
                currentGroup = nil
            }
            
            // If parsing failed (currentGroup became nil), restore the previous group
            if currentGroup == nil {
                currentGroup = previousGroup
                print("⚠️ Group parsing failed during refresh, restored previous group data")
            } else {
                print("✅ Refreshed group data for: \(currentGroup?.name ?? "Unknown")")
            }
        } catch {
            print("❌ Failed to refresh group data: \(error.localizedDescription)")
        }
    }
    
    func leaveSpecificGroup(groupId: String, userId: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            // Check if user exists in the group
            let memberDoc = try await db.collection("groups").document(groupId)
                .collection("members").document(userId).getDocument()
            
            guard memberDoc.exists, let memberData = memberDoc.data() else {
                errorMessage = "You are not a member of this group"
                isLoading = false
                return
            }
            
            let memberRole = memberData["role"] as? String
            
            // Remove the member from subcollection
            try await db.collection("groups").document(groupId)
                .collection("members").document(userId).delete()
            
            // Check remaining members count
            let remainingMembersSnapshot = try await db.collection("groups").document(groupId)
                .collection("members").getDocuments()
            
            if remainingMembersSnapshot.documents.isEmpty {
                // Delete the group if no members left
                try await db.collection("groups").document(groupId).delete()
                print("✅ Group deleted (no members remaining)")
            } else if memberRole == "leader" {
                // Promote first remaining member to leader
                if let firstMemberDoc = remainingMembersSnapshot.documents.first {
                    let newLeaderId = firstMemberDoc.documentID
                    
                    // Update the member's role to leader in subcollection
                    try await db.collection("groups").document(groupId)
                        .collection("members").document(newLeaderId).updateData([
                            "role": "leader"
                        ])
                    
                    // Update the group's leaderId
                    try await db.collection("groups").document(groupId).updateData([
                        "leaderId": newLeaderId
                    ])
                    
                    print("✅ Promoted member to leader")
                }
            }
            
            // If this was the current group, clear it
            if currentGroup?.id == groupId {
                stopListeningToGroup()
                currentGroup = nil
            }
            
            // Reload user groups
            await loadUserGroups(userId: userId)
            
        } catch {
            print("❌ Failed to leave group: \(error.localizedDescription)")
            errorMessage = "Failed to leave group: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    
    private func parseGroupWithSubcollections(groupId: String, groupData: [String: Any]) async -> HitherGroup? {
        guard let name = groupData["name"] as? String,
              let createdAtTimestamp = groupData["createdAt"] as? Timestamp,
              let inviteCode = groupData["inviteCode"] as? String,
              let inviteExpiresAtTimestamp = groupData["inviteExpiresAt"] as? Timestamp else {
            print("❌ parseGroupWithSubcollections failed to parse required fields")
            return nil
        }
        
        let isActive = groupData["isActive"] as? Bool ?? true
        
        // Load members from subcollection  
        do {
            let membersSnapshot = try await db.collection("groups").document(groupId)
                .collection("members").getDocuments()
            
            var members: [GroupMember] = []
            var leaderId: String? = nil
            
            for memberDoc in membersSnapshot.documents {
                let userId = memberDoc.documentID
                let memberData = memberDoc.data()
                
                guard let displayName = memberData["displayName"] as? String,
                      let roleString = memberData["role"] as? String,
                      let role = MemberRole(rawValue: roleString),
                      let joinedAtTimestamp = memberData["joinedAt"] as? Timestamp else {
                    continue
                }
                
                if role == .leader {
                    leaderId = userId
                }
                
                var location: GeoPoint? = nil
                var lastLocationUpdate: Date? = nil
                
                if let locationData = memberData["location"] as? [String: Any],
                   let lat = locationData["latitude"] as? Double,
                   let lng = locationData["longitude"] as? Double {
                    location = GeoPoint(latitude: lat, longitude: lng)
                }
                
                if let lastUpdateTimestamp = memberData["lastLocationUpdate"] as? Timestamp {
                    lastLocationUpdate = lastUpdateTimestamp.dateValue()
                }
                
                // Parse nickname and avatarEmoji from Firebase data
                let nickname = memberData["nickname"] as? String
                let avatarEmoji = memberData["avatarEmoji"] as? String
                
                let member = GroupMember(
                    id: UUID().uuidString,
                    userId: userId,
                    displayName: displayName,
                    nickname: nickname,
                    avatarEmoji: avatarEmoji,
                    role: role,
                    joinedAt: joinedAtTimestamp.dateValue(),
                    location: location,
                    lastLocationUpdate: lastLocationUpdate
                )
                
                members.append(member)
            }
            
            guard let validLeaderId = leaderId else {
                print("❌ No leader found in members subcollection for group: \(groupId)")
                return nil
            }
            
            let leaderName = members.first(where: { $0.role == .leader })?.displayName ?? "Unknown Leader"
            
            // Load group settings from subcollection
            var groupSettings = GroupSettings()
            do {
                let settingsDoc = try await db.collection("groups").document(groupId)
                    .collection("settings").document("general").getDocument()
                
                if settingsDoc.exists, let settingsData = settingsDoc.data() {
                    let freeRoamMode = settingsData["freeRoamMode"] as? Bool ?? false
                    let freeRoamEnabledBy = settingsData["freeRoamEnabledBy"] as? String
                    let freeRoamEnabledAt = (settingsData["freeRoamEnabledAt"] as? Timestamp)?.dateValue()
                    
                    groupSettings = GroupSettings(
                        freeRoamMode: freeRoamMode,
                        freeRoamEnabledBy: freeRoamEnabledBy,
                        freeRoamEnabledAt: freeRoamEnabledAt
                    )
                }
            } catch {
                print("⚠️ Failed to load group settings, using defaults: \(error)")
            }
            
            return HitherGroup(
                id: groupId,
                name: name,
                leaderId: validLeaderId,
                leaderName: leaderName,
                createdAt: createdAtTimestamp.dateValue(),
                inviteCode: inviteCode,
                inviteExpiresAt: inviteExpiresAtTimestamp.dateValue(),
                members: members,
                isActive: isActive,
                settings: groupSettings
            )
            
        } catch {
            print("❌ Failed to load members subcollection for group \(groupId): \(error)")
            return nil
        }
    }
    
    
    // Diagnostic function to check group data structure
    func diagnoseGroupData(groupId: String) async {
        print("🔍 Starting group data diagnosis for groupId: \(groupId)")
        
        do {
            let document = try await db.collection("groups").document(groupId).getDocument()
            guard let data = document.data() else {
                print("❌ Group document not found")
                return
            }
            
            print("🔍 Group document exists with keys: \(data.keys.sorted())")
            
            // Check members subcollection
            let membersSnapshot = try await db.collection("groups").document(groupId)
                .collection("members").getDocuments()
                
            print("🔍 Members subcollection has \(membersSnapshot.documents.count) documents")
            for memberDoc in membersSnapshot.documents {
                let memberData = memberDoc.data()
                print("🔍 Member \(memberDoc.documentID) keys: \(memberData.keys.sorted())")
            }
        } catch {
            print("❌ Failed to diagnose group data: \(error.localizedDescription)")
        }
    }
    
    // MARK: - Member Status Management
    func updateMemberStatus(userId: String, status: MemberStatus) async {
        guard let group = currentGroup else {
            print("❌ No current group to update member status")
            return
        }
        
        do {
            // Update local state first for immediate UI response
            if let memberIndex = currentGroup?.members.firstIndex(where: { $0.userId == userId }) {
                currentGroup?.members[memberIndex].status = status
            }
            
            let groupRef = db.collection("groups").document(group.id)
            let memberRef = groupRef.collection("members").document(userId)
            
            try await memberRef.updateData([
                "status": status.rawValue,
                "lastStatusUpdate": Timestamp()
            ])
            
            print("✅ Successfully updated member status to \(status.rawValue)")
        } catch {
            print("❌ Failed to update member status: \(error.localizedDescription)")
            errorMessage = "Failed to update status: \(error.localizedDescription)"
        }
    }
    
    func updateCurrentUserStatus(_ status: MemberStatus, authService: AuthenticationService) async {
        guard let currentUser = authService.currentUser else {
            print("❌ No current user to update status")
            return
        }
        
        await updateMemberStatus(userId: currentUser.id, status: status)
    }
    
    // MARK: - Free Roam Mode Management
    func updateFreeRoamMode(groupId: String, enabled: Bool, enabledBy: String) async {
        do {
            let settingsRef = db.collection("groups").document(groupId)
                .collection("settings").document("general")
            
            let settingsData: [String: Any] = [
                "freeRoamMode": enabled,
                "freeRoamEnabledBy": enabledBy,
                "freeRoamEnabledAt": Timestamp()
            ]
            
            try await settingsRef.setData(settingsData, merge: true)
            
            // Update local state
            currentGroup?.settings.freeRoamMode = enabled
            currentGroup?.settings.freeRoamEnabledBy = enabledBy
            currentGroup?.settings.freeRoamEnabledAt = Date()
            
            print("✅ Successfully updated free roam mode to \(enabled)")
            
            // Send notification to all group members about the mode change
            await notifyGroupMembersOfModeChange(groupId: groupId, enabled: enabled, enabledBy: enabledBy)
            
        } catch {
            print("❌ Failed to update free roam mode: \(error.localizedDescription)")
            errorMessage = "Failed to update free roam mode: \(error.localizedDescription)"
        }
    }
    
    private func notifyGroupMembersOfModeChange(groupId: String, enabled: Bool, enabledBy: String) async {
        guard let group = currentGroup else { return }
        
        let notificationService = NotificationService()
        let title = enabled ? "Free Roam Mode Enabled" : "Free Roam Mode Disabled"
        let body = enabled ? 
            "All find requests will now be automatically approved" : 
            "Find requests will require approval again"
        
        // Send to all group members except the one who made the change
        for member in group.members where member.userId != enabledBy {
            // Create a simple local notification for mode changes
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            content.userInfo = [
                "type": "free_roam_mode_changed",
                "groupId": groupId,
                "enabled": enabled ? "true" : "false"
            ]
            
            let request = UNNotificationRequest(
                identifier: "free_roam_\(groupId)_\(Date().timeIntervalSince1970)",
                content: content,
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
            )
            
            try? await UNUserNotificationCenter.current().add(request)
        }
    }
}