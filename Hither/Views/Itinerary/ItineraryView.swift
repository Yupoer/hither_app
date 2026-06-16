import SwiftUI
import MapKit
import CoreLocation

struct ItineraryView: View {
    @EnvironmentObject private var groupService: GroupService
    @EnvironmentObject private var authService: AuthenticationService
    @StateObject private var itineraryService = ItineraryService()
    @StateObject private var locationService = LocationService()
    @State private var showingAddWaypoint = false
    @State private var selectedWaypoint: Waypoint?
    @State private var showingImportURL = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                contentView
            }
            .navigationTitle("itinerary".localized)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if isLeader {
                    ToolbarItem(placement: .topBarTrailing) {
                        navigationButtons
                    }
                }
            }
            .onAppear { setupItineraryService() }
            .sheet(isPresented: $showingAddWaypoint) {
                AddWaypointNavigationView(
                    itineraryService: itineraryService,
                    groupId: groupService.currentGroup?.id ?? "",
                    userId: authService.currentUser?.id ?? "",
                    userName: authService.currentUser?.displayName ?? ""
                )
            }
            .sheet(item: $selectedWaypoint) { waypoint in
                WaypointDetailView(
                    waypoint: waypoint,
                    itineraryService: itineraryService,
                    groupId: groupService.currentGroup?.id ?? "",
                    userId: authService.currentUser?.id ?? "",
                    userName: authService.currentUser?.displayName ?? "",
                    isLeader: isLeader,
                    groupName: groupService.currentGroup?.name ?? "",
                    leaderName: groupService.currentGroup?.leader?.displayName ?? "",
                    memberCount: groupService.currentGroup?.members.count ?? 0
                )
            }
            .sheet(isPresented: $showingImportURL) {
                ImportURLSheet { coordinate, name in
                    Task {
                        await importLocationAsWaypoint(coordinate: coordinate, name: name)
                    }
                }
            }
        }
    }
    
    @ViewBuilder
    private var contentView: some View {
        if let group = groupService.currentGroup,
           let user = authService.currentUser {
            if group.leader?.userId == user.id {
                leaderItineraryView(group: group, user: user)
            } else {
                followerItineraryView(group: group, user: user)
            }
        } else {
            Text("join_group_to_view_itinerary".localized)
                .foregroundColor(.secondary)
        }
    }

    private var isLeader: Bool {
        guard let group = groupService.currentGroup,
              let user = authService.currentUser else { return false }
        return group.leader?.userId == user.id
    }

    private var navigationButtons: some View {
        HStack(spacing: 16) {
            Button(action: { showingImportURL = true }) {
                Image(systemName: "link")
            }
            
            Button(action: { showingAddWaypoint = true }) {
                Image(systemName: "plus")
            }
        }
    }
    
    private var addWaypointButton: some View {
        Button(action: { showingAddWaypoint = true }) {
            Image(systemName: "plus")
        }
    }

    @ViewBuilder
    private func leaderItineraryView(group: HitherGroup, user: HitherUser) -> some View {
        VStack(spacing: 16) {
            itineraryHeader(title: "manage_itinerary".localized, subtitle: "add_waypoints_guide".localized)
            if let currentWaypoint = itineraryService.currentItinerary?.currentWaypoint {
                NextWaypointCard(waypoint: currentWaypoint, locationService: locationService)
                    .padding(.horizontal)
            }
            itineraryContent()
        }
    }

    @ViewBuilder
    private func followerItineraryView(group: HitherGroup, user: HitherUser) -> some View {
        VStack(spacing: 16) {
            itineraryHeader(title: "group_itinerary".localized, subtitle: "follow_planned_route".localized)
            if let currentWaypoint = itineraryService.currentItinerary?.currentWaypoint {
                NextWaypointCard(waypoint: currentWaypoint, locationService: locationService)
                    .padding(.horizontal)
            }
            itineraryContent()
        }
    }

    private func itineraryHeader(title: String, subtitle: String) -> some View {
        VStack(spacing: 8) {
            Text(title)
                .font(.headline)
            Text(subtitle)
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .padding(.top)
    }

    @ViewBuilder
    private func itineraryContent() -> some View {
        if let itinerary = itineraryService.currentItinerary {
            if itinerary.waypoints.isEmpty {
                emptyItineraryView()
            } else {
                List {
                    upcomingWaypointsSection(waypoints: itinerary.upcomingWaypoints)
                    waypointSection(title: "completed".localized, waypoints: itinerary.completedWaypoints, isCompleted: true)
                }
                .listStyle(PlainListStyle())
                .environment(\.editMode, .constant(isLeader ? .active : .inactive))
            }
        } else {
            SheepLoadingView(message: "loading_itinerary".localized)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }

        if itineraryService.isLoading {
            SheepLoadingView().padding()
        }

        if let errorMessage = itineraryService.errorMessage {
            Text(errorMessage)
                .foregroundColor(.red)
                .font(.caption)
                .padding()
        }
    }

    private func emptyItineraryView() -> some View {
        VStack(spacing: 12) {
            Image(systemName: "map")
                .font(.system(size: 50))
                .foregroundColor(.gray)
            Text("no_waypoints_yet".localized)
                .font(.headline)
                .foregroundColor(.secondary)
            if isLeader {
                Text("tap_plus_add_first".localized)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func upcomingWaypointsSection(waypoints: [Waypoint]) -> some View {
        if !waypoints.isEmpty {
            Section {
                ForEach(waypoints) { waypoint in
                    WaypointCard(
                        waypoint: waypoint,
                        locationService: locationService,
                        isLeader: isLeader,
                        onTap: { selectedWaypoint = waypoint },
                        onComplete: isLeader && !waypoint.isCompleted ? {
                            Task {
                                guard let groupId = groupService.currentGroup?.id,
                                      let userId = authService.currentUser?.id else { return }
                                await itineraryService.markWaypointCompleted(
                                    waypointId: waypoint.id,
                                    groupId: groupId,
                                    updatedBy: userId
                                )
                            }
                        } : nil,
                        onDelete: isLeader ? {
                            Task {
                                guard let groupId = groupService.currentGroup?.id,
                                      let userId = authService.currentUser?.id else { return }
                                await itineraryService.removeWaypoint(
                                    waypointId: waypoint.id,
                                    groupId: groupId,
                                    updatedBy: userId
                                )
                            }
                        } : nil
                    )
                }
                .onMove(perform: isLeader ? moveWaypoints : nil)
            } header: {
                HStack {
                    Text("upcoming".localized)
                        .font(.headline)
                        .foregroundColor(.primary)
                    Spacer()
                }
                .padding(.horizontal)
            }
        }
    }
    
    @ViewBuilder
    private func waypointSection(title: String, waypoints: [Waypoint], isCompleted: Bool) -> some View {
        if !waypoints.isEmpty {
            Section {
                ForEach(waypoints) { waypoint in
                    WaypointCard(
                        waypoint: waypoint,
                        locationService: locationService,
                        isLeader: isLeader,
                        onTap: { selectedWaypoint = waypoint },
                        onComplete: isLeader && !waypoint.isCompleted ? {
                            Task {
                                guard let groupId = groupService.currentGroup?.id,
                                      let userId = authService.currentUser?.id else { return }
                                await itineraryService.markWaypointCompleted(
                                    waypointId: waypoint.id,
                                    groupId: groupId,
                                    updatedBy: userId
                                )
                            }
                        } : nil,
                        onDelete: isLeader ? {
                            Task {
                                guard let groupId = groupService.currentGroup?.id,
                                      let userId = authService.currentUser?.id else { return }
                                await itineraryService.removeWaypoint(
                                    waypointId: waypoint.id,
                                    groupId: groupId,
                                    updatedBy: userId
                                )
                            }
                        } : nil
                    )
                }
            } header: {
                HStack {
                    Text(title)
                        .font(.headline)
                        .foregroundColor(isCompleted ? .secondary : .primary)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.top, isCompleted ? 8 : 0)
            }
        }
    }

    private func setupItineraryService() {
        guard let group = groupService.currentGroup,
              let user = authService.currentUser else { return }
        
        // Connect location service to itinerary service for automatic Live Activity management
        itineraryService.setLocationService(locationService)
        
        let isLeader = group.leader?.userId == user.id
        itineraryService.startListeningToItinerary(
            groupId: group.id,
            userId: user.id,
            groupName: group.name,
            userRole: isLeader ? "leader" : "follower",
            leaderName: group.leader?.displayName ?? "",
            memberCount: group.members.count
        )
        
        locationService.startTracking(groupId: group.id, userId: user.id)
    }
    
    private func moveWaypoints(from source: IndexSet, to destination: Int) {
        print("🔄 moveWaypoints called: from \(source) to \(destination)")
        
        guard let groupId = groupService.currentGroup?.id,
              let userId = authService.currentUser?.id,
              let itinerary = itineraryService.currentItinerary else { 
            print("❌ Missing required data for moveWaypoints")
            return 
        }
        
        // Get the upcoming waypoints and reorder them
        var reorderedWaypoints = itinerary.upcomingWaypoints
        print("📋 Original waypoints count: \(reorderedWaypoints.count)")
        
        reorderedWaypoints.move(fromOffsets: source, toOffset: destination)
        
        // Update the order property for each waypoint
        for (index, waypoint) in reorderedWaypoints.enumerated() {
            var updatedWaypoint = waypoint
            updatedWaypoint.order = index + 1 // Start from 1, current waypoint is 0
            updatedWaypoint.updatedAt = Date()
            reorderedWaypoints[index] = updatedWaypoint
        }
        
        print("✅ Reordered waypoints, updating Firebase...")
        
        // Update in Firebase
        Task {
            await itineraryService.reorderWaypoints(
                waypoints: reorderedWaypoints,
                groupId: groupId,
                updatedBy: userId
            )
        }
    }
    
    private func importLocationAsWaypoint(coordinate: CLLocationCoordinate2D, name: String) async {
        guard let groupId = groupService.currentGroup?.id,
              let userId = authService.currentUser?.id else {
            print("❌ Missing required data for import")
            return
        }
        
        print("📍 Importing location: \(name) at \(coordinate)")
        
        await itineraryService.addWaypoint(
            name: name,
            description: "imported_from_google_maps".localized,
            type: .destination,
            location: coordinate,
            groupId: groupId,
            createdBy: userId
        )
    }
}
