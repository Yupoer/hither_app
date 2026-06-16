//
//  CommandService.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation
import FirebaseFirestore
import UserNotifications

@MainActor
class CommandService: ObservableObject {
    @Published var recentCommands: [GroupCommand] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let db = Firestore.firestore()
    private var commandsListener: ListenerRegistration?
    private var notificationListener: ListenerRegistration?
    private let notificationService = NotificationService()
    
    deinit {
        commandsListener?.remove()
        notificationListener?.remove()
    }
    
    func startListeningToCommands(groupId: String) {
        commandsListener?.remove()
        
        commandsListener = db.collection("groups").document(groupId)
            .collection("commands")
            .order(by: "timestamp", descending: true)
            .limit(to: 50)
            .addSnapshotListener { [weak self] snapshot, error in
                Task { @MainActor in
                    if let error = error {
                        self?.errorMessage = "Failed to sync commands: \(error.localizedDescription)"
                        return
                    }
                    
                    guard let documents = snapshot?.documents else { return }
                    
                    self?.recentCommands = documents.compactMap { document in
                        self?.parseCommandFromDocument(document, groupId: groupId)
                    }
                }
            }
    }
    
    func stopListeningToCommands() {
        commandsListener?.remove()
        commandsListener = nil
        recentCommands.removeAll()
    }
    
    func sendQuickCommand(
        type: CommandType,
        groupId: String,
        groupName: String,
        senderId: String,
        senderName: String,
        currentLocation: GeoPoint? = nil
    ) async {
        await sendCommand(
            type: type,
            message: type.defaultMessage,
            groupId: groupId,
            groupName: groupName,
            senderId: senderId,
            senderName: senderName,
            currentLocation: currentLocation
        )
    }
    
    func sendCustomCommand(
        message: String,
        groupId: String,
        groupName: String,
        senderId: String,
        senderName: String,
        currentLocation: GeoPoint? = nil
    ) async {
        await sendCommand(
            type: .custom,
            message: message,
            groupId: groupId,
            groupName: groupName,
            senderId: senderId,
            senderName: senderName,
            currentLocation: currentLocation
        )
    }
    
    private func sendCommand(
        type: CommandType,
        message: String,
        groupId: String,
        groupName: String,
        senderId: String,
        senderName: String,
        currentLocation: GeoPoint?
    ) async {
        isLoading = true
        errorMessage = nil
        
        let command = GroupCommand(
            groupId: groupId,
            senderId: senderId,
            senderName: senderName,
            type: type,
            message: message,
            location: currentLocation
        )
        
        do {
            // Save command to Firestore inside the group's commands subcollection
            // No need for groupId since it's nested under the group
            try await db.collection("groups").document(groupId)
                .collection("commands")
                .addDocument(data: [
                    "senderId": command.senderId,
                    "senderName": command.senderName,
                    "type": command.type.rawValue,
                    "message": command.message,
                    "timestamp": Timestamp(date: command.timestamp)
                ])
            
            // Send push notification to group members
            await sendPushNotificationToGroup(command: command, groupName: groupName)
            
        } catch {
            errorMessage = "Failed to send command: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    private func sendPushNotificationToGroup(command: GroupCommand, groupName: String) async {
        // Get all group members to send notifications to everyone except the sender
        do {
            print("🔔 Starting notification process for command from: \(command.senderId)")
            
            let groupDoc = try await db.collection("groups").document(command.groupId).getDocument()
            guard let groupData = groupDoc.data() else {
                print("❌ Failed to get group data for notifications")
                return
            }
            
            var recipientUserIds: [String] = []
            
            // Get members from users subcollection
            let usersSnapshot = try await db.collection("groups").document(command.groupId)
                .collection("users").getDocuments()
            
            print("🔍 Processing members from users subcollection")
            print("🔍 Total users found: \(usersSnapshot.documents.count)")
            print("🔍 Sender ID: \(command.senderId)")
            
            for userDoc in usersSnapshot.documents {
                let userId = userDoc.documentID
                print("🔍 Checking member: \(userId)")
                if userId != command.senderId {
                    recipientUserIds.append(userId)
                    print("✅ Added recipient: \(userId)")
                } else {
                    print("🔕 Skipped sender: \(userId)")
                }
            }
            
            print("🔔 Sending notifications to \(recipientUserIds.count) recipients")
            print("🔔 Recipients: \(recipientUserIds)")
            
            // Create single notification with all recipients instead of individual notifications
            if !recipientUserIds.isEmpty {
                await createGroupNotification(recipientIds: recipientUserIds, command: command, groupName: groupName)
            }
            
            print("✅ Processed command notifications for \(recipientUserIds.count) group members")
            
        } catch {
            print("❌ Failed to send notifications to group members: \(error.localizedDescription)")
        }
    }
    
    private func createGroupNotification(recipientIds: [String], command: GroupCommand, groupName: String) async {
        // Create simplified notification data structure
        // No need for recipientIds since we store notifications in individual user collections
        let notificationData: [String: Any] = [
            "message": command.message,
            "type": command.type.rawValue,
            "timestamp": Timestamp(date: Date()),
            "isRead": false
        ]
        
        // Store notification for each recipient in their individual subcollection
        for userId in recipientIds {
            do {
                try await db.collection("groups")
                    .document(command.groupId)
                    .collection("users")
                    .document(userId)
                    .collection("notifications")
                    .addDocument(data: notificationData)
                
                print("✅ Stored simplified notification in Firestore for user \(userId)")
                
                // Send local notification
                await notificationService.scheduleCommandNotification(
                    command: command,
                    groupName: groupName,
                    recipientId: nil
                )
                
            } catch {
                print("❌ Failed to store notification for user \(userId): \(error)")
                
                // Fallback to local notification only
                await notificationService.scheduleCommandNotification(
                    command: command,
                    groupName: groupName,
                    recipientId: userId
                )
            }
        }
    }
    
    private func parseCommandFromDocument(_ document: QueryDocumentSnapshot, groupId: String) -> GroupCommand? {
        let data = document.data()
        
        guard let senderId = data["senderId"] as? String,
              let senderName = data["senderName"] as? String,
              let typeString = data["type"] as? String,
              let type = CommandType(rawValue: typeString),
              let message = data["message"] as? String,
              let timestamp = (data["timestamp"] as? Timestamp)?.dateValue() else {
            print("❌ Failed to parse command - missing required fields")
            return nil
        }
        
        // Use document ID for command ID and set the timestamp from Firebase
        // No location needed in commands per updated structure
        return GroupCommand(
            id: document.documentID,
            groupId: groupId,
            senderId: senderId,
            senderName: senderName,
            type: type,
            message: message,
            timestamp: timestamp,
            location: nil
        )
    }
    
    func requestNotificationPermission() async {
        await notificationService.requestPermission()
        if let error = notificationService.errorMessage {
            errorMessage = error
        }
    }
    
    func setupNotificationCategories() {
        notificationService.setupNotificationCategories()
    }
    
    func startListeningToNotifications(groupId: String, userId: String) {
        notificationListener?.remove()
        
        // Simplified query to avoid index requirement - order by timestamp only
        notificationListener = db.collection("groups")
            .document(groupId)
            .collection("users")
            .document(userId)
            .collection("notifications")
            .order(by: "timestamp", descending: true)
            .limit(to: 20)
            .addSnapshotListener { [weak self] snapshot, error in
                Task { @MainActor in
                    if let error = error {
                        print("❌ Failed to listen to notifications: \(error.localizedDescription)")
                        return
                    }
                    
                    guard let documents = snapshot?.documents else { return }
                    
                    // Process new notifications (filter unread in client)
                    for document in documents {
                        let data = document.data()
                        let isRead = data["isRead"] as? Bool ?? true
                        if !isRead {
                            await self?.processIncomingNotification(document: document, currentUserId: userId)
                        }
                    }
                }
            }
    }
    
    private func processIncomingNotification(document: QueryDocumentSnapshot, currentUserId: String) async {
        let data = document.data()
        
        // New simplified format - only need message, type, timestamp, isRead
        // Note: recipientIds not needed since notification being in user's collection means they should receive it
        guard let message = data["message"] as? String,
              let typeString = data["type"] as? String,
              let commandType = CommandType(rawValue: typeString) else {
            print("❌ Invalid notification format - missing required fields")
            return
        }
        
        // Create a simplified command object for local notification
        // We'll use placeholder values since we removed redundant fields
        let command = GroupCommand(
            groupId: "placeholder", // Not needed for local notification
            senderId: "placeholder", // Not needed for local notification
            senderName: "Group Member", // Generic sender name
            type: commandType,
            message: message
        )
        
        // Send local notification
        await notificationService.scheduleCommandNotification(
            command: command,
            groupName: "Group", // Generic group name
            recipientId: nil
        )
        
        print("✅ Processed simplified notification")
        
        // Mark notification as read
        do {
            try await document.reference.updateData(["isRead": true])
        } catch {
            print("❌ Failed to mark notification as read: \(error)")
        }
    }
    
    func stopListeningToNotifications() {
        print("🔕 Stopping notification listener")
        notificationListener?.remove()
        notificationListener = nil
    }
    
    func startNotificationListenerIfNeeded(groupId: String, userId: String) {
        // Only start if not already listening
        if notificationListener == nil {
            print("🔔 Starting notification listener for user: \(userId)")
            startListeningToNotifications(groupId: groupId, userId: userId)
        } else {
            print("🔔 Notification listener already active for user: \(userId)")
        }
    }
}

extension GeoPoint {
    func toFirestoreData() -> [String: Any] {
        return [
            "latitude": latitude,
            "longitude": longitude
        ]
    }
}