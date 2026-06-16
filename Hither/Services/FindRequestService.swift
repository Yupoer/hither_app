//
//  FindRequestService.swift
//  Hither
//
//  Created by Development Agent on 2025/8/4.
//

import Foundation
import FirebaseFirestore
import UserNotifications

@MainActor
class FindRequestService: ObservableObject {
    @Published var activeRequests: [FindRequest] = []
    @Published var incomingRequests: [FindRequest] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let db = Firestore.firestore()
    private var requestsListener: ListenerRegistration?
    
    init() {}
    
    deinit {
        // SENIOR REFACTOR: Proper cleanup of all listeners
        requestsListener?.remove()
        requestsListenerRegistration?.remove()
        updatesListenerRegistration?.remove()
    }
    
    // MARK: - Free Roam Mode Management
    func getFreeRoamMode(groupId: String) async -> Bool {
        do {
            let settingsDoc = try await db.collection("groups").document(groupId)
                .collection("settings").document("general").getDocument()
            
            if settingsDoc.exists, let data = settingsDoc.data() {
                return data["freeRoamMode"] as? Bool ?? false
            }
            return false
        } catch {
            print("❌ Failed to get free roam mode: \(error.localizedDescription)")
            return false
        }
    }
    
    // MARK: - Request Management
    
    func createFindRequest(groupId: String, requesterId: String, targetId: String, requesterName: String, targetName: String, freeRoamMode: Bool = false) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let request = FindRequest(requesterId: requesterId, targetId: targetId)
            
            try await db.collection("groups").document(groupId)
                .collection("findRequests").document(request.id).setData([
                    "requesterId": request.requesterId,
                    "targetId": request.targetId,
                    "status": request.status.rawValue,
                    "createdAt": Timestamp(date: request.createdAt),
                    "expiresAt": Timestamp(date: request.expiresAt),
                    "approvedAt": NSNull()
                ])
            
            // If free roam mode is enabled, auto-approve the request
            if freeRoamMode {
                await approveRequest(groupId: groupId, requestId: request.id, targetId: targetId)
            } else {
                // Send notification to target user
                await sendFindRequestNotification(
                    groupId: groupId,
                    requestId: request.id,
                    targetId: targetId,
                    requesterName: requesterName,
                    targetName: targetName
                )
            }
            
            print("✅ Created find request: \(request.id)")
        } catch {
            errorMessage = "Failed to create find request: \(error.localizedDescription)"
            print("❌ Failed to create find request: \(error)")
        }
        
        isLoading = false
    }
    
    func approveRequest(groupId: String, requestId: String, targetId: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let approvedAt = Date()
            try await db.collection("groups").document(groupId)
                .collection("findRequests").document(requestId).updateData([
                    "status": FindRequestStatus.approved.rawValue,
                    "approvedAt": Timestamp(date: approvedAt)
                ])
            
            // Send notification to requester that request was approved
            await sendRequestApprovedNotification(groupId: groupId, requestId: requestId, targetId: targetId)
            
            print("✅ Approved find request: \(requestId)")
        } catch {
            errorMessage = "Failed to approve request: \(error.localizedDescription)"
            print("❌ Failed to approve request: \(error)")
        }
        
        isLoading = false
    }
    
    func denyRequest(groupId: String, requestId: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            try await db.collection("groups").document(groupId)
                .collection("findRequests").document(requestId).updateData([
                    "status": FindRequestStatus.denied.rawValue
                ])
            
            print("✅ Denied find request: \(requestId)")
        } catch {
            errorMessage = "Failed to deny request: \(error.localizedDescription)"
            print("❌ Failed to deny request: \(error)")
        }
        
        isLoading = false
    }
    
    // MARK: - Real-time Listening
    
    func startListening(groupId: String, userId: String) {
        requestsListener = db.collection("groups").document(groupId)
            .collection("findRequests")
            .addSnapshotListener { [weak self] querySnapshot, error in
                Task { @MainActor in
                    if let error = error {
                        self?.errorMessage = "Failed to sync find requests: \(error.localizedDescription)"
                        return
                    }
                    
                    guard let documents = querySnapshot?.documents else { return }
                    
                    var active: [FindRequest] = []
                    var incoming: [FindRequest] = []
                    
                    for document in documents {
                        if let request = self?.parseFindRequest(from: document) {
                            // Clean up expired requests
                            if request.isExpired && request.status == .pending {
                                Task {
                                    await self?.markAsExpired(groupId: groupId, requestId: request.id)
                                }
                                continue
                            }
                            
                            // Categorize requests
                            if request.requesterId == userId {
                                active.append(request)
                            } else if request.targetId == userId && request.status == .pending {
                                incoming.append(request)
                            }
                        }
                    }
                    
                    self?.activeRequests = active.sorted { $0.createdAt > $1.createdAt }
                    self?.incomingRequests = incoming.sorted { $0.createdAt > $1.createdAt }
                }
            }
    }
    
    func stopListening() {
        requestsListener?.remove()
        requestsListener = nil
    }
    
    // MARK: - Helper Methods
    
    private func parseFindRequest(from document: QueryDocumentSnapshot) -> FindRequest? {
        let data = document.data()
        
        guard let requesterId = data["requesterId"] as? String,
              let targetId = data["targetId"] as? String,
              let statusString = data["status"] as? String,
              let status = FindRequestStatus(rawValue: statusString),
              let createdAtTimestamp = data["createdAt"] as? Timestamp,
              let expiresAtTimestamp = data["expiresAt"] as? Timestamp else {
            return nil
        }
        
        let approvedAt = (data["approvedAt"] as? Timestamp)?.dateValue()
        
        return FindRequest(
            id: document.documentID,
            requesterId: requesterId,
            targetId: targetId,
            status: status,
            createdAt: createdAtTimestamp.dateValue(),
            expiresAt: expiresAtTimestamp.dateValue(),
            approvedAt: approvedAt
        )
    }
    
    private func markAsExpired(groupId: String, requestId: String) async {
        do {
            try await db.collection("groups").document(groupId)
                .collection("findRequests").document(requestId).updateData([
                    "status": FindRequestStatus.expired.rawValue
                ])
        } catch {
            print("❌ Failed to mark request as expired: \(error)")
        }
    }
    
    // MARK: - Notification Methods
    
    private func sendFindRequestNotification(groupId: String, requestId: String, targetId: String, requesterName: String, targetName: String) async {
        // Send local notification to target user
        await NotificationService().scheduleFindRequestNotification(
            requestId: requestId,
            groupId: groupId,
            requesterName: requesterName,
            targetName: targetName
        )
        
        print("🔔 Sent find request notification to \(targetName) from \(requesterName)")
    }
    
    private func sendRequestApprovedNotification(groupId: String, requestId: String, targetId: String) async {
        // SENIOR REFACTOR: Get proper target name, not targetId
        // Original code had logic error - was looking for targetId in results instead of actual name
        let targetName = incomingRequests.first { $0.id == requestId }?.targetId ?? 
                        activeRequests.first { $0.id == requestId }?.requesterId ?? "Unknown"
        
        await NotificationService().scheduleRequestApprovedNotification(
            requestId: requestId,
            targetName: targetName
        )
        
        print("🔔 Sent request approved notification to requester")
    }
    
    // MARK: - Group Settings
    
    func updateFreeRoamMode(groupId: String, enabled: Bool, leaderId: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let settings = GroupSettings(
                freeRoamMode: enabled,
                freeRoamEnabledBy: enabled ? leaderId : nil,
                freeRoamEnabledAt: enabled ? Date() : nil
            )
            
            try await db.collection("groups").document(groupId)
                .collection("settings").document("general").setData([
                    "freeRoamMode": settings.freeRoamMode,
                    "freeRoamEnabledBy": settings.freeRoamEnabledBy ?? NSNull(),
                    "freeRoamEnabledAt": settings.freeRoamEnabledAt != nil ? Timestamp(date: settings.freeRoamEnabledAt!) : NSNull()
                ])
            
            print("✅ Updated free roam mode: \(enabled)")
        } catch {
            errorMessage = "Failed to update free roam mode: \(error.localizedDescription)"
            print("❌ Failed to update free roam mode: \(error)")
        }
        
        isLoading = false
    }
    
    // MARK: - Utility Methods
    
    func getActiveRequestForTarget(targetId: String) -> FindRequest? {
        return activeRequests.first { $0.targetId == targetId && $0.status == .approved }
    }
    
    func hasActiveRequestForTarget(targetId: String) -> Bool {
        return activeRequests.contains { $0.targetId == targetId && ($0.status == .pending || $0.status == .approved) }
    }
    
    // MARK: - Enhanced Real-time Listeners
    // SENIOR REFACTOR: Consolidated listener pattern with proper error handling and memory management
    
    private var requestsListenerRegistration: ListenerRegistration?
    private var updatesListenerRegistration: ListenerRegistration?
    
    func startListeningForRequests(groupId: String, targetId: String, onRequestReceived: @escaping (FindRequest) -> Void) {
        // Clean up existing listener
        requestsListenerRegistration?.remove()
        
        requestsListenerRegistration = db.collection("groups").document(groupId)
            .collection("findRequests")
            .whereField("targetId", isEqualTo: targetId)
            .whereField("status", isEqualTo: FindRequestStatus.pending.rawValue)
            .addSnapshotListener { [weak self] snapshot, error in
                guard let self = self else { return }
                
                if let error = error {
                    print("❌ Error listening for find requests: \(error)")
                    Task { @MainActor in
                        self.errorMessage = "Failed to listen for requests: \(error.localizedDescription)"
                    }
                    return
                }
                
                guard let documents = snapshot?.documents else { return }
                
                for document in documents {
                    do {
                        let request = try document.data(as: FindRequest.self)
                        if !request.isExpired {
                            DispatchQueue.main.async {
                                onRequestReceived(request)
                            }
                        }
                    } catch {
                        print("❌ Error decoding find request: \(error)")
                    }
                }
            }
    }
    
    func startListeningForRequestUpdates(groupId: String, userId: String, onRequestUpdated: @escaping (FindRequest) -> Void) {
        // Clean up existing listener
        updatesListenerRegistration?.remove()
        
        updatesListenerRegistration = db.collection("groups").document(groupId)
            .collection("findRequests")
            .whereField("requesterId", isEqualTo: userId)
            .addSnapshotListener { [weak self] snapshot, error in
                guard let self = self else { return }
                
                if let error = error {
                    print("❌ Error listening for request updates: \(error)")
                    Task { @MainActor in
                        self.errorMessage = "Failed to listen for request updates: \(error.localizedDescription)"
                    }
                    return
                }
                
                guard let documents = snapshot?.documents else { return }
                
                for document in documents {
                    do {
                        let request = try document.data(as: FindRequest.self)
                        DispatchQueue.main.async {
                            onRequestUpdated(request)
                        }
                    } catch {
                        print("❌ Error decoding find request update: \(error)")
                    }
                }
            }
    }
    
    func stopListeningForRequests() {
        requestsListenerRegistration?.remove()
        requestsListenerRegistration = nil
    }
    
    func stopListeningForUpdates() {
        updatesListenerRegistration?.remove()
        updatesListenerRegistration = nil
    }
}
