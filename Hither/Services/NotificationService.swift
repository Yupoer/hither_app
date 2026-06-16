//
//  NotificationService.swift
//  Hither
//
//  Created by Dillion on 2025/7/17.
//

import Foundation
import UserNotifications
import UIKit
import FirebaseFirestore

@MainActor
class NotificationService: NSObject, ObservableObject {
    @Published var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published var isEnabled = false
    @Published var errorMessage: String?
    
    private let notificationCenter = UNUserNotificationCenter.current()
    
    override init() {
        super.init()
        checkAuthorizationStatus()
        notificationCenter.delegate = self
    }
    
    func requestPermission() async {
        do {
            let granted = try await notificationCenter.requestAuthorization(
                options: [.alert, .sound, .badge, .criticalAlert]
            )
            
            authorizationStatus = granted ? .authorized : .denied
            isEnabled = granted
            
            if granted {
                await UIApplication.shared.registerForRemoteNotifications()
            } else {
                errorMessage = "Notification permission denied. You may miss important group updates."
            }
        } catch {
            errorMessage = "Failed to request notification permission: \(error.localizedDescription)"
        }
    }
    
    private func checkAuthorizationStatus() {
        Task {
            let settings = await notificationCenter.notificationSettings()
            authorizationStatus = settings.authorizationStatus
            isEnabled = settings.authorizationStatus == .authorized
        }
    }
    
    // MARK: - Local Notifications
    
    func scheduleCommandNotification(
        command: GroupCommand,
        groupName: String,
        recipientId: String? = nil
    ) async {
        guard isEnabled else { 
            print("📱 Notifications not enabled - permission may be denied")
            return 
        }
        
        // Check if notification permissions are properly granted
        let settings = await notificationCenter.notificationSettings()
        guard settings.authorizationStatus == .authorized else {
            print("❌ Notification authorization not granted: \(settings.authorizationStatus)")
            return
        }
        
        let content = UNMutableNotificationContent()
        content.title = "📢 Group Command"
        content.body = "\(command.senderName): \(command.message)"
        content.sound = .default
        content.badge = 1
        content.categoryIdentifier = "GROUP_COMMAND"
        
        // Add custom data
        content.userInfo = [
            "commandId": command.id,
            "groupId": command.groupId,
            "groupName": groupName,
            "type": command.type.rawValue,
            "senderId": command.senderId,
            "recipientId": recipientId ?? ""
        ]
        
        let request = UNNotificationRequest(
            identifier: "command_\(command.id)_\(recipientId ?? "all")",
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        )
        
        do {
            try await notificationCenter.add(request)
            print("✅ Scheduled command notification for recipient: \(recipientId ?? "current user")")
        } catch {
            errorMessage = "Failed to schedule command notification: \(error.localizedDescription)"
            print("❌ Failed to schedule notification: \(error)")
        }
    }
    
    func scheduleItineraryUpdateNotification(
        groupName: String,
        waypointName: String,
        action: String,
        updatedBy: String
    ) async {
        guard isEnabled else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "🗺️ Itinerary Updated"
        
        let actionText = action == "added" ? "added" : action == "completed" ? "completed" : "updated"
        content.body = "\(updatedBy) \(actionText) waypoint: \(waypointName)"
        
        content.sound = .default
        content.badge = 1
        content.categoryIdentifier = "ITINERARY_UPDATE"
        
        content.userInfo = [
            "groupName": groupName,
            "waypointName": waypointName,
            "action": action,
            "updatedBy": updatedBy
        ]
        
        let request = UNNotificationRequest(
            identifier: "itinerary_\(UUID().uuidString)",
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        )
        
        do {
            try await notificationCenter.add(request)
        } catch {
            errorMessage = "Failed to schedule itinerary notification: \(error.localizedDescription)"
        }
    }
    
    func scheduleLocationAlertNotification(
        memberName: String,
        groupName: String,
        alertType: LocationAlertType
    ) async {
        guard isEnabled else { return }
        
        let content = UNMutableNotificationContent()
        content.sound = .default
        content.badge = 1
        content.categoryIdentifier = "LOCATION_ALERT"
        
        switch alertType {
        case .memberLost:
            content.title = "⚠️ Member Alert"
            content.body = "\(memberName) may be lost - no location update for 10+ minutes"
        case .memberTooFar:
            content.title = "📍 Distance Alert"
            content.body = "\(memberName) is more than 1km away from the group"
        case .groupScattered:
            content.title = "👥 Group Alert"
            content.body = "Group members are scattered - consider gathering"
        case .batteryLow:
            content.title = "🔋 Battery Alert"
            content.body = "Your battery is low - location tracking may be affected"
        }
        
        content.userInfo = [
            "memberName": memberName,
            "groupName": groupName,
            "alertType": alertType.rawValue
        ]
        
        let request = UNNotificationRequest(
            identifier: "location_alert_\(UUID().uuidString)",
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        )
        
        do {
            try await notificationCenter.add(request)
        } catch {
            errorMessage = "Failed to schedule location alert: \(error.localizedDescription)"
        }
    }
    
    // MARK: - Find Request Notifications
    
    func scheduleFindRequestNotification(
        requestId: String,
        groupId: String,
        requesterName: String,
        targetName: String
    ) async {
        guard isEnabled else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "🔍 Find Request"
        content.body = "\(requesterName) wants to find you. Allow them to see your location?"
        content.sound = .default
        content.badge = 1
        content.categoryIdentifier = "FIND_REQUEST"
        
        content.userInfo = [
            "requestId": requestId,
            "groupId": groupId,
            "requesterName": requesterName,
            "targetName": targetName,
            "type": "find_request"
        ]
        
        let request = UNNotificationRequest(
            identifier: "find_request_\(requestId)",
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        )
        
        do {
            try await notificationCenter.add(request)
            print("✅ Scheduled find request notification")
        } catch {
            errorMessage = "Failed to schedule find request notification: \(error.localizedDescription)"
            print("❌ Failed to schedule find request notification: \(error)")
        }
    }
    
    func scheduleRequestApprovedNotification(
        requestId: String,
        targetName: String
    ) async {
        guard isEnabled else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "✅ Request Approved"
        content.body = "\(targetName) approved your find request. You can now start finding them!"
        content.sound = .default
        content.badge = 1
        content.categoryIdentifier = "REQUEST_APPROVED"
        
        content.userInfo = [
            "requestId": requestId,
            "targetName": targetName,
            "type": "request_approved"
        ]
        
        let request = UNNotificationRequest(
            identifier: "request_approved_\(requestId)",
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        )
        
        do {
            try await notificationCenter.add(request)
            print("✅ Scheduled request approved notification")
        } catch {
            errorMessage = "Failed to schedule request approved notification: \(error.localizedDescription)"
            print("❌ Failed to schedule request approved notification: \(error)")
        }
    }
    
    // MARK: - Notification Categories
    
    func setupNotificationCategories() {
        let commandCategory = UNNotificationCategory(
            identifier: "GROUP_COMMAND",
            actions: [
                UNNotificationAction(
                    identifier: "VIEW_COMMAND",
                    title: "View",
                    options: [.foreground]
                ),
                UNNotificationAction(
                    identifier: "ACKNOWLEDGE",
                    title: "Got it",
                    options: []
                )
            ],
            intentIdentifiers: []
        )
        
        let itineraryCategory = UNNotificationCategory(
            identifier: "ITINERARY_UPDATE",
            actions: [
                UNNotificationAction(
                    identifier: "VIEW_ITINERARY",
                    title: "View Itinerary",
                    options: [.foreground]
                )
            ],
            intentIdentifiers: []
        )
        
        let locationCategory = UNNotificationCategory(
            identifier: "LOCATION_ALERT",
            actions: [
                UNNotificationAction(
                    identifier: "VIEW_MAP",
                    title: "View Map",
                    options: [.foreground]
                ),
                UNNotificationAction(
                    identifier: "SEND_LOCATION",
                    title: "Share Location",
                    options: []
                )
            ],
            intentIdentifiers: []
        )
        
        let findRequestCategory = UNNotificationCategory(
            identifier: "FIND_REQUEST",
            actions: [
                UNNotificationAction(
                    identifier: "APPROVE_FIND",
                    title: "Allow",
                    options: []
                ),
                UNNotificationAction(
                    identifier: "DENY_FIND",
                    title: "Deny",
                    options: []
                )
            ],
            intentIdentifiers: []
        )
        
        let requestApprovedCategory = UNNotificationCategory(
            identifier: "REQUEST_APPROVED",
            actions: [
                UNNotificationAction(
                    identifier: "START_FINDING",
                    title: "Start Finding",
                    options: [.foreground]
                )
            ],
            intentIdentifiers: []
        )
        
        notificationCenter.setNotificationCategories([
            commandCategory,
            itineraryCategory,
            locationCategory,
            findRequestCategory,
            requestApprovedCategory
        ])
    }
    
    // MARK: - Badge Management
    
    func clearBadge() {
        UIApplication.shared.applicationIconBadgeNumber = 0
    }
    
    func updateBadge(count: Int) {
        UIApplication.shared.applicationIconBadgeNumber = count
    }
    
    // MARK: - Cleanup
    
    func removeAllNotifications() {
        notificationCenter.removeAllPendingNotificationRequests()
        notificationCenter.removeAllDeliveredNotifications()
    }
    
    func removeNotifications(withIdentifiers identifiers: [String]) {
        notificationCenter.removePendingNotificationRequests(withIdentifiers: identifiers)
        notificationCenter.removeDeliveredNotifications(withIdentifiers: identifiers)
    }
    
}

// MARK: - UNUserNotificationCenterDelegate

extension NotificationService: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Show notification even when app is in foreground
        completionHandler([.banner, .sound, .badge])
    }
    
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        
        switch response.actionIdentifier {
        case "VIEW_COMMAND":
            // Navigate to commands view
            handleCommandNotificationTap(userInfo: userInfo)
        case "VIEW_ITINERARY":
            // Navigate to itinerary view
            handleItineraryNotificationTap(userInfo: userInfo)
        case "VIEW_MAP":
            // Navigate to map view
            handleLocationNotificationTap(userInfo: userInfo)
        case "ACKNOWLEDGE", "SEND_LOCATION":
            // Handle quick actions
            break
        case "APPROVE_FIND":
            // Handle find request approval
            handleFindRequestApproval(userInfo: userInfo)
        case "DENY_FIND":
            // Handle find request denial
            handleFindRequestDenial(userInfo: userInfo)
        case "START_FINDING":
            // Handle start finding action
            handleStartFinding(userInfo: userInfo)
        case UNNotificationDefaultActionIdentifier:
            // Handle default tap
            handleDefaultNotificationTap(userInfo: userInfo)
        default:
            break
        }
        
        completionHandler()
    }
    
    private func handleCommandNotificationTap(userInfo: [AnyHashable: Any]) {
        // In a real implementation, this would navigate to the commands tab
        print("Command notification tapped: \(userInfo)")
    }
    
    private func handleItineraryNotificationTap(userInfo: [AnyHashable: Any]) {
        // In a real implementation, this would navigate to the itinerary tab
        print("Itinerary notification tapped: \(userInfo)")
    }
    
    private func handleLocationNotificationTap(userInfo: [AnyHashable: Any]) {
        // In a real implementation, this would navigate to the map tab
        print("Location notification tapped: \(userInfo)")
    }
    
    private func handleDefaultNotificationTap(userInfo: [AnyHashable: Any]) {
        // In a real implementation, this would navigate to the appropriate tab
        print("Default notification tapped: \(userInfo)")
    }
    
    private func handleFindRequestApproval(userInfo: [AnyHashable: Any]) {
        guard let requestId = userInfo["requestId"] as? String,
              let groupId = userInfo["groupId"] as? String else {
            print("❌ Missing required data for find request approval")
            return
        }
        
        print("✅ Find request approved via notification: \(requestId)")
        
        Task {
            do {
                let findRequestService = FindRequestService()
                // Extract targetId from userInfo if available
                let targetId = userInfo["targetId"] as? String ?? ""
                try await findRequestService.approveRequest(groupId: groupId, requestId: requestId, targetId: targetId)
                print("✅ Find request approved successfully")
            } catch {
                print("❌ Failed to approve find request: \(error)")
                await MainActor.run {
                    self.errorMessage = "Failed to approve find request: \(error.localizedDescription)"
                }
            }
        }
    }
    
    private func handleFindRequestDenial(userInfo: [AnyHashable: Any]) {
        guard let requestId = userInfo["requestId"] as? String,
              let groupId = userInfo["groupId"] as? String else {
            print("❌ Missing required data for find request denial")
            return
        }
        
        print("❌ Find request denied via notification: \(requestId)")
        
        Task {
            do {
                let findRequestService = FindRequestService()
                try await findRequestService.denyRequest(groupId: groupId, requestId: requestId)
                print("✅ Find request denied successfully")
            } catch {
                print("❌ Failed to deny find request: \(error)")
                await MainActor.run {
                    self.errorMessage = "Failed to deny find request: \(error.localizedDescription)"
                }
            }
        }
    }
    
    private func handleStartFinding(userInfo: [AnyHashable: Any]) {
        guard let requestId = userInfo["requestId"] as? String else {
            print("❌ Missing request ID for start finding")
            return
        }
        
        print("🧭 Starting finding mode via notification: \(requestId)")
        
        // Post notification to trigger finding mode in the app
        NotificationCenter.default.post(
            name: NSNotification.Name("StartFindingMode"),
            object: nil,
            userInfo: ["requestId": requestId]
        )
    }
}

// MARK: - Supporting Types

enum LocationAlertType: String, CaseIterable {
    case memberLost = "member_lost"
    case memberTooFar = "member_too_far"
    case groupScattered = "group_scattered"
    case batteryLow = "battery_low"
}

